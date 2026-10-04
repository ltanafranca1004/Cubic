import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test, type TestContext } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, ClientToServer, RoomInfo, Seat, ServerToClient, Side } from '@cubic/shared';
import { createApp } from '../src/app';
import { AiPlayer } from '../src/ai/aiPlayer';
import { INACTIVITY, INACTIVITY_RANGE, LIMITS, Rooms, inactivityMs, type Room } from '../src/rooms';

// Inactivity: a player who does nothing for INACTIVITY.idleMs gets a countdown in the chat
// (INACTIVITY.warnMs), anything they do cancels it, and when it runs out only THEY are
// removed. First on bare Rooms with fake timers (the real 4 minutes + 60 seconds, no real
// waiting), then over real sockets with timers of a fraction of a second.

const IDLE = 240_000;
const WARN = 60_000;
const START = 1_700_000_000_000;

function fake() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });
}
/**
 * Time goes by, a second at a time: one big tick would run every timer with the clock
 * already at the end, and a countdown started by one would start late.
 */
const pass = (ms: number) => {
  for (let left = ms; left > 0; left -= 1000) mock.timers.tick(Math.min(1000, left));
};

let saved: typeof INACTIVITY & { seatHoldMs: number; lobbyHoldMs: number };
beforeEach(() => {
  saved = { ...INACTIVITY, seatHoldMs: LIMITS.seatHoldMs, lobbyHoldMs: LIMITS.lobbyHoldMs };
});
afterEach(() => {
  mock.timers.reset();
  Object.assign(INACTIVITY, { idleMs: saved.idleMs, warnMs: saved.warnMs });
  Object.assign(LIMITS, { seatHoldMs: saved.seatHoldMs, lobbyHoldMs: saved.lobbyHoldMs });
});

/** Everything a room tells its listeners about inactivity. */
function watch(room: Room) {
  const notes: ChatMessage[] = [];
  const removed: number[] = [];
  let closed = 0;
  room.listen({ onNote: (m) => notes.push(m), onRemoved: (id) => removed.push(id), onClosed: () => closed++ });
  return { notes, removed, closed: () => closed, texts: () => notes.map((n) => n.text) };
}

/** A lobby with both players in it: the host has picked outside, the guest inside. */
function lobby() {
  const rooms = new Rooms();
  const room = rooms.create('friend');
  const host = room.join();
  const guest = room.join();
  room.pick(host.id, 'out');
  room.pick(guest.id, 'in');
  return { rooms, room, host, guest, ...watch(room) };
}

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
  return { rooms, room, host, guest, ...watch(room) };
}

/** `ms` go by in steps of `every`, and `act` runs at each step (a player who keeps doing something). */
function passWhile(ms: number, every: number, act: () => void): void {
  for (let t = 0; t < ms; t += every) {
    act();
    pass(every);
  }
}

test('the defaults are 4 minutes, then a 60 second countdown', () => {
  assert.deepEqual(INACTIVITY, { idleMs: IDLE, warnMs: WARN });
});

test('game: A active, B idle: a countdown line for B, B is removed, A is never removed and keeps the room and the world', () => {
  fake();
  const { rooms, room, host, guest, notes, removed, closed, texts } = game();
  room.state.solved.push(1);

  // A walks up and down for the whole time; B does nothing
  let step = 1;
  const walk = () => room.move('out', 0, (step = -step));
  passWhile(IDLE - 10_000, 10_000, walk);
  pass(9000);
  assert.deepEqual(texts(), []); // 3:59: nothing yet
  pass(1000);
  assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00']);
  assert.deepEqual(notes[0]!.system, { kind: 'idle', who: 'INSIDE', id: guest.id, until: START + IDLE + WARN, now: START + IDLE });
  assert.deepEqual(removed, []);

  passWhile(WARN - 10_000, 10_000, walk);
  pass(9000);
  assert.deepEqual(removed, []); // 0:01 left
  const pose = { ...room.state.players.out.pose };
  pass(1000);
  assert.deepEqual(removed, [guest.id]);
  // ONE line: the countdown became "left due to inactivity" in place (same id)
  assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00', 'INSIDE left due to inactivity']);
  assert.equal(notes[1]!.id, notes[0]!.id);
  assert.equal(notes[1]!.system!.kind, 'removed');

  // A: still there, still the host, same seat and token; the world is as it was
  const info = room.info();
  assert.deepEqual(info.members.host, { id: host.id, connected: true, isAI: false, side: 'out', ready: false });
  assert.equal(info.members.guest, null);
  assert.equal(room.idOfToken(host.token), host.id);
  assert.equal(room.idOfToken(guest.token), null); // B's token is dead
  assert.deepEqual([closed(), rooms.get(room.code)], [0, room]);
  assert.deepEqual(room.state.solved, [1]);
  assert.deepEqual(room.state.players.out.pose, pose);
  assert.equal(room.phase, 'playing');

  // the seat is open for anyone with the code
  assert.deepEqual(info.seats.in, { taken: false, connected: false, isAI: false });
  const next = room.join();
  assert.deepEqual([next.role, next.side], ['guest', 'in']);

  // and A can go on like this for an hour
  passWhile(3_600_000, 10_000, walk);
  assert.deepEqual(removed, [guest.id, next.id]); // (the newcomer never did anything either)
  assert.equal(room.info().members.host!.id, host.id);
  assert.equal(closed(), 0);
});

