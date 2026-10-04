import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, type TestContext } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, RoomInfo, Seat, ServerToClient, Side } from '@cubic/shared';
import { AiPlayer } from '../src/ai/aiPlayer';
import { createApp } from '../src/app';
import { LIMITS, Rooms, SEAT_HOLD_MS, type Room } from '../src/rooms';

// A solo room's life: one human, the AI partner on the other side (no Gemini here: the
// advisor is null, so it plays from its script and calls nothing). The human's seat is
// held 60 s on Leave or a drop like any seat; the AI waits meanwhile; when the window
// passes the room closes and the AI stops. First on a bare Room with a fake clock, then
// the paths a browser takes over real sockets.

const HOLD = SEAT_HOLD_MS;
const START = 1_700_000_000_000;
const other = (s: Side): Side => (s === 'out' ? 'in' : 'out');

/** Fake clock for one test. `pass` moves it and lets promises settle. */
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: START });
  return async (ms: number, slice = 200) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}

/** A solo room as the server makes it: the human sits, then the AI takes the other seat. */
function solo(human: Side) {
  const rooms = new Rooms();
  const room = rooms.create('ai');
  const seat = room.sit(human);
  const logs: string[] = [];
  const ai = new AiPlayer(room, other(human), null, { log: (l) => logs.push(l) });
  let closed = 0;
  const infos: RoomInfo[] = [];
  room.listen({ onClosed: () => closed++, onRoom: (r) => infos.push(r) });
  const stopped = () => logs.some((l) => l.includes('stopped'));
  /** Everything the AI did that a human would notice: its steps and its chat lines. */
  const aiDid = () => [room.state.players[other(human)].steps, room.chat.filter((m) => m.isAI).length];
  return { rooms, room, seat, ai, logs, infos, stopped, aiDid, closed: () => closed };
}

/** What the human's banner is made from: the AI's seat is never held, never disconnected. */
function assertNoAiBanner(infos: RoomInfo[], ai: Side): void {
  for (const r of infos) {
    assert.equal(r.seats[ai].away, undefined, 'the AI seat was shown as held');
    assert.deepEqual([r.seats[ai].taken, r.seats[ai].connected, r.seats[ai].isAI], [true, true, true]);
  }
}

for (const human of ['out', 'in'] as const) {
  test(`solo, human ${human}side: no lobby, the AI has the other side, the game runs at once`, async (t) => {
    const pass = clock(t);
    const { room, seat, aiDid } = solo(human);
    const info = room.info();
    assert.deepEqual([info.mode, info.phase, seat.side], ['ai', 'playing', human]);
    assert.deepEqual(info.seats[human], { taken: true, connected: true, isAI: false });
    assert.deepEqual(info.seats[other(human)], { taken: true, connected: true, isAI: true });
    assert.equal(room.state.players[other(human)].isAI, true);
    assert.throws(() => room.join(), /full/i);
    await pass(4000);
    assert.ok(aiDid()[1]! > 0, 'the AI partner says hello');
    room.close();
  });
}

test('solo: Leave and come back in time: the same game, the AI still there, and it did not play on meanwhile', async (t) => {
  const pass = clock(t);
  const { room, seat, infos, aiDid, stopped, closed } = solo('out');
  await pass(4000);
  room.move('out', 0, 1);
  room.state.solved.push(1);
  const pose = { ...room.state.players.out.pose };

  room.leave(seat.id);
  assert.deepEqual(room.info().seats.out, { taken: true, connected: false, isAI: false, away: { kind: 'left', until: START + 4000 + HOLD, now: START + 4000 } });
  const before = aiDid();
  const botPose = { ...room.state.players.in.pose };
  await pass(45_000, 1000);
  assert.deepEqual(aiDid(), before, 'the AI walked or talked while the human was away');
  assert.deepEqual(room.state.players.in.pose, botPose);
  assert.deepEqual([stopped(), closed()], [false, 0]);

  const back = room.resume(room.idOfToken(seat.token)!);
  assert.deepEqual([back.id, back.side, back.token], [seat.id, 'out', seat.token]);
  assert.deepEqual(back.state.players.out.pose, pose);
  assert.deepEqual(back.state.solved, [1]);
  assert.deepEqual(room.info().seats, { out: { taken: true, connected: true, isAI: false }, in: { taken: true, connected: true, isAI: true } });

  // the old deadline is dead, and the AI plays again
  await pass(HOLD, 1000);
  assert.deepEqual([stopped(), closed()], [false, 0]);
  room.say('out', 'hello?');
  await pass(8000);
  assert.ok(aiDid()[1]! > before[1]!, 'the AI answers again once the human is back');
  assertNoAiBanner(infos, 'in');
  room.close();
});

