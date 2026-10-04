import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { PING_COOLDOWN_MS, QUICK_CHATS, type ChatMessage, type ClientToServer, type Ping, type QuickChat, type Seat, type ServerToClient, type Side } from '@cubic/shared';
import { AiPlayer } from '../src/ai/aiPlayer';
import { scriptedBrain } from '../src/ai/scripted';
import { createApp, type App } from '../src/app';
import { Room, Rooms } from '../src/rooms';

// Pings and quick chat on the server: the Room rules with a fake clock, the same through
// real sockets, and an AI room that must not mind either.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A playing room with both seats taken and a clock the test moves. */
function playing() {
  let now = 1_000_000;
  const room = new Room(
    'TEST',
    'friend',
    () => {},
    () => now,
  );
  room.sit('out');
  room.sit('in');
  const pings: Ping[] = [];
  const quicks: QuickChat[] = [];
  const chat: ChatMessage[] = [];
  room.listen({ onPing: (p) => pings.push(p), onQuick: (q) => quicks.push(q), onChat: (m) => chat.push(m) });
  return { room, pings, quicks, chat, tick: (ms: number) => (now += ms), now: () => now };
}

test("ping: lands on the sender's tile and is broadcast", () => {
  const { room, pings, now } = playing();
  const pose = room.state.players.in.pose;
  const ping = room.ping('in');
  assert.deepEqual(ping, { id: ping!.id, from: 'in', face: pose.face, x: pose.x, y: pose.y, at: now() });
  assert.deepEqual(pings, [ping]);
  room.close();
});

test('ping: one per player per 2 s; the two players have their own cooldowns', () => {
  const { room, pings, tick } = playing();
  assert.ok(room.ping('out'));
  assert.equal(room.ping('out'), null, 'again at once: refused');
  assert.ok(room.ping('in'), 'the partner is not held back by it');
  tick(PING_COOLDOWN_MS - 1);
  assert.equal(room.ping('out'), null);
  tick(1);
  assert.ok(room.ping('out'));
  assert.equal(pings.length, 3);
  assert.deepEqual(new Set(pings.map((p) => p.id)).size, 3, 'ids are unique');
  room.close();
});

test('ping and quick chat do nothing in the lobby', () => {
  const room = new Room('LOBY', 'friend', () => {});
  room.join();
  room.join();
  assert.equal(room.ping('out'), null);
  assert.equal(room.quick('out', 0), null);
  room.close();
});

test('quick chat: the fixed line goes in the chat log and out as a bubble', () => {
  const { room, quicks, chat } = playing();
  const q = room.quick('out', 2);
  assert.ok(q);
  assert.deepEqual([q.from, q.index], ['out', 2]);
  assert.deepEqual(
    chat.map((m) => [m.from, m.text]),
    [['out', 'Yes']],
  );
  assert.equal(q.chatId, chat[0]!.id);
  assert.equal(room.chat.at(-1)!.text, QUICK_CHATS[2]);
  assert.deepEqual(quicks, [q]);
  room.close();
});

test('quick chat: only the four lines; anything else is dropped', () => {
  const { room, quicks, chat } = playing();
  for (const bad of [4, -1, 1.5, '0', null, undefined, { index: 1 }]) assert.equal(room.quick('out', bad), null);
  assert.equal(quicks.length + chat.length, 0);
  room.close();
});

test('quick chat: shares the chat rate limit (5 lines per 5 s, typed or quick)', () => {
  const { room, quicks, chat, tick } = playing();
  assert.ok(room.say('out', 'typed'));
  for (let i = 0; i < 4; i++) assert.ok(room.quick('out', i), `quick ${i}`);
  assert.equal(room.quick('out', 0), null, 'the sixth line in the window is refused');
  assert.equal(room.say('out', 'also refused'), null);
  assert.equal(quicks.length, 4);
  assert.equal(chat.length, 5);
  tick(5000);
  assert.ok(room.quick('out', 3));
  room.close();
});

// ---------- an AI room ----------

test('an AI partner is not broken by pings and quick chat; it hears the line as chat', async () => {
  const rooms = new Rooms();
  const room = rooms.create('ai');
  room.sit('out');
  const ai = new AiPlayer(room, 'in', scriptedBrain(), { minThinkMs: 20, idleMs: 1e9, stepMs: 5, timeoutMs: 200, log: () => {} });
  const pings: Ping[] = [];
  room.listen({ onPing: (p) => pings.push(p) });
  assert.ok(room.ping('out'));
  assert.ok(room.quick('out', 0));
  assert.equal(room.chat.at(-1)!.text, 'Here!');
  // the AI goes on playing through the same Room methods, and could ping or quick-chat itself
  await sleep(150);
  assert.ok(room.ping('in'));
  assert.ok(room.quick('in', 3));
  assert.equal(room.chat.at(-1)!.isAI, true);
  assert.equal(pings.length, 2);
  ai.stop();
  rooms.closeAll();
});

