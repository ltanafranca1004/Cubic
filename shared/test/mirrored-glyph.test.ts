import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, createGame, defaultEnv, isSolidTile, objectiveFor, onRing, visibleObjects, type GameState } from '../src/index';
import { GLYPH, GLYPH_CLEAR, GLYPH_TILES, mirroredGlyph } from '../src/puzzles/mirroredGlyph';
import { keyOf, type XY } from '../src/puzzles/util';
import { solver, type Solver } from './harness';

// Mirrored Glyph (face 3): the outside player sees a fixed symbol, the inside player flips
// floor tiles until the same canonical tiles are on.

const FACE = 3;
const play = () => {
  const state = createGame(0);
  return { state, t: solver(state) };
};
/** The inside player walks to a tile of the face and presses E. */
const press = (t: Solver, tile: XY) => {
  t.go('in', { face: FACE, x: tile.x, y: tile.y });
  return t.interact('in');
};
const inside = (state: GameState) => visibleObjects(state, 'in', FACE);
const flipped = (state: GameState) => inside(state).filter((o) => o.type === 'f3-tile' && o.state !== 'off').map(keyOf).sort();
const solved = (state: GameState) => state.solved.includes(FACE);
const want = GLYPH_TILES.map(keyOf).sort();

test('mirrored-glyph: the symbol is the designed one, row for row', () => {
  assert.deepEqual(GLYPH, [
    '...#######..',
    '............',
    '....#####...',
    '...#.....#..',
    '.###..##..#.',
    '##..#....#..',
    '.....####...',
    '.....###....',
    '....##.##...',
    '.#..#..##...',
    '#..##..#....',
    '.###...#....',
  ]);
  assert.deepEqual(GLYPH.map((row) => [...row].filter((ch) => ch === '#').length), [7, 0, 5, 2, 6, 4, 4, 3, 4, 4, 4, 4]);
  assert.equal(GLYPH_TILES.length, 47);
  assert.ok(!GLYPH_TILES.some((g) => g.x === GLYPH_CLEAR.x && g.y === GLYPH_CLEAR.y), 'CLEAR is not a symbol tile');
});

test('mirrored-glyph: outside sees only the symbol, inside sees only tiles and CLEAR', () => {
  const { state, t } = play();
  const out = visibleObjects(state, 'out', FACE);
  assert.deepEqual(out.map((o) => o.type), Array(47).fill('f3-glyph'));
  assert.deepEqual(out.map(keyOf).sort(), want);
  const tiles = inside(state);
  assert.equal(tiles.length, FACE_SIZE * FACE_SIZE);
  assert.deepEqual(tiles.filter((o) => o.type === 'clear').map(keyOf), [keyOf(GLYPH_CLEAR)]);
  assert.ok(tiles.every((o) => o.type === 'clear' || (o.type === 'f3-tile' && o.state === 'off')), 'nothing inside gives the symbol away');
  // what the inside player flips never shows outside
  press(t, { x: 2, y: 2 });
  assert.deepEqual(flipped(state), ['2,2']);
  assert.deepEqual(visibleObjects(state, 'out', FACE), out);
  // each side is told its own job
  t.go('out', { face: FACE, x: 5, y: 5 });
  assert.match(objectiveFor(state, 'out'), /drawing/);
  assert.match(objectiveFor(state, 'in'), /glow/);
});

test('mirrored-glyph: E flips the tile under the inside player, and flips it back', () => {
  const { state, t } = play();
  assert.ok(press(t, { x: 4, y: 6 }).some((e) => e.type === 'puzzle' && e.name === 'toggle'));
  assert.deepEqual(flipped(state), ['4,6']);
  // flipped tiles are walked over like any other
  t.go('in', { face: FACE, x: 6, y: 6 });
  t.go('in', { face: FACE, x: 4, y: 6 });
  t.interact('in');
  assert.deepEqual(flipped(state), []);
  // the outside player has no tiles to flip
  t.go('out', { face: FACE, x: 4, y: 6 });
  t.interact('out');
  assert.deepEqual(flipped(state), []);
  assert.equal(state.strikes, 0);
});

