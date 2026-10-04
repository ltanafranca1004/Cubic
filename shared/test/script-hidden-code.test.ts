import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, NORMALS, canonOf, canonToScreen, cellOf, compassDrift, createGame, digitsIn, hiddenCodeScript, observe, parseHuman, visibleObjects, type Observation, type Side, type Vec } from '../src/index';
import { readCode } from '../src/puzzles/hiddenCode';
import { hiddenCodeHuman } from './humans/hiddenCode';
import { play, STEP_MS, type HumanScript, type Played } from './partnerSim';

// The AI partner on face 1 (hidden-code), either side, against a simulated human, through
// the real engine. No server, no network, no model.

const FACE = 1;
const solved = (r: Played) => r.state.solved.includes(FACE);
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; startAt?: number } = {}) =>
  play(aiSide, { humans: [human as HumanScript<unknown>], scripts: [hiddenCodeScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: 120_000, ...opts });
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === 'hidden-code.relay').map((s) => String(s.args!.words));
/** When (ms of game time) each line key was said. */
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const spoken = (code: string) => [...code].map((d) => WORDS[Number(d)]).join(' ');

test('relayKit: canonOf / cellOf agree with the cube math on every face, side and turn', () => {
  const ups: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let checked = 0;
  for (const side of ['out', 'in'] as const)
    for (const face of FACES)
      for (const up of ups) {
        const n = NORMALS[face];
        if (up[0] * n[0] + up[1] * n[1] + up[2] * n[2] !== 0) continue;
        const o = { you: side, compassDrift: compassDrift({ face, up }) } as Observation;
        for (const [x, y] of [[0, 0], [3, 7], [11, 2], [5, 5]] as const) {
          const [col, row] = canonToScreen(side, face, up, x, y);
          assert.deepEqual(cellOf(o, { x, y }), { col, row });
          assert.deepEqual(canonOf(o, { col, row }), { x, y });
          checked++;
        }
      }
  assert.equal(checked, 2 * 6 * 4 * 4);
  assert.equal(compassDrift({ face: 1, up: CANON_UP[1] }), 0);
});

