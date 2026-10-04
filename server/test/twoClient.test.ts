import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { FACE_SIZE, defaultEnv, visibleObjects, type ChatMessage, type ClientToServer, type GameEvent, type RoomInfo, type Seat, type ServerToClient, type Side, type StateUpdate, type FaceId, type TileRef } from '@cubic/shared';
import { readCode } from '../../shared/src/puzzles/hiddenCode';
import { createApp, type App } from '../src/app';
import { LIMITS } from '../src/rooms';
// face 4 (botanical-mirror): what a side sees, under its own name so the other faces' blocks can import theirs
import { visibleObjects as seenOnFace4 } from '@cubic/shared';
import { MOVES, findPath, hazardAvoid, linesOn, stepPose } from '@cubic/shared'; // faces 5 and 6

// Scripted two-client game over real sockets: rooms, codes, the lobby (pick sides, ready,
// start), chat, validation, reconnect, items, every puzzle and the win.

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

  /** Walk to a tile with real validated moves, re-planning from the server state. Never through a deadly tile (face 6's lava). */
  async walkTo(target: TileRef) {
    for (let guard = 0; guard < 200; guard++) {
      const path = findPath(this.last.state, this.side, (p) => p.face === target.face && p.x === target.x && p.y === target.y, defaultEnv, undefined, hazardAvoid(this.last.state, this.side));
      assert.ok(path, `${this.side}: no path to face ${target.face} ${target.x},${target.y}`);
      if (path.length === 0 || this.last.state.wonAt !== null) return;
      await this.move(path[0]![0], path[0]![1]);
    }
    assert.fail('walkTo did not arrive');
  }
}

