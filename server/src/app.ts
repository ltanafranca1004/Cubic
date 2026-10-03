import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import type { Ack, ClientToServer, Seat, ServerInfo, ServerToClient, Side } from '@cubic/shared';
import { devCommandsEnabled, runDev } from './dev';
import { Rooms, type Room } from './rooms';

type Io = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

const VOICE_CHUNK_MAX = 64 * 1024;
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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
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
      onChat: (m) => io.to(room.code).emit('chat', m),
      onRoom: (r) => io.to(room.code).emit('room', r),
      onTyping: (from, on) => io.to(room.code).emit('typing', { from, on }),
    });
  }

  io.on('connection', (socket: Sock) => {
    let room: Room | null = null;
    /** Our member id in `room`. The side comes from the room: it is picked in the lobby. */
    let me: number | null = null;
    const side = (): Side | null => (room && me !== null ? room.sideOf(me) : null);

    socket.emit('info', info());

    /** Hear the room's broadcasts. Call before taking a place, so the first ones arrive. */
    const enter = (r: Room) => {
      wire(r);
      socket.join(r.code);
    };
    const attach = (r: Room, seat: Seat): Seat => {
      room = r;
      me = seat.id;
      socket.data = { code: r.code, id: seat.id };
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
        // A newer tab/socket replaces the old one for this place.
        for (const sid of io.sockets.adapter.rooms.get(r.code) ?? []) {
          const other = io.sockets.sockets.get(sid);
          if (other && other.id !== socket.id && other.data?.id === id) {
            other.data.replaced = true;
            other.disconnect(true);
          }
        }
        if (room === r && me === id) return r.resume(id);
        detach(true);
        enter(r);
        const seat = attach(r, r.resume(id));
        voiceReady();
        return seat;
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
      if (room && s) room.interact(s, Number(msg?.seq) || 0);
    });
    socket.on('chat', (msg) => {
      const s = side();
      if (room && s) room.say(s, msg?.text);
    });

    socket.on('voice:signal', (msg) => partner()?.emit('voice:signal', { data: msg?.data }));
    socket.on('voice:chunk', (msg) => {
      const size = (msg?.data as ArrayBuffer | undefined)?.byteLength ?? 0;
      if (size > 0 && size <= VOICE_CHUNK_MAX) partner()?.emit('voice:chunk', msg);
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