test('digitsIn: the ways a person says three digits', () => {
  assert.equal(digitsIn('4 7 2'), '472');
  assert.equal(digitsIn('472'), '472');
  assert.equal(digitsIn('four seven two'), '472');
  assert.equal(digitsIn('the code is 4, 7, 2'), '472');
  assert.equal(digitsIn('first digit is nine'), '9');
  assert.equal(digitsIn('0'), '0');
  assert.equal(digitsIn('give me 2 minutes'), null);
  assert.equal(digitsIn('hello'), null);
  // none of these earns a "huh": they are plain protocol lines
  for (const line of ['4 7 2', '472', 'four seven two', 'nine zero one', 'the code is 4 7 2', '0']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it reads the number out in vocabulary pieces and the human inside types it', () => {
  for (const startAt of [1_700_000_000_000, 1_700_000_123_456, 1_700_000_999_999]) {
    const r = run('out', hiddenCodeHuman(), { startAt });
    assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
    const code = readCode(visibleObjects(r.state, 'out', FACE))!;
    assert.deepEqual(relays(r), [`the code is ${spoken(code)}`]);
    assert.equal(r.lines.filter((k) => k === 'hidden-code.out.intro').length, 1);
    assert.ok(!r.lines.includes('unknown'));
  }
});

test('AI outside: it reads the number right with its view turned (upside down a 6 is a 9)', () => {
  const drifts: number[] = [];
  for (const up of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as Vec[]) {
    // the outside player has come onto face 1 over another edge: same tile, the view turned
    const state = createGame(1_700_000_000_000);
    state.players.out.pose = { ...state.players.out.pose, face: FACE, up };
    drifts.push(observe(state, 'out').compassDrift);
    const code = readCode(visibleObjects(state, 'out', FACE))!;
    const r = play('out', { state, humans: [hiddenCodeHuman()], scripts: [hiddenCodeScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: 120_000 });
    assert.deepEqual([solved(r), r.state.strikes, observe(r.state, 'out').compassDrift], [true, 0, drifts.at(-1)]);
    assert.deepEqual(relays(r), [`the code is ${spoken(code)}`]);
  }
  assert.deepEqual([...drifts].sort((a, b) => a - b), [0, 90, 180, 270]);
});

test('AI outside: it repeats on "again" / "what?" and after a strike', () => {
  const r = run('out', hiddenCodeHuman({ again: 2 }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.equal(relays(r).length, 3);
  assert.equal(new Set(relays(r)).size, 1);
  assert.deepEqual(r.human.said, ['again', 'what?']);

  // a human who fumbles the keypad first (0 + ENTER is never the code: it starts with 1 to 9)
  const good = hiddenCodeHuman();
  interface Fumble {
    fumbled: number;
    inner: ReturnType<typeof good.init>;
  }
  const fumbler: HumanScript<Fumble> = {
    id: 'hidden-code',
    init: () => ({ fumbled: 0, inner: good.init() }),
    play(ctx) {
      if (ctx.mem.fumbled < 2) {
        const key = ctx.seen('key').find((k) => k.state === (ctx.mem.fumbled === 0 ? '0' : 'enter'))!;
        if (ctx.walk(key)) {
          ctx.interact();
          ctx.mem.fumbled++;
          while (ctx.next()); // whatever was said before the strike is forgotten
        }
        return;
      }
      good.play({ ...ctx, mem: ctx.mem.inner });
    },
  };
  const f = run('out', fumbler);
  assert.deepEqual([solved(f), f.state.strikes], [true, 1]);
  assert.equal(relays(f).length, 2); // once on arriving, once more after the strike
});

test('AI inside: it types what the human says, however they say it', () => {
  for (const style of ['spaced', 'joined', 'words', 'single'] as const) {
    const r = run('in', hiddenCodeHuman({ style }));
    assert.deepEqual([solved(r), r.state.strikes], [true, 0], style);
    const code = readCode(visibleObjects(r.state, 'out', FACE))!;
    assert.deepEqual(relays(r), [`press ${spoken(code)}`], style); // it says back what it understood
    assert.ok(r.ms < 30_000, `${style}: ${r.ms} ms`);
  }
});

test('AI inside: it does nothing before the human speaks, asks after about 15 s, and again later', () => {
  for (const startAt of [1_700_000_000_000, 1_700_000_123_456]) {
    const r = run('in', hiddenCodeHuman({ mute: true }), { maxMs: 60_000, startAt });
    assert.equal(solved(r), false);
    assert.equal(r.state.strikes, 0);
    assert.ok(r.decisions.every((d) => d.action === null), 'it moved or pressed something');
    assert.ok(visibleObjects(r.state, 'in', FACE).filter((o) => o.type === 'display').every((o) => o.state === 'empty'));
    const asks = saidAt(r, 'hidden-code.ask.first');
    assert.ok(asks[0]! >= 15_000 && asks[0]! <= 16_000, `first ask at ${asks[0]} ms`);
    assert.equal(asks.length, 3); // 15 s, then every 20 s
    assert.deepEqual(r.lines.filter((k) => k.startsWith('hidden-code.')), Array(3).fill('hidden-code.ask.first'));
  }
  // a human who answers the question, one digit at a time, then stops after the first: it asks for the next
  const shy = run('in', hiddenCodeHuman({ shy: true, style: 'single' }));
  assert.deepEqual([solved(shy), shy.state.strikes], [true, 0]);
  const one: HumanScript<{ said: boolean }> = {
    id: 'hidden-code',
    init: () => ({ said: false }),
    play(ctx) {
      if (!ctx.mem.said) ctx.say(readCode(ctx.seen('code-mark'))![0]!);
      ctx.mem.said = true;
    },
  };
  const half = run('in', one, { maxMs: 40_000 });
  assert.equal(solved(half), false);
  assert.ok(half.decisions.every((d) => d.action === null));
  assert.ok(saidAt(half, 'hidden-code.ask.next')[0]! <= 16_500);
  assert.equal(saidAt(half, 'hidden-code.ask.first').length, 0);
});

test('AI inside: it has no way to the number but the human: a wrong number said is a wrong number typed', () => {
  const r = play('in', { humans: [hiddenCodeHuman({ lie: true })], scripts: [hiddenCodeScript], order: [FACE], until: (s) => s.strikes > 0, maxMs: 60_000 });
  assert.equal(solved(r), false);
  assert.equal(r.state.strikes, 1);
  const code = readCode(visibleObjects(r.state, 'out', FACE))!;
  const lie = [...code].map((d) => (Number(d) + 1) % 10).join('');
  assert.deepEqual(relays(r), [`press ${spoken(lie)}`]);
  // and it says so and asks again instead of trying something of its own
  const more = play('in', { humans: [hiddenCodeHuman({ lie: true })], scripts: [hiddenCodeScript], order: [FACE], until: (s) => s.strikes > 1, maxMs: 25_000 });
  assert.ok(more.lines.includes('hidden-code.wrong'));
  assert.equal(solved(more), false);
});
