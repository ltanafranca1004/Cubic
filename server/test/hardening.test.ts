import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, Seat, ServerToClient, Side, StateUpdate } from '@cubic/shared';
import { createApp, type App } from '../src/app';
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

  constructor() {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    socks.push(this.sock);
    this.sock.on('state', (u) => this.states.push(u));
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
