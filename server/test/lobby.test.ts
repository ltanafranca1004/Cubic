import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, RoomInfo, Seat, ServerToClient, Side } from '@cubic/shared';
import { createApp, type App } from '../src/app';
import { LIMITS, Rooms } from '../src/rooms';

// The lobby rules (host/guest, side picks, ready, start), first on a bare Room and then
// over real sockets, where both screens have to end up showing the same thing.

const rooms = new Rooms();
after(() => rooms.closeAll());

/** A friend room with a host and a guest in the lobby. */
function lobby() {
  const room = rooms.create('friend');
  const infos: RoomInfo[] = [];
  room.listen({ onRoom: (i) => infos.push(i) });
  const host = room.join();
  const guest = room.join();
  return { room, host, guest, infos };
}

test('a friend room starts in the lobby: host first, then guest, nobody has a side', () => {
  const { room, host, guest } = lobby();
  assert.deepEqual([host.role, host.side, guest.role, guest.side], ['host', null, 'guest', null]);
  const info = room.info();
  assert.equal(info.phase, 'lobby');
  assert.deepEqual(info.members.host, { id: host.id, connected: true, isAI: false, side: null, ready: false });
  assert.deepEqual(info.members.guest, { id: guest.id, connected: true, isAI: false, side: null, ready: false });
  assert.deepEqual(info.seats, { out: { taken: false, connected: false, isAI: false }, in: { taken: false, connected: false, isAI: false } });
  assert.notEqual(host.token, guest.token);
  assert.throws(() => room.join(), /full/i);
});

test('both players cannot pick the same side, and a pick can be taken back', () => {
  const { room, host, guest, infos } = lobby();
  room.pick(host.id, 'in');
  assert.throws(() => room.pick(guest.id, 'in'), /already picked/i);
  assert.equal(room.info().members.guest!.side, null);
  room.pick(guest.id, 'out');
  assert.deepEqual([room.info().seats.in.taken, room.info().seats.out.taken], [true, true]);
  // the host steps back to the middle: the side is free again
  room.pick(host.id, null);
  room.pick(guest.id, 'in');
  assert.deepEqual([room.info().members.host!.side, room.info().members.guest!.side], [null, 'in']);
  assert.throws(() => room.pick(host.id, 'up' as Side), /no such side/i);
  // every change was broadcast, a repeated pick was not
  const before = infos.length;
  room.pick(guest.id, 'in');
  assert.equal(infos.length, before);
});

test('only the guest readies up, only with a side, and a new pick clears it', () => {
  const { room, host, guest } = lobby();
  assert.throws(() => room.setReady(guest.id, true), /pick a side first/i);
  assert.throws(() => room.setReady(host.id, true), /only the guest/i);
  room.pick(guest.id, 'in');
  room.setReady(guest.id, true);
  assert.equal(room.info().members.guest!.ready, true);
  room.pick(guest.id, 'out');
  assert.equal(room.info().members.guest!.ready, false);
  room.setReady(guest.id, true);
  room.setReady(guest.id, false);
  assert.equal(room.info().members.guest!.ready, false);
});

test('start: host only, both sides picked, guest ready', () => {
  const { room, host, guest } = lobby();
  assert.match(room.startBlocker()!, /pick a side/i);
  room.pick(host.id, 'in');
  assert.throws(() => room.start(host.id), /pick a side/i);
  room.pick(guest.id, 'out');
  assert.throws(() => room.start(host.id), /not ready/i);
  room.setReady(guest.id, true);
  assert.equal(room.startBlocker(), null);
  assert.throws(() => room.start(guest.id), /only the host/i);
  assert.equal(room.phase, 'lobby');

  // nothing moves in the lobby
  assert.deepEqual(room.move('in', 0, -1), []);
  assert.equal(room.say('in', 'hello'), null);

  room.start(host.id);
  assert.equal(room.phase, 'playing');
  assert.deepEqual([room.sideOf(host.id), room.sideOf(guest.id)], ['in', 'out']);
  assert.deepEqual([room.state.players.in.connected, room.state.players.out.connected], [true, true]);
  // the sides are locked
  assert.throws(() => room.pick(host.id, 'out'), /already started/i);
  assert.throws(() => room.setReady(guest.id, false), /already started/i);
  assert.throws(() => room.start(host.id), /already started/i);
  assert.ok(room.move('in', 0, -1).length > 0);
});

test('a room alone cannot start', () => {
  const room = rooms.create('friend');
  const host = room.join();
  room.pick(host.id, 'out');
  assert.throws(() => room.start(host.id), /second player/i);
});

