import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, laserPathScript, mirrorPush, parseHuman, stepLine, visibleObjects, type GameState, type Side } from '../src/index';
import { partnerCell, rowColumnIn, stepsIn, turnOf } from '../src/bot/scripts/kit456';
import { FLOWER_ID } from '../src/puzzles/chain';
import { solver } from './harness';
import { laserPathHuman } from './humans/laserPath';
import { play, STEP_MS, type HumanScript, type Played } from './partnerSim';
import { SOLUTIONS } from './solutions';

// The AI partner on face 6 (laser-path), either side, against a simulated human, through
// the real engine. No server, no network, no model. Every game starts with faces 2 and 5
// solved by their real solution scripts: the laser is on and the lava is hot.

const FACE = 6;
const STARTS = [1_700_000_000_000, 1_700_000_123_456, 1_700_000_999_999, 1_700_000_424_242];
const RELAY = 'laser-path.relay';

function afterFace5(startAt: number): GameState {
  const state = createGame(startAt);
  SOLUTIONS['sequence-laser']!(solver(state, undefined, startAt));
  assert.deepEqual(state.solved, [2, 5]);
  return state;
}
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; startAt?: number } = {}) =>
  play(aiSide, { state: afterFace5(opts.startAt ?? STARTS[0]!), humans: [human as HumanScript<unknown>], scripts: [laserPathScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: opts.maxMs ?? 400_000 });
const solved = (r: Played) => r.state.solved.includes(FACE);
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === RELAY).map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
/** Inner (lava) tiles of face 6 the AI stood on. */
const lavaTrodden = (r: Played) => [...r.trodden].filter((t) => t.startsWith('6:')).map((t) => t.slice(2).split(',').map(Number)).filter(([x, y]) => x! > 0 && y! > 0 && x! < 11 && y! < 11);
const pathTiles = (state: GameState) => visibleObjects(state, 'out', FACE).filter((o) => o.type === 'f6-path').map((o) => [o.x, o.y]);

test('the pieces: the mirror plan, a line of steps, the turn between the screens, what a human types', () => {
  assert.deepEqual(mirrorPush({ x: 4, y: 2 }, { x: 9, y: 4 }, { x: 5, y: 5 }, { x: 9, y: 11 }), { stand: { x: 3, y: 2 }, dx: 1, dy: 0 });
  assert.deepEqual(mirrorPush({ x: 5, y: 2 }, { x: 9, y: 4 }, { x: 5, y: 5 }, { x: 9, y: 11 }), { stand: { x: 9, y: 5 }, dx: 0, dy: -1 });
  assert.equal(mirrorPush({ x: 5, y: 2 }, { x: 9, y: 2 }, { x: 5, y: 5 }, { x: 9, y: 11 }), 'set');
  assert.equal(mirrorPush({ x: 5, y: 2 }, { x: 8, y: 4 }, { x: 5, y: 5 }, { x: 9, y: 11 }), 'reset');
  assert.deepEqual(stepLine(['right', 'right', 'up', 'left'], 0), { pieces: ['step', 'right', 'two', 'then', 'up', 'one'], length: 3 });
  assert.deepEqual(stepLine(['right', 'right', 'up', 'left'], 3), { pieces: ['step', 'left', 'one', 'then', 'press'], length: 1 });
  assert.deepEqual(stepsIn('step right two then up one then press'), ['right', 'right', 'up']);
  assert.deepEqual(stepsIn('left 3, down'), ['left', 'left', 'left', 'down']);
  assert.deepEqual(rowColumnIn('row six'), { row: 6 });
  // upright on both sides the inside is my mirror image: my right is their left, my tile 0,5 their 11,5
  assert.equal(turnOf({ col: 1, row: 0 }, 'left'), 0);
  assert.deepEqual(partnerCell({ col: 0, row: 5 }, 0), { col: 11, row: 5 });
  for (const line of ['right 2 then up 1', 'face 4', 'row 6', 'column 12', 'up 1 then press', 'left']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it pushes the mirrors, takes the flower, and talks the human inside along the path to the button', () => {
  for (const startAt of STARTS) {
    const r = run('out', laserPathHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    assert.equal(r.state.items[FLOWER_ID]!.carriedBy, 'out');
    const said = relays(r);
    assert.match(said[0]!, /^(row|column) \w+$/);
    for (const line of said.slice(1)) assert.match(line, /^step (up|down|left|right) \w+( then (up|down|left|right) \w+)?( then press)?$/);
    assert.match(said.at(-1)!, / then press$/);
    // one line at a time: the next only after the human's "yes"
    assert.equal(r.human.said.filter((t) => t === 'yes').length, said.length - 1);
    assert.equal(r.lines.filter((k) => /^laser-path\.out\.side\.\d$/.test(k)).length, 1);
  }
});

test('AI outside: the human walks straight on and falls; it says so, asks the way again and starts over', () => {
  const r = run('out', laserPathHuman({ slips: 1 }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 1]);
  assert.equal(r.lines.filter((k) => k === 'laser-path.out.fell').length, 1);
  const steps = relays(r).filter((l) => l.startsWith('step'));
  assert.equal(steps.filter((l) => l === steps[0]).length, 2); // the first line again, from the start
});

test('AI outside: the human is silent: it repeats its question about every 20 s and reads no step out', () => {
  const mute: HumanScript<null> = { id: 'laser-path', init: () => null, play: ({ next }) => void next() };
  const r = run('out', mute, { maxMs: 120_000 });
  assert.equal(solved(r), false);
  assert.equal(relays(r).length, 0);
  const asks = saidAt(r, 'laser-path.out.lava');
  assert.ok(asks.length >= 3);
  for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 20_000);
});

test('AI inside: it stays on the ring, goes where the human says and walks only the tiles it is told, to the button', () => {
  for (const startAt of STARTS) {
    const r = run('in', laserPathHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], `start ${startAt}`);
    const path = new Set(pathTiles(r.state).map(String));
    const trod = lavaTrodden(r);
    assert.ok(trod.length > 0);
    for (const t of trod) assert.ok(path.has(String(t)), `stood on lava ${t} that is not on the path`);
    assert.match(r.human.said[0]!, /^face [1-4]$/);
    assert.match(r.human.said[1]!, /^(row|column) \d+$/);
    assert.ok(!r.lines.includes(RELAY));
  }
});

