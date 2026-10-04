import { C } from '../../style/tokens';
import { bitmap, type Draw, type Rect, type Sprite } from './common';

// Face 2 (Equation Safe): the sprites only this face's puzzle uses, both sides.
// Outside, the three things to count. They must not pass for the desert's own cacti, palms,
// dry bushes and pebbles: the bush is round with pink berries, the rock a big grey boulder,
// the bird blue. Inside, the safe and the row carved above it, which shows the SAME three
// pictures on stone plates.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

/** Rows of characters drawn at x,y: each character is a colour of `ink`, anything else is left alone. */
function paint(rect: Rect, x: number, y: number, rows: readonly string[], ink: Readonly<Record<string, string>>): void {
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const colour = ink[ch];
      if (colour) rect(x + c, y + r, 1, 1, colour);
    }),
  );
}

const BUSH = [
  '....######....',
  '..##LLLLLL##..',
  '.#LLLGGpGGGG#.',
  '#LLGpGGGGGGGG#',
  '#LGGGGGGGGpGG#',
  '#GGGGGpGGGGGG#',
  '#GpGGGGGGGGGG#',
  '#GGGGGGGGpGGD#',
  '#DGGGpGGGGGDD#',
  '.#DDDDDDDDDD#.',
  '..##########..',
];
const BUSH_INK = { '#': C.ink, L: C.grass, G: C.green, D: C.greenDark, p: C.hotPink };

/** A round bush with pink berries: one of the things the outside player counts. */
function bush(rect: Rect): void {
  paint(rect, 1, 3, BUSH, BUSH_INK);
}

const ROCK = [
  '....#####.....',
  '..##WWWSS##...',
  '.#WWSSSSSSS#..',
  '.#WSSSSSSSSS#.',
  '#SSSSS#SSSSSM#',
  '#SSSSSS#SSSMM#',
  '#SSSSSSSSSMMM#',
  '#MSSSSSSMMMMM#',
  '.#MMMMMMMMMM#.',
  '..##########..',
];
const ROCK_INK = { '#': C.ink, W: C.white, S: C.silver, M: C.mauve };

/** A big grey boulder with a crack: one of the things the outside player counts. */
function rock(rect: Rect): void {
  paint(rect, 1, 4, ROCK, ROCK_INK);
}

const BIRD_UP = [
  '....##........',
  '...#ss#..###..',
  '...#sss##bbb#.',
  '####bssbbbkb#o',
  '#bbbbbbbbbbb#o',
  '.#bbbbwwwb##..',
  '..###wwww#....',
  '....#####.....',
];
const BIRD_DOWN = [
  '..............',
  '.........###..',
  '...######bbb#.',
  '####bbbbbbkb#o',
  '#bbbbbbbbbbb#o',
  '.#bsssbwwb##..',
  '..#sss#ww#....',
  '...###.##.....',
];
const BIRD_INK = { '#': C.ink, k: C.ink, b: C.sky, s: C.blue, w: C.white, o: C.amber };

/** A blue bird, wings `up` or `down`: it hops about, and the outside player counts it too. */
function bird(rect: Rect, state: string): void {
  paint(rect, 1, 4, state === 'down' ? BIRD_DOWN : BIRD_UP, BIRD_INK);
}

/** The safe: `locked`, or `open` once the answer is in (the door swung aside, nothing left inside). */
function safe(rect: Rect, state: string): void {
  const open = state === 'open';
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, C.mauve);
  rect(2, 2, 12, 1, C.silver);
  rect(2, 13, 12, 1, C.slate);
  rect(3, 4, 10, 9, C.ink);
  if (open) {
    rect(4, 5, 6, 7, C.shadow);
    rect(4, 9, 6, 1, C.slate); // the empty shelf
    rect(11, 4, 3, 9, C.silver); // the door, edge on
    rect(12, 5, 1, 7, C.mist);
    rect(7, 2, 2, 1, C.green);
    return;
  }
  rect(4, 5, 8, 7, C.slate);
  rect(4, 5, 8, 1, C.silver);
  rect(6, 7, 4, 4, C.ink);
  rect(7, 8, 2, 2, C.amber); // the dial
  rect(11, 7, 1, 4, C.mist); // the handle
  rect(7, 2, 2, 1, C.red);
}

const TIMES = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'];

/**
 * One tile of the carved row: `three` and `two` (tally marks), `times`, and `bush`, `bird`,
 * `rock`: the pictures the outside player counts, on a stone plate.
 */
function clue(rect: Rect, state: string): void {
  rect(0, 0, 16, 16, C.shadow);
  rect(1, 1, 14, 14, C.slate);
  rect(1, 1, 14, 1, C.mauve);
  if (state === 'three') for (const x of [3, 7, 11]) rect(x, 4, 2, 9, C.mist);
  else if (state === 'two') for (const x of [5, 9]) rect(x, 4, 2, 9, C.mist);
  else if (state === 'times') bitmap(rect, 5, 6, TIMES, C.mist);
  else if (state === 'bush') bush(rect);
  else if (state === 'bird') bird(rect, 'up');
  else if (state === 'rock') rock(rect);
}

export const DRAW: Record<string, Draw> = { 'f2-bush': bush, 'f2-rock': rock, 'f2-bird': bird, 'f2-safe': safe, 'f2-clue': clue };

export const SPRITES: readonly Sprite[] = [
  { type: 'f2-bush', state: 'default' },
  { type: 'f2-rock', state: 'default' },
  { type: 'f2-bird', state: 'up' },
  { type: 'f2-bird', state: 'down' },
  { type: 'f2-safe', state: 'locked' },
  { type: 'f2-safe', state: 'open' },
  ...['three', 'two', 'times', 'bush', 'bird', 'rock'].map((state) => ({ type: 'f2-clue', state })),
];
