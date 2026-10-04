import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SIDES, createGame, defaultEnv, isBlocked, objectiveFor, onRing, visibleObjects, type Side } from '../src/index';
import { BATTERY_ID } from '../src/puzzles/chain';
import { SYMBOLS } from '../src/puzzles/sequenceLaser';
import { solver, type Solver } from './harness';
import { insideGo, litSymbol, powerLaser, pressSymbol, watchSequence } from './laser-solutions';
import { SOLUTIONS } from './solutions';

// SEQUENCE LASER (face 5). Run just this file: npx tsx --test shared/test/sequence-laser.test.ts

const FACE = 5;
const see = (t: Solver, side: Side) => visibleObjects(t.state, side, FACE, t.env);
const symbols = (t: Solver, side: Side) => see(t, side).filter((o) => o.type === 'f5-symbol');
const lit = (t: Solver, side: Side) => symbols(t, side).filter((o) => o.state?.endsWith('-lit'));
const emitter = (t: Solver) => see(t, 'in').find((o) => o.type === 'f5-emitter')?.state;
const puzzleEvents = (evs: readonly { type: string }[]) => evs.flatMap((e) => (e.type === 'puzzle' ? [(e as unknown as { name: string }).name] : []));

/** A game where face 2 has handed over the battery. */
function withBattery(seed: number): Solver {
  const t = solver(createGame(seed));
  SOLUTIONS['equation-safe']!(t);
  assert.ok(t.state.items[BATTERY_ID], 'face 2 did not hand over the battery');
  return t;
}
/** ... and the battery is in the emitter. */
function powered(seed: number): Solver {
  const t = withBattery(seed);
  powerLaser(t);
  return t;
}

test('sequence-laser: seven symbols on a circle, on the same tiles on both sides, and off the ring', () => {
  const t = solver(createGame(1));
  const tiles = (side: Side) => symbols(t, side).map((o) => `${o.x},${o.y}`);
  assert.equal(tiles('out').length, SYMBOLS.length);
  assert.deepEqual(tiles('in'), tiles('out'), 'inside and outside share the canonical tiles');
  assert.deepEqual(symbols(t, 'in').map((o) => o.state), [...SYMBOLS], 'the i-th tile is the i-th symbol, unlit');
  assert.deepEqual(symbols(t, 'out').map((o) => o.state), [...SYMBOLS]);
  for (const o of symbols(t, 'out')) assert.ok(!onRing(o.x, o.y));
  assert.equal(see(t, 'out').filter((o) => o.type === 'f5-replay').length, 1);
  assert.equal(see(t, 'in').filter((o) => o.type === 'f5-replay').length, 0, 'REPLAY is outside only');
  assert.equal(emitter(t), 'dead');
  assert.equal(see(t, 'out').some((o) => o.type === 'f5-emitter'), false, 'the emitter is inside only');
});

test('sequence-laser: solved by battery, watching and seven presses; the emitter fires', () => {
  const t = withBattery(3);
  powerLaser(t);
  assert.equal(emitter(t), 'powered');
  assert.equal(t.state.items[BATTERY_ID]!.placedOn !== null, true, 'the battery stays in the emitter');
  const order = watchSequence(t);
  assert.equal(order.length, SYMBOLS.length);
  const strikes = t.state.strikes;
  let last: ReturnType<Solver['interact']> = [];
  for (const [i, name] of order.entries()) {
    assert.equal(lit(t, 'in').length, i, 'the buttons pressed so far are lit inside');
    last = pressSymbol(t, name);
  }
  assert.ok(t.state.solved.includes(FACE));
  assert.equal(t.state.strikes, strikes);
  assert.deepEqual(puzzleEvents(last), ['laser', 'chime']);
  assert.equal(emitter(t), 'firing');
  assert.equal(lit(t, 'in').length, SYMBOLS.length);
  assert.equal(lit(t, 'out').length, SYMBOLS.length);
});

test('sequence-laser: the order is a permutation of the seven symbols and differs between seeds', () => {
  const orders = [11, 22, 33].map((seed) => watchSequence(powered(seed)));
  for (const order of orders) assert.deepEqual([...order].sort(), [...SYMBOLS].sort(), 'every symbol exactly once');
  assert.notDeepEqual(orders[0], orders[1]);
  assert.notDeepEqual(orders[1], orders[2]);
  // the same seed plays the same order, and REPLAY does not change it
  const t = powered(11);
  assert.deepEqual(watchSequence(t), orders[0]);
  assert.deepEqual(watchSequence(t), orders[0]);
});