test('mirrored-glyph: flipping exactly the symbol solves it, then the tiles lock', () => {
  const { state, t } = play();
  for (const tile of GLYPH_TILES.slice(0, -1)) press(t, tile);
  assert.equal(solved(state), false, 'one tile missing');
  const last = press(t, GLYPH_TILES.at(-1)!);
  assert.ok(last.some((e) => e.type === 'puzzle' && e.name === 'chime'));
  assert.ok(solved(state));
  assert.deepEqual(flipped(state), want);
  assert.ok(inside(state).every((o) => o.type !== 'f3-tile' || o.state === (want.includes(keyOf(o)) ? 'done' : 'off')));
  assert.equal(state.strikes, 0);
  // after the solve nothing changes: not a symbol tile, not another tile, not CLEAR
  const before = JSON.stringify(state.puzzles[mirroredGlyph.id]);
  for (const tile of [GLYPH_TILES[0]!, { x: 5, y: 1 }, GLYPH_CLEAR]) {
    const evs = press(t, tile);
    assert.ok(!evs.some((e) => e.type === 'puzzle'), 'a locked tile makes no sound');
  }
  assert.equal(JSON.stringify(state.puzzles[mirroredGlyph.id]), before);
  assert.equal(t.events.filter((e) => e.type === 'solve').length, 1);
});

test('mirrored-glyph: one extra tile does not solve, taking it back does', () => {
  const { state, t } = play();
  press(t, { x: 5, y: 1 }); // not part of the symbol
  for (const tile of GLYPH_TILES) press(t, tile);
  assert.equal(solved(state), false);
  assert.equal(flipped(state).length, 48);
  press(t, { x: 5, y: 1 });
  assert.ok(solved(state));
});

test('mirrored-glyph: CLEAR empties the pattern and is never flipped itself', () => {
  const { state, t } = play();
  for (const tile of GLYPH_TILES.slice(0, 5)) press(t, tile);
  assert.equal(flipped(state).length, 5);
  assert.ok(press(t, GLYPH_CLEAR).some((e) => e.type === 'puzzle' && e.name === 'toggle'));
  assert.deepEqual(flipped(state), []);
  press(t, GLYPH_CLEAR);
  assert.deepEqual(flipped(state), []);
  assert.deepEqual(inside(state).filter((o) => o.x === GLYPH_CLEAR.x && o.y === GLYPH_CLEAR.y).map((o) => o.type), ['clear']);
  assert.equal(solved(state), false);
});

test('mirrored-glyph: nothing blocks, on the ring or anywhere on the symbol', () => {
  assert.equal(mirroredGlyph.isBlocked, undefined, 'the puzzle has no blocker at all');
  const { world } = defaultEnv;
  for (let y = 0; y < FACE_SIZE; y++)
    for (let x = 0; x < FACE_SIZE; x++) {
      assert.equal(isSolidTile(world, 'in', FACE, x, y), false, `inside ${x},${y} is floor`);
      if (onRing(x, y) || GLYPH[y]![x] === '#') assert.equal(isSolidTile(world, 'out', FACE, x, y), false, `outside ${x},${y} must be walkable`);
    }
  // both players can stand on every symbol tile, before and after the solve
  const { state, t } = play();
  for (const tile of GLYPH_TILES) press(t, tile);
  assert.ok(solved(state));
  for (const tile of GLYPH_TILES) t.go('out', { face: FACE, x: tile.x, y: tile.y });
  for (let i = 0; i < FACE_SIZE; i++) for (const tile of [{ x: i, y: 0 }, { x: i, y: 11 }, { x: 0, y: i }, { x: 11, y: i }]) t.go('in', { face: FACE, ...tile });
});