test('every kind of activity cancels the countdown ("is back") and starts a fresh 4 minutes', () => {
  const acts: [string, (room: Room, id: number) => void][] = [
    ['a move', (room) => room.move('in', 0, -1)],
    ['a move over the budget', (room) => { for (let i = 0; i < 20; i++) room.move('in', 0, i % 2 ? 1 : -1); }],
    ['use', (room) => room.interact('in')],
    ['a chat message', (room) => assert.ok(room.say('in', 'here'))],
    ['a quick chat', (room) => assert.ok(room.quick('in', 0))],
    ['a key, a tap or talking (the activity message)', (room, id) => room.activity(id)],
  ];
  for (const [what, act] of acts) {
    fake();
    const { room, guest, notes, removed, texts } = game();
    const keepA = () => room.activity(room.info().members.host!.id);
    passWhile(IDLE + 30_000, 10_000, keepA); // 0:30 into B's countdown
    assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00'], what);
    act(room, guest.id);
    assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00', 'INSIDE is back'], what);
    assert.equal(notes[1]!.id, notes[0]!.id, what); // the same line, changed in place
    passWhile(IDLE - 10_000, 10_000, keepA); // the old deadline is long past
    assert.deepEqual(removed, [], what);
    assert.equal(notes.length, 2, what);
    passWhile(10_000, 10_000, keepA); // 4 minutes after what they did: a new countdown, a new line
    assert.equal(notes.length, 3, what);
    assert.notEqual(notes[2]!.id, notes[0]!.id, what);
    passWhile(WARN, 10_000, keepA);
    assert.deepEqual(removed, [guest.id], what);
    mock.timers.reset();
  }
});

test("B's tab is in the background but B is talking: B is never warned or removed", () => {
  fake();
  const { room, guest, notes, removed } = game();
  let step = 1;
  // B stands still and talks: all the server hears from B is the activity message, and a
  // background tab's timers run about once a second (here: far slower, every 30 s)
  passWhile(1_800_000, 30_000, () => {
    room.move('out', 0, (step = -step));
    room.activity(guest.id);
  });
  assert.deepEqual([notes.length, removed.length], [0, 0]);
  assert.equal(room.info().members.guest!.id, guest.id);
});

test('host transfer: the host is idle and removed, the guest becomes the host', () => {
  fake();
  const { room, host, guest, removed, closed } = game();
  passWhile(IDLE + WARN, 10_000, () => room.activity(guest.id));
  assert.deepEqual(removed, [host.id]);
  assert.deepEqual(room.info().members, { host: { id: guest.id, connected: true, isAI: false, side: 'in', ready: false }, guest: null });
  assert.equal(closed(), 0);
  assert.equal(room.join().side, 'out'); // the code seats a new player
});

test('host transfer the other way round: the guest is idle and removed, the host stays the host', () => {
  fake();
  const { room, host, guest, removed, closed } = game();
  passWhile(IDLE + WARN, 10_000, () => room.activity(host.id));
  assert.deepEqual(removed, [guest.id]);
  assert.deepEqual(room.info().members, { host: { id: host.id, connected: true, isAI: false, side: 'out', ready: false }, guest: null });
  assert.equal(closed(), 0);
});

test('lobby: B idle: countdown for P2, B removed, A keeps the lobby and the pick, a new player can join', () => {
  fake();
  const { rooms, room, host, guest, removed, closed, texts } = lobby();
  room.setReady(guest.id, true);
  passWhile(IDLE, 10_000, () => room.activity(host.id));
  assert.deepEqual(texts(), ['P2 inactive, removed in 1:00']);
  passWhile(WARN, 10_000, () => room.activity(host.id));
  assert.deepEqual(removed, [guest.id]);
  assert.deepEqual(texts(), ['P2 inactive, removed in 1:00', 'P2 left due to inactivity']);
  assert.deepEqual(room.info().members, { host: { id: host.id, connected: true, isAI: false, side: 'out', ready: false }, guest: null });
  assert.deepEqual([room.phase, closed(), rooms.get(room.code)], ['lobby', 0, room]);
  const next = room.join();
  assert.deepEqual([next.role, next.side], ['guest', null]);
});