test('solo: a dropped connection and back in time: the same game, the AI waited', async (t) => {
  const pass = clock(t);
  const { room, seat, infos, aiDid, stopped, closed } = solo('in');
  await pass(4000);
  room.state.solved.push(2);
  room.drop(seat.id);
  assert.equal(room.info().seats.in.away?.kind, 'reconnecting');
  assert.equal(room.state.players.in.connected, false);
  const before = aiDid();
  await pass(HOLD - 1000, 1000);
  assert.deepEqual(aiDid(), before);
  const back = room.resume(room.idOfToken(seat.token)!);
  assert.deepEqual([back.id, back.side, back.state.solved], [seat.id, 'in', [2]]);
  await pass(HOLD, 1000);
  assert.deepEqual([stopped(), closed(), room.isConnected('in'), room.isConnected('out')], [false, 0, true, true]);
  assertNoAiBanner(infos, 'out');
  room.close();
});

for (const how of ['leave', 'drop'] as const) {
  test(`solo: ${how} and the 60 s pass: the room closes and the AI stops, timers and all`, async (t) => {
    const pass = clock(t);
    const { rooms, room, seat, ai, infos, aiDid, stopped, closed } = solo('out');
    await pass(2000);
    room[how](seat.id);
    await pass(HOLD - 200);
    assert.deepEqual([stopped(), closed(), rooms.size], [false, 0, 1]);
    await pass(400);
    assert.deepEqual([stopped(), closed(), rooms.size], [true, 1, 0]);
    assert.equal(rooms.get(room.code), undefined);
    assert.equal(room.idOfToken(seat.token), null, 'the token is dead');
    assertNoAiBanner(infos, 'in');

    // nothing of it runs on: no AI step, no line, no Gemini call, no state broadcast
    const before = aiDid();
    let states = 0;
    const inner = room as unknown as { emitState(events: unknown[]): void };
    const real = inner.emitState.bind(room);
    inner.emitState = (events) => {
      states++;
      real(events);
    };
    await pass(30_000, 1000);
    assert.deepEqual([aiDid(), states, ai.calls], [before, 0, 0]);
  });
}

test('solo: play again after a win keeps the AI on the other side', async (t) => {
  const pass = clock(t);
  const { room, seat, infos } = solo('in');
  await pass(1000);
  room.restart(); // not won: nothing happens
  const old = room.state;
  assert.equal(room.state, old);
  room.state.wonAt = START + 1000;
  room.restart();
  assert.notEqual(room.state, old);
  assert.deepEqual([room.state.wonAt, room.state.solved], [null, []]);
  assert.deepEqual([room.sideOf(seat.id), room.info().mode, room.info().phase], ['in', 'ai', 'playing']);
  assert.deepEqual(room.info().seats, { out: { taken: true, connected: true, isAI: true }, in: { taken: true, connected: true, isAI: false } });
  assert.deepEqual([room.state.players.out.isAI, room.state.players.out.connected, room.state.players.in.isAI, room.state.players.in.connected], [true, true, false, true]);
  const lines = room.chat.filter((m) => m.isAI).length;
  await pass(6000);
  assert.ok(room.chat.filter((m) => m.isAI).length > lines, 'the AI plays the new game');
  assertNoAiBanner(infos, 'out');
  room.close();
});

// ---------- over real sockets ----------

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
  rooms: RoomInfo[] = [];

  constructor(private url: string) {
    this.sock = this.connect();
  }

  private connect(): Sock {
    const sock: Sock = io(this.url, { transports: ['websocket'], forceNew: true });
    sock.on('room', (r) => {
      this.room = r;
      this.rooms.push(r);
    });
    return sock;
  }

  /** The tab's connection is lost and a new one comes up (wifi, a refresh). */
  reconnect(): void {
    this.sock.disconnect();
    this.sock = this.connect();
  }

  private seated = (send: (ack: (r: Reply) => void) => void) =>
    new Promise<Seat>((ok, no) =>
      send((r) => {
        if (!r.ok) return no(new Error(r.error));
        this.seat = r;
        this.room = r.room;
        this.rooms.push(r.room);
        ok(r);
      }),
    );
  create = () => this.seated((ack) => this.sock.emit('room:create', ack));
  solo = (side: Side) => this.seated((ack) => this.sock.emit('room:createAI', { side }, ack));
  join = (code: string, token?: string) => this.seated((ack) => this.sock.emit('room:join', { code, ...(token ? { token } : {}) }, ack));
  rejoin = (code: string, token: string) => this.seated((ack) => this.sock.emit('room:rejoin', { code, token }, ack));
}

