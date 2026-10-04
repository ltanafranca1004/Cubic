import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carryBattery, countsIn, createGame, equationSafeScript, observe, parseHuman, seedOf, visibleObjects, type PuzzleScript, type Side } from '../src/index';
import { equationAnswer, equationCounts } from '../src/puzzles/equationSafe';
import { equationSafeHuman } from './humans/equationSafe';
import { play, STEP_MS, type HumanScript, type Played } from './partnerSim';

// The AI partner on face 2 (equation-safe), either side, against a simulated human, through
// the real engine. No server, no network, no model.

const FACE = 2;
const STARTS = [1_700_000_000_000, 1_700_000_123_456, 1_700_000_999_999, 1_700_000_424_242];
const solved = (r: Played) => r.state.solved.includes(FACE);
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; startAt?: number; until?: (s: Played['state']) => boolean } = {}) =>
  play(aiSide, { humans: [human as HumanScript<unknown>], scripts: [equationSafeScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: 180_000, ...opts });
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === 'equation-safe.relay').map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const digits = (n: number) => [...String(n)].map((d) => WORDS[Number(d)]).join(' ');

test('countsIn: the ways a person says three counts', () => {
  const read = (text: string, asked: 'bushes' | 'birds' | 'rocks' | null = null, into = {}) => (countsIn(text, into, asked), into);
  assert.deepEqual(read('3 bushes 2 birds 1 rock'), { bushes: 3, birds: 2, rocks: 1 });
  assert.deepEqual(read('one rock, two birds and three bushes'), { bushes: 3, birds: 2, rocks: 1 });
  assert.deepEqual(read('bushes 3, birds 2, rocks 1'), { bushes: 3, birds: 2, rocks: 1 });
  assert.deepEqual(read('bushes: 4'), { bushes: 4 });
  assert.deepEqual(read('3 2 1'), { bushes: 3, birds: 2, rocks: 1 });
  assert.deepEqual(read('4', 'birds'), { birds: 4 });
  assert.deepEqual(read('2', null, { bushes: 1 }), { bushes: 1, birds: 2 });
  assert.deepEqual(read('give me 2 minutes'), {});
  assert.deepEqual(read('hello'), {});
  for (const line of ['3 bushes 2 birds 1 rock', '3 2 1', 'bushes 3 birds 2 rocks 1', 'four']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it says the three counts in vocabulary pieces and the human inside opens the safe', () => {
  for (const startAt of STARTS) {
    const r = run('out', equationSafeHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
    const c = equationCounts(seedOf(r.state));
    assert.deepEqual(relays(r), [`${WORDS[c.bushes]} bushes ${WORDS[c.birds]} birds ${WORDS[c.rocks]} rocks`]);
    assert.equal(r.lines.filter((k) => k === 'equation-safe.out.intro').length, 1);
  }
});

test('AI outside: it repeats on "repeat"', () => {
  const r = run('out', equationSafeHuman({ again: 2 }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.equal(relays(r).length, 3);
  assert.equal(new Set(relays(r)).size, 1);
});

test('AI inside: it multiplies the counts the human says, however they say them, and opens the safe', () => {
  for (const startAt of STARTS)
    for (const style of ['named', 'backwards', 'bare'] as const) {
      const r = run('in', equationSafeHuman({ style }), { startAt });
      assert.deepEqual([solved(r), r.state.strikes], [true, 0], style);
      assert.deepEqual(relays(r), [`press ${digits(equationAnswer(seedOf(r.state)))}`], style);
    }
});

test('AI inside: it does nothing before the human speaks, asks kind by kind after about 15 s, and takes bare answers', () => {
  for (const startAt of STARTS.slice(0, 2)) {
    // the bot has to walk to face 2 first: count from when it is first asked there
    const r = run('in', equationSafeHuman({ mute: true }), { maxMs: 120_000, startAt });
    assert.equal(solved(r), false);
    assert.equal(r.state.strikes, 0);
    const first = r.decisions.findIndex((d) => d.status.startsWith("waiting for the partner's counts"));
    assert.ok(first >= 0);
    assert.ok(r.decisions.slice(first).every((d) => d.action === null), 'it moved or pressed something');
    assert.ok(visibleObjects(r.state, 'in', FACE).filter((o) => o.type === 'display').every((o) => o.state === 'empty'));
    const asks = saidAt(r, 'equation-safe.ask.bushes').map((t) => t - (first + 1) * STEP_MS);
    assert.ok(asks[0]! >= 15_000 && asks[0]! <= 16_000, `first ask after ${asks[0]} ms`);
    assert.ok(asks[1]! - asks[0]! === 20_000);
    assert.deepEqual([...new Set(r.lines.filter((k) => k.startsWith('equation-safe.')))], ['equation-safe.ask.bushes']);
  }
  const shy = run('in', equationSafeHuman({ shy: true }), { maxMs: 300_000 });
  assert.deepEqual([solved(shy), shy.state.strikes], [true, 0]);
  assert.deepEqual(shy.lines.filter((k) => k.startsWith('equation-safe.ask')), ['equation-safe.ask.bushes', 'equation-safe.ask.birds', 'equation-safe.ask.rocks']);
  assert.equal(shy.human.said.length, 3);
});

test('AI inside: it has no way to the counts but the human: a wrong count said is a wrong answer typed', () => {
  const r = run('in', equationSafeHuman({ lie: true }), { until: (s) => s.strikes > 0, maxMs: 120_000 });
  assert.deepEqual([solved(r), r.state.strikes], [false, 1]);
  const c = equationCounts(seedOf(r.state));
  assert.deepEqual(relays(r), [`press ${digits(6 * (c.bushes + 1) * c.birds * c.rocks)}`]);
  const more = run('in', equationSafeHuman({ lie: true }), { until: (s) => s.strikes > 1, maxMs: 150_000 });
  assert.ok(more.lines.includes('equation-safe.wrong'));
  assert.equal(solved(more), false);
});

test('the battery: carryBattery, as the errand of the face 5 script, takes it to the emitter and places it', () => {
  // a stand-in for the sequence-laser script: only its errand
  const face5: PuzzleScript<null> = { id: 'sequence-laser', lines: [], init: () => null, play: () => null, errand: (ctx) => carryBattery(ctx.o) };
  for (const startAt of STARTS.slice(0, 2)) {
    const powered = (s: Played['state']) => visibleObjects(s, 'in', 5).some((o) => o.type === 'f5-emitter' && o.state !== 'dead');
    const r = play('in', { humans: [equationSafeHuman()], scripts: [equationSafeScript, face5], order: [FACE], until: powered, maxMs: 300_000, startAt });
    assert.ok(solved(r));
    assert.ok(powered(r.state), `the battery is ${JSON.stringify(r.state.items)}`);
    assert.equal(r.state.strikes, 0);
    assert.equal(r.state.players.in.carrying, null);
  }
  // not the outside player's job, and nothing to carry before the safe is open
  const fresh = createGame(STARTS[0]!);
  assert.equal(carryBattery(observe(fresh, 'in')), null);
  assert.equal(carryBattery(observe(fresh, 'out')), null);
});