test('lobby: the idle host is removed, the guest becomes the host and keeps the pick; lobby actions are activity', () => {
  fake();
  const { room, host, guest, removed, closed, texts } = lobby();
  // B (the guest) only picks sides and readies up: that is being active
  let n = 0;
  passWhile(IDLE + WARN, 10_000, () => (n++ % 2 ? room.pick(guest.id, 'in') : room.setReady(guest.id, n % 4 === 1)));
  assert.deepEqual(removed, [host.id]);
  assert.deepEqual(texts(), ['P1 inactive, removed in 1:00', 'P1 left due to inactivity']);
  const me = room.info().members.host!;
  assert.deepEqual([me.id, me.connected, room.info().members.guest], [guest.id, true, null]);
  assert.equal(closed(), 0);
});

test('both idle at the same instant: both are told, both are removed, the room is deleted', () => {
  for (const make of [game, lobby]) {
    fake();
    const { rooms, room, host, guest, removed, closed, texts } = make();
    const who = room.phase === 'playing' ? ['OUTSIDE', 'INSIDE'] : ['P1', 'P2'];
    pass(IDLE);
    assert.deepEqual(texts(), who.map((w) => `${w} inactive, removed in 1:00`));
    assert.equal(closed(), 0);
    pass(WARN - 1);
    assert.deepEqual([removed.length, closed()], [0, 0]);
    pass(1);
    assert.deepEqual(removed, [host.id, guest.id]);
    assert.deepEqual([closed(), rooms.size, rooms.get(room.code)], [1, 0, undefined]);
    pass(3_600_000); // nothing is left to fire
    assert.equal(removed.length, 2);
    mock.timers.reset();
  }
});

test('one idle, then the other: the room lives as long as one of them is active, and is deleted with the last', () => {
  fake();
  const { rooms, room, host, guest, removed, closed } = game();
  passWhile(IDLE + WARN, 10_000, () => room.activity(host.id)); // B goes
  assert.deepEqual([removed, closed()], [[guest.id], 0]);
  room.activity(host.id);
  pass(IDLE + WARN - 1); // then A stops too
  assert.deepEqual([removed, closed()], [[guest.id], 0]);
  pass(10_000);
  assert.deepEqual(removed, [guest.id, host.id]);
  assert.deepEqual([closed(), rooms.size], [1, 0]);
  assert.equal(room.idOfToken(host.token), null);
});

test('solo: the AI is never inactive; an idle human is warned in the chat, then the room is closed', () => {
  fake();
  const rooms = new Rooms();
  const room = rooms.create('ai');
  const human = room.sit('out');
  const ai = room.sit('in', true);
  const { notes, removed, closed, texts } = watch(room);

  // the AI does nothing for an hour while the human plays: no line, nobody removed
  passWhile(3_600_000, 30_000, () => room.activity(human.id));
  assert.deepEqual([notes.length, removed.length, closed()], [0, 0, 0]);
  // and what the AI does (it talks, it walks) is not the human being active
  passWhile(IDLE, 4000, () => {
    room.say('in', 'hello?');
    room.move('in', 0, 1);
    room.activity(ai.id);
  });
  assert.deepEqual(texts(), ['OUTSIDE inactive, removed in 1:00']);
  assert.ok(room.chat.every((m) => !m.system)); // the AI reads room.chat: system lines are not in it
  pass(WARN);
  assert.deepEqual(removed, [human.id]);
  assert.deepEqual([closed(), rooms.size], [1, 0]);
});

test('reconnect during the countdown: the drop ends it (gone, not inactive), the seat is held, and coming back is not a fresh 4 minutes', () => {
  fake();
  const { room, host, guest, notes, removed, texts } = game();
  passWhile(IDLE + 30_000, 10_000, () => room.activity(host.id));
  assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00']);

  room.drop(guest.id); // a refresh, or the wifi
  assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00', 'INSIDE disconnected']);
  assert.equal(notes[1]!.id, notes[0]!.id);
  assert.equal(notes[1]!.system!.kind, 'gone');
  assert.equal(room.info().seats.in.away!.kind, 'reconnecting'); // the 60 s hold and its banner take over

  passWhile(40_000, 10_000, () => room.activity(host.id)); // past the old countdown's end
  assert.deepEqual(removed, []);
  assert.equal(room.info().members.guest!.id, guest.id);

  const back = room.resume(room.idOfToken(guest.token)!);
  assert.deepEqual([back.id, back.side], [guest.id, 'in']);
  assert.equal(notes.length, 2); // no line for coming back: the banner already went
  // back, but they still have not DONE anything: the next countdown is one countdown's length away
  passWhile(WARN - 10_000, 10_000, () => room.activity(host.id));
  assert.equal(notes.length, 2);
  passWhile(10_000, 10_000, () => room.activity(host.id));
  assert.equal(notes[2]!.text, 'INSIDE inactive, removed in 1:00');
  passWhile(WARN, 10_000, () => room.activity(host.id));
  assert.deepEqual(removed, [guest.id]);
});

