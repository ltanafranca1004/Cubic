import { io, type Socket } from 'socket.io-client';
import {
  applyInteract,
  applyMove,
  createGame,
  quickIndex,
  QUICK_CHATS,
  type ChatMessage,
  type ClientToServer,
  type DevCommand,
  type GameEvent,
  type GameState,
  type InteractOnly,
  type MemberInfo,
  type QuickChat,
  type Role,
  type RoomInfo,
  type Seat,
  type SeatAway,
  type ServerInfo,
  type ServerToClient,
  type Side,
  type TtsChain,
  type TtsClip,
  type VoiceChunk,
} from '@cubic/shared';
import { soloLeftUntil, type Saved } from './left';

// Socket client + move prediction. The local player's input is applied at once to a
// predicted copy of the state with the same /shared code the server runs; every server
// update replaces the truth and replays whatever the server has not acknowledged yet.

/**
 * Where the game server is. Production builds use VITE_SERVER_URL (the Render URL). In dev,
 * when it is unset, the client talks to its own origin and Vite proxies /socket.io to the
 * local server, so the game also works through a single tunnel URL. '' = same origin.
 */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');

/**
 * Ask the server's /health. It wakes it as early as possible (the Render free tier sleeps
 * when idle and a cold start takes about 50 seconds), and its answer says whether this
 * page's origin may connect at all. True = the server is up and refuses us: its
 * CLIENT_ORIGIN does not list this site. False = allowed, or no answer yet (still waking).
 */
export async function serverBlocksUs(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
    return ((await res.json()) as { originAllowed?: boolean }).originAllowed === false;
  } catch {
    return false;
  }
}
const SEAT_KEY = 'cubic.seat';
/**
 * The seat we pressed Leave on. The server holds it for a while: joining that room again
 * with its code sends this token along and gets the same seat back. Not used on a refresh
 * (Leave means leave), and per tab like SEAT_KEY.
 */
const LEFT_KEY = 'cubic.left';

function saved(key: string): Saved | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

type Pending = { seq: number; kind: 'move'; dx: number; dy: number } | { seq: number; kind: 'interact'; only?: InteractOnly };

export interface NetHandlers {
  /** Connection, seat, room or game state changed. */
  onChange(): void;
  /** Things that just happened. `local` = predicted from our own input. */
  onEvents(events: GameEvent[], local: boolean): void;
  onChat(msg: ChatMessage): void;
  /** A quick-chat line was said (by either player). */
  onQuick?(quick: QuickChat): void;
  onTyping(on: boolean): void;
  onVoiceReady(): void;
  onVoiceSignal(data: unknown): void;
  onVoiceChunk(chunk: VoiceChunk): void;
  onTts(clip: TtsClip): void;
  /** A relay line as a chain of clips, one per vocabulary piece. */
  onTtsChain?(chain: TtsChain): void;
  /** Say an AI line with the browser's own voice. */
  onSpeak(text: string): void;
}

export class Net {
  online = false;
  /**
   * The server is up but refuses this site (a wrong CLIENT_ORIGIN on the server). Not the
   * same as a cold start: waiting will not help, so the menus say so.
   */
  blocked = false;
  info: ServerInfo = { aiAvailable: false, ttsAvailable: false, ttsMode: 'browser' };
  code: string | null = null;
  /** Our member id in the room: who we are in `room.members`. */
  id: number | null = null;
  /** Host or guest. Follows the room: the guest is promoted when the host leaves. */
  role: Role | null = null;
  /** Null in the lobby until we pick a side. */
  side: Side | null = null;
  room: RoomInfo | null = null;
  chat: ChatMessage[] = [];
  /** What we draw: server state + our unacknowledged input. */
  state: GameState | null = null;
  error: string | null = null;
  busy = false;

  private socket: Socket<ServerToClient, ClientToServer> | null = null;
  private server: GameState | null = null;
  private pending: Pending[] = [];
  private seq = 0;
  private localId = 0;
  /** The server's clock minus ours, from the last room info that carried the server's time. */
  private skew = 0;

