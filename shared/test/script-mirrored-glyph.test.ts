import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, isVocab, mirroredGlyphScript, observe, parseHuman, parseRow, rowPieces, visibleObjects, type Side, type Vec } from '../src/index';
import { GLYPH, GLYPH_TILES } from '../src/puzzles/mirroredGlyph';
import { mirroredGlyphHuman } from './humans/mirroredGlyph';
import { play, STEP_MS, type HumanScript, type Played } from './partnerSim';

// The AI partner on face 3 (mirrored-glyph), either side, against a simulated human,
// through the real engine. No server, no network, no model.

const FACE = 3;
const solved = (r: Played) => r.state.solved.includes(FACE);
const run = (aiSide: Side, human: HumanScript<unknown> | HumanScript<never>, opts: { maxMs?: number; state?: Played['state']; until?: (s: Played['state']) => boolean } = {}) =>
  play(aiSide, { humans: [human as HumanScript<unknown>], scripts: [mirroredGlyphScript], order: [FACE], until: (s) => s.solved.includes(FACE), maxMs: 600_000, ...opts });
const relays = (r: Played) => r.decisions.flatMap((d) => d.say).filter((s) => s.key === 'mirrored-glyph.relay').map((s) => String(s.args!.words));
const saidAt = (r: Played, key: string) => r.decisions.flatMap((d, i) => (d.say.some((s) => s.key === key) ? [(i + 1) * STEP_MS] : []));
/** The tiles that are flipped on, as the inside player sees them: "x,y". */
const flipped = (s: Played['state']) =>
  visibleObjects(s, 'in', FACE)
    .filter((o) => o.type === 'f3-tile' && o.state !== 'off')
    .map((o) => `${o.x},${o.y}`)
    .sort();
const rowOf = (y: number) => ({ y, xs: GLYPH_TILES.filter((t) => t.y === y).map((t) => t.x) });

test('the row convention: every row of the symbol goes to vocabulary pieces and back, and typed rows parse', () => {
  GLYPH.forEach((_, y) => {
    const pieces = rowPieces(rowOf(y));
    assert.ok(pieces.every(isVocab), pieces.join(' '));
    assert.ok(pieces.join(' ').length <= 80);
    assert.deepEqual(parseRow(pieces.join(' ')), rowOf(y));
  });
  assert.deepEqual(rowPieces({ y: 0, xs: [3, 4, 5, 6, 7, 8, 9] }), ['row', 'one', 'skip', 'three', 'flip', 'seven']);
  assert.deepEqual(rowPieces({ y: 1, xs: [] }), ['row', 'two', 'skip']);
  assert.deepEqual(rowPieces({ y: 5, xs: [0, 1, 4, 9] }), ['row', 'six', 'flip', 'two', 'skip', 'two', 'flip', 'one', 'skip', 'four', 'flip', 'one']);
  assert.deepEqual(parseRow('row 3: skip 4 flip 5'), { y: 2, xs: [4, 5, 6, 7, 8] });
  assert.deepEqual(parseRow('Row 10, skip 1, flip 1, skip 2, flip 1'), { y: 9, xs: [1, 4] });
  assert.deepEqual(parseRow('row two skip'), { y: 1, xs: [] });
  assert.deepEqual(parseRow('flip 2 skip 1 flip'), null); // no row named and none expected
  assert.deepEqual(parseRow('flip 2 skip 1 flip', 4), { y: 4, xs: [0, 1, 3] });
  for (const not of ['row 3', 'hello', 'row 13 skip', 'row 1 skip 9 flip 9', 'ok on it']) assert.equal(parseRow(not, null), null, not);
  for (const line of ['row 3: skip 4 flip 5', 'row 10 skip', 'row twelve skip one flip three', 'clear', 'reset']) assert.ok(parseHuman(line).plain, line);
});

test('AI outside: it reads the symbol out one row per line and the human inside copies it', () => {
  const r = run('out', mirroredGlyphHuman());
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.deepEqual(relays(r), GLYPH.map((_, y) => rowPieces(rowOf(y)).join(' ')));
  assert.equal(r.lines.filter((k) => k === 'mirrored-glyph.out.intro').length, 1);
  assert.ok(r.decisions.every((d) => d.action?.type !== 'use'));
});

