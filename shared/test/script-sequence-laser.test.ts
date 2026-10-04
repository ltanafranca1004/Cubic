import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, parseHuman, sequenceLaserScript, orderLines, visibleObjects, type GameState, type Side } from '../src/index';
import { symbolsIn } from '../src/bot/scripts/kit456';
import { BATTERY_ID } from '../src/puzzles/chain';
import { solver } from './harness';
import { sequenceLaserHuman } from './humans/sequenceLaser';
import { watchSequence } from './laser-solutions';
import { play, STEP_MS, type HumanScript, type Played } from './partnerSim';
import { SOLUTIONS } from './solutions';

// The AI partner on face 5 (sequence-laser), either side, against a simulated human, through
// the real engine. No server, no network, no model. Every game starts with face 2 solved by
// its real solution script: the battery lies inside, in front of the safe.

const FACE = 5;
const STARTS = [1_700_000_000_000, 1_700_000_123_456, 1_700_000_999_999];
const RELAY = 'sequence-laser.relay';

function afterFace2(startAt: number): GameState {
  const state = createGame(startAt);
  SOLUTIONS['equation-safe']!(solver(state, undefined, startAt));
  assert.deepEqual(state.solved, [2]);
  return state;
}
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; startAt?: number; state?: GameState } = {}) =>
  play(aiSide, { state: opts.state ?? afterFace2(opts.startAt ?? STARTS[0]!), humans: [human as HumanScript<unknown>], scripts: [sequenceLaserScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: opts.maxMs ?? 240_000 });
const solved = (r: Played) => r.state.solved.includes(FACE);
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === RELAY).map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
/** The real order, read the way the outside player can: REPLAY and watch. */
const shown = (state: GameState): string[] => watchSequence(solver(state, undefined, state.startedAt));
const pressed = (r: Played) => visibleObjects(r.state, 'in', FACE).filter((o) => o.type === 'f5-symbol' && o.state?.endsWith('-lit')).length;

test('orderLines and the words a human types', () => {
  assert.deepEqual(orderLines(['sun', 'moon', 'star', 'bolt', 'drop', 'leaf', 'eye']), [
    ['the order is', 'sun', 'then', 'moon', 'then', 'star'],
    ['next', 'bolt', 'then', 'drop', 'then', 'leaf', 'then', 'eye'],
  ]);
  assert.deepEqual(symbolsIn('first the Sun, then moon and the eye!'), ['sun', 'moon', 'eye']);
  for (const line of ['sun moon star', 'bolt drop leaf eye', 'the first is leaf', 'then eye']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it presses REPLAY, watches, says the order in two parts and the human inside fires the laser', () => {
  for (const startAt of STARTS) {
    const r = run('out', sequenceLaserHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
    const said = relays(r);
    assert.equal(said.length, 2);
    assert.match(said[0]!, /^the order is \w+ then \w+ then \w+$/);
    assert.match(said[1]!, /^next \w+ then \w+ then \w+ then \w+$/);
    assert.equal(new Set(symbolsIn(said.join(' '))).size, 7);
    // before the battery was in there was nothing to say
    assert.ok(r.lines.indexOf('sequence-laser.out.dark') < r.lines.indexOf(RELAY));
  }
});

test('AI outside: it repeats both parts on "again"', () => {
  const r = run('out', sequenceLaserHuman({ again: 2 }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  const said = relays(r);
  assert.equal(said.length, 6);
  assert.deepEqual([said[2], said[3]], [said[0], said[1]]);
});

test('AI inside: it fetches the battery, powers the laser and presses what the human says', () => {
  for (const startAt of STARTS) {
    const r = run('in', sequenceLaserHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
    assert.equal(r.state.items[BATTERY_ID]!.placedOn !== null, true);
    assert.equal(r.human.said.length, 2);
    assert.ok(!r.lines.includes(RELAY)); // the doing side has nothing to relay
  }
});

test('AI inside: the battery is already in its hands, or already in the emitter', () => {
  const carried = afterFace2(STARTS[1]!);
  const t = solver(carried, undefined, carried.startedAt);
  t.go('in', t.item(BATTERY_ID));
  t.interact('in');
  assert.equal(carried.items[BATTERY_ID]!.carriedBy, 'in');
  assert.ok(solved(run('in', sequenceLaserHuman(), { state: carried })));
});

test('AI inside: with a silent human it powers the laser, presses nothing and asks for the first symbol about every 15 s', () => {
  const r = run('in', sequenceLaserHuman({ mute: true }), { maxMs: 120_000 });
  assert.deepEqual([solved(r), r.state.strikes, pressed(r)], [false, 0, 0]);
  assert.equal(visibleObjects(r.state, 'in', FACE).find((o) => o.type === 'f5-emitter')!.state, 'powered');
  const asks = saidAt(r, 'sequence-laser.in.first');
  assert.ok(asks.length >= 2, `asked ${asks.length} times`);
  for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);
  assert.equal(saidAt(r, 'sequence-laser.in.how').length, 1);
});

test('AI inside: a shy human answers when asked; a wrong order is a strike, said, and asked again', () => {
  const shy = run('in', sequenceLaserHuman({ shy: true }));
  assert.deepEqual([solved(shy), shy.state.strikes], [true, 0]);
  assert.ok(shy.lines.includes('sequence-laser.in.first'));
  const lie = run('in', sequenceLaserHuman({ lie: true }), { maxMs: 90_000 });
  assert.ok(lie.state.strikes >= 1);
  assert.ok(lie.lines.includes('sequence-laser.in.strike'));
});

test('AI inside: it presses one symbol at a time when the human says one at a time, and asks what is next', () => {
  const state = afterFace2(STARTS[2]!);
  let order: string[] | null = null;
  const slow: HumanScript<{ n: number }> = {
    id: 'sequence-laser',
    init: () => ({ n: 0 }),
    play({ mem, next, say, seen }) {
      if (seen('f5-replay')[0]?.state !== 'on') return void next();
      order ??= shown(state); // (the test reads it the outside player's way, once)
      for (let l = next(); l; l = next()) if (l.key === 'sequence-laser.in.how' || l.key === 'sequence-laser.in.next' || l.key === 'sequence-laser.in.first') if (mem.n < 7) say(`it is ${order[mem.n++]}`);
    },
  };
  const r = run('in', slow, { state, maxMs: 400_000 });
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.equal(r.human.said.length, 7);
  assert.ok(saidAt(r, 'sequence-laser.in.next').length >= 5);
});

test('AI inside never reads the order: no word from the human, other seeds, and no button is pressed', () => {
  for (const startAt of STARTS) {
    const r = run('in', sequenceLaserHuman({ mute: true }), { startAt, maxMs: 60_000 });
    assert.deepEqual([solved(r), r.state.strikes, pressed(r)], [false, 0, 0]);
  }
  // and alone on the face (no human script at all) it still only powers the laser
  const alone = play('in', { state: afterFace2(STARTS[0]!), humans: [], scripts: [sequenceLaserScript], maxMs: 60_000 });
  assert.deepEqual([alone.state.solved, alone.state.strikes], [[2], 0]);
});

test('AI outside: a human who does not bring the battery hears that the symbols are dark; nothing is relayed', () => {
  const r = run('out', sequenceLaserHuman({ lazy: true }), { maxMs: 40_000 });
  assert.equal(solved(r), false);
  assert.ok(r.lines.includes('sequence-laser.out.dark'));
  assert.equal(relays(r).length, 0);
});