test('sequence-laser: one symbol lights every 500 ms, outside only', () => {
  const t = powered(5);
  const order = watchSequence(t); // ends with the playback over
  assert.equal(litSymbol(t), null);
  t.interact('out'); // still on REPLAY
  const seen: (string | null)[] = [];
  for (let i = 0; i < SYMBOLS.length * 2 + 2; i++) {
    seen.push(litSymbol(t));
    assert.ok(lit(t, 'out').length <= 1, 'one at a time');
    assert.equal(lit(t, 'in').length, 0, 'the inside player never sees the sequence');
    t.wait(250);
  }
  // two looks per 500 ms step, then dark
  assert.deepEqual(seen, [...order.flatMap((n) => [n, n]), null, null]);
});

test('sequence-laser: nothing works before the battery is in', () => {
  const t = withBattery(7);
  const before = JSON.stringify(t.state.puzzles['sequence-laser']);
  for (const o of symbols(t, 'in')) {
    insideGo(t, { face: FACE, x: o.x, y: o.y });
    // the inside player carries nothing yet, so E is a plain use
    t.interact('in');
  }
  const replay = see(t, 'out').find((o) => o.type === 'f5-replay')!;
  assert.equal(replay.state, 'off');
  t.go('out', { face: FACE, x: replay.x, y: replay.y });
  t.interact('out');
  t.wait(1000);
  assert.equal(JSON.stringify(t.state.puzzles['sequence-laser']), before);
  assert.equal(t.state.strikes, 0);
  assert.equal(lit(t, 'out').length + lit(t, 'in').length, 0);
  assert.match(objectiveFor(t.state, 'out', t.env), /power/i);
});

test('sequence-laser: a wrong press is a strike and the progress starts over; the order stays', () => {
  const t = powered(9);
  const order = watchSequence(t);
  pressSymbol(t, order[0]!);
  pressSymbol(t, order[1]!);
  assert.equal(lit(t, 'in').length, 2);
  const evs = pressSymbol(t, order[3]!); // order[2] was next
  assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'in'));
  assert.equal(t.state.strikes, 1);
  assert.equal(lit(t, 'in').length, 0, 'the entered presses are gone');
  assert.ok(!t.state.solved.includes(FACE));
  assert.deepEqual(watchSequence(t), order, 'the same order after a mistake');
  for (const name of order) pressSymbol(t, name);
  assert.ok(t.state.solved.includes(FACE));
  assert.equal(t.state.strikes, 1);
});

test('sequence-laser: REPLAY restarts the playback from the first symbol', () => {
  const t = powered(13);
  const order = watchSequence(t);
  t.interact('out');
  t.wait(1250); // into the third symbol
  assert.equal(litSymbol(t), order[2]);
  t.interact('out');
  assert.equal(litSymbol(t), order[0]);
  // the inside player cannot replay: there is no REPLAY tile in there
  const replay = see(t, 'out').find((o) => o.type === 'f5-replay')!;
  t.wait(5000);
  insideGo(t, { face: FACE, x: replay.x, y: replay.y });
  t.interact('in');
  assert.equal(litSymbol(t), null);
});

test('sequence-laser: never blocks a tile, on the ring or anywhere, in any state', () => {
  const check = (t: Solver) => {
    for (const side of SIDES)
      for (let y = 0; y < FACE_SIZE; y++)
        for (let x = 0; x < FACE_SIZE; x++) {
          const solid = defaultEnv.world[side][FACE].tiles[y]![x] !== 'floor';
          assert.equal(isBlocked(t.state, side, { face: FACE, x, y }, t.env), solid, `${side} ${x},${y}`);
          if (onRing(x, y)) assert.equal(solid, false);
        }
  };
  const t = withBattery(2);
  check(t);
  powerLaser(t);
  check(t);
  const order = watchSequence(t);
  pressSymbol(t, order[0]!);
  check(t);
  for (const name of order.slice(1)) pressSymbol(t, name);
  check(t);
});
