import { C } from '../../style/tokens';

// Sprites more than one face uses: the keypad (keys and display cells), a plain button and
// the RESET / CLEAR tiles. Also the types and the bitmap helper the per-face files share.

/** Fill w x h pixels at x,y with a palette colour. */
export type Rect = (x: number, y: number, w: number, h: number, colour: string) => void;
/** Draws one object type into a 16x16 cell. `state` is the object's state (`default` when it has none). */
export type Draw = (rect: Rect, state: string) => void;
/** One cell of the sheet. The first sprite of a type is also its `default` frame. */
export interface Sprite {
  type: string;
  state: string;
}

/** Rows of `#` and `.` drawn at x,y, `scale` pixels per character. */
export function bitmap(rect: Rect, x: number, y: number, rows: readonly string[], colour: string, scale = 1): void {
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch === '#' && rect(x + c * scale, y + r * scale, scale, scale, colour)));
}

/** The digits 0-9, 3x5. Drawn at 2 pixels per cell on keys and display cells. */
export const DIGITS: readonly (readonly string[])[] = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '###', '..#', '###'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'],
  ['###', '..#', '..#', '..#', '..#'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
];
const DIGIT_NAMES = DIGITS.map((_, n) => String(n));
const ENTER = ['......##', '......##', '..#...##', '.##...##', '########', '########', '.##.....', '..#.....'];

/** A keypad key: `0`..`9` or `enter`. With `-ok` it is green: the code is in and the pad is locked. */
function key(rect: Rect, state: string): void {
  const ok = state.endsWith('-ok');
  const name = ok ? state.slice(0, -3) : state;
  const mark = ok ? C.white : C.ink;
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 11, ok ? C.green : C.mist);
  rect(2, 2, 12, 1, ok ? C.grass : C.white);
  rect(2, 13, 12, 1, ok ? C.slate : C.silver);
  const digit = DIGITS[Number(name)];
  if (name === 'enter') bitmap(rect, 4, 4, ENTER, mark);
  else if (digit) bitmap(rect, 5, 3, digit, mark, 2);
}

/** One cell of the keypad's display: `blank`, or the digit typed into it. */
function display(rect: Rect, state: string): void {
  rect(0, 1, 16, 14, C.ink);
  rect(1, 2, 14, 12, C.shadow);
  const digit = DIGITS[Number(state)];
  if (state !== 'blank' && digit) bitmap(rect, 5, 3, digit, C.lemon, 2);
  else rect(5, 11, 6, 2, C.slate);
}

/** A floor button. `on` once it has been pressed. */
function button(rect: Rect, state: string): void {
  const on = state === 'on';
  rect(3, 4, 10, 9, C.ink);
  rect(4, 3, 8, 11, C.ink);
  rect(4, 5, 8, on ? 8 : 6, on ? C.amberDark : C.slate);
  rect(4, on ? 6 : 4, 8, 6, on ? C.amber : C.silver);
  rect(5, on ? 7 : 5, 3, 1, on ? C.lemon : C.white);
}

/** The RESET tile: puts a puzzle's pieces back where they started. */
function reset(rect: Rect): void {
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, C.blue);
  rect(2, 2, 12, 1, C.sky);
  // an arrow going round
  bitmap(rect, 4, 4, ['..####..', '.#....#.', '#......#', '#......#', '#...#..#', '.#..##..', '..#####.', '....##..'], C.white);
}

/** The CLEAR tile: wipes what has been entered. */
function clear(rect: Rect): void {
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, C.slate);
  rect(2, 2, 12, 1, C.silver);
  bitmap(rect, 4, 4, ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'], C.hotPink);
}

export const DRAW: Record<string, Draw> = { key, display, button, reset, clear };

export const SPRITES: readonly Sprite[] = [
  ...[...DIGIT_NAMES, 'enter'].map((n) => ({ type: 'key', state: n })),
  ...[...DIGIT_NAMES, 'enter'].map((n) => ({ type: 'key', state: `${n}-ok` })),
  { type: 'display', state: 'blank' },
  ...DIGIT_NAMES.map((n) => ({ type: 'display', state: n })),
  { type: 'button', state: 'off' },
  { type: 'button', state: 'on' },
  { type: 'reset', state: 'default' },
  { type: 'clear', state: 'default' },
];