test('a host waiting ALONE in a lobby is never warned or removed, and the room is not deleted; the clock starts for both when the second player sits', () => {
  fake();
  const rooms = new Rooms();
  const room = rooms.create('friend');
  const host = room.join();
  const { notes, removed, closed } = watch(room);
  pass(300_000); // the reviewer's probe: one join(), 300 s
  assert.deepEqual([notes.length, removed.length, closed(), rooms.get(room.code)], [0, 0, 0, room]);
  pass(3_600_000); // an hour: the friend is slow
  assert.deepEqual([notes.length, removed.length, closed()], [0, 0, 0]);
  assert.equal(room.idOfToken(host.token), host.id);

  // the friend comes in with the code: both clocks start NOW, with the full 4 minutes
  const guest = room.join();
  assert.deepEqual([guest.role, room.info().members.host!.id], ['guest', host.id]);
  pass(IDLE - 1000);
  assert.equal(notes.length, 0);
  pass(1000);
  assert.deepEqual(notes.map((n) => n.text), ['P1 inactive, removed in 1:00', 'P2 inactive, removed in 1:00']);

  // the guest is removed while the host plays on: the host waits alone again, with no clock
  room.activity(host.id);
  pass(WARN);
  assert.deepEqual(removed, [guest.id]);
  pass(3_600_000);
  assert.deepEqual([removed, closed(), room.info().members.host!.id], [[guest.id], 0, host.id]);

  // same when the guest presses Leave or drops out of the lobby
  const again = room.join();
  room.leave(again.id);
  pass(3_600_000);
  const third = room.join();
  room.drop(third.id);
  pass(3_600_000);
  assert.deepEqual([removed, closed(), room.info().members], [[guest.id], 0, { host: { id: host.id, connected: true, isAI: false, side: null, ready: false }, guest: null }]);
});

test('in a running game a player left alone still has a clock (the seat is open, but they are not waiting in a lobby)', () => {
  fake();
  const { rooms, room, host, guest, removed, closed, texts } = game();
  room.leave(guest.id);
  pass(LIMITS.seatHoldMs); // the guest's seat is given up: the host is alone in the game
  assert.equal(room.info().members.guest, null);
  pass(IDLE - LIMITS.seatHoldMs);
  assert.deepEqual(texts(), ['OUTSIDE inactive, removed in 1:00']);
  pass(WARN);
  assert.deepEqual([removed, closed(), rooms.size], [[host.id], 1, 0]);
});

test('a rejoin with no drop before it (a refresh whose new socket is first) ends the countdown: not removed 30 s later', () => {
  fake();
  const { room, host, guest, notes, removed, texts } = game();
  passWhile(IDLE + 30_000, 10_000, () => room.activity(host.id)); // 0:30 left
  const seat = room.resume(guest.id); // still "connected": the old socket has not gone yet
  assert.deepEqual(texts(), ['INSIDE inactive, removed in 1:00', 'INSIDE is back']);
  assert.equal(notes[1]!.id, notes[0]!.id);
  assert.deepEqual(seat.chat.filter((m) => m.system).map((m) => m.text), ['INSIDE is back']);
  passWhile(50_000, 10_000, () => room.activity(host.id)); // past the old deadline
  assert.deepEqual([removed, notes.length], [[], 2]);
  // it is not a fresh 4 minutes either: with nothing done, a new countdown a minute after
  passWhile(10_000, 10_000, () => room.activity(host.id));
  assert.equal(notes[2]!.text, 'INSIDE inactive, removed in 1:00');
  room.move('in', 0, -1); // real activity: "is back", and now the full window
  passWhile(IDLE - 10_000, 10_000, () => room.activity(host.id));
  assert.deepEqual([removed, notes.length, notes[3]!.text], [[], 4, 'INSIDE is back']);
});

test('a flapping connection does not keep an absent player in: drop and resume every 3 minutes, removed all the same', () => {
  fake();
  const { room, host, guest, removed, closed } = game();
  let t = 0;
  for (; t < 1_200_000 && !removed.length; t += 10_000) {
    room.activity(host.id);
    if (t > 0 && t % 180_000 === 0 && room.idOfToken(guest.token) !== null) {
      room.drop(guest.id);
      room.resume(guest.id);
    }
    pass(10_000);
  }
  assert.deepEqual(removed, [guest.id]);
  assert.ok(t <= 360_000, `removed after ${t / 1000} s`);
  assert.deepEqual([closed(), room.info().members.host!.id], [0, host.id]);
});

test('time spent disconnected is not idle time, and the clock goes on where it stood', () => {
  fake();
  const { room, host, guest, notes, removed } = game();
  passWhile(100_000, 10_000, () => room.activity(host.id)); // B idle for 1:40
  room.drop(guest.id);
  passWhile(50_000, 10_000, () => room.activity(host.id)); // gone for 0:50 (inside the 60 s hold)
  room.resume(guest.id);
  passWhile(IDLE - 100_000 - 10_000, 10_000, () => room.activity(host.id)); // 2:10 more: 3:50 idle in all
  assert.equal(notes.length, 0);
  passWhile(10_000, 10_000, () => room.activity(host.id)); // 4:00 of being there and doing nothing
  assert.deepEqual(notes.map((n) => n.text), ['INSIDE inactive, removed in 1:00']);
  assert.deepEqual(removed, []);
});

