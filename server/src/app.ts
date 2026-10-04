import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import { DEFAULT_AI_VOICE, parseAiVoice, type Ack, type AiVoice, type ClientToServer, type Seat, type ServerInfo, type ServerToClient, type Side, type VoicePreview } from '@cubic/shared';
import { devCommandsEnabled, runDev } from './dev';
import { Rooms, type Room } from './rooms';

type Io = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

/**
 * Voice relay limits, per socket (tests read these). A signal is an SDP offer or answer (a
 * few KB), an ICE candidate or the relay switch; candidates come in a burst when a call
 * starts. Relay chunks are 200 ms of Opus each, so five a second.
 */
export const VOICE_LIMITS = { signalMaxBytes: 16 * 1024, signalBurst: 60, signalPerSec: 20, chunkMaxBytes: 64 * 1024, chunkBurst: 20, chunkPerSec: 10 };
/** The AI voice picker, per socket: a preview is one banked clip (about 60 KB), a choice is one word. */
export const AI_VOICE_LIMITS = { previewBurst: 4, previewPerSec: 0.5, pickBurst: 10, pickPerSec: 2 };
/** The one format the client records for the relay (RELAY_MIME in client/src/voice/voice.ts). */
const VOICE_MIMES = ['audio/webm;codecs=opus'];

/** Allows `burst` at once, then `perSec` a second. Returns false when the message is over. */
function bucket(burst: () => number, perSec: () => number): () => boolean {
  let tokens = burst();
  let at = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst(), tokens + ((now - at) / 1000) * perSec());
    at = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is this what the voice client sends (Signal in client/src/voice/voice.ts)? An SDP offer
 * or answer, an ICE candidate, or the switch to the relay: nothing else, and not too big.
 */
export function validSignal(data: unknown): boolean {
  if (!isObject(data)) return false;
  const keys = Object.keys(data);
  if (keys.length === 0 || keys.some((k) => k !== 'sdp' && k !== 'candidate' && k !== 'relay')) return false;
  if ('sdp' in data && !(isObject(data.sdp) && (data.sdp.type === 'offer' || data.sdp.type === 'answer') && typeof data.sdp.sdp === 'string')) return false;
  if ('candidate' in data && !(isObject(data.candidate) && typeof data.candidate.candidate === 'string')) return false;
  if ('relay' in data && data.relay !== true) return false;
  return JSON.stringify(data).length <= VOICE_LIMITS.signalMaxBytes;
}
/** Public STUN, always offered. The client keeps the same list as its fallback. */
export const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

/** A TURN relay for voice calls that cannot connect directly (TURN_* env vars). */
export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
}
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** What GET /ice returns: STUN, plus TURN when it is fully configured. */
export function iceServers(turn?: TurnConfig | null): IceServer[] {
  const urls = (turn?.urls ?? []).map((u) => u.trim()).filter(Boolean);
  const stun: IceServer = { urls: STUN_URLS };
  // A TURN entry without credentials makes the browser's RTCPeerConnection throw.
  if (!turn || urls.length === 0 || !turn.username || !turn.credential) return [stun];
  return [stun, { urls, username: turn.username, credential: turn.credential }];
}

export interface AppOptions {
  /** Allowed browser origins (CLIENT_ORIGIN). */
  origins?: string[];
  /** Also allow any localhost origin (dev). */
  allowLocalhost?: boolean;
  /** Hook for the AI partner: called when a room is created for an AI game. */
  onAiRoom?: (room: Room, humanSide: Side) => void;
  /**
   * Hook for the AI partner: the voice the human of a solo room wants it to speak with.
   * Only ever called with a key of AI_VOICES, and only for an AI room.
   */
  onAiVoice?: (room: Room, voice: AiVoice) => void;
  /** Hook for the AI partner: one banked greeting in a voice (the settings panel's preview). */
  voicePreview?: (voice: AiVoice) => VoicePreview;
  /** TURN relay handed to clients by GET /ice. Unset = STUN only. */
  turn?: TurnConfig | null;
  info?: () => ServerInfo;
  /** Obey the `dev` socket message (DEV_COMMANDS=1). Ignored when NODE_ENV=production. */
  devCommands?: boolean;
}

