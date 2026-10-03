import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import type { Ack, ClientToServer, Seat, ServerInfo, ServerToClient, Side } from '@cubic/shared';
import { Rooms, type Room } from './rooms';

type Io = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

const VOICE_CHUNK_MAX = 64 * 1024;

export interface AppOptions {
  /** Allowed browser origins (CLIENT_ORIGIN). */
  origins?: string[];
  /** Also allow any localhost origin (dev). */
  allowLocalhost?: boolean;
  /** Hook for the AI partner: called when a room is created for an AI game. */
  onAiRoom?: (room: Room, humanSide: Side) => void;
  info?: () => ServerInfo;
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

export function createApp(opts: AppOptions = {}): App {
  const origins = (opts.origins ?? []).map(trim).filter(Boolean);
  const originAllowed = (origin: string | undefined) => !origin || origins.includes(trim(origin)) || (!!opts.allowLocalhost && isLocal(origin));
  const info = opts.info ?? (() => ({ aiAvailable: false, ttsAvailable: false }));

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: Io = new Server(http, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
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
    });
  }

  io.on('connection', (socket: Sock) => {
    let room: Room | null = null;
    let side: Side | null = null;

    socket.emit('info', info());

    const attach = (r: Room, s: Side) => {
      room = r;
      side = s;
      socket.join(r.code);
      socket.data = { code: r.code, side: s };
    };
    const detach = (forGood: boolean) => {
      if (!room || !side) return;
      socket.leave(room.code);
      if (forGood) room.leave(side);
      else room.drop(side);
      room = null;
      side = null;
    };
    /** The other player's socket, if connected. */
    const partner = () => {
      if (!room) return null;
      for (const id of io.sockets.adapter.rooms.get(room.code) ?? []) if (id !== socket.id) return io.sockets.sockets.get(id) ?? null;
      return null;
    };
    /** Both humans are here: tell them to (re)start the voice call. */
    const voiceReady = () => {
      const r = room;
      // After the join/rejoin ack, so the newcomer knows its side before the call starts.
      setTimeout(() => {
        if (r && r === room && r.mode === 'friend' && r.isConnected('out') && r.isConnected('in') && partner()) io.to(r.code).emit('voice:ready');
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

    socket.on('room:create', (ack) =>
      safe(ack, () => {
        detach(true);
        const r = rooms.create('friend');
        wire(r);
        attach(r, 'out');
        return r.sit('out');
      }),
    );

    socket.on('room:join', (msg, ack) =>
      safe(ack, () => {
        const r = rooms.get(msg?.code);
        if (!r) throw new Error('Room not found. Check the code.');
        const free = r.mode === 'friend' ? r.freeSide() : null;
        if (!free) throw new Error('That room is full.');
        detach(true);
        wire(r);
        attach(r, free);
        const seat = r.sit(free);
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
        wire(r);
        attach(r, human);
        const seat = r.sit(human);
        opts.onAiRoom(r, human);
        return { ...seat, room: r.info(), state: r.state };
      }),
    );

    socket.on('room:rejoin', (msg, ack) =>
      safe(ack, () => {
        const r = rooms.get(msg?.code);
        const s = r && typeof msg?.token === 'string' ? r.sideOfToken(msg.token) : null;
        if (!r || !s) throw new Error('That room is gone.');
        // A newer tab/socket replaces the old one for this seat.
        for (const id of io.sockets.adapter.rooms.get(r.code) ?? []) {
          const other = io.sockets.sockets.get(id);
          if (other && other.id !== socket.id && other.data?.side === s) {
            other.data.replaced = true;
            other.disconnect(true);
          }
        }
        if (room === r && side === s) return r.resume(s);
        detach(true);
        wire(r);
        attach(r, s);
        const seat = r.resume(s);
        voiceReady();
        return seat;
      }),
    );

    socket.on('room:leave', () => detach(true));
    socket.on('room:restart', () => room?.restart());

    socket.on('move', (msg) => {
      if (room && side && msg) room.move(side, Number(msg.dx), Number(msg.dy), Number(msg.seq) || 0);
    });
    socket.on('interact', (msg) => {
      if (room && side) room.interact(side, Number(msg?.seq) || 0);
    });
    socket.on('chat', (msg) => {
      if (room && side) room.say(side, msg?.text);
    });

    socket.on('voice:signal', (msg) => partner()?.emit('voice:signal', { data: msg?.data }));
    socket.on('voice:chunk', (msg) => {
      const size = (msg?.data as ArrayBuffer | undefined)?.byteLength ?? 0;
      if (size > 0 && size <= VOICE_CHUNK_MAX) partner()?.emit('voice:chunk', msg);
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