test('a newcomer is not told about the removal of whoever had the place before (they would read it as about themself)', () => {
  fake();
  const { room, host, guest, texts } = lobby();
  passWhile(IDLE + WARN, 10_000, () => room.activity(host.id));
  assert.deepEqual(texts(), ['P2 inactive, removed in 1:00', 'P2 left due to inactivity']);
  assert.equal(room.idOfToken(guest.token), null);
  pass(13_000);
  const next = room.join(); // the new P2
  assert.deepEqual([next.role, next.chat], ['guest', []]);
  // the host, who was there, still has the line, with the time it was written
  const mine = room.resume(host.id).chat;
  assert.deepEqual(mine.map((m) => [m.text, m.at, m.system!.now]), [['P2 left due to inactivity', START + IDLE + WARN, START + IDLE + WARN + 13_000]]);
});

test('a line names who the player WAS: a host transfer or the start of the game rewrites nothing', () => {
  // the host (P1) is removed in the lobby: the survivor becomes P1, the old line still says P1 left
  fake();
  const l = lobby();
  passWhile(IDLE + WARN, 10_000, () => l.room.activity(l.guest.id));
  assert.deepEqual(l.removed, [l.host.id]);
  assert.equal(l.room.info().members.host!.id, l.guest.id);
  assert.deepEqual([l.notes[1]!.text, l.notes[1]!.system!.who, l.notes[1]!.system!.id], ['P1 left due to inactivity', 'P1', l.host.id]); // the id says it is not about the survivor
  const again = l.room.join();
  passWhile(IDLE, 10_000, () => l.room.activity(l.guest.id)); // the newcomer idles: a NEW line, about the new P2
  assert.deepEqual(l.texts().slice(2), ['P2 inactive, removed in 1:00']);
  assert.equal(l.notes[2]!.system!.id, again.id);
  assert.deepEqual(l.room.resume(l.guest.id).chat.map((m) => m.text), ['P1 left due to inactivity', 'P2 inactive, removed in 1:00']);
  mock.timers.reset();

  // the countdown starts in the lobby (P2), the host starts the game meanwhile: still P2
  fake();
  const g = lobby();
  g.room.setReady(g.guest.id, true);
  passWhile(IDLE + 30_000, 10_000, () => g.room.activity(g.host.id));
  g.room.start(g.host.id);
  passWhile(30_000, 10_000, () => g.room.activity(g.host.id));
  assert.deepEqual(g.texts(), ['P2 inactive, removed in 1:00', 'P2 left due to inactivity']);
  assert.deepEqual(g.removed, [g.guest.id]);
});

test('INACTIVE_MS / INACTIVE_WARN_MS: unset or nonsense = the default, anything else is kept between 1 s and 24 h', () => {
  assert.deepEqual(INACTIVITY_RANGE, { min: 1000, max: 86_400_000 });
  for (const bad of [undefined, '', '  ', 'abc', '0', '-5', 'NaN', 'Infinity', null]) assert.equal(inactivityMs(bad, 240_000), 240_000, String(bad));
  assert.equal(inactivityMs('10000', 240_000), 10_000);
  assert.equal(inactivityMs('5000.4', 60_000), 5000);
  assert.equal(inactivityMs('1', 240_000), 1000); // too short
  assert.equal(inactivityMs('999999999999', 240_000), 86_400_000); // over 2^31 ms setTimeout would fire at once
  assert.equal(inactivityMs(String(2 ** 31), 240_000), 86_400_000);

  // and with the largest value a player is not removed the moment they sit down
  fake();
  INACTIVITY.idleMs = inactivityMs('1e300', 240_000);
  INACTIVITY.warnMs = inactivityMs('1e300', 60_000);
  const { notes, removed, closed } = game();
  pass(3_600_000);
  assert.deepEqual([notes.length, removed.length, closed()], [0, 0, 0]);
});

// ---------- solo, with the real AI partner ----------

/** Fake clock for one test. `pass` moves it and lets promises settle (the AI thinks in promises). */
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: START });
  return async (ms: number, slice = 200) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}

/** A solo room as the server makes it: the human outside, the real AiPlayer (no advisor: its script, no API) inside. */
function soloRoom() {
  const rooms = new Rooms();
  const room = rooms.create('ai');
  const seat = room.sit('out');
  const logs: string[] = [];
  const ai = new AiPlayer(room, 'in', null, { log: (l) => logs.push(l) });
  const stopped = () => logs.some((l) => l.includes('stopped'));
  const aiDid = () => room.state.players.in.steps + room.chat.filter((m) => m.isAI).length;
  return { rooms, room, seat, ai, stopped, aiDid, ...watch(room) };
}

