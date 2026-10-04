import { C } from '../../style/tokens';
import { bitmap, type Draw, type Rect, type Sprite } from './common';

// Face 5 (Sequence Laser): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

/** The seven symbols, 8x8. The names are the states of `f5-symbol` (and `<name>-lit`). */
const SYMBOLS: Record<string, readonly string[]> = {
  sun: ['#..##..#', '.#....#.', '..####..', '#.####.#', '#.####.#', '..####..', '.#....#.', '#..##..#'],
  moon: ['..####..', '.###....', '###.....', '###.....', '###.....', '###.....', '.###...#', '..#####.'],
  star: ['...##...', '...##...', '########', '.######.', '..####..', '.######.', '.##..##.', '##....##'],
  bolt: ['....###.', '...###..', '..###...', '.######.', '...###..', '..###...', '.###....', '.#......'],
  drop: ['...##...', '...##...', '..####..', '.######.', '########', '########', '.######.', '..####..'],
  leaf: ['.....###', '...#####', '..######', '.######.', '.#####..', '.####...', '.#......', '#.......'],
  eye: ['........', '..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..', '........'],
};
const NAMES = Object.keys(SYMBOLS);

/** A symbol tile: dark, or `-lit` (outside: its turn in the sequence; inside: pressed). */
function symbol(rect: Rect, state: string): void {
  const lit = state.endsWith('-lit');
  const rows = SYMBOLS[lit ? state.slice(0, -4) : state] ?? SYMBOLS.sun!;
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, lit ? C.amber : C.shadow);
  rect(2, 2, 12, 1, lit ? C.lemon : C.slate);
  bitmap(rect, 4, 4, rows, lit ? C.white : C.silver);
}

/** The REPLAY tile: shows the sequence again. `on` once the laser has power. */
function replay(rect: Rect, state: string): void {
  const on = state === 'on';
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, on ? C.green : C.slate);
  rect(2, 2, 12, 1, on ? C.grass : C.silver);
  // a play triangle
  bitmap(rect, 5, 4, ['##....', '####..', '######', '######', '######', '####..', '##....'], on ? C.white : C.mist);
}

/** The laser emitter: `dead` (an empty battery slot), `powered`, `firing`. */
function emitter(rect: Rect, state: string): void {
  rect(2, 2, 12, 12, C.ink);
  rect(3, 1, 10, 14, C.ink);
  rect(3, 3, 10, 10, C.slate);
  rect(3, 3, 10, 1, C.silver);
  // the lens
  rect(5, 5, 6, 6, C.ink);
  rect(6, 6, 4, 4, state === 'firing' ? C.red : state === 'powered' ? C.maroon : C.shadow);
  if (state === 'firing') {
    rect(7, 7, 2, 2, C.white);
    rect(7, 0, 2, 5, C.red);
    rect(7, 11, 2, 5, C.red);
    rect(0, 7, 5, 2, C.red);
    rect(11, 7, 5, 2, C.red);
  }
  // the power light
  rect(11, 12, 2, 1, state === 'dead' ? C.maroon : C.green);
}

export const DRAW: Record<string, Draw> = { 'f5-symbol': symbol, 'f5-replay': replay, 'f5-emitter': emitter };

export const SPRITES: readonly Sprite[] = [
  ...NAMES.map((n) => ({ type: 'f5-symbol', state: n })),
  ...NAMES.map((n) => ({ type: 'f5-symbol', state: `${n}-lit` })),
  { type: 'f5-replay', state: 'off' },
  { type: 'f5-replay', state: 'on' },
  { type: 'f5-emitter', state: 'dead' },
  { type: 'f5-emitter', state: 'powered' },
  { type: 'f5-emitter', state: 'firing' },
];
