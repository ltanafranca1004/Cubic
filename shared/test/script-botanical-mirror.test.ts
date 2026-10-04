import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, parseHuman, potLine, PUZZLE_SCRIPTS, visibleObjects, type GameState, type Side } from '../src/index';
import { potColourLine } from '../src/bot/scripts/botanicalMirror';
import { colourIn, rowColumnIn } from '../src/bot/scripts/kit456';
import { potColours } from '../src/puzzles/botanicalMirror';
import { solver } from './harness';
import { botanicalMirrorHuman } from './humans/botanicalMirror';
import { laserPathHuman } from './humans/laserPath';
import { sequenceLaserHuman } from './humans/sequenceLaser';
import { HUMAN_SCRIPTS, play, STEP_MS, type HumanScript, type Played } from './partnerSim';
import { SOLUTIONS } from './solutions';

// The AI partner on face 4 (botanical-mirror), either side, against a simulated human,
// through the real engine. No server, no network, no model. Every game starts with faces 2,
// 5 and 6 solved by their real solution scripts: the crate's flower lies outside on face 6,
// the other four where the seed put them, on faces 1, 2, 3 and 5.

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
  play(aiSide, { state: opts.state ?? afterFace6(opts.startAt ?? STARTS[0]!), humans: [human as HumanScript<unknown>], scripts: PUZZLE_SCRIPTS, order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: opts.maxMs ?? 600_000 });
const solved = (r: Played) => r.state.solved.includes(FACE);
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === RELAY).map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
const count = (r: Played, key: string) => r.lines.filter((k) => k === key).length;
/** The five pots as the inside player sees them: canonical tile and colour. */
const pots = (state: GameState) => visibleObjects(state, 'in', FACE).filter((o) => o.type === 'f4-flowerpot').map((o) => ({ x: o.x, y: o.y, colour: o.state ?? '' }));
const potWords = (p: { x: number; y: number }) => `the pot is row ${WORDS[p.y + 1]} column ${WORDS[p.x + 1]}`;
const flowers = (state: GameState) => Object.values(state.items).filter((i) => i.kind.startsWith('flower-'));