// ---------- over real sockets ----------

type Sock = Socket<ServerToClient, ClientToServer>;
let app: App;
let url: string;
const socks: Sock[] = [];
before(async () => {
  app = createApp({ allowLocalhost: true });
  url = `http://localhost:${await app.listen(0)}`;
});
after(async () => {
  for (const s of socks) s.close();
  await app.close();
});

function client() {
  const sock: Sock = io(url, { transports: ['websocket'], forceNew: true });
  socks.push(sock);
  const got = { pings: [] as Ping[], quicks: [] as QuickChat[], chat: [] as ChatMessage[] };
  sock.on('ping', (p) => got.pings.push(p));
  sock.on('quick', (q) => got.quicks.push(q));
  sock.on('chat', (m) => got.chat.push(m));
  const ask = <T>(send: (ack: (r: ({ ok: true } & T) | { ok: false; error: string }) => void) => void) => new Promise<T>((ok, no) => send((r) => (r.ok ? ok(r) : no(new Error(r.error)))));
  return {
    sock,
    got,
    create: () => ask<Seat>((ack) => sock.emit('room:create', ack)),
    join: (code: string) => ask<Seat>((ack) => sock.emit('room:join', { code }, ack)),
    pick: (side: Side) => ask<object>((ack) => sock.emit('lobby:pick', { side }, ack)),
    ready: () => ask<object>((ack) => sock.emit('lobby:ready', { ready: true }, ack)),
    start: () => ask<object>((ack) => sock.emit('lobby:start', ack)),
  };
}

async function until(cond: () => boolean, what: string, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** Two sockets in one lobby: `a` is the host, `b` the guest. */
async function paired() {
  const a = client();
  const b = client();
  const seat = await a.create();
  await b.join(seat.code);
  return { a, b, seat };
}

test('sockets: a ping and a quick chat reach both players; spam and junk are dropped', async () => {
  const { a, b } = await paired();

  // not before the game starts
  a.sock.emit('ping');
  a.sock.emit('quick', { index: 0 });
  await a.pick('out');
  await b.pick('in');
  await b.ready();
  await a.start();
  await sleep(60);
  assert.equal(a.got.pings.length + a.got.quicks.length + b.got.chat.length, 0, 'nothing in the lobby');

  a.sock.emit('ping');
  a.sock.emit('ping'); // inside the cooldown
  await until(() => a.got.pings.length === 1 && b.got.pings.length === 1, 'the ping on both sides');
  assert.deepEqual(a.got.pings[0], b.got.pings[0]);
  assert.equal(b.got.pings[0]!.from, 'out');
  assert.equal(b.got.pings[0]!.face, 1);

  b.sock.emit('quick', { index: 1 });
  // junk from a hostile client is ignored, not a crash
  b.sock.emit('quick', { index: 99 });
  b.sock.emit('quick', null as unknown as { index: number });
  b.sock.emit('quick', { index: 'x' as unknown as number });
  await until(() => a.got.quicks.length === 1 && b.got.quicks.length === 1, 'the bubble on both sides');
  assert.deepEqual([a.got.quicks[0]!.from, a.got.quicks[0]!.index], ['in', 1]);
  await until(() => a.got.chat.length === 1, 'the line in the chat log');
  assert.deepEqual([a.got.chat[0]!.from, a.got.chat[0]!.text], ['in', 'Wait']);
  assert.equal(a.got.quicks[0]!.chatId, a.got.chat[0]!.id);

  await sleep(80);
  assert.equal(a.got.pings.length, 1, 'the second ping was inside the cooldown');
  assert.equal(a.got.quicks.length, 1);
});

test('sockets: Q (drop only) never picks an item up; E still does', async () => {
  const { a, b, seat } = await paired();
  await a.pick('out');
  await b.pick('in');
  await b.ready();
  await a.start();
  const room = app.rooms.get(seat.code)!;
  const rose = room.state.items.rose!;
  // stand the outside player on the rose (the test owns the room: no need to walk there)
  Object.assign(room.state.players.out.pose, { face: rose.face, x: rose.x, y: rose.y });
  a.sock.emit('interact', { seq: 1, only: 'drop' });
  await sleep(80);
  assert.equal(room.state.players.out.carrying, null, 'Q on an item does not pick it up');
  a.sock.emit('interact', { seq: 2 });
  await until(() => room.state.players.out.carrying === 'rose', 'E to pick it up');
  a.sock.emit('interact', { seq: 3, only: 'drop' });
  await until(() => room.state.players.out.carrying === null, 'Q to drop it');
});
