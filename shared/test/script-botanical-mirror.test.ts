import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botanicalMirrorScript, createGame, laserPathScript, parseHuman, potLine, PUZZLE_SCRIPTS, seedOf, sequenceLaserScript, visibleObjects, type GameState, type Side } from '../src/index';
import { colourIn, rowColumnIn } from '../src/bot/scripts/kit456';
import { flowerColour, FLOWER_ID } from '../src/puzzles/chain';
import { solver } from './harness';
import { botanicalMirrorHuman } from './humans/botanicalMirror';
import { laserPathHuman } from './humans/laserPath';
import { sequenceLaserHuman } from './humans/sequenceLaser';
import { HUMAN_SCRIPTS, play, STEP_MS, type HumanScript, type Played } from './partnerSim';
import { SOLUTIONS } from './solutions';

// The AI partner on face 4 (botanical-mirror), either side, against a simulated human,
// through the real engine. No server, no network, no model. Every game starts with faces 2,
// 5 and 6 solved by their real solution scripts: the flower lies outside on face 6.

const FACE = 4;
const STARTS = [1_700_000_000_000, 1_700_000_123_456, 1_700_000_999_999, 1_700_000_424_242];
const RELAY = 'botanical-mirror.relay';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function afterFace6(startAt: number): GameState {
  const state = createGame(startAt);
  SOLUTIONS['laser-path']!(solver(state, undefined, startAt));
  assert.deepEqual(state.solved, [2, 5, 6]);
  return state;
}
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; startAt?: number; state?: GameState } = {}) =>
  play(aiSide, { state: opts.state ?? afterFace6(opts.startAt ?? STARTS[0]!), humans: [human as HumanScript<unknown>], scripts: [botanicalMirrorScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: opts.maxMs ?? 240_000 });
const solved = (r: Played) => r.state.solved.includes(FACE);
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === RELAY).map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
/** The pot that holds this game's colour, as the inside player sees it. */
const rightPot = (state: GameState) => visibleObjects(state, 'in', FACE).find((o) => o.type === 'f4-flowerpot' && o.state === flowerColour(seedOf(state)))!;

test('the pieces: the pot line, and what a human types', () => {
  assert.deepEqual(potLine({ x: 8, y: 3 }), ['the pot is', 'row', 'four', 'column', 'nine']);
  assert.deepEqual(rowColumnIn('the pot is row four column nine'), { row: 4, column: 9 });
  assert.deepEqual(rowColumnIn('col 12, row 1'), { row: 1, column: 12 });
  assert.equal(colourIn('It is PINK!'), 'pink');
  for (const line of ['row 4 column 9', 'it is pink', 'the flower is yellow', 'column 10 row 12']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it fetches the flower on face 6, says its colour, and plants it in the pot the human names', () => {
  for (const startAt of STARTS) {
    const r = run('out', botanicalMirrorHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    assert.deepEqual(relays(r), [`the flower is ${flowerColour(seedOf(r.state))}`]);
    const pot = rightPot(r.state);
    assert.deepEqual(r.human.said, [`row ${pot.y + 1} column ${pot.x + 1}`]);
  }
});

test('AI outside: a wrong pot is a strike; it says so, asks again and plants it where it is told next', () => {
  const r = run('out', botanicalMirrorHuman({ lie: true }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 1]);
  assert.equal(r.lines.filter((k) => k === 'botanical-mirror.out.strike').length, 1);
  assert.equal(r.human.said.length, 2);
});

test('AI outside never reads the flowers inside: a silent human, other seeds, and the flower stays in its hands', () => {
  for (const startAt of STARTS) {
    const r = run('out', botanicalMirrorHuman({ mute: true }), { startAt, maxMs: 120_000 });
    assert.deepEqual([solved(r), r.state.strikes], [false, 0]);
    assert.equal(r.state.items[FLOWER_ID]!.carriedBy, 'out');
    assert.equal(r.state.players.out.pose.face, FACE);
    const asks = saidAt(r, 'botanical-mirror.out.ask');
    assert.ok(asks.length >= 3);
    for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);
    // it says the colour again each time it asks
    assert.equal(relays(r).length, asks.length);
  }
});

test('AI inside: it asks for the colour, names the pot by row and column, and the human outside plants the flower', () => {
  for (const startAt of STARTS) {
    const r = run('in', botanicalMirrorHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    const pot = rightPot(r.state);
    assert.deepEqual(relays(r), [`the pot is row ${WORDS[pot.y + 1]} column ${WORDS[pot.x + 1]}`]);
    assert.deepEqual(r.human.said, [`it is ${flowerColour(seedOf(r.state))}`]);
    assert.equal(r.lines.filter((k) => k === 'botanical-mirror.in.how').length, 1);
  }
});

test('AI inside: it does not name a pot before the colour is said, asks about every 15 s, and repeats on "again"', () => {
  const mute = run('in', botanicalMirrorHuman({ mute: true }), { maxMs: 120_000 });
  assert.equal(solved(mute), false);
  assert.equal(relays(mute).length, 0);
  const asks = saidAt(mute, 'botanical-mirror.in.ask');
  assert.ok(asks.length >= 3);
  for (let i = 2; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);

  let agains = 0;
  const base = botanicalMirrorHuman();
  const deaf: HumanScript<unknown> = {
    ...(base as HumanScript<unknown>),
    play(ctx) {
      if (ctx.side === 'out' && agains < 2 && ctx.inbox[0]?.key === RELAY) return void (ctx.next(), agains++, ctx.say('again'));
      base.play(ctx as never);
    },
  };
  const r = run('in', deaf);
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.equal(relays(r).length, 3);
  assert.equal(new Set(relays(r)).size, 1);
});

test('the chain 5 -> 6 -> 4 in one game, the AI on either side: battery, laser, mirrors, path, flower, pot', () => {
  for (const aiSide of ['out', 'in'] as const) {
    const state = createGame(STARTS[1]!);
    SOLUTIONS['equation-safe']!(solver(state, undefined, state.startedAt));
    const r = play(aiSide, {
      state,
      scripts: [sequenceLaserScript, laserPathScript, botanicalMirrorScript],
      humans: [sequenceLaserHuman(), laserPathHuman(), botanicalMirrorHuman()] as HumanScript<unknown>[],
      order: [5, 6, 4],
      until: (s) => s.solved.includes(4),
      maxMs: 900_000,
    });
    assert.deepEqual([r.state.solved, r.state.strikes], [[2, 4, 5, 6], 0], `AI ${aiSide}`);
  }
});

test('the registries hold the three scripts of faces 4 to 6 and their humans', () => {
  for (const id of ['botanical-mirror', 'sequence-laser', 'laser-path']) {
    assert.ok(PUZZLE_SCRIPTS.some((s) => s.id === id), id);
    assert.ok(HUMAN_SCRIPTS.some((h) => h.id === id), id);
  }
});
