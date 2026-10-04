import { FACE_SIZE } from '../../types';
import type { Observation } from '../observe';
import { relayText, VOCAB_NUMBERS } from '../vocab';
import type { Cell } from './grid';
import type { ScriptCtx } from './types';

// What the scripts of faces 1 to 3 share: saying a relay line from vocabulary pieces,
// reading numbers out of a chat line, noticing a silent human, and turning the bot's own
// screen tiles into the face's canonical tiles (the tiles both players can count).

/** How long the doing side waits for the human's words before it asks. */
export const ASK_MS = 15_000;
/** How long before it asks again. */
export const REASK_MS = 20_000;

/**
 * Say a relay line: `pieces` are vocabulary pieces only (../vocab.ts; relayText throws on
 * anything else). The key's words are '{words}', so the caption is the pieces joined and
 * the voice is the banked clips chained. Forced: a relay is said because something asked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const relay = (ctx: ScriptCtx<any>, key: string, pieces: readonly string[]): boolean => ctx.say(key, { force: true, args: { words: relayText(pieces) } });

/** The words of a chat line: lower case, no punctuation. */
export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** A word as a number: "7", "12", "seven", "twelve". null = not a number. */
export function numberOf(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (/^\d{1,4}$/.test(word)) return Number(word);
  const i = (VOCAB_NUMBERS as readonly string[]).indexOf(word);
  return i < 0 ? null : i;
}

/** Words that may stand around numbers without changing what a line means. */
const AROUND = new Set('a an and the it its is are says say reads then so i see there of code number numbers digit digits first second third next last one'.split(' '));
/** Every word is a number, one of `own` or a filler: the line is about numbers and nothing else. */
export const onlyNumbersAnd = (words: readonly string[], own: readonly string[] = []): boolean => words.every((w) => numberOf(w) !== null || own.includes(w) || AROUND.has(w));

/**
 * Has the human been silent for ASK_MS? `mem.since` is when the script last heard something
 * it could use (or last asked). Call once per play(); `heard` = this turn brought something.
 * After it returns true the next true comes REASK_MS later.
 */
export function silent(mem: { since: number | null }, now: number, heard: boolean): boolean {
  if (mem.since === null || heard) mem.since = now;
  if (now - mem.since < ASK_MS) return false;
  mem.since = now + REASK_MS - ASK_MS;
  return true;
}

/** A canonical tile of a face: x from the outside player's left, y from the top, compass upright. */
export interface Tile {
  x: number;
  y: number;
}

const N = FACE_SIZE - 1;
const turns = (o: Observation) => o.compassDrift / 90;

/**
 * The canonical tile of one of my screen tiles. Upright (drift 0) the outside player's
 * screen IS canonical and the inside player's is mirrored left to right; each quarter turn
 * of drift turns the screen once more (the other way round inside). Checked against
 * canonToScreen for every face and turn in shared/test/script-hidden-code.test.ts.
 */
export function canonOf(o: Observation, c: Cell): Tile {
  let { col, row } = c;
  for (let i = 0; i < turns(o); i++) [col, row] = o.you === 'out' ? [row, N - col] : [N - row, col];
  return { x: o.you === 'out' ? col : N - col, y: row };
}

/** My screen tile of a canonical tile: the inverse of canonOf. */
export function cellOf(o: Observation, t: Tile): Cell {
  let [col, row] = [o.you === 'out' ? t.x : N - t.x, t.y];
  for (let i = 0; i < turns(o); i++) [col, row] = o.you === 'out' ? [N - row, col] : [row, N - col];
  return { col, row };
}
