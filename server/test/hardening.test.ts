import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, Seat, ServerToClient, Side, StateUpdate } from '@cubic/shared';
import { VOICE_LIMITS, createApp, type App } from '../src/app';
import { LIMITS } from '../src/rooms';

// What a hostile or unlucky client can do to a room over real sockets: a refresh in the
// middle of a game, a flood of moves, junk and floods on the voice channel, joining the
// room you are already in.

type Sock = Socket<ServerToClient, ClientToServer>;
type Reply = ({ ok: true } & Seat) | { ok: false; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

let app: App;
let url: string;
const socks: Sock[] = [];
const BURST = LIMITS.moveBurst;

class Client {
  sock: Sock;
  seat!: Seat;
  states: StateUpdate[] = [];
  signals: unknown[] = [];
  chunks: { seq: unknown; mime: unknown; data: unknown }[] = [];

  constructor() {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    socks.push(this.sock);
    this.sock.on('state', (u) => this.states.push(u));
    this.sock.on('voice:signal', (m) => this.signals.push(m.data));
    this.sock.on('voice:chunk', (c) => this.chunks.push(c));
  }

  private seated = (send: (ack: (r: Reply) => void) => void) =>
    new Promise<Seat>((ok, no) =>
      send((r) => {
        if (!r.ok) return no(new Error(r.error));
        this.seat = r;
        ok(r);
      }),
    );
  create = () => this.seated((ack) => this.sock.emit('room:create', ack));
  join = (code: string) => this.seated((ack) => this.sock.emit('room:join', { code }, ack));
  rejoin = (code: string, token: string) => this.seated((ack) => this.sock.emit('room:rejoin', { code, token }, ack));
  private lobby = (send: (ack: (r: { ok: true } | { ok: false; error: string }) => void) => void) =>
    new Promise<void>((ok, no) => send((r) => (r.ok ? ok() : no(new Error(r.error)))));
  pick = (side: Side) => this.lobby((ack) => this.sock.emit('lobby:pick', { side }, ack));
  ready = () => this.lobby((ack) => this.sock.emit('lobby:ready', { ready: true }, ack));
  start = () => this.lobby((ack) => this.sock.emit('lobby:start', ack));

  /** The highest ack this client has been sent for `side`. */
  ack(side: Side): number {
    return this.states.at(-1)?.acks[side] ?? 0;
  }
}

/** Two clients in one room: still in the lobby, or with the game started (host outside). */
async function pair(started: boolean): Promise<{ a: Client; b: Client }> {
  const a = new Client();
  const b = new Client();
  await a.create();
  await b.join(a.seat.code);
  if (!started) return { a, b };
  await a.pick('out');
  await b.pick('in');
  await b.ready();
  await a.start();
  await until(() => a.states.length > 0 && b.states.length > 0, 'the first state');
  return { a, b };
}

before(async () => {
  app = createApp({ allowLocalhost: true });
  url = `http://localhost:${await app.listen(0)}`;
});
beforeEach(() => {
  LIMITS.moveBurst = BURST;
});
after(async () => {
  for (const s of socks) s.disconnect();
  await app.close();
});

test('a refresh starts the move sequence again: the old ack is not kept', async () => {
  LIMITS.moveBurst = 1e9;
  const { a } = await pair(true);
  for (let seq = 1; seq <= 7; seq++) a.sock.emit('move', { dx: seq % 2 ? 1 : -1, dy: 0, seq });
  await until(() => a.ack('out') === 7, 'ack 7');

  a.sock.disconnect();
  const again = new Client();
  await again.rejoin(a.seat.code, a.seat.token);
  await until(() => again.states.length > 0, 'a state after the rejoin');
  assert.equal(again.ack('out'), 0, 'the new page counts its moves from 1 again');

  // its first move is acknowledged as 1, not as the 7 of the page before it
  again.sock.emit('move', { dx: 1, dy: 0, seq: 1 });
  await until(() => again.ack('out') === 1, 'ack 1');
  await sleep(50);
  assert.equal(again.ack('out'), 1);
});

test('rate-limited moves are not broadcast, but the sender still gets every ack', async () => {
  const { a, b } = await pair(true);
  await sleep(100);
  const before = b.states.length;
  const N = 300;
  for (let seq = 1; seq <= N; seq++) a.sock.emit('move', { dx: seq % 2 ? 1 : -1, dy: 0, seq });
  await until(() => a.ack('out') === N, `ack ${N}`);
  await sleep(100);
  const got = b.states.length - before;
  // only the moves the budget allowed (the burst plus the refill meanwhile) reach the partner
  assert.ok(got >= 1 && got <= LIMITS.moveBurst + 15, `the partner got ${got} state updates for ${N} moves`);
});

test('voice: nothing is relayed in the lobby', async () => {
  const { a, b } = await pair(false);
  a.sock.emit('voice:signal', { data: { relay: true } });
  a.sock.emit('voice:chunk', { seq: 0, mime: 'audio/webm;codecs=opus', data: new ArrayBuffer(8) });
  await sleep(150);
  assert.deepEqual([b.signals.length, b.chunks.length], [0, 0]);
});

test('voice: well-formed signals and chunks are relayed in a game, junk is dropped', async () => {
  const { a, b } = await pair(true);
  const offer = { sdp: { type: 'offer', sdp: 'v=0' } };
  const candidate = { candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
  const junk: unknown[] = [
    undefined,
    null,
    'text',
    7,
    [],
    { data: 'text' },
    { data: null },
    { data: [] },
    { data: {} },
    { data: { evil: 1 } },
    { data: { relay: 'yes' } },
    { data: { sdp: 'v=0' } },
    { data: { sdp: { type: 'rollback', sdp: 'v=0' } } },
    { data: { sdp: { type: 'offer', sdp: 5 } } },
    { data: { candidate: 'x' } },
    { data: { sdp: { type: 'offer', sdp: 'x'.repeat(VOICE_LIMITS.signalMaxBytes) } } }, // too big
  ];
  for (const msg of junk) a.sock.emit('voice:signal', msg as { data: unknown });
  for (const data of [offer, candidate, { relay: true }]) a.sock.emit('voice:signal', { data });
  await until(() => b.signals.length >= 3, 'the three good signals');
  await sleep(100);
  assert.deepEqual(b.signals, [offer, candidate, { relay: true }]);

  const mime = 'audio/webm;codecs=opus';
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const bad: unknown[] = [
    undefined,
    { seq: 'zero', mime, data: bytes },
    { seq: -1, mime, data: bytes },
    { seq: 1.5, mime, data: bytes },
    { seq: 0, mime: { evil: 1 }, data: bytes },
    { seq: 0, mime: 'text/html', data: bytes },
    { seq: 0, mime, data: { byteLength: 5 } }, // a plain object that only claims a size
    { seq: 0, mime, data: 'text' },
    { seq: 0, mime, data: new ArrayBuffer(0) },
    { seq: 0, mime, data: new ArrayBuffer(VOICE_LIMITS.chunkMaxBytes + 1) },
  ];
  for (const msg of bad) a.sock.emit('voice:chunk', msg as never);
  a.sock.emit('voice:chunk', { seq: 3, mime, data: bytes });
  await until(() => b.chunks.length >= 1, 'the good chunk');
  await sleep(100);
  assert.equal(b.chunks.length, 1);
  assert.deepEqual([b.chunks[0]!.seq, b.chunks[0]!.mime, [...new Uint8Array(b.chunks[0]!.data as ArrayBuffer)]], [3, mime, [1, 2, 3, 4]]);
});

test('voice: a flood of signals or chunks is cut off at the rate limit', async () => {
  const { a, b } = await pair(true);
  const N = 1000;
  for (let i = 0; i < N; i++) a.sock.emit('voice:signal', { data: { relay: true } });
  for (let i = 0; i < N; i++) a.sock.emit('voice:chunk', { seq: i, mime: 'audio/webm;codecs=opus', data: new ArrayBuffer(16) });
  // a marker on another channel tells us the server has been through all of them
  a.sock.emit('move', { dx: 1, dy: 0, seq: 1 });
  await until(() => a.ack('out') === 1, 'the flood to be processed', 10_000);
  await sleep(150);
  // the burst, plus whatever was refilled while the flood was being read
  assert.ok(b.signals.length >= 1 && b.signals.length <= VOICE_LIMITS.signalBurst * 2, `${b.signals.length} of ${N} signals relayed`);
  assert.ok(b.chunks.length >= 1 && b.chunks.length <= VOICE_LIMITS.chunkBurst * 2, `${b.chunks.length} of ${N} chunks relayed`);
});
