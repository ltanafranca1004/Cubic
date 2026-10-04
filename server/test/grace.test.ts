import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, RoomInfo, Seat, ServerToClient, Side } from '@cubic/shared';
import { createApp } from '../src/app';
import { LIMITS, Rooms, SEAT_HOLD_MS, type Room } from '../src/rooms';

// The grace window of a running game: a player who drops or presses Leave keeps their
// seat, side and token for 60 s. First on bare Rooms with fake timers (no real waiting),
// then the Leave + join-by-code path over real sockets.

const HOLD = SEAT_HOLD_MS;
const START = 1_700_000_000_000;

/** Fake clock for the Room tests: setTimeout, setInterval and Date move only with `pass`. */
function fake() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });
}
const pass = (ms: number) => mock.timers.tick(ms);
afterEach(() => mock.timers.reset());

/** A running friend game: the host outside, the guest inside. */
function game() {
  const rooms = new Rooms();
  const room = rooms.create('friend');
  const host = room.join();
  const guest = room.join();
  room.pick(host.id, 'out');
  room.pick(guest.id, 'in');
  room.setReady(guest.id, true);
  room.start(host.id);
  let closed = 0;
  room.listen({ onClosed: () => closed++ });
  return { rooms, room, host, guest, closed: () => closed };
}

/** How often the room still broadcasts a state (its tick, a move): 0 once it is deleted. */
function countStates(room: Room): () => number {
  let n = 0;
  const inner = room as unknown as { emitState(events: unknown[]): void };
  const real = inner.emitState.bind(room);
  inner.emitState = (events) => {
    n++;
    real(events);
  };
  return () => n;
}

test('the hold is 60 seconds', () => {
  assert.deepEqual([SEAT_HOLD_MS, LIMITS.seatHoldMs], [60_000, 60_000]);
});

test('a player disconnects and comes back in time: same seat, same side, same game', () => {
  fake();
  const { room, host, guest } = game();
  room.move('in', 0, -1);
  room.state.solved.push(1);
  const pose = { ...room.state.players.in.pose };

  room.drop(guest.id);
  const held = room.info();
  assert.deepEqual(held.seats.in, { taken: true, connected: false, isAI: false, away: { kind: 'reconnecting', until: START + HOLD, now: START } });
  assert.equal(held.seats.out.away, undefined);
  assert.equal(room.state.players.in.connected, false);
  assert.throws(() => room.join(), /full/i); // a stranger with the code cannot take the held seat

  // the other player keeps playing and nothing resets
  pass(45_000);
  assert.ok(room.move('out', 0, 1).length > 0);
  assert.deepEqual(room.info().seats.in.away, { kind: 'reconnecting', until: START + HOLD, now: START + 45_000 }); // 0:15 left
  assert.deepEqual(room.state.solved, [1]);

  const back = room.resume(room.idOfToken(guest.token)!);
  assert.deepEqual([back.id, back.role, back.side, back.token], [guest.id, 'guest', 'in', guest.token]);
  assert.deepEqual(back.state.players.in.pose, pose);
  assert.deepEqual(back.state.solved, [1]);
  assert.deepEqual(room.info().seats.in, { taken: true, connected: true, isAI: false });
  assert.equal(room.info().members.host!.id, host.id);

  // the old deadline is dead: nothing happens when it would have passed
  pass(HOLD);
  assert.equal(room.sideOf(guest.id), 'in');
  assert.ok(room.move('in', 0, -1).length > 0);
});

test('a player presses Leave and comes back in time: the token still holds the seat', () => {
  fake();
  const { room, host, guest } = game();
  room.leave(host.id);
  assert.deepEqual(room.info().seats.out.away, { kind: 'left', until: START + HOLD, now: START });
  assert.equal(room.info().members.host!.id, host.id, 'still the host while the seat is held');
  assert.throws(() => room.join(), /full/i);
  assert.ok(room.move('in', 0, -1).length > 0);

  pass(HOLD - 1);
  assert.equal(room.idOfToken(host.token), host.id);
  const back = room.resume(host.id);
  assert.deepEqual([back.id, back.role, back.side], [host.id, 'host', 'out']);
  assert.equal(room.info().seats.out.away, undefined);
  pass(HOLD);
  assert.deepEqual([room.info().members.host!.id, room.info().members.guest!.id], [host.id, guest.id]);
});

