import { FACE_SIZE } from '../types';
import { flipClear, flipEquals, flipHas, flipToggle, newFlipSet, type FlipSet } from './lib/flip';
import type { PuzzleModule, VisibleObject } from './types';
import { at, type XY } from './util';

// MIRRORED GLYPH (face 3: Snow outside, Tile room inside).
// A symbol is carved into the snow outside. The inside of the face is a floor of 12x12
// flip tiles: the inside player stands on a tile and presses E to flip it, and has to copy
// the symbol their partner describes. Both sides use the SAME canonical tiles, so to the
// inside player (who sees the wall from behind) the symbol comes out mirrored.
// The corner tile is CLEAR: E on it turns every tile off. No strikes. Once the flipped
// tiles are exactly the symbol the face is solved and the tiles lock.
//
// Nothing here blocks: the symbol and the tiles are walked over.
// Map objects used: none. The symbol is fixed (GLYPH below) and the tiles cover the face.

const FACE = 3;

/** The symbol, the whole face: `#` = a symbol tile. Canonical, x left to right, y top to bottom. */
export const GLYPH: readonly string[] = [
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
];

/** The symbol's tiles, row by row. */
export const GLYPH_TILES: readonly XY[] = GLYPH.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '#' ? [{ x, y }] : [])));

/** The CLEAR tile (inside). It is never flipped itself. */
export const GLYPH_CLEAR: XY = { x: FACE_SIZE - 1, y: FACE_SIZE - 1 };

interface State {
  /** The tiles the inside player has flipped. */
  on: FlipSet;
  done: boolean;
}

export const mirroredGlyph: PuzzleModule<State> = {
  id: 'mirrored-glyph',
  face: FACE,
  bright: true,

  init: () => ({ on: newFlipSet(), done: false }),

  onUse(s, ctx, side, tile) {
    if (side !== 'in' || s.done) return;
    if (at(GLYPH_CLEAR, tile)) flipClear(s.on);
    else flipToggle(s.on, tile);
    ctx.emit('toggle');
    if (flipEquals(s.on, GLYPH_TILES)) {
      s.done = true;
      ctx.emit('chime');
    }
  },

  isSolved: (s) => s.done,

  visible(s, _ctx, side) {
    if (side === 'out') return GLYPH_TILES.map((t) => ({ type: 'f3-glyph', x: t.x, y: t.y }));
    const tiles: VisibleObject[] = [];
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        if (at(GLYPH_CLEAR, { x, y })) tiles.push({ type: 'clear', x, y });
        else tiles.push({ type: 'f3-tile', x, y, state: !flipHas(s.on, { x, y }) ? 'off' : s.done ? 'done' : 'on' });
      }
    return tiles;
  },

  objective(s, _ctx, side) {
    if (s.done) return 'The symbol matches.';
    return side === 'out' ? 'Describe the symbol to your partner. They see it mirrored.' : 'Flip tiles with E to copy the symbol. CLEAR in the corner resets.';
  },
};
