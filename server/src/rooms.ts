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
  type RoomInfo,
  type RoomMode,
  type Seat,
  type Side,
  type StateUpdate,
} from '@cubic/shared';

// Rooms: the server owns each room's GameState and is the only thing that changes it.
// Transport-agnostic: index/app wires sockets to these methods, the AI partner calls the
// same ones, so a bot can do nothing a human cannot.

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
const CODE_LEN = 4;
/** How long a disconnected player's seat is held for them. */
export const SEAT_HOLD_MS = 60_000;
const CHAT_HISTORY = 60;
const CHAT_WINDOW_MS = 5_000;
const CHAT_PER_WINDOW = 5;
/** Move budget: a burst of moveBurst, refilled one per moveRefillMs (~11 moves/s). */
/** Tunable (tests lift it). */
export const LIMITS = { moveBurst: 5, moveRefillMs: 90 };

interface SeatData {
  token: string;
  isAI: boolean;
  connected: boolean;
  /** Highest move seq processed (echoed back for prediction). */
  ack: number;
  budget: number;
  budgetAt: number;
  chatTimes: number[];
  dropTimer: NodeJS.Timeout | null;
}

export interface RoomListener {
  onState?(update: StateUpdate): void;
  onChat?(msg: ChatMessage): void;
  onRoom?(info: RoomInfo): void;
  onClosed?(): void;
}

export class Room {
  state: GameState;
  readonly chat: ChatMessage[] = [];
  private seats: Partial<Record<Side, SeatData>> = {};
  private listeners = new Set<RoomListener>();
  private chatId = 0;
  private ticker: NodeJS.Timeout | null = null;
  private everFull = false;

  constructor(
    readonly code: string,
    readonly mode: RoomMode,
    private readonly onEmpty: (room: Room) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.state = createGame(this.now());
    if (needsTick()) {
      this.ticker = setInterval(() => this.emitState(tick(this.state, TICK_MS, this.now())), TICK_MS);
      this.ticker.unref();
    }
  }

  listen(l: RoomListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  info(): RoomInfo {
    const seat = (side: Side) => {
      const s = this.seats[side];
      return { taken: !!s, connected: !!s?.connected, isAI: !!s?.isAI };
    };
    return { code: this.code, mode: this.mode, seats: { out: seat('out'), in: seat('in') } };
  }

  acks(): Record<Side, number> {
    return { out: this.seats.out?.ack ?? 0, in: this.seats.in?.ack ?? 0 };
  }

  freeSide(): Side | null {
    return SIDES.find((s) => !this.seats[s]) ?? null;
  }

  sideOfToken(token: string): Side | null {
    return SIDES.find((s) => this.seats[s]?.token === token) ?? null;
  }

  isConnected(side: Side): boolean {
    return !!this.seats[side]?.connected;
  }

  /** Take a free seat. */
  sit(side: Side, isAI = false): Seat {
    if (this.seats[side]) throw new Error('seat taken');
    const token = randomBytes(16).toString('hex');
    this.seats[side] = { token, isAI, connected: true, ack: 0, budget: LIMITS.moveBurst, budgetAt: this.now(), chatTimes: [], dropTimer: null };
    const player = this.state.players[side];
    player.connected = true;
    player.isAI = isAI;
    if (!this.everFull && this.seats.out && this.seats.in) {
      this.everFull = true;
      this.state.startedAt = this.now(); // the clock starts when both are here
    }
    this.emitRoom();
    this.emitState([]);
    return this.seatView(side);
  }

  /** A player came back with their token. */
  resume(side: Side): Seat {
    const seat = this.seats[side]!;
    if (seat.dropTimer) clearTimeout(seat.dropTimer);
    seat.dropTimer = null;
    seat.connected = true;
    this.state.players[side].connected = true;
    this.emitRoom();
    this.emitState([]);
    return this.seatView(side);
  }

  /** Socket dropped: hold the seat for a while so a refresh can rejoin. */
  drop(side: Side): void {
    const seat = this.seats[side];
    if (!seat) return;
    seat.connected = false;
    this.state.players[side].connected = false;
    if (seat.dropTimer) clearTimeout(seat.dropTimer);
    seat.dropTimer = setTimeout(() => this.leave(side), SEAT_HOLD_MS);
    seat.dropTimer.unref();
    this.emitRoom();
    this.emitState([]);
  }

  /** Give the seat up for good. */
  leave(side: Side): void {
    const seat = this.seats[side];
    if (!seat) return;
    if (seat.dropTimer) clearTimeout(seat.dropTimer);
    delete this.seats[side];
    this.state.players[side].connected = false;
    this.emitRoom();
    this.emitState([]);
    const humans = SIDES.filter((s) => this.seats[s] && !this.seats[s]!.isAI);
    if (humans.length === 0) this.close();
  }

  close(): void {
    if (this.ticker) clearInterval(this.ticker);
    for (const s of SIDES) if (this.seats[s]?.dropTimer) clearTimeout(this.seats[s]!.dropTimer!);
    this.seats = {};
    for (const l of this.listeners) l.onClosed?.();
    this.listeners.clear();
    this.onEmpty(this);
  }

  private seatView(side: Side): Seat {
    return { code: this.code, side, token: this.seats[side]!.token, room: this.info(), state: this.state, chat: this.chat };
  }

  private spend(seat: SeatData): boolean {
    const now = this.now();
    seat.budget = Math.min(LIMITS.moveBurst, seat.budget + (now - seat.budgetAt) / LIMITS.moveRefillMs);
    seat.budgetAt = now;
    if (seat.budget < 1) return false;
    seat.budget -= 1;
    return true;
  }

  /** Validated move. `seq` is echoed back so the mover can reconcile its prediction. */
  move(side: Side, dx: number, dy: number, seq = 0): GameEvent[] {
    const seat = this.seats[side];
    if (!seat) return [];
    if (seq > seat.ack) seat.ack = seq;
    const events = this.spend(seat) ? applyMove(this.state, side, dx, dy, this.now()) : [];
    this.emitState(events);
    return events;
  }

  interact(side: Side, seq = 0): GameEvent[] {
    const seat = this.seats[side];
    if (!seat) return [];
    if (seq > seat.ack) seat.ack = seq;
    const events = this.spend(seat) ? applyInteract(this.state, side, this.now()) : [];
    this.emitState(events);
    return events;
  }

  /** Chat line. Returns the stored message, or null if it was empty or rate limited. */
  say(side: Side, text: string): ChatMessage | null {
    const seat = this.seats[side];
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

  /** New game in the same room (after a win). */
  restart(): void {
    if (this.state.wonAt === null) return;
    const old = this.state;
    this.state = createGame(this.now());
    for (const s of SIDES) {
      this.state.players[s].connected = old.players[s].connected;
      this.state.players[s].isAI = old.players[s].isAI;
    }
    this.emitState([]);
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
    let code = '';
    do {
      code = Array.from(randomBytes(CODE_LEN), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
    } while (this.rooms.has(code));
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
