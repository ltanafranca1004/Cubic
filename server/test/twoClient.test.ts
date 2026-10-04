import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { FACE_SIZE, defaultEnv, pathTo, type ChatMessage, type ClientToServer, type GameEvent, type RoomInfo, type Seat, type ServerToClient, type Side, type StateUpdate, type TileRef } from '@cubic/shared';
import { createApp, type App } from '../src/app';
import { LIMITS } from '../src/rooms';

// Scripted two-client game over real sockets: rooms, codes, the lobby (pick sides, ready,
// start), chat, validation, reconnect, the example puzzle and the portal win.

type Sock = Socket<ServerToClient, ClientToServer>;

class Client {
  sock: Sock;
  seat!: Seat;
  last!: StateUpdate;
  events: GameEvent[] = [];
  chat: ChatMessage[] = [];
  room: RoomInfo | null = null;
  private seq = 0;
  private waiters: (() => void)[] = [];

  constructor(url: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('state', (u) => {
      this.last = u;
      this.events.push(...u.events);
      this.wake();
    });
    this.sock.on('chat', (m) => {
      this.chat.push(m);
      this.wake();
    });
    this.sock.on('room', (r) => {
      this.room = r;
      this.wake();
    });
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  async until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise<void>((res) => {
        const t = setTimeout(res, 50);
        this.waiters.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }
  }

  private adopt(res: ({ ok: true } & Seat) | { ok: false; error: string }): Seat {
    if (!res.ok) throw new Error(res.error);
    this.seat = res;
    this.last = { state: res.state, events: [], acks: { out: 0, in: 0 } };
    return res;
  }

  create = () => new Promise<Seat>((ok, no) => this.sock.emit('room:create', (r) => { try { ok(this.adopt(r)); } catch (e) { no(e); } }));
  join = (code: string) => new Promise<Seat>((ok, no) => this.sock.emit('room:join', { code }, (r) => { try { ok(this.adopt(r)); } catch (e) { no(e); } }));
  rejoin = (code: string, token: string) =>
    new Promise<Seat>((ok, no) => this.sock.emit('room:rejoin', { code, token }, (r) => { try { ok(this.adopt(r)); } catch (e) { no(e); } }));

  private lobby = (send: (ack: (r: { ok: true } | { ok: false; error: string }) => void) => void) =>
    new Promise<void>((ok, no) => send((r) => (r.ok ? ok() : no(new Error(r.error)))));
  pick = (side: Side | null) => this.lobby((ack) => this.sock.emit('lobby:pick', { side }, ack));
  ready = (ready: boolean) => this.lobby((ack) => this.sock.emit('lobby:ready', { ready }, ack));
  start = () => this.lobby((ack) => this.sock.emit('lobby:start', ack));

  /** This client's own entry in the latest room info. */
  get member() {
    const m = this.room?.members;
    return m?.host?.id === this.seat.id ? m.host : m?.guest?.id === this.seat.id ? m.guest : null;
  }
  get side(): Side {
    const side = this.member?.side ?? this.seat.side;
    assert.ok(side, 'this client has no side yet');
    return side;
  }
  get pose() {
    return this.last.state.players[this.side].pose;
  }

  async move(dx: number, dy: number) {
    const seq = ++this.seq;
    this.sock.emit('move', { dx, dy, seq });
    await this.until(() => this.last.acks[this.side] >= seq, `ack ${seq}`);
  }

  async interact() {
    const seq = ++this.seq;
    this.sock.emit('interact', { seq });
    await this.until(() => this.last.acks[this.side] >= seq, `ack ${seq}`);
  }

  /** Walk to a tile with real validated moves, re-planning from the server state. */
  async walkTo(target: TileRef) {
    for (let guard = 0; guard < 200; guard++) {
      const path = pathTo(this.last.state, this.side, target, defaultEnv);
      assert.ok(path, `${this.side}: no path to face ${target.face} ${target.x},${target.y}`);
      if (path.length === 0 || this.last.state.wonAt !== null) return;
      await this.move(path[0]![0], path[0]![1]);
    }
    assert.fail('walkTo did not arrive');
  }
}

const find = (side: Side, face: 1 | 6, type: string): TileRef => {
  const o = defaultEnv.world[side][face].objects.find((x) => x.type === type)!;
  return { face, x: o.x, y: o.y };
};

let app: App;
let url: string;
const clients: Client[] = [];
const client = () => {
  const c = new Client(url);
  clients.push(c);
  return c;
};

before(async () => {
  LIMITS.moveBurst = 1e9; // no move rate limit in tests
  app = createApp({ allowLocalhost: true });
  url = `http://localhost:${await app.listen(0)}`;
});

after(async () => {
  for (const c of clients) c.sock.disconnect();
  await app.close();
});

test('GET /health returns 200', async () => {
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);
});

