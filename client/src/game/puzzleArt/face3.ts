import { C } from '../../style/tokens';
import type { Draw, Rect, Sprite } from './common';

// Face 3 (Mirrored Glyph): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

/** One tile of the symbol carved into the snow (outside): dark stone, full tile so neighbours join up. */
function glyph(rect: Rect): void {
  rect(0, 0, 16, 16, C.shadow);
  rect(0, 0, 16, 1, C.ink);
  rect(0, 0, 1, 16, C.ink);
  rect(1, 15, 15, 1, C.slate);
  rect(15, 1, 1, 15, C.slate);
  // chisel marks
  rect(4, 5, 3, 1, C.slate);
  rect(9, 10, 3, 1, C.slate);
  rect(11, 4, 1, 1, C.ink);
  rect(5, 11, 1, 1, C.ink);
}

/** A flip tile of the tile room (inside): `off` face down, `on` flipped, `done` once the symbol matches. */
function tile(rect: Rect, state: string): void {
  const [face, light, dark] = state === 'on' ? [C.amber, C.lemon, C.amberDark] : state === 'done' ? [C.green, C.grass, C.greenDark] : [C.slate, C.mauve, C.shadow];
  rect(0, 0, 16, 16, C.ink);
  rect(1, 1, 14, 14, face);
  rect(1, 1, 14, 1, light);
  rect(1, 1, 1, 14, light);
  rect(1, 14, 14, 1, dark);
  rect(14, 1, 1, 14, dark);
  if (state === 'off') rect(7, 7, 2, 2, dark);
  else rect(5, 5, 6, 6, light);
}

export const DRAW: Record<string, Draw> = { 'f3-glyph': glyph, 'f3-tile': tile };

export const SPRITES: readonly Sprite[] = [
  { type: 'f3-glyph', state: 'default' },
  { type: 'f3-tile', state: 'off' },
  { type: 'f3-tile', state: 'on' },
  { type: 'f3-tile', state: 'done' },
];
