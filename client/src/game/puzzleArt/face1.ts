import { C } from '../../style/tokens';
import type { Draw, Rect, Sprite } from './common';

// Face 1 (hidden-code): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.
// The inside keypad (key, display) is in ./common.ts.

/** One daisy: four petals round a centre at x,y. */
function daisy(rect: Rect, x: number, y: number, petal: string): void {
  rect(x, y - 1, 1, 3, petal);
  rect(x - 1, y, 3, 1, petal);
  rect(x, y, 1, 1, C.amber);
}

/**
 * One tile of the number in the grass (outside). It has to pass for terrain and still read
 * as a filled tile from across the face: a patch of flowers, a rock, or worn ground.
 */
function codeMark(rect: Rect, state: string): void {
  if (state === 'rock') {
    rect(3, 6, 10, 7, C.ink);
    rect(4, 5, 8, 9, C.ink);
    rect(4, 6, 8, 6, C.silver);
    rect(5, 6, 5, 2, C.mist);
    rect(4, 10, 8, 2, C.slate);
    rect(9, 8, 2, 2, C.slate);
    rect(6, 7, 2, 1, C.white);
  } else if (state === 'path') {
    rect(2, 4, 12, 9, C.sandDark);
    rect(3, 3, 10, 11, C.sandDark);
    rect(3, 5, 10, 7, C.sand);
    rect(5, 4, 6, 1, C.sand);
    rect(5, 7, 2, 1, C.mud);
    rect(9, 10, 2, 1, C.mud);
    rect(10, 6, 1, 1, C.mud);
    rect(4, 10, 1, 1, C.mud);
  } else {
    // stems first, so the petals sit on top
    for (const [x, y] of [[4, 5], [11, 4], [7, 9], [3, 12], [12, 11]] as const) rect(x, y + 1, 1, 3, C.greenDark);
    daisy(rect, 4, 4, C.white);
    daisy(rect, 11, 3, C.lemon);
    daisy(rect, 7, 8, C.white);
    daisy(rect, 3, 11, C.lemon);
    daisy(rect, 12, 10, C.white);
  }
}

export const DRAW: Record<string, Draw> = { 'code-mark': codeMark };

export const SPRITES: readonly Sprite[] = [
  { type: 'code-mark', state: 'flower' },
  { type: 'code-mark', state: 'rock' },
  { type: 'code-mark', state: 'path' },
];