  constructor(
    private h: NetHandlers,
    /** Offline: no server, a local game where you play `offlineSide` (for ?mock). */
    private offlineSide: Side | null = null,
  ) {}

  start(): void {
    if (this.offlineSide) {
      this.online = true;
      this.side = this.offlineSide;
      this.code = 'MOCK';
      this.state = createGame(Date.now());
      this.state.players.out.connected = this.state.players.in.connected = true;
      this.id = 1;
      this.role = 'host';
      const member = (id: number, side: Side): MemberInfo => ({ id, connected: true, isAI: false, side, ready: true });
      this.room = {
        code: 'MOCK',
        mode: 'friend',
        phase: 'playing',
        seats: { out: { taken: true, connected: true, isAI: false }, in: { taken: true, connected: true, isAI: false } },
        members: { host: member(1, this.offlineSide), guest: member(2, this.offlineSide === 'out' ? 'in' : 'out') },
      };
      this.h.onChange();
      return;
    }
    // wakes a sleeping server; and each time the socket is refused, asks why
    const probe = () =>
      void serverBlocksUs().then((blocked) => {
        if (this.online || blocked === this.blocked) return;
        this.blocked = blocked;
        this.h.onChange();
      });
    probe();
    // WebSocket first; where a network blocks it (some campus and office networks), HTTP
    // long-polling. Without tryAllTransports the client would never try the second one.
    const options = { transports: ['websocket', 'polling'], tryAllTransports: true };
    const socket = (this.socket = SERVER_URL ? io(SERVER_URL, options) : io(options));
    socket.on('connect_error', probe); // the socket keeps retrying by itself
    socket.on('connect', () => {
      this.online = true;
      this.blocked = false;
      this.h.onChange();
      this.tryRejoin();
    });
    socket.on('disconnect', () => {
      this.online = false;
      this.h.onChange();
    });
    socket.on('info', (info) => {
      this.info = info;
      this.h.onChange();
    });
    socket.on('room', (room) => {
      this.setRoom(room);
      this.sync();
      this.h.onChange();
    });
    socket.on('state', (u) => {
      this.server = u.state;
      if (!this.side) return;
      const ack = u.acks[this.side];
      this.pending = this.pending.filter((p) => p.seq > ack);
      this.repredict();
      this.h.onChange();
      // Our own steps were already played when predicted; the rest is news.
      const me = this.side;
      const news = u.events.filter((e: GameEvent) => !('side' in e) || e.side !== me);
      if (news.length) this.h.onEvents(news, false);
    });
    socket.on('chat', (msg) => {
      this.chat = [...this.chat, msg];
      this.h.onChat(msg);
      this.h.onChange();
    });
    socket.on('quick', (q) => this.h.onQuick?.(q));
    socket.on('typing', (t) => this.h.onTyping(t.on));
    socket.on('voice:ready', () => this.h.onVoiceReady());
    socket.on('voice:signal', (m) => this.h.onVoiceSignal(m.data));
    socket.on('voice:chunk', (c) => this.h.onVoiceChunk(c));
    socket.on('tts', (c) => this.h.onTts(c));
    socket.on('tts:chain', (c) => this.h.onTtsChain?.(c));
    socket.on('speak', (m) => this.h.onSpeak(m.text));
  }

  private repredict(): void {
    if (!this.server || !this.side) return;
    const s = structuredClone(this.server);
    for (const p of this.pending) {
      if (p.kind === 'move') applyMove(s, this.side, p.dx, p.dy);
      else applyInteract(s, this.side, undefined, undefined, p.only);
    }
    this.state = s;
  }

  private setRoom(room: RoomInfo): void {
    this.room = room;
    const away = room.seats.out.away ?? room.seats.in.away;
    if (away) this.skew = away.now - Date.now();
  }

  /**
   * The partner's seat is held for them (they dropped, or pressed Leave): why, and until
   * when on OUR clock. Null when they are here, or when the seat is free.
   */
  partnerAway(): { kind: SeatAway['kind']; until: number } | null {
    const away = this.side ? this.room?.seats[this.side === 'out' ? 'in' : 'out'].away : undefined;
    return away ? { kind: away.kind, until: away.until - this.skew } : null;
  }