test('two clients play a whole game online', async () => {
  const a = client();
  const b = client();

  // --- rooms and codes
  const seatA = await a.create();
  assert.match(seatA.code, /^[A-Z]{4}$/);
  assert.deepEqual([seatA.role, seatA.side, seatA.room.phase], ['host', null, 'lobby']);
  assert.equal(seatA.room.members.guest, null);
  await assert.rejects(b.join('ZZZZ'), /not found/i);
  const seatB = await b.join(seatA.code.toLowerCase()); // codes are case-insensitive
  assert.deepEqual([seatB.role, seatB.side], ['guest', null]);
  await a.until(() => !!a.room?.members.guest?.connected, 'partner joined');
  await assert.rejects(client().join(seatA.code), /full/i);

  // --- the lobby: nothing moves until both picked a side, the guest is ready and the host starts
  a.sock.emit('move', { dx: 0, dy: 1, seq: 0 });
  await assert.rejects(a.start(), /pick a side/i);
  await assert.rejects(b.ready(true), /pick a side first/i);
  await a.pick('out');
  await assert.rejects(b.pick('out'), /already picked/i);
  await b.pick('in');
  await assert.rejects(a.start(), /not ready/i);
  await assert.rejects(b.start(), /only the host/i);
  await b.ready(true);
  await a.until(() => !!a.room?.members.guest?.ready, 'guest ready reaches the host');
  await a.start();
  await b.until(() => b.room?.phase === 'playing', 'the game starts for both');
  await a.until(() => a.room?.phase === 'playing', 'the game starts for the host');
  assert.deepEqual([a.side, b.side], ['out', 'in']);
  assert.equal(a.last.state.players.out.steps, 0); // the lobby move was ignored
  await assert.rejects(a.pick('in'), /already started/i);

  // --- chat, both ways, rate limited and trimmed
  a.sock.emit('chat', { text: '  hello   inside  ' });
  await b.until(() => b.chat.length === 1, 'chat');
  assert.deepEqual([b.chat[0]!.from, b.chat[0]!.text, b.chat[0]!.isAI], ['out', 'hello inside', false]);
  b.sock.emit('chat', { text: 'x'.repeat(500) });
  await a.until(() => a.chat.length === 2, 'chat reply');
  assert.equal(a.chat[1]!.text.length, 200);
  for (let i = 0; i < 10; i++) a.sock.emit('chat', { text: `spam ${i}` });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(b.chat.filter((m) => m.text.startsWith('spam')).length, 4); // 5 per 5s, 1 already used

  // --- the server validates: garbage and walls change nothing
  const start = { ...a.pose };
  a.sock.emit('move', { dx: 5, dy: 0, seq: 0 });
  a.sock.emit('move', { dx: 1, dy: 1, seq: 0 });
  await a.move(0, 1);
  assert.deepEqual([a.pose.x, a.pose.y], [start.x, start.y + 1]);
  const crystal = find('out', 1, 'crystal');
  assert.equal(pathTo(a.last.state, 'out', crystal), null); // door is shut

  // --- the example puzzle, online: inside presses the plate, outside takes the crystal
  await b.walkTo(find('in', 1, 'plate'));
  await a.until(() => a.events.some((e) => e.type === 'puzzle' && e.name === 'door-open'), 'door-open reaches the other player');
  await a.walkTo(crystal);
  await b.until(() => b.events.some((e) => e.type === 'solve' && e.face === 1), 'solve reaches both');
  assert.deepEqual(a.last.state.solved, [1]);

  // --- walk around the cube: inside does a full lap through 4 faces (row 4 is clear)
  await b.walkTo({ face: 1, x: 8, y: 4 });
  for (let i = 0; i < FACE_SIZE * 4; i++) await b.move(1, 0);
  assert.equal(b.pose.face, 1);
  assert.equal(b.events.filter((e) => e.type === 'flip' && e.side === 'in').length, 4);

  // --- disconnect and reconnect to the same seat
  b.sock.disconnect();
  await a.until(() => a.room?.seats.in.connected === false && a.room.seats.in.taken, 'partner dropped, seat held');
  const b2 = client();
  await assert.rejects(b2.rejoin(seatA.code, 'wrong-token'), /gone/i);
  const back = await b2.rejoin(seatA.code, seatB.token);
  assert.equal(back.side, 'in');
  assert.deepEqual(back.state.solved, [1]);
  assert.equal(back.chat.length, a.chat.length);
  await a.until(() => !!a.room?.seats.in.connected, 'partner back');

  // --- items online: outside carries the rose from face 1 to the pot on face 6
  const rose = a.last.state.items.rose!;
  await a.walkTo({ face: 1, x: rose.x, y: rose.y });
  await a.interact();
  assert.equal(a.last.state.players.out.carrying, 'rose');
  await a.walkTo(find('out', 6, 'target'));
  assert.equal(a.last.state.players.out.carrying, 'rose'); // it crossed the edges with them
  await a.interact();
  await b2.until(() => b2.events.some((e) => e.type === 'puzzle' && e.name === 'bloom'), 'item puzzle event reaches both');
  assert.deepEqual(a.last.state.solved, [1, 6]);
  assert.deepEqual([a.last.state.items.rose!.face, a.last.state.items.rose!.placedOn !== null], [6, true]);

  // --- portal win
  const portal = find('out', 6, 'portal');
  await a.walkTo(portal);
  await b2.walkTo(portal);
  await a.until(() => a.events.some((e) => e.type === 'win'), 'win reaches both');
  assert.notEqual(a.last.state.wonAt, null);

  // --- play again
  a.sock.emit('room:restart');
  await b2.until(() => b2.last.state.wonAt === null && b2.last.state.solved.length === 0, 'fresh game');
});