test('the guest leaves: their side is free and their ready is gone', () => {
  const { room, host, guest } = lobby();
  room.pick(host.id, 'out');
  room.pick(guest.id, 'in');
  room.setReady(guest.id, true);
  room.leave(guest.id);
  const info = room.info();
  assert.equal(info.members.guest, null);
  assert.equal(info.seats.in.taken, false);
  assert.throws(() => room.start(host.id), /second player/i);
  // a new guest starts from scratch and can take either free side
  const next = room.join();
  assert.deepEqual([next.role, next.side, room.info().members.guest!.ready], ['guest', null, false]);
  assert.notEqual(next.id, guest.id);
  assert.equal(room.idOfToken(guest.token), null);
  room.pick(next.id, 'in');
});

test('the guest drops: side freed, ready reset, place held for the token', () => {
  const { room, host, guest } = lobby();
  room.pick(host.id, 'out');
  room.pick(guest.id, 'in');
  room.setReady(guest.id, true);
  room.drop(guest.id);
  assert.deepEqual(room.info().members.guest, { id: guest.id, connected: false, isAI: false, side: null, ready: false });
  assert.throws(() => room.start(host.id), /second player/i);
  assert.throws(() => room.join(), /full/i); // the place is held
  const back = room.resume(room.idOfToken(guest.token)!);
  assert.deepEqual([back.id, back.role, back.side], [guest.id, 'guest', null]);
  assert.equal(room.info().members.guest!.connected, true);
});

test('a held lobby place is given up after lobbyHoldMs', async () => {
  const old = LIMITS.lobbyHoldMs;
  LIMITS.lobbyHoldMs = 30;
  try {
    const { room, guest } = lobby();
    room.drop(guest.id);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.info().members.guest, null);
    assert.equal(room.isFull(), false);
  } finally {
    LIMITS.lobbyHoldMs = old;
  }
});

test('the host leaves the lobby: the guest becomes the host and has to be readied again', () => {
  const { room, host, guest } = lobby();
  room.pick(host.id, 'out');
  room.pick(guest.id, 'in');
  room.setReady(guest.id, true);
  room.leave(host.id);
  const info = room.info();
  assert.deepEqual(info.members.host, { id: guest.id, connected: true, isAI: false, side: 'in', ready: false });
  assert.equal(info.members.guest, null);
  assert.equal(info.seats.out.taken, false);
});

test('the last human leaving closes the room', () => {
  const { room, host, guest } = lobby();
  room.leave(guest.id);
  assert.ok(rooms.get(room.code));
  room.leave(host.id);
  assert.equal(rooms.get(room.code), undefined);
});

test('joining a game that is already running takes the free seat', () => {
  const { room, host, guest } = lobby();
  room.pick(host.id, 'in');
  room.pick(guest.id, 'out');
  room.setReady(guest.id, true);
  room.start(host.id);
  room.leave(guest.id);
  assert.equal(room.phase, 'playing');
  const late = room.join();
  assert.deepEqual([late.role, late.side], ['guest', 'out']);
  assert.equal(room.state.players.out.connected, true);
});

test('an AI room skips the lobby', () => {
  const room = rooms.create('ai');
  const human = room.sit('in');
  assert.deepEqual([human.role, human.side, room.phase], ['host', 'in', 'playing']);
  const ai = room.sit('out', true);
  assert.deepEqual([ai.role, room.info().members.guest!.isAI, room.info().seats.out.isAI], ['guest', true, true]);
  assert.throws(() => room.pick(human.id, 'out'), /already started/i);
  assert.ok(room.move('in', 0, -1).length > 0);
});

// ---------- over sockets: both screens always match ----------

type Sock = Socket<ServerToClient, ClientToServer>;
type Res = { ok: true } | { ok: false; error: string };

class Client {
  sock: Sock;
  seat!: Seat;
  room: RoomInfo | null = null;
  voiceReady = 0;

  constructor(url: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('room', (r) => (this.room = r));
    this.sock.on('voice:ready', () => this.voiceReady++);
  }

  private seated = (send: (ack: (r: ({ ok: true } & Seat) | { ok: false; error: string }) => void) => void) =>
    new Promise<Seat>((ok, no) =>
      send((r) => {
        if (!r.ok) return no(new Error(r.error));
        this.seat = r;
        this.room = r.room;
        ok(r);
      }),
    );
  private act = (send: (ack: (r: Res) => void) => void) => new Promise<void>((ok, no) => send((r) => (r.ok ? ok() : no(new Error(r.error)))));

