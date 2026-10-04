import { randomBytes } from 'node:crypto';
import {
  CHAT_MAX_LEN,
  SIDES,
  TICK_MS,
  applyInteract,
  applyMove,
  createGame,
  needsTick,
  tick,
  type ChatMessage,
  type GameEvent,
  type GameState,
  type MemberInfo,
  type Role,
  type RoomInfo,
  type RoomMode,
  type RoomPhase,
  type Seat,
  type Side,
  type StateUpdate,
} from '@cubic/shared';

// Rooms: the server owns each room's GameState and is the only thing that changes it.
// Transport-agnostic: index/app wires sockets to these methods, the AI partner calls the
// same ones, so a bot can do nothing a human cannot.
//
// A friend room starts in the LOBBY: the host (who made it) and the guest (who joined)
// each pick a side, the guest readies up and the host starts. From then on the room is
// PLAYING and the sides are locked. AI rooms skip the lobby.

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
const CODE_LEN = 4;
/** How long a disconnected player's seat is held for them once the game is running. */
export const SEAT_HOLD_MS = 60_000;
const CHAT_HISTORY = 60;
const CHAT_WINDOW_MS = 5_000;
const CHAT_PER_WINDOW = 5;
/**
 * Tunable (tests change these). Move budget: a burst of moveBurst, refilled one per
 * moveRefillMs (~11 moves/s). lobbyHoldMs: how long a place in the lobby is held after a
 * disconnect (short: the room is blocked for a new guest meanwhile).
 */
export const LIMITS = { moveBurst: 5, moveRefillMs: 90, lobbyHoldMs: 15_000 };

interface Member {
  id: number;
  token: string;
  role: Role;
  isAI: boolean;
  connected: boolean;
  side: Side | null;
  ready: boolean;
  /** Highest move seq processed (echoed back for prediction). */
  ack: number;
  budget: number;
  budgetAt: number;
  chatTimes: number[];
  dropTimer: NodeJS.Timeout | null;
}

/** A member by id, or whoever holds a side. */
type Who = number | Side;

export interface RoomListener {
  onState?(update: StateUpdate): void;
  onChat?(msg: ChatMessage): void;
  onRoom?(info: RoomInfo): void;
  onTyping?(side: Side, on: boolean): void;
  onClosed?(): void;
}