test('solo with the real AI partner: what the AI says and does is never the human being active; the idle human is warned, then the room closes and the AI stops', async (t) => {
  const pass = clock(t);
  const { rooms, room, seat, stopped, aiDid, notes, removed, closed, texts } = soloRoom();
  // the human asks for help once, then does nothing: the AI answers and plays on by itself
  await pass(5000);
  room.say('out', 'what do you see?');
  const before = aiDid();
  await pass(IDLE - 1000);
  assert.ok(aiDid() > before, 'the AI partner did things meanwhile');
  assert.deepEqual(texts(), []);
  await pass(1000);
  assert.deepEqual(texts(), ['OUTSIDE inactive, removed in 1:00']); // 4 minutes after the HUMAN's last act, whatever the AI did
  assert.deepEqual([notes[0]!.system!.id, removed.length, closed(), stopped()], [seat.id, 0, 0, false]);
  // the AI's context is room.chat: the system line is not in it, so it is in no prompt either
  assert.ok(room.chat.length > 0 && room.chat.every((m) => !m.system && !/inactive/.test(m.text)));
  await pass(WARN);
  assert.deepEqual(removed, [seat.id]);
  assert.deepEqual([closed(), rooms.size, stopped()], [1, 0, true]);
  const after = aiDid();
  await pass(30_000);
  assert.equal(aiDid(), after); // it really stopped
});

test('solo with the real AI partner: the AI is never warned or removed, and the 60 s grace of a human who left is as before', async (t) => {
  const pass = clock(t);
  const { rooms, room, seat, stopped, notes, removed, closed } = soloRoom();
  // an hour of the human at the keys: nothing about the AI, ever
  for (let i = 0; i < 120; i++) {
    room.activity(seat.id);
    await pass(30_000, 5000);
  }
  assert.deepEqual([notes.length, removed.length, closed()], [0, 0, 0]);
  assert.deepEqual(room.info().seats.in, { taken: true, connected: true, isAI: true });

  // Leave during the countdown: the line ends, the seat is held 60 s (the solo grace), no removal
  await pass(IDLE, 5000);
  assert.equal(notes.length, 1);
  room.leave(seat.id);
  assert.deepEqual(notes.map((n) => n.text), ['OUTSIDE inactive, removed in 1:00', 'OUTSIDE left']);
  await pass(LIMITS.seatHoldMs - 1000, 5000);
  assert.deepEqual([removed.length, closed(), stopped()], [0, 0, false]);
  const back = room.resume(room.idOfToken(seat.token)!); // CONTINUE: the same game
  assert.deepEqual([back.id, back.side], [seat.id, 'out']);
  room.leave(seat.id);
  await pass(LIMITS.seatHoldMs + 1000, 5000);
  assert.deepEqual([removed.length, closed(), rooms.size, stopped()], [0, 1, 0, true]); // closed by the hold, not by inactivity
});

test('a held seat is "gone", not "inactive": no countdown line for its owner, the hold alone decides', () => {
  fake();
  LIMITS.seatHoldMs = 600_000; // a hold longer than the inactivity timers, to tell them apart
  const { room, host, guest, notes, removed } = game();
  room.drop(guest.id);
  passWhile(IDLE + WARN + 60_000, 10_000, () => room.activity(host.id));
  assert.deepEqual([notes.length, removed.length], [0, 0]);
  assert.equal(room.info().seats.in.away!.kind, 'reconnecting');
  assert.equal(room.info().members.guest!.id, guest.id);

  // same for Leave
  room.resume(guest.id);
  room.leave(guest.id);
  passWhile(IDLE + WARN + 60_000, 10_000, () => room.activity(host.id));
  assert.deepEqual([notes.length, removed.length], [0, 0]);
  assert.equal(room.info().seats.in.away!.kind, 'left');
});

test('the 60 s grace is as before: an idle player and a gone player, the room is deleted only when both are out', () => {
  fake();
  const { rooms, room, host, guest, removed, closed } = game();
  pass(IDLE + 50_000); // both idle, 0:10 left on both countdowns
  room.drop(guest.id); // B's tab closes: B is gone, held for 60 s
  pass(10_000);
  assert.deepEqual(removed, [host.id]); // A's countdown ran out
  assert.equal(closed(), 0); // B's seat is still held: the room stays for B
  const back = room.resume(room.idOfToken(guest.token)!);
  assert.deepEqual([back.role, back.side], ['host', 'in']);

  room.drop(guest.id);
  pass(LIMITS.seatHoldMs);
  assert.deepEqual([closed(), rooms.size], [1, 0]); // nobody left, present or held
});