  create = () => this.seated((ack) => this.sock.emit('room:create', ack));
  join = (code: string) => this.seated((ack) => this.sock.emit('room:join', { code }, ack));
  rejoin = (code: string, token: string) => this.seated((ack) => this.sock.emit('room:rejoin', { code, token }, ack));
  pick = (side: Side | null) => this.act((ack) => this.sock.emit('lobby:pick', { side }, ack));
  ready = (ready: boolean) => this.act((ack) => this.sock.emit('lobby:ready', { ready }, ack));
  start = () => this.act((ack) => this.sock.emit('lobby:start', ack));
}

async function until(cond: () => boolean, what: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let app: App;
let url: string;
const clients: Client[] = [];
const client = () => {
  const c = new Client(url);
  clients.push(c);
  return c;
};

before(async () => {
  app = createApp({ allowLocalhost: true });
  url = `http://localhost:${await app.listen(0)}`;
});

after(async () => {
  for (const c of clients) c.sock.disconnect();
  await app.close();
});

test('sockets: picks, ready and start are synced to both players', async () => {
  const a = client();
  const b = client();
  const { code } = await a.create();
  await b.join(code);
  await until(() => !!a.room?.members.guest, 'the host sees the guest');

  await a.pick('in');
  await until(() => b.room?.members.host?.side === 'in', 'the guest sees the host pick');
  await assert.rejects(b.pick('in'), /already picked/i);
  await b.pick('out');
  await b.ready(true);
  await until(() => a.room?.members.guest?.ready === true, 'the host sees ready');
  assert.deepEqual(a.room, b.room);

  // lobby actions with no room, or with garbage, fail politely
  const stray = client();
  await assert.rejects(stray.pick('out'), /not in a room/i);
  await assert.rejects(b.pick('sideways' as Side), /no such side/i);
  assert.equal(b.room?.members.guest?.ready, true);

  await assert.rejects(b.start(), /only the host/i);
  await a.start();
  await until(() => a.room?.phase === 'playing' && b.room?.phase === 'playing', 'both see the game start');
  assert.deepEqual(a.room, b.room);
  assert.deepEqual([a.room!.members.host!.side, a.room!.members.guest!.side], ['in', 'out']);
  await until(() => a.voiceReady > 0 && b.voiceReady > 0, 'the voice call starts with the game');
});

test('sockets: the guest leaves, comes back by code, and the lobby resets', async () => {
  const a = client();
  const b = client();
  const { code } = await a.create();
  await b.join(code);
  await a.pick('out');
  await b.pick('in');
  await b.ready(true);
  await until(() => a.room?.members.guest?.ready === true, 'ready');

  b.sock.emit('room:leave');
  await until(() => a.room?.members.guest === null, 'the host sees the guest leave');
  assert.equal(a.room!.seats.in.taken, false);
  await assert.rejects(a.start(), /second player/i);
  assert.equal(a.voiceReady, 0); // no call in the lobby

  await b.join(code);
  await until(() => !!a.room?.members.guest, 'guest back');
  assert.deepEqual([a.room!.members.guest!.side, a.room!.members.guest!.ready], [null, false]);
});

test('sockets: a refresh in the lobby rejoins by token', async () => {
  const a = client();
  const b = client();
  const { code } = await a.create();
  const seatB = await b.join(code);
  await b.pick('in');
  await b.ready(true);
  b.sock.disconnect();
  await until(() => a.room?.members.guest?.connected === false, 'the host sees the guest drop');
  assert.deepEqual([a.room!.members.guest!.side, a.room!.members.guest!.ready], [null, false]);

  const b2 = client();
  await assert.rejects(b2.rejoin(code, 'wrong-token'), /gone/i);
  const back = await b2.rejoin(code, seatB.token);
  assert.deepEqual([back.id, back.role, back.room.phase], [seatB.id, 'guest', 'lobby']);
  await until(() => a.room?.members.guest?.connected === true, 'the host sees the guest back');
  await b2.pick('in');
  await until(() => a.room?.members.guest?.side === 'in', 'pick after rejoin');
});

test('sockets: the host leaves the lobby and the guest is promoted', async () => {
  const a = client();
  const b = client();
  const { code } = await a.create();
  const seatB = await b.join(code);
  a.sock.emit('room:leave');
  await until(() => b.room?.members.host?.id === seatB.id, 'the guest becomes the host');
  assert.equal(b.room!.members.guest, null);
  // and can run the room: a new guest joins and the new host starts
  const c = client();
  await c.join(code);
  await b.pick('out');
  await c.pick('in');
  await c.ready(true);
  await b.start();
  await until(() => c.room?.phase === 'playing', 'started by the promoted host');
});