test('the window passes: the seat opens for anyone with the code, and the old token is dead', () => {
  fake();
  const { rooms, room, host, guest } = game();
  room.move('in', 0, -1);
  const pose = { ...room.state.players.in.pose };
  room.leave(guest.id);
  pass(HOLD - 1);
  assert.equal(room.info().seats.in.taken, true);
  pass(1);
  const info = room.info();
  assert.deepEqual(info.seats.in, { taken: false, connected: false, isAI: false });
  assert.equal(info.members.guest, null);
  assert.equal(info.members.host!.id, host.id);
  assert.equal(room.idOfToken(guest.token), null);
  assert.throws(() => room.resume(guest.id), /gone/i);
  assert.ok(rooms.get(room.code), 'the room goes on with one player');

  // whoever joins now takes the free side, where the game is
  const next = room.join();
  assert.deepEqual([next.role, next.side], ['guest', 'in']);
  assert.notEqual(next.id, guest.id);
  assert.deepEqual(next.state.players.in.pose, pose);
});

test('a second drop starts a new window', () => {
  fake();
  const { room, guest } = game();
  room.drop(guest.id);
  pass(50_000);
  room.resume(guest.id);
  room.drop(guest.id);
  assert.equal(room.info().seats.in.away!.until, START + 50_000 + HOLD);
  pass(HOLD - 1);
  assert.equal(room.info().seats.in.taken, true);
  pass(1);
  assert.equal(room.info().seats.in.taken, false);
});

for (const how of ['leave', 'drop'] as const) {
  test(`host transfer: the host is gone (${how}) past the window, the guest becomes the host`, () => {
    fake();
    const { room, host, guest } = game();
    const infos: RoomInfo[] = [];
    room.listen({ onRoom: (i) => infos.push(i) });
    room[how](host.id);
    pass(HOLD - 1);
    assert.deepEqual([room.info().members.host!.id, room.info().members.guest!.id], [host.id, guest.id]);
    pass(1);
    const info = infos.at(-1)!; // the change was broadcast
    assert.deepEqual(info.members.host, { id: guest.id, connected: true, isAI: false, side: 'in', ready: false });
    assert.equal(info.members.guest, null);
    assert.equal(info.seats.out.taken, false);
    // the old host is a stranger now: joining again makes them the guest of the new host
    const again = room.join();
    assert.deepEqual([again.role, again.side], ['guest', 'out']);
    assert.equal(room.info().members.host!.id, guest.id);
  });
}

test('host transfer the other way round: the guest is gone past the window, the host stays the host', () => {
  fake();
  const { room, host, guest } = game();
  room.drop(guest.id);
  pass(HOLD);
  assert.equal(room.info().members.host!.id, host.id);
  assert.equal(room.info().members.guest, null);
  // and it moves again when the roles turn: a new guest joins, the host leaves for good
  const next = room.join();
  room.leave(host.id);
  pass(HOLD);
  assert.deepEqual(room.info().members.host, { id: next.id, connected: true, isAI: false, side: 'in', ready: false });
  // host-only things follow the role: after a win the new host's room restarts
  room.state.wonAt = START;
  room.restart();
  assert.equal(room.state.wonAt, null);
});

test('both players are gone at once and one comes back: the game continues', () => {
  fake();
  const { rooms, room, host, guest, closed } = game();
  room.state.solved.push(3);
  room.drop(host.id);
  room.leave(guest.id);
  assert.deepEqual([room.info().seats.out.away!.kind, room.info().seats.in.away!.kind], ['reconnecting', 'left']);
  pass(HOLD - 1);
  assert.equal(rooms.get(room.code), room, 'the room is kept while both seats are held');
  assert.equal(closed(), 0);

  const back = room.resume(guest.id);
  assert.deepEqual([back.side, back.state.solved], ['in', [3]]);
  pass(1); // the host never came back: their seat opens, the one who did is the host
  assert.equal(rooms.get(room.code), room);
  assert.deepEqual(room.info().members.host, { id: guest.id, connected: true, isAI: false, side: 'in', ready: false });
  assert.equal(room.info().seats.out.taken, false);
  assert.ok(room.move('in', 0, -1).length > 0);
  pass(HOLD * 2);
  assert.equal(closed(), 0);
});