test('the pieces: the pot lines, and what a human types', () => {
  assert.deepEqual(potLine({ x: 8, y: 3 }), ['the pot is', 'row', 'four', 'column', 'nine']);
  assert.deepEqual(potColourLine({ x: 8, y: 3 }, 'pink'), ['the pot is', 'row', 'four', 'column', 'nine', 'the flower is', 'pink']);
  assert.deepEqual(rowColumnIn('the pot is row four column nine'), { row: 4, column: 9 });
  assert.deepEqual(rowColumnIn('col 12, row 1'), { row: 1, column: 12 });
  assert.equal(colourIn('It is PINK!'), 'pink');
  for (const line of ['row 4 column 9', 'it is pink', 'the flower is yellow', 'column 10 row 12', 'white']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it asks the colour of every pot by row and column, then fetches the five flowers and plants each in its pot', () => {
  for (const startAt of STARTS) {
    const r = run('out', botanicalMirrorHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    const seen = pots(r.state);
    // one question per pot, each answered with the colour the inside player sees there
    assert.deepEqual(relays(r), seen.map(potWords));
    assert.deepEqual(r.human.said, seen.map((p) => p.colour));
    assert.deepEqual([count(r, 'botanical-mirror.out.colour'), count(r, 'botanical-mirror.out.go'), count(r, 'botanical-mirror.out.strike')], [5, 1, 0]);
    // all five are in the pots, for good
    assert.ok(flowers(r.state).length === 5 && flowers(r.state).every((f) => f.placedOn && f.face === FACE), `start ${startAt}`);
    // it never stood on a pot: they are solid
    for (const p of seen) assert.ok(!r.trodden.has(`${FACE}:${p.x},${p.y}`));
  }
});

test('AI outside: a wrong colour is a strike; it says so, asks where the flower in its hands goes, and still plants all five', () => {
  const r = run('out', botanicalMirrorHuman({ lie: true }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 1]);
  assert.equal(count(r, 'botanical-mirror.out.strike'), 1);
  // after the strike it says the colour it holds, and the human names the pot by row and column
  assert.ok(relays(r).some((w) => /^the flower is \w+$/.test(w)));
  assert.ok(r.human.said.some((w) => /^row \d+ column \d+$/.test(w)));
});

test('AI outside never reads the flowers inside: with a silent human it fetches nothing, plants nothing and keeps asking', () => {
  for (const startAt of STARTS) {
    const r = run('out', botanicalMirrorHuman({ mute: true }), { startAt, maxMs: 120_000 });
    assert.deepEqual([solved(r), r.state.strikes], [false, 0]);
    assert.equal(r.state.players.out.carrying, null);
    assert.ok(flowers(r.state).every((f) => !f.placedOn && f.face !== FACE));
    assert.equal(r.state.players.out.pose.face, FACE);
    const asks = saidAt(r, 'botanical-mirror.out.colour');
    assert.ok(asks.length >= 3);
    for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);
    // it names the same pot each time it asks
    assert.equal(relays(r).length, asks.length);
    assert.equal(new Set(relays(r)).size, 1);
  }
});

test('AI inside: it names every pot with its colour, and the human outside fetches the five flowers and plants them', () => {
  for (const startAt of STARTS) {
    const r = run('in', botanicalMirrorHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    const seen = pots(r.state);
    // the first time it is on the wall with the human: all five, in map order
    assert.deepEqual(relays(r).slice(0, 5), seen.map((p) => `${potWords(p)} the flower is ${p.colour}`));
    assert.deepEqual(seen.map((p) => p.colour), potColours(r.state.seed!));
    // it names them all once; when the human is back with the next flower it asks its colour and names that pot again
    assert.equal(count(r, 'botanical-mirror.in.how'), 1);
    for (const said of r.human.said) assert.match(said, /^it is (red|blue|yellow|pink|white)$/);
    assert.equal(relays(r).length, 5 + r.human.said.length);
    assert.ok(flowers(r.state).length === 5 && flowers(r.state).every((f) => f.placedOn && f.face === FACE), `start ${startAt}`);
  }
});

test('AI inside: "again" repeats the pots, a colour or a row and column names one pot, and a silent human is asked', () => {
  let asked = 0;
  const base = botanicalMirrorHuman();
  const chatty: HumanScript<unknown> = {
    ...(base as HumanScript<unknown>),
    play(ctx) {
      base.play(ctx as never);
      // once it has heard the five pots: "again", then one colour, then one pot by row and column
      if (ctx.inbox.length) return;
      const said = ['again', 'my flower is white', 'row 4 column 9'][asked];
      if (said && Object.keys((ctx.mem as { pots: object }).pots).length === 5) void (asked++, ctx.say(said));
    },
    // this human only talks: it never goes for a flower
    errand: () => false,
  };
  const r = run('in', chatty, { maxMs: 60_000 });
  const seen = pots(r.state);
  const line = (p: { x: number; y: number; colour: string }) => `${potWords(p)} the flower is ${p.colour}`;
  const all = seen.map(line);
  assert.deepEqual(relays(r), [...all, ...all, line(seen.find((p) => p.colour === 'white')!), line(seen.find((p) => p.x === 8 && p.y === 3)!)]);
  assert.equal(count(r, 'botanical-mirror.in.how'), 1);
  // then the human says nothing more: it asks for the colour of their flower, about every 15 s
  const asks = saidAt(r, 'botanical-mirror.in.ask');
  assert.ok(asks.length >= 2);
  for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);
});

test('the chain 5 -> 6 -> 4 in one game, the AI on either side: battery, laser, mirrors, path, five flowers, five pots', () => {
  for (const aiSide of ['out', 'in'] as const) {
    const state = createGame(STARTS[1]!);
    SOLUTIONS['equation-safe']!(solver(state, undefined, state.startedAt));
    const r = play(aiSide, {
      state,
      scripts: PUZZLE_SCRIPTS,
      humans: [sequenceLaserHuman(), laserPathHuman(), botanicalMirrorHuman()] as HumanScript<unknown>[],
      order: [5, 6, 4],
      until: (s) => s.solved.includes(4),
      maxMs: 1_500_000,
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
