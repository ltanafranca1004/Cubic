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
  type AiVoice,
  type VoicePreview,
  type VoiceChunk,
} from '@cubic/shared';
import { soloLeftUntil, type Saved } from './left';
import { viewerNote } from './notes';
import { WAKE, socketOptions, type WakeState } from './wake';

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

/** At most one `activity` message per this long. */
const ACTIVITY_EVERY_MS = 3000;

/**
 * A system line as the UI gets it: stamped with OUR clock. `at` is when it arrived, and a
 * countdown's `until` is moved from the server's clock to ours (`until - Date.now()` is
 * what is left). A line about the other player is worded "Your partner ..." (`viewerNote`):
 * `me` is our member id.
 */
function localNote(raw: ChatMessage, me: number | null): ChatMessage {
  const msg = viewerNote(raw, me);
  const s = msg.system;
  if (!s) return msg;
  const now = Date.now();
  const skew = now - s.now; // our clock minus the server's
  return { ...msg, at: msg.at + skew, system: { ...s, now, ...(s.until !== undefined ? { until: s.until + skew } : {}) } };
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
  /**
   * Not online: since when we have been trying (our clock), and whether we stopped (the
   * menus then show RETRY). Null while online. See `wake.ts` for the numbers.
   */
  wake: WakeState | null = null;
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
  private activityAt = 0;
  /** The AI partner's voice (Settings), as the server was last told. Null = never set: the server's default. */
  private aiVoice: AiVoice | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

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
    const probe = () => this.probe();
    this.wait();
    probe();
    const options = socketOptions();
    const socket = (this.socket = SERVER_URL ? io(SERVER_URL, options) : io(options));
    socket.on('connect_error', probe); // the socket keeps retrying by itself
    socket.on('connect', () => {
      this.online = true;
      this.blocked = false;
      this.wake = null;
      if (this.wakeTimer) clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
      this.h.onChange();
      // before the rejoin, so a solo room that takes us back speaks in our voice at once
      if (this.aiVoice) socket.emit('ai:voice', { voice: this.aiVoice });
      this.tryRejoin();
    });
    socket.on('disconnect', (reason) => {
      this.online = false;
      this.wait();
      this.h.onChange();
      // The server closed this socket (our seat was opened in another tab, see `removed`):
      // socket.io does not reconnect after that by itself. We have no seat any more, so
      // connecting again only puts the menus back online.
      if (reason === 'io server disconnect') socket.connect();
    });
    // Back from the background, or the network is back: try now instead of sitting out a
    // pause (a phone that was locked finds its socket dead, and its timers were frozen).
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.nudge());
      window.addEventListener('online', () => this.nudge());
    }
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
    socket.on('chat', (raw) => {
      const msg = localNote(raw, this.id);
      // a system line that has changed (the countdown ended) takes the place of its old form
      this.chat = this.chat.some((m) => m.id === msg.id) ? this.chat.map((m) => (m.id === msg.id ? msg : m)) : [...this.chat, msg];
      this.h.onChat(msg);
      this.h.onChange();
    });
    socket.on('removed', (msg) => {
      // The server took us out of the room: say why on the mode screen. Not a Leave: there
      // is no seat to come back to (nothing is kept for "continue"), and when another tab
      // took the seat the room is not told anything, the token is that tab's now.
      this.error = msg?.reason === 'replaced' ? 'This seat was opened in another tab.' : 'You were removed for inactivity.';
      try {
        if (saved(LEFT_KEY)?.code === this.code) sessionStorage.removeItem(LEFT_KEY);
      } catch {
        // ignore
      }
      this.forget();
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

  /**
   * Ask /health: it wakes a sleeping server, and each time the socket is refused it says
   * whether that is a cold start or a server that refuses this site.
   */
  private probe(): void {
    void serverBlocksUs().then((blocked) => {
      if (this.online || blocked === this.blocked) return;
      this.blocked = blocked;
      this.h.onChange();
    });
  }

  /** We are not online from now: the wait starts, and with it the clock to the give-up. */
  private wait(): void {
    this.wake = { since: Date.now(), failed: false };
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => this.waited(), WAKE.giveUpMs);
  }

  /**
   * The wait is over and the server never answered: stop, and let the menus offer RETRY.
   * Never in a room: the seat may still be held, so the socket goes on by itself (the
   * game and the lobby say "reconnecting"); we look again once the room is gone.
   */
  private waited(): void {
    this.wakeTimer = null;
    if (this.online || !this.wake || this.wake.failed) return;
    // (nor while the server refuses this site: that line says it is retrying, and it is)
    if (this.code || this.blocked) {
      this.wakeTimer = setTimeout(() => this.waited(), WAKE.retryMaxMs);
      return;
    }
    this.wake = { ...this.wake, failed: true };
    this.socket?.disconnect(); // ends the retries; `retry` starts them again
    this.h.onChange();
  }

  /** One attempt right now, whatever pause the socket was in. Not while it is connected. */
  private attempt(): void {
    if (!this.socket || this.online) return;
    this.probe();
    this.socket.disconnect().connect();
  }

  /** RETRY on the menus: the whole wait again, from zero. */
  retry(): void {
    if (!this.socket || this.online) return;
    this.wait();
    this.attempt();
    this.h.onChange();
  }

  /** The page is visible again or the network came back: try at once (after a give-up, start over). */
  private nudge(): void {
    if (!this.socket || this.online) return;
    if (this.wake?.failed) this.retry();
    else this.attempt();
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
    this.chat = res.chat.map((m) => localNote(m, res.id));
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

  /**
   * The voice the AI partner should speak with (Settings). The server keeps it for this
   * connection and uses it in a solo game from the AI's next line; it is sent again on
   * every (re)connect. In a two-player room it does nothing.
   */
  setAiVoice(voice: AiVoice): void {
    if (this.aiVoice === voice) return;
    this.aiVoice = voice;
    if (this.online) this.socket?.emit('ai:voice', { voice });
  }

  /** One banked greeting in a voice (the settings panel's preview), or null: offline, or the server has none. */
  previewVoice(voice: AiVoice): Promise<VoicePreview | null> {
    return new Promise((resolve) => {
      if (!this.socket || !this.online) resolve(null);
      else this.socket.emit('ai:preview', { voice }, (res) => resolve(res.ok ? res : null));
    });
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

  /**
   * The player is here: a key, a tap, or talking. Most of those never reach the server by
   * themselves, so this tells it, at most once every few seconds, while we are in a room.
   */
  activity(): void {
    const now = Date.now();
    if (!this.socket || !this.online || !this.code || now - this.activityAt < ACTIVITY_EVERY_MS) return;
    this.activityAt = now;
    this.socket.emit('activity');
  }

  /**
   * Our own inactivity countdown is running: when we are removed, on OUR clock. Null when
   * there is none.
   */
  idleUntil(): number | null {
    const s = this.chat.find((m) => m.system?.kind === 'idle' && m.system.id === this.id)?.system;
    return s?.until ?? null;
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