test('the host leaves during the countdown of the guest', () => {
  // in a game: the host's seat is held 60 s, the guest's countdown goes on
  fake();
  let g = game();
  passWhile(IDLE + 30_000, 10_000, () => g.room.activity(g.host.id));
  g.room.leave(g.host.id);
  pass(30_000);
  assert.deepEqual(g.removed, [g.guest.id]);
  assert.equal(g.closed(), 0); // the host can still come back
  const back = g.room.resume(g.room.idOfToken(g.host.token)!);
  assert.deepEqual([back.role, back.side, g.room.info().members.guest], ['host', 'out', null]);
  mock.timers.reset();

  // nobody comes back: the room is deleted when the hold ends
  fake();
  g = game();
  passWhile(IDLE + 30_000, 10_000, () => g.room.activity(g.host.id));
  g.room.leave(g.host.id);
  pass(30_000);
  assert.equal(g.closed(), 0);
  pass(30_000);
  assert.deepEqual([g.closed(), g.rooms.size], [1, 0]);
  mock.timers.reset();

  // in the lobby: Leave frees the place at once, the idle guest is the host until removed
  fake();
  const l = lobby();
  passWhile(IDLE + 30_000, 10_000, () => l.room.activity(l.host.id));
  l.room.leave(l.host.id);
  assert.equal(l.room.info().members.host!.id, l.guest.id);
  assert.equal(l.closed(), 0);
  pass(30_000);
  assert.deepEqual(l.removed, [l.guest.id]);
  assert.deepEqual([l.closed(), l.rooms.size], [1, 0]);
});

test('the idle host leaves during their own countdown: the line ends, the guest is not touched', () => {
  fake();
  const { room, host, guest, notes, removed, texts } = lobby();
  passWhile(IDLE + 30_000, 10_000, () => room.activity(guest.id));
  room.leave(host.id);
  assert.deepEqual(texts(), ['P1 inactive, removed in 1:00', 'P1 left']);
  assert.equal(notes[1]!.id, notes[0]!.id);
  passWhile(IDLE, 10_000, () => room.activity(guest.id));
  assert.deepEqual(removed, []);
  assert.equal(room.info().members.host!.id, guest.id);
});

test('a player who joins or rejoins gets the countdown line with the time on the server clock', () => {
  fake();
  const { room, host, guest } = game();
  room.say('out', 'hello');
  passWhile(IDLE + 20_000, 10_000, () => room.activity(host.id));
  room.say('out', 'are you there?');
  const seat = room.resume(host.id);
  assert.deepEqual(seat.chat.map((m) => m.text), ['hello', 'INSIDE inactive, removed in 1:00', 'are you there?']);
  assert.deepEqual(seat.chat[1]!.system, { kind: 'idle', who: 'INSIDE', id: guest.id, until: START + IDLE + WARN, now: START + IDLE + 20_000 });
  assert.equal(seat.chat[1]!.at, START + IDLE); // the line keeps the time it was written
  assert.equal(room.idOfToken(guest.token), guest.id);
});

// ---------- over real sockets ----------

type Sock = Socket<ServerToClient, ClientToServer>;
type Reply = ({ ok: true } & Seat) | { ok: false; error: string };

async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  sock: Sock;
  seat!: Seat;
  room: RoomInfo | null = null;
  chat: ChatMessage[] = [];
  removed: string[] = [];
  states = 0;

  constructor(url: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('room', (r) => (this.room = r));
    this.sock.on('chat', (m) => this.chat.push(m));
    this.sock.on('removed', (m) => this.removed.push(m.reason));
    this.sock.on('state', () => this.states++);
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
  join = (code: string) => this.seated((ack) => this.sock.emit('room:join', { code }, ack));
  rejoin = (code: string, token: string) => this.seated((ack) => this.sock.emit('room:rejoin', { code, token }, ack));
  pick = (side: Side) => this.act((ack) => this.sock.emit('lobby:pick', { side }, ack));
  ready = () => this.act((ack) => this.sock.emit('lobby:ready', { ready: true }, ack));
  start = () => this.act((ack) => this.sock.emit('lobby:start', ack));
  texts = () => this.chat.map((m) => m.text);
}

/** A server with short timers, A (host, outside) and B (guest, inside) in one room. */
async function online(startGame: boolean) {
  INACTIVITY.idleMs = 400;
  INACTIVITY.warnMs = 400;
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
  if (startGame) {
    await b.ready();
    await a.start();
    await until(() => b.room?.phase === 'playing', 'the game to start');
  }
  /** A is at the keys: the activity message every 100 ms until stopped. */
  const keys = setInterval(() => a.sock.emit('activity'), 100);
  const close = async () => {
    clearInterval(keys);
    for (const c of clients) c.sock.disconnect();
    await app.close();
  };
  return { app, a, b, code, client, close, stopA: () => clearInterval(keys) };
}