export interface App {
  http: HttpServer;
  io: Io;
  rooms: Rooms;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

const isLocal = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const trim = (o: string) => o.trim().replace(/\/$/, '');
/**
 * One CLIENT_ORIGIN entry as a matcher. Exact, except that "*" stands for any run of
 * letters, digits and dashes inside one host label (for Vercel preview URLs such as
 * https://cubic-*.vercel.app). It never matches a dot, so it cannot span domains.
 */
export const originPattern = (origin: string) =>
  new RegExp(`^${origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i');

export function createApp(opts: AppOptions = {}): App {
  const origins = (opts.origins ?? []).map(trim).filter(Boolean).map(originPattern);
  const originAllowed = (origin: string | undefined) => !origin || origins.some((re) => re.test(trim(origin))) || (!!opts.allowLocalhost && isLocal(origin));
  const info = opts.info ?? (() => ({ aiAvailable: false, ttsAvailable: false, ttsMode: 'browser' as const }));

  const devOn = devCommandsEnabled({ DEV_COMMANDS: opts.devCommands ? '1' : '', NODE_ENV: process.env.NODE_ENV });

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      // Readable from any origin, and it says whether the asking origin may connect: a
      // client that the socket refuses can then tell a wrong CLIENT_ORIGIN (we are up, and
      // it is not allowed) from a server that is still waking up (no answer at all).
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, originAllowed: originAllowed(req.headers.origin) }));
      return;
    }
    if (req.url === '/ice') {
      // Same origin rules as the socket. The client is on another origin in production,
      // so an allowed origin also gets the CORS header.
      const origin = req.headers.origin;
      if (req.method !== 'GET' || !originAllowed(origin)) {
        res.writeHead(req.method !== 'GET' ? 405 : 403);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin', ...(origin ? { 'access-control-allow-origin': origin } : {}) });
      res.end(JSON.stringify({ iceServers: iceServers(opts.turn) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: Io = new Server(http, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
    // CORS does not cover WebSocket upgrades: refuse other origins outright.
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
    maxHttpBufferSize: 256 * 1024,
  });
  const rooms = new Rooms();
  /** Rooms already wired to broadcast to their socket.io room. */
  const wired = new WeakSet<Room>();

  function wire(room: Room) {
    if (wired.has(room)) return;
    wired.add(room);
    room.listen({
      onState: (u) => io.to(room.code).emit('state', u),
      onAck: (id, u) => {
        for (const sid of io.sockets.adapter.rooms.get(room.code) ?? []) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.id === id) s.emit('state', u);
        }
      },
      onChat: (m) => io.to(room.code).emit('chat', m),
      onNote: (m) => io.to(room.code).emit('chat', m),
      // Taken out for inactivity: told why, and cut off from the room at once. Nobody else
      // in the room is touched.
      onRemoved: (id, reason) => {
        for (const sid of [...(io.sockets.adapter.rooms.get(room.code) ?? [])]) {
          const s = io.sockets.sockets.get(sid);
          if (s?.data?.id !== id) continue;
          s.emit('removed', { reason });
          s.leave(room.code);
          s.data.evict?.();
        }
      },
      onQuick: (q) => io.to(room.code).emit('quick', q),
      onRoom: (r) => io.to(room.code).emit('room', r),
      onTyping: (from, on) => io.to(room.code).emit('typing', { from, on }),
      // the room is deleted: nothing of it stays behind in socket.io
      onClosed: () => io.in(room.code).socketsLeave(room.code),
    });
  }

  io.on('connection', (socket: Sock) => {
    let room: Room | null = null;
    /** Our member id in `room`. The side comes from the room: it is picked in the lobby. */
    let me: number | null = null;
    const side = (): Side | null => (room && me !== null ? room.sideOf(me) : null);
    /** The AI voice this player picked in Settings. It only matters in a solo room. */
    let aiVoice: AiVoice = DEFAULT_AI_VOICE;
    const useAiVoice = () => {
      if (room?.mode === 'ai') opts.onAiVoice?.(room, aiVoice);
    };

    socket.emit('info', info());

    /** Hear the room's broadcasts. Call before taking a place, so the first ones arrive. */
    const enter = (r: Room) => {
      wire(r);
      socket.join(r.code);
    };
    const attach = (r: Room, seat: Seat): Seat => {
      room = r;
      me = seat.id;
      // evict: the room removed us (inactivity), this socket is in no room any more
      socket.data = { code: r.code, id: seat.id, evict: () => ((room = null), (me = null)) };
      useAiVoice(); // a solo room speaks in this player's voice from its first line (and again after a rejoin)
      return seat;
    };
    const detach = (forGood: boolean) => {
      if (!room || me === null) return;
      socket.leave(room.code);
      if (forGood) room.leave(me);
      else room.drop(me);
      room = null;
      me = null;
    };
    /** The other player's socket, if connected. */
    const partner = () => {
      if (!room) return null;
      for (const id of io.sockets.adapter.rooms.get(room.code) ?? []) if (id !== socket.id) return io.sockets.sockets.get(id) ?? null;
      return null;
    };
    /** Both humans are in the game: tell them to (re)start the voice call. */
    const voiceReady = () => {
      const r = room;
      // After the join/rejoin ack, so the newcomer knows its side before the call starts.
      setTimeout(() => {
        if (r && r === room && r.mode === 'friend' && r.phase === 'playing' && r.isConnected('out') && r.isConnected('in') && partner()) io.to(r.code).emit('voice:ready');
      }, 50);
    };
    /** Back into the place member `id` holds in `r` (a refresh, a reconnect, or a Leave taken back in time). */
    const comeBack = (r: Room, id: number): Seat => {
      // A newer tab/socket replaces the old one for this place.
      for (const sid of io.sockets.adapter.rooms.get(r.code) ?? []) {
        const other = io.sockets.sockets.get(sid);
        if (other && other.id !== socket.id && other.data?.id === id) {
          other.data.replaced = true;
          // Tell it why first: a socket the server disconnects does not come back by itself,
          // and that tab would sit on "reconnecting" for ever. It forgets the seat (the
          // token is now this tab's) and goes back to the mode screen.
          other.emit('removed', { reason: 'replaced' });
          other.disconnect(true);
        }
      }
      if (room === r && me === id) return r.resume(id);
      detach(true);
      enter(r);
      const seat = attach(r, r.resume(id));
      voiceReady();
      return seat;
    };
    const safe = (ack: unknown, fn: () => Seat) => {
      if (typeof ack !== 'function') return;
      try {
        (ack as Ack<Seat>)({ ok: true, ...fn() });
      } catch (e) {
        (ack as Ack<Seat>)({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong' });
      }
    };
    /** A lobby action: the rules live in Room and it throws the reason when one is broken. */
    const lobby = (ack: unknown, fn: (r: Room, id: number) => void) => {
      const reply = typeof ack === 'function' ? (ack as Ack<object>) : () => {};
      try {
        if (!room || me === null) throw new Error('You are not in a room.');
        fn(room, me);
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong' });
      }
    };

    socket.on('room:create', (ack) =>
      safe(ack, () => {
        detach(true);
        const r = rooms.create('friend');
        enter(r);
        return attach(r, r.join());
      }),
    );

    socket.on('room:join', (msg, ack) =>
      safe(ack, () => {
        const r = rooms.get(msg?.code);
        if (!r) throw new Error('Room not found. Check the code.');
        // Already in it: leaving first would close the room (if we are alone) and seat us in the dead one.
        if (r === room && me !== null) return r.resume(me);
        // Their own token: the place they left (or dropped from) is still theirs. Anyone
        // else finds a held seat taken.
        const held = typeof msg?.token === 'string' ? r.idOfToken(msg.token) : null;
        if (held !== null) return comeBack(r, held);
        if (r.mode !== 'friend' || r.isFull()) throw new Error('That room is full.');
        detach(true);
        enter(r);
        const seat = attach(r, r.join());
        voiceReady();
        return seat;
      }),
    );

    socket.on('room:createAI', (msg, ack) =>
      safe(ack, () => {
        if (!opts.onAiRoom || !info().aiAvailable) throw new Error('The AI partner is not available on this server.');
        const human: Side = msg?.side === 'in' ? 'in' : 'out';
        detach(true);
        const r = rooms.create('ai');
        enter(r);
        const seat = attach(r, r.sit(human));
        opts.onAiRoom(r, human);
        return { ...seat, room: r.info(), state: r.state };
      }),
    );

    socket.on('room:rejoin', (msg, ack) =>
      safe(ack, () => {
        const r = rooms.get(msg?.code);
        const id = r && typeof msg?.token === 'string' ? r.idOfToken(msg.token) : null;
        if (!r || id === null) throw new Error('That room is gone.');
        return comeBack(r, id);
      }),
    );

    socket.on('room:leave', () => detach(true));
    socket.on('room:restart', () => room?.restart());

    socket.on('lobby:pick', (msg, ack) => lobby(ack, (r, id) => r.pick(id, msg?.side ?? null)));
    socket.on('lobby:ready', (msg, ack) => lobby(ack, (r, id) => r.setReady(id, !!msg?.ready)));
    socket.on('lobby:start', (ack) =>
      lobby(ack, (r, id) => {
        r.start(id);
        voiceReady();
      }),
    );

    socket.on('move', (msg) => {
      const s = side();
      if (room && s && msg) room.move(s, Number(msg.dx), Number(msg.dy), Number(msg.seq) || 0);
    });
    socket.on('interact', (msg) => {
      const s = side();
      if (room && s) room.interact(s, Number(msg?.seq) || 0, msg?.only === 'drop' || msg?.only === 'pick' ? msg.only : undefined);
    });
    socket.on('chat', (msg) => {
      const s = side();
      if (room && s) room.say(s, msg?.text);
    });
    socket.on('quick', (msg) => {
      const s = side();
      if (room && s) room.quick(s, msg?.index);
    });
    // a key, a tap or talking that nothing else told us about (lobby and game alike)
    socket.on('activity', () => {
      if (room && me !== null) room.activity(me);
    });

    // Voice is relayed only where the client uses it: between the two humans of a running
    // game (that is when `voice:ready` goes out). Never in the lobby, never unchecked, and
    // never faster than a real call needs.
    const voiceOn = () => !!room && room.mode === 'friend' && room.phase === 'playing' && side() !== null;
    const signalOk = bucket(() => VOICE_LIMITS.signalBurst, () => VOICE_LIMITS.signalPerSec);
    const chunkOk = bucket(() => VOICE_LIMITS.chunkBurst, () => VOICE_LIMITS.chunkPerSec);
    socket.on('voice:signal', (msg) => {
      if (!voiceOn() || !validSignal(msg?.data) || !signalOk()) return;
      partner()?.emit('voice:signal', { data: msg.data });
    });
    socket.on('voice:chunk', (msg) => {
      // socket.io hands binary over as a Buffer: a plain object that only claims a size is not one
      const data: unknown = msg?.data;
      if (!voiceOn() || !Buffer.isBuffer(data) || data.length === 0 || data.length > VOICE_LIMITS.chunkMaxBytes) return;
      if (!Number.isSafeInteger(msg.seq) || msg.seq < 0 || !VOICE_MIMES.includes(msg.mime) || !chunkOk()) return;
      partner()?.emit('voice:chunk', { seq: msg.seq, mime: msg.mime, data: data as unknown as ArrayBuffer });
    });

    // The AI partner's voice (Settings). Only a key of the known list is ever taken: a
    // client cannot hand the server a voice id. In a two-player room it changes nothing.
    const pickOk = bucket(() => AI_VOICE_LIMITS.pickBurst, () => AI_VOICE_LIMITS.pickPerSec);
    const previewOk = bucket(() => AI_VOICE_LIMITS.previewBurst, () => AI_VOICE_LIMITS.previewPerSec);
    socket.on('ai:voice', (msg) => {
      const voice = parseAiVoice(msg?.voice);
      if (!voice || !pickOk()) return;
      aiVoice = voice;
      useAiVoice();
    });
    socket.on('ai:preview', (msg, ack) => {
      if (typeof ack !== 'function') return;
      const voice = parseAiVoice(msg?.voice);
      if (!voice) ack({ ok: false, error: 'Unknown voice.' });
      else if (!opts.voicePreview || !info().aiAvailable) ack({ ok: false, error: 'The AI partner is not available on this server.' });
      else if (!previewOk()) ack({ ok: false, error: 'Too many previews. Wait a moment.' });
      else ack({ ok: true, ...opts.voicePreview(voice) });
    });

    socket.on('dev', (cmd, ack) => {
      if (typeof ack === 'function') ack(runDev(devOn, room, cmd));
    });

    socket.on('disconnect', () => {
      // Only drop the seat if this socket still owns it (a rejoin may have replaced it).
      if (socket.data?.replaced) return;
      detach(false);
    });
  });

  return {
    http,
    io,
    rooms,
    listen: (port) => new Promise((resolve) => http.listen(port, () => resolve((http.address() as AddressInfo).port))),
    close: async () => {
      rooms.closeAll();
      await io.close();
    },
  };
}
