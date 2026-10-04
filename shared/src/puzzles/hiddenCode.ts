import { keyAt, keypadLock, keypadUse, keypadVisible, newKeypad, type KeypadState } from './lib/keypad';
import type { PuzzleModule, VisibleObject } from './types';
import type { XY } from './util';

// HIDDEN CODE (face 1: Grass outside, Keypad room inside).
// Outside: a 3-digit number, different every game, is laid out in the grass: each digit is
// a 3x5 block of tiles, and the tiles of a digit are flowers, rocks or worn ground. The
// sprites stand upright but the arrangement turns with the outside player's compass drift,
// so the number only reads right when their view is upright (upside down a 6 is a 9).
// Inside: a floor keypad. Step on a key and press E to type, ENTER to submit. A wrong code
// is a strike and clears the display; the right one turns the keypad green for good.
//
// Map objects used: inside "key" (named "0".."9" and "enter") and "display" (three). The
// number has no map objects: its tiles come from visible(), for the outside only, inside
// the block CODE_ORIGIN + CODE_W x CODE_H (kept floor and free of decor on the map).
// Nothing here blocks: the number is walked over.

const FACE = 1;

/** The digits 0-9 as 3x5 tiles, `#` = a marked tile. The same shapes as the keypad's keys. */
export const CODE_FONT: readonly (readonly string[])[] = [
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
export const CODE_DIGITS = 3;
const GLYPH_W = 3;
const GLYPH_H = 5;
/** One empty column between two digits. */
const PITCH = GLYPH_W + 1;
/** The block the number is laid out in: 11 x 5 tiles from CODE_ORIGIN (its top left). */
export const CODE_W = CODE_DIGITS * PITCH - 1;
export const CODE_H = GLYPH_H;
export const CODE_ORIGIN: XY = { x: 0, y: 2 };
/** The object type of one tile of the number. Its state is one of CODE_LOOKS. */
export const CODE_MARK = 'code-mark';
export const CODE_LOOKS = ['flower', 'rock', 'path'] as const;

/** This game's code: the first digit is 1-9, the others 0-9. */
const codeOf = (rand: (...keys: number[]) => number): string => Array.from({ length: CODE_DIGITS }, (_, i) => (i === 0 ? 1 + (rand(FACE, i) % 9) : rand(FACE, i) % 10)).join('');

/** The tiles of the `i`-th digit `digit`, canonical. */
function glyphTiles(digit: number, i: number): XY[] {
  const tiles: XY[] = [];
  CODE_FONT[digit]!.forEach((row, r) => [...row].forEach((ch, c) => ch === '#' && tiles.push({ x: CODE_ORIGIN.x + i * PITCH + c, y: CODE_ORIGIN.y + r })));
  return tiles;
}

/**
 * Read the number back from what a side sees on this face (visibleObjects): the digits, or
 * null when that side sees no number. This is what the outside player does by eye.
 */
export function readCode(objects: readonly VisibleObject[]): string | null {
  const marked = new Set(objects.filter((o) => o.type === CODE_MARK).map((o) => `${o.x},${o.y}`));
  let code = '';
  for (let i = 0; i < CODE_DIGITS; i++) {
    const digit = CODE_FONT.findIndex((rows) => rows.every((row, r) => [...row].every((ch, c) => marked.has(`${CODE_ORIGIN.x + i * PITCH + c},${CODE_ORIGIN.y + r}`) === (ch === '#'))));
    if (digit < 0) return null;
    code += digit;
  }
  return code;
}

interface State {
  pad: KeypadState;
}

export const hiddenCode: PuzzleModule<State> = {
  id: 'hidden-code',
  face: FACE,
  bright: true,

  init: () => ({ pad: newKeypad() }),

  onUse(s, ctx, side, tile) {
    const name = keyAt(ctx.objects('in', FACE, 'key'), tile);
    if (side !== 'in' || name === null) return;
    const res = keypadUse(s.pad, name, CODE_DIGITS);
    if (res.kind === 'none') return;
    ctx.emit('key');
    if (res.kind !== 'submit') return;
    if (res.code === codeOf(ctx.rand)) {
      keypadLock(s.pad, res.code);
      ctx.emit('chime');
    } else ctx.strike(side); // the display is already cleared
  },

  isSolved: (s) => s.pad.locked,

  visible(s, ctx, side) {
    if (side === 'out') {
      // each digit is made of one kind of thing; which digit gets which changes per game
      const turn = ctx.rand(FACE, 100);
      return [...codeOf(ctx.rand)].flatMap((d, i) => glyphTiles(Number(d), i).map((t) => ({ type: CODE_MARK, x: t.x, y: t.y, state: CODE_LOOKS[(i + turn) % CODE_LOOKS.length]! })));
    }
    // The inside view is mirrored: the cell furthest along x is the leftmost on screen, so
    // the first digit goes there and the display reads the way it was typed.
    const cells = [...ctx.objects('in', FACE, 'display')].sort((a, b) => b.x - a.x || a.y - b.y);
    const green = s.pad.locked ? '-green' : '';
    return [
      ...keypadVisible(s.pad, ctx.objects('in', FACE, 'key'), []),
      ...cells.map((o, i) => ({ type: 'display', x: o.x, y: o.y, state: s.pad.typed[i] === undefined ? 'empty' : `${s.pad.typed[i]}${green}` })),
    ];
  },

  objective: (_s, _ctx, side) => (side === 'out' ? 'The grass shifts with your turn. Stand straight to see the truth.' : 'Keys glow when touched. Watch the lights dance.'),
};