/** A server whose AI rooms get a real AiPlayer with no advisor, like AI_FAKE=1. */
async function online() {
  const ais: { ai: AiPlayer; logs: string[] }[] = [];
  const app = createApp({
    allowLocalhost: true,
    info: () => ({ aiAvailable: true, ttsAvailable: false, ttsMode: 'browser' }),
    onAiRoom: (room: Room, human) => {
      const logs: string[] = [];
      ais.push({ ai: new AiPlayer(room, other(human), null, { log: (l) => logs.push(l) }), logs });
    },
  });
  const url = `http://localhost:${await app.listen(0)}`;
  const clients: Client[] = [];
  const client = () => {
    const c = new Client(url);
    clients.push(c);
    return c;
  };
  const close = async () => {
    for (const c of clients) c.sock.disconnect();
    await app.close();
  };
  return { app, ais, client, close };
}

let holdMs: number;
beforeEach(() => {
  holdMs = LIMITS.seatHoldMs;
});
afterEach(() => {
  LIMITS.seatHoldMs = holdMs;
});

test('sockets: PLAY SOLO goes straight into a game, and a stranger can never join it by code', async () => {
  const { app, ais, client, close } = await online();
  try {
    const a = client();
    const seat = await a.solo('in');
    assert.deepEqual([seat.side, seat.room.mode, seat.room.phase], ['in', 'ai', 'playing']);
    assert.deepEqual(seat.room.seats, { out: { taken: true, connected: true, isAI: true }, in: { taken: true, connected: true, isAI: false } });
    assert.equal(ais.length, 1);

    // while the human plays
    const stranger = client();
    await assert.rejects(stranger.join(seat.code), /full/i);
    await assert.rejects(stranger.join(seat.code, 'not-the-token'), /full/i);
    await assert.rejects(stranger.rejoin(seat.code, 'not-the-token'), /gone/i);

    // while the seat is held after Leave
    a.sock.emit('room:leave');
    await until(() => !app.rooms.get(seat.code)!.isConnected('in'), 'the seat to be held');
    await assert.rejects(stranger.join(seat.code), /full/i);
    await assert.rejects(stranger.join(seat.code, 'not-the-token'), /full/i);

    // the human, with the token the tab kept: the same seat, the same game, the same AI
    const back = await a.join(seat.code, seat.token);
    assert.deepEqual([back.id, back.side, back.token], [seat.id, 'in', seat.token]);
    assert.deepEqual(back.room.seats, seat.room.seats);
    assert.equal(ais.length, 1, 'coming back must not make a second AI');
    await assert.rejects(stranger.join(seat.code), /full/i);
    // Nothing the human was sent ever showed the AI as away. (The very first broadcast is
    // the room with the AI seat still free: it arrives before the seat is ours, so no
    // screen is drawn from it.)
    assert.ok(a.rooms.length >= 4);
    for (const r of a.rooms) {
      assert.equal(r.seats.out.away, undefined);
      if (r.seats.out.taken) assert.deepEqual([r.seats.out.connected, r.seats.out.isAI], [true, true]);
    }
    assert.deepEqual(a.rooms.filter((r) => !r.seats.out.taken).length, 1);
  } finally {
    await close();
  }
});

test('sockets: the connection drops and the same tab comes back: the same solo game', async () => {
  const { app, ais, client, close } = await online();
  try {
    const a = client();
    const seat = await a.solo('out');
    app.rooms.get(seat.code)!.state.solved.push(1);
    a.reconnect();
    await until(() => !app.rooms.get(seat.code)!.isConnected('out'), 'the seat to be held');
    const back = await a.rejoin(seat.code, seat.token);
    assert.deepEqual([back.id, back.side, back.state.solved], [seat.id, 'out', [1]]);
    assert.deepEqual(back.room.seats, { out: { taken: true, connected: true, isAI: false }, in: { taken: true, connected: true, isAI: true } });
    assert.equal(ais.length, 1);
  } finally {
    await close();
  }
});

test('sockets: Leave and the window passes: the room is deleted, the AI stopped, the code is dead', async () => {
  LIMITS.seatHoldMs = 150;
  const { app, ais, client, close } = await online();
  try {
    const a = client();
    const seat = await a.solo('out');
    a.sock.emit('room:leave');
    await until(() => app.rooms.size === 0, 'the room to be deleted');
    assert.ok(ais[0]!.logs.some((l) => l.includes('stopped')));
    assert.equal(app.io.sockets.adapter.rooms.get(seat.code), undefined);
    await assert.rejects(a.join(seat.code, seat.token), /not found/i);
    await assert.rejects(client().join(seat.code), /not found/i);
    // a new solo game is a new room with a new AI
    const next = await a.solo('in');
    assert.notEqual(next.code, seat.code);
    assert.equal(ais.length, 2);
  } finally {
    await close();
  }
});