for (const where of ['lobby', 'game'] as const) {
  test(`sockets, ${where}: B idle: both see the countdown, only B is removed and told, A keeps the room and a new player joins`, async () => {
    const { app, a, b, code, client, close } = await online(where === 'game');
    const who = where === 'game' ? 'INSIDE' : 'P2';
    try {
      await until(() => a.chat.length === 1 && b.chat.length === 1, 'the countdown line on both');
      assert.deepEqual([a.texts(), b.texts()], [[`${who} inactive, removed in 0:01`], [`${who} inactive, removed in 0:01`]]);
      await until(() => b.removed.length === 1, 'B to be removed');
      await until(() => a.chat.length === 2 && a.room?.members.guest === null, 'A to see B gone');
      assert.deepEqual(a.texts().at(-1), `${who} left due to inactivity`);
      assert.equal(a.chat[1]!.id, a.chat[0]!.id);
      assert.deepEqual(a.removed, []);
      assert.deepEqual([a.room!.members.host!.id, a.room!.members.host!.connected, a.room!.phase], [a.seat.id, true, where === 'game' ? 'playing' : 'lobby']);
      assert.equal(app.rooms.get(code)!.idOfToken(a.seat.token), a.seat.id);

      // B is cut off from the room: its old token is dead and it hears nothing more of it
      await assert.rejects(b.rejoin(code, b.seat.token), /gone/);
      const heard = b.states;
      a.sock.emit('move', { dx: 0, dy: 1, seq: 1 });
      await sleep(80);
      assert.equal(b.states, heard);

      // the code seats a new player, and B itself can come back in with it
      const c = client();
      const seat = await c.join(code);
      assert.deepEqual([seat.role, seat.side], ['guest', where === 'game' ? 'in' : null]);
      await assert.rejects(b.join(code), /full/);

      // A is still there long after
      c.sock.emit('room:leave');
      await sleep(1200);
      assert.deepEqual(a.removed, []);
      assert.equal(app.rooms.get(code)!.info().members.host!.id, a.seat.id);
    } finally {
      await close();
    }
  });
}

test('sockets: the seat is opened in another tab (same token): the old tab is told why, the new one has the seat, the partner sees nothing', async () => {
  const { app, a, b, code, client, close } = await online(true);
  INACTIVITY.idleMs = 60_000; // no countdown in this one
  try {
    let dropped = '';
    b.sock.on('disconnect', (reason) => (dropped = reason));
    const tab = client();
    const seat = await tab.rejoin(code, b.seat.token); // b's socket is still connected
    assert.deepEqual([seat.id, seat.side, seat.token], [b.seat.id, 'in', b.seat.token]);
    await until(() => b.removed.length === 1 && dropped !== '', 'the old tab to be told and disconnected');
    assert.deepEqual([b.removed, dropped], [['replaced'], 'io server disconnect']);
    // the token is the new tab's: still good, the seat still taken and connected
    const room = app.rooms.get(code)!;
    assert.equal(room.idOfToken(b.seat.token), b.seat.id);
    assert.deepEqual(room.info().seats.in, { taken: true, connected: true, isAI: false });
    // the old tab connects again (as the client does) WITHOUT its token: the new tab keeps the seat
    b.sock.connect();
    await until(() => b.sock.connected, 'the old tab back online');
    await sleep(100);
    assert.deepEqual([tab.removed, a.removed, room.info().seats.in.connected], [[], [], true]);
    assert.deepEqual([a.chat.length, tab.chat.length], [0, 0]); // no system line for anyone
    const heard = tab.states;
    a.sock.emit('move', { dx: 0, dy: 1, seq: 1 });
    await until(() => tab.states > heard, 'the new tab to hear the game');
    await assert.rejects(b.join(code), /full/); // and the old tab is simply not in the room
  } finally {
    await close();
  }
});

test('sockets: a chat message during the countdown cancels it for both', async () => {
  const { a, b, close } = await online(true);
  try {
    await until(() => a.chat.length === 1, 'the countdown line');
    b.sock.emit('chat', { text: 'sorry, here' });
    await until(() => a.chat.length === 3 && b.chat.length === 3, 'the line to change and the message to arrive');
    assert.deepEqual(a.texts().slice(1).sort(), ['INSIDE is back', 'sorry, here']);
    assert.equal(a.chat.find((m) => m.text === 'INSIDE is back')!.id, a.chat[0]!.id);
    assert.deepEqual(b.removed, []);
  } finally {
    await close();
  }
});

test('sockets: both idle: both are told they were removed and the room is deleted', async () => {
  const { app, a, b, code, close, stopA } = await online(true);
  try {
    stopA();
    await until(() => a.removed.length === 1 && b.removed.length === 1, 'both to be removed');
    assert.deepEqual([a.removed, b.removed], [['inactive'], ['inactive']]);
    await until(() => app.rooms.size === 0, 'the room to be deleted');
    assert.equal(app.rooms.get(code), undefined);
    assert.equal(app.io.sockets.adapter.rooms.get(code), undefined);
    // a removed player can start again on the same socket
    const seat = await a.create();
    assert.equal(seat.role, 'host');
  } finally {
    await close();
  }
});
