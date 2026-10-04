import { C } from '../../style/tokens';
import type { Draw, Rect, Sprite } from './common';

// Face 4 (Botanical Mirror): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

/** The five flower colours (FLOWER_COLOURS in shared/src/puzzles/chain.ts): petal, petal shade. */
const PETALS: Record<string, readonly [string, string]> = {
  red: [C.red, C.crimson],
  blue: [C.sky, C.blue],
  yellow: [C.amber, C.amberDark],
  pink: [C.pink, C.berry],
  white: [C.white, C.silver],
};
const COLOURS = Object.keys(PETALS);

/** A clay pot with soil in it. `asleep` is the grey pot that takes nothing yet. */
function clay(rect: Rect, asleep: boolean): void {
  const [rim, body, shade] = asleep ? [C.silver, C.mauve, C.slate] : [C.sandDark, C.copper, C.rust];
  rect(2, 7, 12, 4, C.ink);
  rect(3, 10, 10, 6, C.ink);
  rect(3, 8, 10, 2, rim);
  rect(4, 8, 8, 1, C.mud);
  rect(4, 10, 8, 5, body);
  rect(4, 10, 8, 1, shade);
  rect(10, 11, 2, 4, shade);
  rect(5, 11, 1, 3, rim);
}

/** A flower standing in the pot: a stem, two leaves and a head of `colour`. */
function flower(rect: Rect, colour: string): void {
  const [petal, shade] = PETALS[colour] ?? PETALS.red!;
  rect(7, 5, 2, 4, C.greenDark);
  rect(5, 6, 2, 1, C.green);
  rect(9, 7, 2, 1, C.green);
  rect(5, 0, 6, 6, C.ink);
  rect(4, 1, 8, 4, C.ink);
  rect(6, 1, 4, 4, petal);
  rect(5, 2, 6, 2, petal);
  rect(6, 4, 4, 1, shade);
  rect(7, 2, 2, 2, colour === 'yellow' ? C.rust : C.lemon);
}

/** An outside pot: `empty`, `locked` (asleep until face 6 is solved) or `bloom-<colour>`. */
function pot(rect: Rect, state: string): void {
  clay(rect, state === 'locked');
  if (state.startsWith('bloom-')) flower(rect, state.slice(6));
}

/** An inside pot: the flower of one colour. The state is the colour. */
function flowerpot(rect: Rect, state: string): void {
  clay(rect, false);
  flower(rect, state);
}

export const DRAW: Record<string, Draw> = { 'f4-pot': pot, 'f4-flowerpot': flowerpot };

export const SPRITES: readonly Sprite[] = [
  { type: 'f4-pot', state: 'empty' },
  { type: 'f4-pot', state: 'locked' },
  ...COLOURS.map((c) => ({ type: 'f4-pot', state: `bloom-${c}` })),
  ...COLOURS.map((c) => ({ type: 'f4-flowerpot', state: c })),
];