test('AI inside never reads the path: with a silent human it never steps on lava, and asks about every 15 s', () => {
  for (const startAt of STARTS) {
    const r = run('in', laserPathHuman({ mute: true }), { startAt, maxMs: 120_000 });
    assert.deepEqual([solved(r), r.state.strikes], [false, 0]);
    assert.deepEqual(lavaTrodden(r), []);
    const asks = saidAt(r, 'laser-path.in.side');
    assert.ok(asks.length >= 3);
    for (let i = 1; i < asks.length; i++) assert.equal(asks[i]! - asks[i - 1]!, 15_000);
  }
});

test('AI inside: told a wrong step it falls, says so, and walks the path when told again from the start', () => {
  let lied = false;
  const base = laserPathHuman();
  const liar: HumanScript<unknown> = {
    ...(base as HumanScript<unknown>),
    play(ctx) {
      // the first steps the human would say are swapped for "straight on": into the lava
      const say = ctx.say;
      base.play({ ...ctx, say: (text: string) => say(!lied && /^(up|down|left|right) \d/.test(text) ? ((lied = true), `${text.split(' ')[0]} 9`) : text) } as never);
    },
  };
  const r = run('in', liar);
  assert.deepEqual([solved(r), r.state.strikes], [true, 1]);
  assert.equal(r.lines.filter((k) => k === 'laser-path.in.fell').length, 1);
});

test('AI inside: "which way now?" after 15 s of silence in the middle of the path', () => {
  let said = 0;
  const base = laserPathHuman();
  const stalls: HumanScript<unknown> = {
    ...(base as HumanScript<unknown>),
    play(ctx) {
      // answers everything up to the first line of steps, then goes quiet
      if (said >= 3) return void ctx.next();
      base.play({ ...ctx, say: (text: string) => (said++, ctx.say(text)) } as never);
    },
  };
  const r = run('in', stalls, { maxMs: 150_000 });
  assert.deepEqual([solved(r), r.state.strikes], [false, 0]);
  assert.ok(saidAt(r, 'laser-path.in.done').length === 1);
  const asks = saidAt(r, 'laser-path.in.ask');
  assert.ok(asks.length >= 2);
  assert.equal(asks[1]! - asks[0]!, 15_000);
});
