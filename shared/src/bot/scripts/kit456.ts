import { FACE_SIZE } from '../../types';
import type { Observation } from '../observe';
import { DIRS, type Dir } from '../talk';
import { VOCAB_COLOURS, VOCAB_SYMBOLS } from '../vocab';
import { dirOf, throughWall, type Cell } from './grid';
import { cellOf, numberOf, wordsOf } from './relayKit';

// What the scripts of faces 4 to 6 share on top of ./relayKit: reading their own words out
// of a chat line (symbols, colours, rows and columns, steps) and the geometry between my
// screen and the partner's. Everything comes from the observation.

/** How long the relay side waits before it repeats what it is waiting for. */
export const REPEAT_MS = 20_000;

/** The direction on my screen of a one-tile canonical step. */
export function canonDir(o: Observation, dx: number, dy: number): Dir {
  const a = cellOf(o, { x: 5, y: 5 });
  const b = cellOf(o, { x: 5 + dx, y: 5 + dy });
  return dirOf({ col: b.col - a.col, row: b.row - a.row })!;
}

/** Is this screen tile on the outer ring of the face? */
export const onRing = (c: Cell): boolean => c.col === 0 || c.row === 0 || c.col === FACE_SIZE - 1 || c.row === FACE_SIZE - 1;

/**
 * The turn between my screen and the partner's, from one shared direction: `v` is a step
 * on my screen, `said` is the same step on theirs (throughWall in ./grid).
 */
export const turnOf = (v: Cell, said: Dir): number => [0, 1, 2, 3].find((k) => dirOf(throughWall(v, k)) === said) ?? 0;

/** One of my screen tiles as the partner sees it through the wall, `k` quarter turns apart. */
export function partnerCell(c: Cell, k: number): Cell {
  const n = FACE_SIZE - 1;
  const t = throughWall({ col: 2 * c.col - n, row: 2 * c.row - n }, k);
  return { col: (t.col + n) / 2, row: (t.row + n) / 2 };
}

// ---------- reading a chat line ----------

/** The symbol names in a line, in the order they were said. */
export const symbolsIn = (text: string): string[] => wordsOf(text).filter((w) => (VOCAB_SYMBOLS as readonly string[]).includes(w));

/** The (last) colour named in a line, or null. */
export const colourIn = (text: string): string | null => wordsOf(text).filter((w) => (VOCAB_COLOURS as readonly string[]).includes(w)).at(-1) ?? null;

/** "row 4 column 9", "column nine", "col 3 row 2": what was named, 1 to 12. */
export function rowColumnIn(text: string): { row?: number; column?: number } {
  const words = wordsOf(text);
  const out: { row?: number; column?: number } = {};
  words.forEach((w, i) => {
    const n = numberOf(words[i + 1]);
    if (n === null || n < 1 || n > FACE_SIZE) return;
    if (w === 'row') out.row = n;
    if (w === 'column' || w === 'col') out.column = n;
  });
  return out;
}

/** "right 2 then up", "step left three": single steps, in order. */
export function stepsIn(text: string): Dir[] {
  const words = wordsOf(text);
  const out: Dir[] = [];
  words.forEach((w, i) => {
    if (!(DIRS as readonly string[]).includes(w)) return;
    const n = numberOf(words[i + 1]);
    for (let j = 0; j < (n !== null && n >= 1 && n <= FACE_SIZE ? n : 1); j++) out.push(w as Dir);
  });
  return out;
}

/** Steps as runs: [up, up, left] -> [[up, 2], [left, 1]]. */
export function runsOf(steps: readonly Dir[]): [Dir, number][] {
  const out: [Dir, number][] = [];
  for (const d of steps) {
    const last = out.at(-1);
    if (last && last[0] === d) last[1]++;
    else out.push([d, 1]);
  }
  return out;
}