export class Room {
  state: GameState;
  readonly chat: ChatMessage[] = [];
  phase: RoomPhase;
  private members: Member[] = [];
  private listeners = new Set<RoomListener>();
  private chatId = 0;
  private memberId = 0;
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    readonly mode: RoomMode,
    private readonly onEmpty: (room: Room) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.state = createGame(this.now());
    // An AI game has nothing to wait for: the human chose a side with the button.
    this.phase = mode === 'ai' ? 'playing' : 'lobby';
    if (needsTick()) {
      this.ticker = setInterval(() => {
        if (this.phase === 'playing') this.emitState(tick(this.state, TICK_MS, this.now()));
      }, TICK_MS);
      this.ticker.unref();
    }
  }

  listen(l: RoomListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private find(who: Who): Member | undefined {
    return typeof who === 'number' ? this.members.find((m) => m.id === who) : this.members.find((m) => m.side === who);
  }

  private byRole(role: Role): Member | undefined {
    return this.members.find((m) => m.role === role);
  }

  info(): RoomInfo {
    const seat = (side: Side) => {
      const m = this.find(side);
      return { taken: !!m, connected: !!m?.connected, isAI: !!m?.isAI };
    };
    const member = (role: Role): MemberInfo | null => {
      const m = this.byRole(role);
      return m ? { id: m.id, connected: m.connected, isAI: m.isAI, side: m.side, ready: m.ready } : null;
    };
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      seats: { out: seat('out'), in: seat('in') },
      members: { host: member('host'), guest: member('guest') },
    };
  }

  acks(): Record<Side, number> {
    return { out: this.find('out')?.ack ?? 0, in: this.find('in')?.ack ?? 0 };
  }

  /** Both places are taken (a held place counts). */
  isFull(): boolean {
    return this.members.length >= 2;
  }

  freeSide(): Side | null {
    return SIDES.find((s) => !this.find(s)) ?? null;
  }

  idOfToken(token: string): number | null {
    return this.members.find((m) => m.token === token)?.id ?? null;
  }

  sideOf(id: number): Side | null {
    return this.find(id)?.side ?? null;
  }

  isConnected(side: Side): boolean {
    return !!this.find(side)?.connected;
  }

  private add(isAI: boolean, side: Side | null): Member {
    if (this.isFull()) throw new Error('That room is full.');
    const m: Member = {
      id: ++this.memberId,
      token: randomBytes(16).toString('hex'),
      role: this.byRole('host') ? 'guest' : 'host',
      isAI,
      connected: true,
      side,
      ready: false,
      ack: 0,
      budget: LIMITS.moveBurst,
      budgetAt: this.now(),
      chatTimes: [],
      dropTimer: null,
    };
    this.members.push(m);
    this.seatPlayer(m);
    return m;
  }

  /** Copy a member's presence onto the player they control. */
  private seatPlayer(m: Member): void {
    if (!m.side) return;
    const player = this.state.players[m.side];
    player.connected = m.connected;
    player.isAI = m.isAI;
  }

  /**
   * Come into the room. In the lobby you arrive with no side (host first, then guest).
   * If the game is already running you take the seat that is free.
   */
  join(isAI = false): Seat {
    const m = this.add(isAI, this.phase === 'playing' ? this.freeSide() : null);
    this.emitRoom();
    this.emitState([]);
    return this.seatView(m);
  }

  /** Take a seat directly, skipping the lobby (AI games, tests). The game starts when both seats are taken. */
  sit(side: Side, isAI = false): Seat {
    if (this.find(side)) throw new Error('seat taken');
    const m = this.add(isAI, side);
    if (this.find('out') && this.find('in')) {
      this.phase = 'playing';
      this.state.startedAt = this.now(); // the clock starts when both are here
    }
    this.emitRoom();
    this.emitState([]);
    return this.seatView(m);
  }

  // ---------- lobby ----------

  private inLobby(id: number): Member {
    const m = this.find(id);
    if (!m) throw new Error('You are not in this room.');
    if (this.phase !== 'lobby') throw new Error('The game has already started.');
    return m;
  }

  /** Lobby: take a side, or null to step back to the middle. Both players cannot hold the same side. */
  pick(id: number, side: Side | null): void {
    const m = this.inLobby(id);
    if (side !== null && side !== 'out' && side !== 'in') throw new Error('No such side.');
    if (m.side === side) return;
    if (side && this.find(side)) throw new Error('Your partner already picked that side.');
    m.side = side;
    if (m.role === 'guest') m.ready = false; // a new pick has to be confirmed again
    this.emitRoom();
  }

  /** Lobby: the guest readies up (needs a side) or takes it back. */
  setReady(id: number, ready: boolean): void {
    const m = this.inLobby(id);
    if (m.role !== 'guest') throw new Error('The host starts the game. Only the guest readies up.');
    if (ready && !m.side) throw new Error('Pick a side first.');
    if (m.ready === !!ready) return;
    m.ready = !!ready;
    this.emitRoom();
  }

  /** Why the host cannot start yet, or null when everything is in place. */
  startBlocker(): string | null {
    const host = this.byRole('host');
    const guest = this.byRole('guest');
    if (this.phase !== 'lobby') return 'The game has already started.';
    if (!guest || !guest.connected) return 'Waiting for a second player.';
    if (!host?.side || !guest.side) return 'Both players need to pick a side.';
    if (!guest.ready) return 'Your partner is not ready yet.';
    return null;
  }

  /** Lobby: the host starts the game. The sides are locked from here on. */
  start(id: number): void {
    const m = this.inLobby(id);
    if (m.role !== 'host') throw new Error('Only the host can start the game.');
    const blocker = this.startBlocker();
    if (blocker) throw new Error(blocker);
    this.phase = 'playing';
    this.state = createGame(this.now());
    for (const x of this.members) this.seatPlayer(x);
    this.emitRoom();
    this.emitState([]);
  }

  // ---------- coming and going ----------

  /** A player came back with their token. */
  resume(id: number): Seat {
    const m = this.find(id);
    if (!m) throw new Error('That room is gone.');
    if (m.dropTimer) clearTimeout(m.dropTimer);
    m.dropTimer = null;
    m.connected = true;
    this.seatPlayer(m);
    this.emitRoom();
    this.emitState([]);
    return this.seatView(m);
  }

  /** Socket dropped: hold the place for a while so a refresh can rejoin. */
  drop(who: Who): void {
    const m = this.find(who);
    if (!m) return;
    m.connected = false;
    if (this.phase === 'lobby') {
      // Nobody can start a game with someone who is not there: their pick and ready go.
      m.ready = false;
      m.side = null;
    } else this.seatPlayer(m);
    if (m.dropTimer) clearTimeout(m.dropTimer);
    m.dropTimer = setTimeout(() => this.leave(m.id), this.phase === 'lobby' ? LIMITS.lobbyHoldMs : SEAT_HOLD_MS);
    m.dropTimer.unref();
    this.emitRoom();
    this.emitState([]);
  }

  /** Give the place up for good. If the host goes, whoever is left becomes the host. */
  leave(who: Who): void {
    const m = this.find(who);
    if (!m) return;
    if (m.dropTimer) clearTimeout(m.dropTimer);
    this.members = this.members.filter((x) => x !== m);
    if (m.side) this.state.players[m.side].connected = false;
    if (!this.members.some((x) => !x.isAI)) {
      this.close();
      return;
    }
    const rest = this.members[0]!;
    rest.role = 'host';
    rest.ready = false;
    this.emitRoom();
    this.emitState([]);
  }

  close(): void {
    if (this.ticker) clearInterval(this.ticker);
    for (const m of this.members) if (m.dropTimer) clearTimeout(m.dropTimer);
    this.members = [];
    for (const l of this.listeners) l.onClosed?.();
    this.listeners.clear();
    this.onEmpty(this);
  }

  private seatView(m: Member): Seat {
    return { code: this.code, id: m.id, role: m.role, side: m.side, token: m.token, room: this.info(), state: this.state, chat: this.chat };
  }

  /** Whoever holds `side`, once the game is running (nothing moves in the lobby). */
  private playing(side: Side): Member | undefined {
    return this.phase === 'playing' ? this.find(side) : undefined;
  }

  private spend(seat: Member): boolean {
    const now = this.now();
    seat.budget = Math.min(LIMITS.moveBurst, seat.budget + (now - seat.budgetAt) / LIMITS.moveRefillMs);
    seat.budgetAt = now;
    if (seat.budget < 1) return false;
    seat.budget -= 1;
    return true;
  }

  /** Validated move. `seq` is echoed back so the mover can reconcile its prediction. */
  move(side: Side, dx: number, dy: number, seq = 0): GameEvent[] {
    const seat = this.playing(side);
    if (!seat) return [];
    if (seq > seat.ack) seat.ack = seq;
    const events = this.spend(seat) ? applyMove(this.state, side, dx, dy, this.now()) : [];
    this.emitState(events);
    return events;
  }

  interact(side: Side, seq = 0): GameEvent[] {
    const seat = this.playing(side);
    if (!seat) return [];
    if (seq > seat.ack) seat.ack = seq;
    const events = this.spend(seat) ? applyInteract(this.state, side, this.now()) : [];
    this.emitState(events);
    return events;
  }

  /** Chat line. Returns the stored message, or null if it was empty or rate limited. */
  say(side: Side, text: string): ChatMessage | null {
    const seat = this.playing(side);
    if (!seat || typeof text !== 'string') return null;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
    if (!clean) return null;
    const now = this.now();
    seat.chatTimes = seat.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (seat.chatTimes.length >= CHAT_PER_WINDOW) return null;
    seat.chatTimes.push(now);
    const msg: ChatMessage = { id: ++this.chatId, from: side, isAI: seat.isAI, text: clean, at: now };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    for (const l of this.listeners) l.onChat?.(msg);
    return msg;
  }

  /** The AI partner is thinking (typing indicator). */
  setTyping(side: Side, on: boolean): void {
    for (const l of this.listeners) l.onTyping?.(side, on);
  }

  /** New game in the same room (after a win). Everyone keeps their side. */
  restart(): void {
    if (this.phase !== 'playing' || this.state.wonAt === null) return;
    this.state = createGame(this.now());
    for (const m of this.members) this.seatPlayer(m);
    this.emitState([]);
  }

  /**
   * Dev tools only (see dev.ts, DEV_COMMANDS=1): change the state with a /shared dev
   * helper, then broadcast it like any other change.
   */
  devApply(change: (state: GameState, now: number) => GameEvent[]): GameEvent[] {
    const events = change(this.state, this.now());
    this.emitState(events);
    return events;
  }

  private emitState(events: GameEvent[]): void {
    const update: StateUpdate = { state: this.state, events, acks: this.acks() };
    for (const l of this.listeners) l.onState?.(update);
  }

  private emitRoom(): void {
    const info = this.info();
    for (const l of this.listeners) l.onRoom?.(info);
  }
}

export class Rooms {
  private rooms = new Map<string, Room>();

  get size(): number {
    return this.rooms.size;
  }

  create(mode: RoomMode): Room {
    const roll = () => Array.from(randomBytes(CODE_LEN), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
    let code = roll();
    while (this.rooms.has(code)) code = roll();
    const room = new Room(code, mode, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: unknown): Room | undefined {
    return typeof code === 'string' ? this.rooms.get(code.trim().toUpperCase()) : undefined;
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) room.close();
  }
}