test('both players are gone and nobody comes back: the room is deleted and everything is freed', () => {
  fake();
  const { rooms, room, host, guest, closed } = game();
  const states = countStates(room);
  pass(1000);
  const ticking = states();
  room.leave(host.id);
  pass(30_000);
  room.drop(guest.id); // 30 s later: the room lives 60 s from the moment the last one went
  pass(30_000);
  assert.equal(rooms.get(room.code), room);
  assert.equal(room.info().members.host!.id, guest.id, 'the host seat ran out first');
  assert.equal(closed(), 0);
  pass(29_999);
  assert.equal(rooms.size, 1);
  pass(1);
  assert.equal(rooms.get(room.code), undefined);
  assert.equal(rooms.size, 0);
  assert.equal(closed(), 1);
  assert.deepEqual([room.idOfToken(host.token), room.idOfToken(guest.token)], [null, null]);

  // no tick, no timer and no listener is left behind
  const after = states();
  pass(HOLD * 3);
  assert.equal(states(), after);
  assert.ok(ticking === 0 || after > ticking, 'the tick ran until the room was deleted');
  assert.equal(closed(), 1);
  assert.throws(() => room.resume(guest.id), /gone/i);
  assert.deepEqual(room.move('in', 0, -1), []);
});

test('an AI room: the human leaves, the room is kept 60 s, then closed with the AI', () => {
  for (const how of ['leave', 'drop'] as const) {
    mock.timers.reset();
    fake();
    const rooms = new Rooms();
    const room = rooms.create('ai');
    const human = room.sit('out');
    room.sit('in', true);
    let stopped = 0; // AiPlayer stops itself (timers, the call in flight) from onClosed
    room.listen({ onClosed: () => stopped++ });
    room.state.solved.push(2);

    // in time: the same seat and the same game, the AI still in its own
    room[how](human.id);
    assert.equal(room.info().seats.out.away!.kind, how === 'leave' ? 'left' : 'reconnecting');
    assert.deepEqual(room.info().seats.in, { taken: true, connected: true, isAI: true });
    pass(HOLD - 1);
    assert.equal(rooms.get(room.code), room);
    const back = room.resume(room.idOfToken(human.token)!);
    assert.deepEqual([back.side, back.role, back.state.solved], ['out', 'host', [2]]);
    pass(HOLD);
    assert.equal(stopped, 0);

    // too late: no human is left, so the room is closed (the AI never becomes the host of an empty room)
    room[how](human.id);
    pass(HOLD - 1);
    assert.equal(stopped, 0);
    pass(1);
    assert.equal(rooms.get(room.code), undefined, how);
    assert.equal(stopped, 1);
  }
});

test('the lobby is as before: Leave frees the place at once, a drop is held for lobbyHoldMs', () => {
  fake();
  const rooms = new Rooms();
  const room = rooms.create('friend');
  const host = room.join();
  const guest = room.join();
  room.pick(guest.id, 'in');
  room.drop(guest.id);
  assert.deepEqual(room.info().seats.in, { taken: false, connected: false, isAI: false }); // no side is held in the lobby
  assert.throws(() => room.join(), /full/i);
  pass(LIMITS.lobbyHoldMs);
  assert.equal(room.info().members.guest, null);

  const next = room.join();
  room.leave(next.id);
  assert.equal(room.idOfToken(next.token), null);
  room.leave(host.id);
  assert.equal(rooms.get(room.code), undefined);
});

// ---------- over sockets (real timers) ----------

type Sock = Socket<ServerToClient, ClientToServer>;
type Reply = ({ ok: true } & Seat) | { ok: false; error: string };

async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

class Client {
  sock: Sock;
  seat!: Seat;
  room: RoomInfo | null = null;

  constructor(url: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('room', (r) => (this.room = r));
  }

  private seated = (send: (ack: (r: Reply) => void) => void) =>
    new Promise<Seat>((ok, no) =>
      send((r) => {
        if (!r.ok) return no(new Error(r.error));
        this.seat = r;
        this.room = r.room;
        ok(r);
      }),
    );
  private act = (send: (ack: (r: { ok: true } | { ok: false; error: string }) => void) => void) =>
    new Promise<void>((ok, no) => send((r) => (r.ok ? ok() : no(new Error(r.error)))));
  create = () => this.seated((ack) => this.sock.emit('room:create', ack));
  join = (code: string, token?: string) => this.seated((ack) => this.sock.emit('room:join', { code, ...(token ? { token } : {}) }, ack));
  pick = (side: Side) => this.act((ack) => this.sock.emit('lobby:pick', { side }, ack));
  ready = () => this.act((ack) => this.sock.emit('lobby:ready', { ready: true }, ack));
  start = () => this.act((ack) => this.sock.emit('lobby:start', ack));
}