test('AI outside: it reads the same rows with its view turned, repeats on "again", jumps on "row 5"', () => {
  for (const up of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as Vec[]) {
    const state = createGame(1_700_000_000_000);
    state.players.out.pose = { ...state.players.out.pose, face: FACE, up };
    state.players.in.pose = { ...state.players.in.pose, face: FACE };
    const r = run('out', mirroredGlyphHuman({ again: 2 }), { state, maxMs: 10_000 });
    assert.deepEqual(relays(r).slice(0, 3), Array(3).fill(rowPieces(rowOf(0)).join(' ')), `drift ${observe(state, 'out').compassDrift}`);
  }
  const lines = ['row 5', 'next', 'row twelve', 'ok', 'again'];
  const talker: HumanScript<{ n: number }> = {
    id: 'mirrored-glyph',
    init: () => ({ n: 0 }),
    play(ctx) {
      const heard = ctx.next();
      if ((heard?.key === 'mirrored-glyph.relay' || heard?.key === 'mirrored-glyph.out.done') && ctx.mem.n < lines.length) ctx.say(lines[ctx.mem.n++]!);
    },
  };
  const t = run('out', talker, { maxMs: 20_000 });
  assert.deepEqual(relays(t), [0, 4, 5, 11, 11].map((y) => rowPieces(rowOf(y)).join(' ')));
  assert.deepEqual(t.lines.filter((k) => k.startsWith('mirrored-glyph.out')), ['mirrored-glyph.out.intro', 'mirrored-glyph.out.done']);
});

test('AI inside: it flips exactly the rows the human describes and asks for the next after each', () => {
  for (const colon of [false, true]) {
    const r = run('in', mirroredGlyphHuman({ colon }));
    assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
    assert.equal(r.human.said.length, 12);
    assert.equal(r.lines.filter((k) => k === 'mirrored-glyph.in.next').length, 11); // the twelfth row solves it
    assert.ok(!r.lines.includes('mirrored-glyph.in.cleared'));
  }
  // with its view turned: the same tiles
  for (const up of [[1, 0, 0], [-1, 0, 0], [0, -1, 0]] as Vec[]) {
    const state = createGame(1_700_000_000_000);
    state.players.in.pose = { ...state.players.in.pose, face: FACE, up };
    state.players.out.pose = { ...state.players.out.pose, face: FACE };
    assert.notEqual(observe(state, 'in').compassDrift, 0);
    assert.ok(solved(run('in', mirroredGlyphHuman(), { state })));
  }
});

test('AI inside: it does nothing before the human speaks, asks after about 15 s, and does only what it was told', () => {
  const r = run('in', mirroredGlyphHuman({ mute: true }), { maxMs: 120_000 });
  assert.equal(solved(r), false);
  assert.deepEqual(flipped(r.state), []);
  const first = r.decisions.findIndex((d) => d.status === 'waiting for the partner to describe a row');
  assert.ok(first >= 0);
  assert.ok(r.decisions.slice(first).every((d) => d.action === null), 'it moved or pressed something');
  const asks = saidAt(r, 'mirrored-glyph.in.ask').map((t) => t - (first + 1) * STEP_MS);
  assert.ok(asks[0]! >= 15_000 && asks[0]! <= 16_000, `first ask after ${asks[0]} ms`);
  assert.equal(asks[1]! - asks[0]!, 20_000);

  // three rows said, three rows flipped, nothing else
  const some = run('in', mirroredGlyphHuman({ rows: 3 }), { maxMs: 120_000 });
  assert.equal(solved(some), false);
  assert.deepEqual(flipped(some.state), GLYPH_TILES.filter((t) => t.y < 3).map((t) => `${t.x},${t.y}`).sort());
  assert.ok(some.lines.includes('mirrored-glyph.in.ask')); // and then it asks for more

  // a human who describes another symbol gets that symbol, not the real one
  const lie = run('in', mirroredGlyphHuman({ lie: true }), { maxMs: 400_000 });
  assert.equal(solved(lie), false);
  assert.equal(lie.human.said.length, 12);
  assert.deepEqual(flipped(lie.state), GLYPH_TILES.filter((t) => t.x + 1 < 11).map((t) => `${t.x + 1},${t.y}`).sort());
});

test('AI inside: CLEAR only when the human says "clear", then it starts over', () => {
  const r = run('in', mirroredGlyphHuman({ clearAfter: 2 }));
  assert.deepEqual([solved(r), r.state.strikes], [true, 0]);
  assert.equal(r.lines.filter((k) => k === 'mirrored-glyph.in.cleared').length, 1);
  assert.equal(r.human.said.filter((l) => l === 'clear').length, 1);
  assert.equal(r.human.said.length, 3 + 1 + 12);
  // the CLEAR tile was pressed once
  const clears = r.decisions.filter((d) => d.action?.type === 'use' && d.action.object === 'clear');
  assert.ok(clears.length > 0);
  const plain = run('in', mirroredGlyphHuman());
  assert.ok(plain.decisions.every((d) => !(d.action?.type === 'use' && d.action.object === 'clear')));
});