  /** Find ourselves in the room: the lobby decides our role and side, not us. */
  private sync(): void {
    const m = this.room?.members;
    const role: Role | null = this.id === null ? null : m?.host?.id === this.id ? 'host' : m?.guest?.id === this.id ? 'guest' : null;
    const side = role ? (m![role]!.side ?? null) : null;
    this.role = role;
    if (side === this.side) return;
    this.side = side;
    this.pending = [];
    if (side) this.repredict();
    else this.state = null;
  }

  private adopt(res: ({ ok: true } & Seat) | { ok: false; error: string }): void {
    this.busy = false;
    if (!res.ok) {
      this.error = res.error;
      this.h.onChange();
      return;
    }
    this.error = null;
    this.code = res.code;
    this.id = res.id;
    this.setRoom(res.room);
    this.chat = res.chat;
    this.server = res.state;
    // a new seat, or the same one after a reconnect: the server counts our moves from 0
    this.pending = [];
    this.seq = 0;
    this.side = null;
    this.state = null;
    this.sync();
    // sessionStorage, not localStorage: two windows of one browser must be two players.
    try {
      sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: res.code, token: res.token }));
      sessionStorage.removeItem(LEFT_KEY);
    } catch {
      // storage blocked: reconnect after a refresh will not work, the game still does
    }
    this.h.onChange();
  }

  private tryRejoin(): void {
    const seat = saved(SEAT_KEY);
    if (!seat || !this.socket) return;
    this.socket.emit('room:rejoin', seat, (res) => {
      if (res.ok) this.adopt(res);
      else {
        this.error = res.error; // the room is gone (it emptied, or the server restarted): say why we are back on the menu
        this.forget();
      }
    });
  }

  private forget(): void {
    try {
      sessionStorage.removeItem(SEAT_KEY);
    } catch {
      // ignore
    }
    this.code = this.id = this.role = this.side = this.room = this.state = this.server = null;
    this.chat = [];
    this.pending = [];
    this.h.onChange();
  }

  private begin(): boolean {
    if (!this.socket || !this.online) {
      this.error = 'Cannot reach the server.';
      this.h.onChange();
      return false;
    }
    this.busy = true;
    this.error = null;
    this.h.onChange();
    return true;
  }

  createRoom(): void {
    if (this.begin()) this.socket!.emit('room:create', (res) => this.adopt(res));
  }

  joinRoom(code: string): void {
    if (!/^[A-Za-z]{4}$/.test(code.trim())) {
      this.error = 'Room codes are 4 letters.';
      this.h.onChange();
      return;
    }
    const room = code.trim().toUpperCase();
    // the room we pressed Leave in: our token takes the held seat back
    const left = saved(LEFT_KEY);
    if (this.begin()) this.socket!.emit('room:join', { code: room, ...(left?.code === room ? { token: left.token } : {}) }, (res) => this.adopt(res));
  }

  playWithAI(side: Side): void {
    if (this.begin()) this.socket!.emit('room:createAI', { side }, (res) => this.adopt(res));
  }

  /** The solo game this tab left and can still go back to: until when, or null. */
  leftSolo(): number | null {
    return soloLeftUntil(saved(LEFT_KEY), Date.now());
  }

  /**
   * Back into the solo game we pressed Leave in: the same path as a friend room (the code
   * and our token give the held seat back), only the code is not typed.
   */
  resumeSolo(): void {
    const left = saved(LEFT_KEY);
    if (!left?.solo) return;
    if (!this.begin()) return;
    this.socket!.emit('room:join', { code: left.code, token: left.token }, (res) => {
      if (!res.ok) {
        // the window passed: the room is closed and the AI has stopped
        try {
          sessionStorage.removeItem(LEFT_KEY);
        } catch {
          // ignore
        }
      }
      this.adopt(res.ok ? res : { ok: false, error: 'That game is over. Start a new one.' });
    });
  }

  /** A lobby action. The server owns the rules: on a refusal we only show its reason. */
  private lobby(send: (ack: (res: { ok: true } | { ok: false; error: string }) => void) => void): void {
    if (!this.socket) return;
    this.error = null;
    send((res) => {
      this.error = res.ok ? null : res.error;
      this.h.onChange();
    });
  }

  /** Lobby: take a side, or null to step back to the middle. */
  pickSide(side: Side | null): void {
    this.lobby((ack) => this.socket!.emit('lobby:pick', { side }, ack));
  }

  /** Lobby, guest: ready up or take it back. */
  setReady(ready: boolean): void {
    this.lobby((ack) => this.socket!.emit('lobby:ready', { ready }, ack));
  }

  /** Lobby, host: start the game. */
  startGame(): void {
    this.lobby((ack) => this.socket!.emit('lobby:start', ack));
  }

  leave(): void {
    const seat = saved(SEAT_KEY);
    // a solo game has no code to come back with: remember that it was one, and when we left
    const solo = this.room?.mode === 'ai';
    this.socket?.emit('room:leave');
    this.forget();
    try {
      if (seat) sessionStorage.setItem(LEFT_KEY, JSON.stringify(solo ? { ...seat, solo, at: Date.now() } : seat));
    } catch {
      // storage blocked: coming back with the code will be a new join
    }
  }

  restart(): void {
    if (this.offlineSide) {
      this.state = createGame(Date.now());
      this.h.onChange();
    } else this.socket?.emit('room:restart');
  }

  /** Predict a step locally, then tell the server. */
  move(dx: number, dy: number): void {
    if (!this.state || !this.side) return;
    const events = applyMove(this.state, this.side, dx, dy);
    if (this.socket) {
      const seq = ++this.seq;
      this.pending.push({ seq, kind: 'move', dx, dy });
      this.socket.emit('move', { dx, dy, seq });
    }
    this.finish(events);
  }

  /** E: pick up or drop. `only: 'drop'` (Q) drops and never picks up. */
  interact(only?: InteractOnly): void {
    if (!this.state || !this.side) return;
    const events = applyInteract(this.state, this.side, undefined, undefined, only);
    if (this.socket) {
      const seq = ++this.seq;
      this.pending.push({ seq, kind: 'interact', ...(only ? { only } : {}) });
      this.socket.emit('interact', { seq, ...(only ? { only } : {}) });
    }
    this.finish(events);
  }

  /** Say one of the fixed quick-chat lines (0..3). */
  quick(index: number): void {
    const i = quickIndex(index);
    if (i === null || !this.state || !this.side) return;
    if (this.socket) {
      this.socket.emit('quick', { index: i });
      return;
    }
    // offline (?mock): the same two things the server would send
    const msg: ChatMessage = { id: ++this.localId, from: this.side, isAI: false, text: QUICK_CHATS[i], at: Date.now() };
    this.chat = [...this.chat, msg];
    this.h.onQuick?.({ id: ++this.localId, from: this.side, index: i, chatId: msg.id, at: msg.at });
    this.h.onChange();
  }

  private finish(events: GameEvent[]): void {
    this.h.onChange();
    // Online, events without a side (solve, win, puzzle) are announced by the server.
    const me = this.side;
    const mine = this.socket ? events.filter((e) => 'side' in e && e.side === me) : events;
    if (mine.length) this.h.onEvents(mine, true);
  }

  /** Dev tools (?dev): ask the server to run a dev command. It refuses unless DEV_COMMANDS=1. */
  dev(cmd: DevCommand): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      if (!this.socket || !this.online) resolve({ ok: false, error: 'Not connected to a server.' });
      else this.socket.emit('dev', cmd, resolve);
    });
  }

  sendChat(text: string): void {
    this.socket?.emit('chat', { text });
  }

  voiceSignal(data: unknown): void {
    this.socket?.emit('voice:signal', { data });
  }

  voiceChunk(chunk: VoiceChunk): void {
    this.socket?.emit('voice:chunk', chunk);
  }
}