/** A server, and a started game on it: A is the host outside, B the guest inside. */
async function online() {
  const app = createApp({ allowLocalhost: true });
  const url = `http://localhost:${await app.listen(0)}`;
  const clients: Client[] = [];
  const client = () => {
    const c = new Client(url);
    clients.push(c);
    return c;
  };
  const a = client();
  const b = client();
  const { code } = await a.create();
  await b.join(code);
  await a.pick('out');
  await b.pick('in');
  await b.ready();
  await a.start();
  await until(() => b.room?.phase === 'playing', 'the game to start');
  const close = async () => {
    for (const c of clients) c.sock.disconnect();
    await app.close();
  };
  return { app, a, b, code, client, close };
}

let holdMs: number;
beforeEach(() => {
  holdMs = LIMITS.seatHoldMs;
});
afterEach(() => {
  LIMITS.seatHoldMs = holdMs;
});

test('sockets: Leave, then the code and the token give the same seat back; a stranger with the code is refused', async () => {
  const { app, a, b, code, client, close } = await online();
  try {
    const room = app.rooms.get(code)!;
    room.state.solved.push(1);
    const first = b.seat;
    b.sock.emit('room:leave');
    await until(() => a.room?.seats.in.away?.kind === 'left', 'the host sees the seat held');
    const away = a.room!.seats.in.away!;
    assert.equal(away.until - away.now, HOLD); // the countdown the banner shows starts at 1:00
    assert.equal(a.room!.members.host!.id, a.seat.id);

    // the code alone is not enough, from a stranger or with a wrong token
    const c = client();
    await assert.rejects(c.join(code), /full/i);
    await assert.rejects(c.join(code, 'not-the-token'), /full/i);
    assert.equal(a.room!.seats.in.away?.kind, 'left');

    // the one who left: the same socket (they never closed the tab) joins with the code
    const back = await b.join(code, first.token);
    assert.deepEqual([back.id, back.role, back.side, back.token], [first.id, 'guest', 'in', first.token]);
    assert.deepEqual(back.state.solved, [1]);
    await until(() => a.room?.seats.in.connected === true, 'the host sees the guest back');
    assert.equal(a.room!.seats.in.away, undefined);
    assert.deepEqual(a.room, b.room);

    // and they hear the room again: a move by the host reaches them
    let heard = 0;
    b.sock.on('state', () => heard++);
    a.sock.emit('move', { dx: 0, dy: 1, seq: 1 });
    await until(() => heard > 0, 'a state update after coming back');
  } finally {
    await close();
  }
});

test('sockets: the host leaves and the window passes: the guest is the host, and the code seats a new player', async () => {
  LIMITS.seatHoldMs = 150;
  const { app, a, b, code, client, close } = await online();
  try {
    const token = a.seat.token;
    a.sock.emit('room:leave');
    await until(() => b.room?.seats.out.away?.kind === 'left', 'the guest sees the seat held');
    assert.equal(b.room!.members.host!.id, a.seat.id);
    await until(() => b.room?.members.host?.id === b.seat.id, 'the guest becomes the host');
    assert.deepEqual([b.room!.members.guest, b.room!.seats.out.taken], [null, false]);
    // the old token is worth nothing now: the old host is seated like anyone else
    const again = await a.join(code, token);
    assert.deepEqual([again.role, again.side], ['guest', 'out']);
    assert.notEqual(again.id, b.seat.id);
    await assert.rejects(client().join(code), /full/i);
    assert.ok(app.rooms.get(code));
  } finally {
    await close();
  }
});

test('sockets: both tabs close: the room is kept for the window, then deleted', async () => {
  LIMITS.seatHoldMs = 150;
  const { app, a, b, code, close } = await online();
  try {
    a.sock.disconnect();
    b.sock.disconnect();
    await until(() => !app.rooms.get(code)!.isConnected('out') && !app.rooms.get(code)!.isConnected('in'), 'both seats held');
    assert.equal(app.rooms.size, 1);
    await until(() => app.rooms.size === 0, 'the room to be deleted');
    assert.equal(app.io.sockets.adapter.rooms.get(code), undefined);
  } finally {
    await close();
  }
});

test('a host alone in the lobby is held for seatHoldMs: a phone leaves the page to send the code', () => {
  fake();
  const rooms = new Rooms();
  const room = rooms.create('friend');
  const host = room.join();
  room.drop(host.id);
  pass(LIMITS.lobbyHoldMs);
  assert.equal(rooms.get(room.code), room); // the short hold is for a lobby someone else waits in
  assert.equal(room.idOfToken(host.token), host.id);
  pass(LIMITS.seatHoldMs - LIMITS.lobbyHoldMs);
  assert.equal(rooms.get(room.code), undefined);
});