test('CLIENT_ORIGIN: comma-separated list, exact origins and * inside a host label', async () => {
  const strict = createApp({ origins: ' https://cubic.vercel.app/ , https://cubic-*.vercel.app,https://cubic.tech'.split(','), allowLocalhost: false });
  const port = await strict.listen(0);
  const status = async (origin?: string) => (await fetch(`http://localhost:${port}/socket.io/?EIO=4&transport=polling`, { headers: origin ? { origin } : {} })).status;
  try {
    for (const ok of ['https://cubic.vercel.app', 'https://cubic-git-ui-luis.vercel.app', 'https://CUBIC.tech', undefined]) assert.equal(await status(ok), 200, String(ok));
    for (const bad of ['https://evil.example', 'https://cubic.vercel.app.evil.example', 'https://cubic-x.evil.vercel.app', 'https://xcubic.tech', 'http://cubic.tech', 'http://localhost:5173']) {
      assert.equal(await status(bad), 403, bad);
    }
  } finally {
    await strict.close();
  }
});

test('GET /ice: STUN only without TURN, STUN + TURN when configured', async () => {
  type Ice = { iceServers: { urls: string[]; username?: string; credential?: string }[] };
  const plain = (await (await fetch(`${url}/ice`)).json()) as Ice;
  assert.equal(plain.iceServers.length, 1);
  assert.ok(plain.iceServers[0]!.urls.every((u) => u.startsWith('stun:')));
  assert.equal(plain.iceServers[0]!.username, undefined);

  const turn = { urls: [' turn:turn.example:80 ', 'turns:turn.example:443?transport=tcp', ''], username: 'user', credential: 'secret' };
  const withTurn = createApp({ allowLocalhost: true, turn });
  // Half-configured TURN (no credential) must not reach the browser: it would throw there.
  const half = createApp({ allowLocalhost: true, turn: { ...turn, credential: '' } });
  try {
    const res = await fetch(`http://localhost:${await withTurn.listen(0)}/ice`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /json/);
    const body = (await res.json()) as Ice;
    assert.deepEqual(body.iceServers[0], plain.iceServers[0]);
    assert.deepEqual(body.iceServers[1], { urls: ['turn:turn.example:80', 'turns:turn.example:443?transport=tcp'], username: 'user', credential: 'secret' });
    assert.equal(body.iceServers.length, 2);
    assert.deepEqual(await (await fetch(`http://localhost:${await half.listen(0)}/ice`)).json(), plain);
  } finally {
    await withTurn.close();
    await half.close();
  }
});

test('GET /ice: same origin rules as the socket, CORS header for allowed origins', async () => {
  const strict = createApp({ origins: ['https://cubic.vercel.app', 'https://cubic-*.vercel.app'], allowLocalhost: false, turn: { urls: ['turn:turn.example:80'], username: 'user', credential: 'secret' } });
  const port = await strict.listen(0);
  const get = (origin?: string, method = 'GET') => fetch(`http://localhost:${port}/ice`, { method, headers: origin ? { origin } : {} });
  try {
    for (const ok of ['https://cubic.vercel.app', 'https://cubic-git-ui-luis.vercel.app']) {
      const res = await get(ok);
      assert.equal(res.status, 200, ok);
      assert.equal(res.headers.get('access-control-allow-origin'), ok);
      assert.equal(((await res.json()) as { iceServers: unknown[] }).iceServers.length, 2);
    }
    // No Origin header (same-origin or a non-browser client): allowed, no CORS header.
    const bare = await get();
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get('access-control-allow-origin'), null);
    for (const bad of ['https://evil.example', 'https://cubic.vercel.app.evil.example', 'http://localhost:5173']) {
      const res = await get(bad);
      assert.equal(res.status, 403, bad);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.equal(await res.text(), '', 'no credentials in a rejected response');
    }
    assert.equal((await get('https://cubic.vercel.app', 'POST')).status, 405);
  } finally {
    await strict.close();
  }
});