const find = (side: Side, face: FaceId, type: string, name?: string): TileRef => {
  const o = defaultEnv.world[side][face].objects.find((x) => x.type === type && (name === undefined || x.name === name))!;
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
  /** The inside player's live client (a new one after the reconnect below). */
  let bNow = () => b;

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

  // --- THE PUZZLES, ONLINE. One block per puzzle, in chain order (1 and 3 stand alone, then
  // 2 -> 5 -> 6 -> 4). Each client only uses what its own side can see. Replace a block
  // with the real play when its puzzle replaces the stub; keep the `solved` line that ends it.
  const solved = async (face: FaceId) => {
    await a.until(() => a.last.state.solved.includes(face), `face ${face} solved for the outside player`);
    await bNow().until(() => bNow().last.state.solved.includes(face), `face ${face} solved for the inside player`);
  };

  // ---------- face 1: hidden-code ----------
  // outside reads the number laid out in the grass, inside types it on the floor keypad
  const code = readCode(visibleObjects(a.last.state, 'out', 1));
  assert.ok(code, 'the outside player sees the number');
  assert.equal(readCode(visibleObjects(b.last.state, 'in', 1)), null, 'the inside player does not');
  for (const name of [...code, 'enter']) {
    await b.walkTo(find('in', 1, 'key', name));
    await b.interact();
  }
  await a.until(() => a.events.some((e) => e.type === 'use' && e.side === 'in'), 'the use event reaches the other player');
  await b.until(() => b.events.some((e) => e.type === 'solve' && e.face === 1), 'solve reaches both');
  assert.deepEqual(a.last.state.solved, [1]);
  // ---------- end face 1 ----------

  // --- walk around the cube: inside does a full lap through 4 faces (row 0 is clear)
  await b.walkTo({ face: 1, x: 8, y: 0 });
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

  bNow = () => b2;

  // --- items online: outside picks one up, carries it over an edge and drops it
  const room = app.rooms.get(seatA.code)!;
  // (the test owns the room: the items of the real game are handed out by the puzzles)
  room.state.items.parcel = { id: 'parcel', kind: 'parcel', side: 'out', face: a.pose.face, x: a.pose.x, y: a.pose.y, carriedBy: null, placedOn: null, props: {} };
  await a.interact();
  assert.equal(a.last.state.players.out.carrying, 'parcel');
  await a.walkTo({ face: 3, x: 5, y: 5 });
  assert.equal(a.last.state.players.out.carrying, 'parcel'); // it crossed the edges with them
  await a.interact();
  await b2.until(() => b2.events.some((e) => e.type === 'drop' && e.side === 'out'), 'the drop reaches both');
  assert.deepEqual([a.last.state.items.parcel!.face, a.last.state.items.parcel!.carriedBy, a.last.state.solved], [3, null, [1]]); // E put the item down: no use
  delete room.state.items.parcel;

  // ---------- face 3: mirrored-glyph ----------
  // outside reads the symbol off the snow, inside flips those tiles (a snake, row by row)
  const symbol = visibleObjects(a.last.state, 'out', 3).filter((o) => o.type === 'f3-glyph');
  assert.deepEqual(visibleObjects(b2.last.state, 'in', 3).filter((o) => o.type === 'f3-glyph'), []); // the inside player cannot see it
  symbol.sort((p, q) => p.y - q.y || (p.y % 2 ? q.x - p.x : p.x - q.x));
  for (const o of symbol) {
    await b2.walkTo({ face: 3, x: o.x, y: o.y });
    await b2.interact();
  }
  await solved(3);
  // ---------- end face 3 ----------

  // ---------- face 2: equation-safe ----------
  // The outside player counts, the inside player types the product. The battery stays lying.
  {
    const { visibleObjects } = await import('@cubic/shared');
    const seen = (type: string) => visibleObjects(a.last.state, 'out', 2).filter((o) => o.type === type).length;
    const answer = 3 * seen('f2-bush') * 2 * seen('f2-bird') * seen('f2-rock');
    for (const name of [...String(answer), 'enter']) {
      const key = visibleObjects(b2.last.state, 'in', 2).find((o) => o.type === 'key' && o.state === name)!;
      await b2.walkTo({ face: 2, x: key.x, y: key.y });
      await b2.interact();
    }
  }
  await solved(2);
  assert.equal(a.last.state.items.battery?.face, 2);
  // ---------- end face 2 ----------

  // ---------- face 5: sequence-laser ----------
  {
    const symbols = (c: Client) => visibleObjects(c.last.state, c.side, 5).filter((o) => o.type === 'f5-symbol');
    // inside: the battery (lying inside on face 2, or already in hand) goes into the emitter
    const battery = b2.last.state.items.battery;
    assert.ok(battery, 'face 2 handed over the battery');
    if (battery.carriedBy !== 'in') {
      await b2.walkTo({ face: battery.face, x: battery.x, y: battery.y });
      await b2.interact();
    }
    await b2.walkTo(find('in', 5, 'target', 'f5-emitter'));
    await b2.interact();
    // outside: E on REPLAY, then watch the symbols light up (0.5 s each, on the server's tick)
    await a.walkTo(find('out', 5, 'f5-replay'));
    await a.interact();
    const order: string[] = [];
    for (let i = 0; i < 120 && order.length < symbols(a).length; i++) {
      const lit = symbols(a).find((o) => o.state?.endsWith('-lit'))?.state?.slice(0, -4);
      if (lit && !order.includes(lit)) order.push(lit);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(order.length, 7, 'the outside player saw every symbol light up');
    assert.ok(symbols(b2).every((o) => !o.state?.endsWith('-lit')), 'the inside player never sees the sequence');
    // inside: presses the buttons in the order the outside player calls out
    for (const name of order) {
      const button = symbols(b2).find((o) => o.state === name)!;
      await b2.walkTo({ face: 5, x: button.x, y: button.y });
      await b2.interact();
    }
    assert.ok(a.events.some((e) => e.type === 'puzzle' && e.name === 'laser'), 'the laser fires');
  }
  await solved(5);
  // ---------- end face 5 ----------

  // ---------- face 6: laser-path ----------
  {
    const stepOnto = async (c: Client, x: number, y: number) => {
      const m = MOVES.find(([dx, dy]) => ((p) => p.face === 6 && p.x === x && p.y === y)(stepPose(c.pose, dx, dy).pose));
      assert.ok(m, `${c.side} is not next to face 6 ${x},${y}`);
      await c.move(m[0], m[1]);
    };
    const reset = async () => {
      await a.walkTo(find('out', 6, 'reset'));
      await a.interact();
    };
    // outside: mirrors to their start, then three pushes bend the beam onto the crate
    await reset();
    for (const [from, box] of [[[3, 2], [4, 2]], [[9, 5], [9, 4]], [[9, 4], [9, 3]]] as const) {
      await a.walkTo({ face: 6, x: from[0], y: from[1] });
      await stepOnto(a, box[0], box[1]);
    }
    await b2.until(() => b2.events.some((e) => e.type === 'puzzle' && e.name === 'burn'), 'the crate burns');
    assert.equal(a.last.state.items.flower?.side, 'out'); // left lying for face 4
    // the beam is the path: only the outside player sees it; the inside player walks what they are told,
    // from the edge tile where the crate stood back along the beam to its source (the button)
    const beam = linesOn(a.last.state, 'out', 6);
    assert.ok(beam.length > 1 && linesOn(b2.last.state, 'in', 6).length === 0);
    const tiles: { x: number; y: number }[] = [{ x: beam[0]!.from[0], y: beam[0]!.from[1] }];
    for (const { from, to } of beam) for (let [x, y] = from; x !== to[0] || y !== to[1]; ) tiles.push({ x: (x += Math.sign(to[0] - from[0])), y: (y += Math.sign(to[1] - from[1])) });
    const [start, ...path] = tiles.reverse();
    const edge = [start!.x, start!.y] as const;
    assert.ok(edge[0] === 0 || edge[1] === 0 || edge[0] === FACE_SIZE - 1 || edge[1] === FACE_SIZE - 1, 'the beam ends on the ring');
    // inside: round the lava to the face next door, then onto the ring tile the path starts on
    const beside = findPath(b2.last.state, 'in', (p) => p.face !== 6 && MOVES.some(([dx, dy]) => ((q) => q.face === 6 && q.x === edge[0] && q.y === edge[1])(stepPose(p, dx, dy).pose)), defaultEnv, (face) => face !== 6);
    assert.ok(beside, 'a way to face 6 that stays off its lava');
    for (const [dx, dy] of beside) await b2.move(dx, dy);
    await stepOnto(b2, edge[0], edge[1]);
    const strikes = b2.last.state.strikes;
    for (const p of path) await stepOnto(b2, p.x, p.y);
    await b2.interact(); // the button
    assert.equal(b2.last.state.strikes, strikes, 'nobody fell in the lava');
  }
  await solved(6);
  // ---------- end face 6 ----------

  assert.equal(a.last.state.wonAt, null); // one face to go

  // ---------- face 4: botanical-mirror ----------
  {
    // Five flowers outside: the crate's (face 6) and the four that lay about from the start. One walk each.
    const loose = () => Object.values(a.last.state.items).filter((i) => i.side === 'out' && i.kind.startsWith('flower-') && !i.placedOn);
    assert.equal(loose().length, 5, 'face 6 is solved: five flowers are outside');
    // Outside sees five empty pots and no colours; inside sees the five flowers and names the pots.
    assert.ok(seenOnFace4(a.last.state, 'out', 4).every((o) => o.type === 'f4-pot' && o.state === 'empty'));
    const pots = seenOnFace4(bNow().last.state, 'in', 4).filter((o) => o.type === 'f4-flowerpot');
    assert.equal(new Set(pots.map((o) => o.state)).size, 5);
    /** A pot is solid: walk to a tile next to it, then step into it (a bump) to face it. */
    const faceTo = async (pot: { x: number; y: number }) => {
      const into = (p: typeof a.pose) => MOVES.find(([dx, dy]) => ((to) => !to.crossed && to.pose.face === 4 && to.pose.x === pot.x && to.pose.y === pot.y)(stepPose(p, dx, dy)));
      for (let guard = 0; guard < 200; guard++) {
        const path = findPath(a.last.state, 'out', (p) => !!into(p), defaultEnv);
        assert.ok(path, `no way to stand next to the pot at ${pot.x},${pot.y}`);
        if (path.length === 0) break;
        await a.move(path[0]![0], path[0]![1]);
      }
      const bump = into(a.pose)!;
      await a.move(bump[0], bump[1]);
      assert.notDeepEqual([a.pose.x, a.pose.y], [pot.x, pot.y], 'nobody stands on a pot');
    };
    const ids = loose().sort((x, y) => Number(y.carriedBy === 'out') - Number(x.carriedBy === 'out')).map((i) => i.id);
    for (const [n, id] of ids.entries()) {
      const flower = () => a.last.state.items[id]!;
      if (flower().carriedBy !== 'out') {
        await a.walkTo({ face: flower().face, x: flower().x, y: flower().y });
        await a.interact();
      }
      assert.equal(a.last.state.players.out.carrying, id);
      const colour = flower().kind.replace('flower-', '');
      if (n === 0) {
        // A wrong pot first: a strike for both, and the flower is back in the outside hands.
        const wrong = pots.find((o) => o.state !== colour)!;
        const strikes = a.last.state.strikes;
        await faceTo(wrong);
        await a.interact();
        await bNow().until(() => bNow().last.state.strikes === strikes + 1, 'the strike reaches the inside player');
        assert.deepEqual([a.last.state.strikes, a.last.state.players.out.carrying, a.last.state.solved.includes(4)], [strikes + 1, id, false]);
      }
      // The pot the inside player names: the flower stays in it.
      const right = pots.find((o) => o.state === colour)!;
      await faceTo(right);
      await a.interact();
      assert.deepEqual([a.last.state.players.out.carrying, flower().x, flower().y, !!flower().placedOn], [null, right.x, right.y, true]);
      assert.equal(a.last.state.solved.includes(4), n === ids.length - 1);
    }
  }
  await solved(4);
  // ---------- end face 4 ----------

  // --- the win: no portal, the last solve ends the game for both
  await a.until(() => a.events.some((e) => e.type === 'win'), 'win reaches the outside player');
  await b2.until(() => b2.events.some((e) => e.type === 'win'), 'win reaches the inside player');
  assert.notEqual(a.last.state.wonAt, null);
  assert.deepEqual([...a.last.state.solved].sort(), [1, 2, 3, 4, 5, 6]);

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
