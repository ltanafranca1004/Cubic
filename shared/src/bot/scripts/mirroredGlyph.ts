import { FACE_SIZE } from '../../types';
import { numberWord } from '../vocab';
import { far } from './grid';
import { canonOf, numberOf, relay, silent, wordsOf } from './relayKit';
import type { Play, PuzzleScript, ScriptCtx } from './types';

// MIRRORED GLYPH (face 3). Outside: a symbol carved in the snow. Inside: 12x12 flip tiles.
//
// THE ROW CONVENTION (both directions, built from vocabulary pieces):
//   "row <n> skip <a> flip <b> skip <c> flip <d> ..."
// Rows are numbered one to twelve from the top. Inside a row the count runs over the
// CANONICAL tiles, x = 0 first: that is from the OUTSIDE player's left, and so from the
// INSIDE player's RIGHT (they see the wall from behind), both with the compass upright.
// "skip a" = leave the next a tiles off, "flip b" = the next b tiles are symbol tiles. A
// row that starts with a symbol tile starts with "flip". Whatever is left after the last
// piece is off. An empty row is "row <n> skip".
//
// AI outside (relay): one row per line, from row one. It cannot see the tiles inside, so it
// moves on when the human says "next" / "ok", repeats on "again" and jumps on "row 5".
// AI inside (doing): it reads the human's rows in the same convention ("row 3: skip 4 flip
// 5" too; a line without "row" is the row after the last one), makes each told row look
// exactly like that with E, then asks for the next. CLEAR only when the human says "clear"
// or "reset". It never sees the symbol: with a silent human it asks after 15 s and flips
// nothing.

export interface GlyphRow {
  /** 0 to 11, top to bottom. */
  y: number;
  /** The canonical x of the symbol tiles in it. */
  xs: number[];
}

/** One row as vocabulary pieces: ['row', 'three', 'skip', 'three', 'flip', 'one', ...]. */
export function rowPieces(row: GlyphRow): string[] {
  const pieces = ['row', numberWord(row.y + 1)];
  if (row.xs.length === 0) return [...pieces, 'skip'];
  const last = Math.max(...row.xs);
  for (let x = 0; x <= last; ) {
    const on = row.xs.includes(x);
    let n = 0;
    while (x <= last && row.xs.includes(x) === on) [x, n] = [x + 1, n + 1];
    pieces.push(on ? 'flip' : 'skip', numberWord(n));
  }
  return pieces;
}

const SKIP = ['skip', 'blank', 'empty'];
const FLIP = ['flip'];

/**
 * Read one row from a line of chat (or from the pieces of a relay line). `next` is the row a
 * line without "row <n>" means. null = the line describes no row.
 */
export function parseRow(text: string, next: number | null = null): GlyphRow | null {
  const words = wordsOf(text);
  const at = words.indexOf('row');
  const named = at < 0 ? null : numberOf(words[at + 1]);
  const y = named === null ? next : named - 1;
  if (y === null || y < 0 || y >= FACE_SIZE) return null;
  const xs: number[] = [];
  let x = 0;
  let ops = 0;
  for (let i = named === null ? 0 : at + 2; i < words.length; i++) {
    const skip = SKIP.includes(words[i]!);
    if (!skip && !FLIP.includes(words[i]!)) continue;
    ops++;
    const n = numberOf(words[i + 1]);
    if (n !== null) i++;
    // "skip" with no number: the rest of the row is off. "flip" with no number: one tile.
    const run = n ?? (skip ? FACE_SIZE - x : 1);
    if (!skip) for (let k = 0; k < run; k++) xs.push(x + k);
    x += run;
  }
  if (ops === 0 || x > FACE_SIZE) return null;
  return { y, xs };
}

/** "row 5" and nothing more: the human wants to hear that row. */
function rowAsked(text: string): number | null {
  const words = wordsOf(text);
  const at = words.indexOf('row');
  const n = at < 0 ? null : numberOf(words[at + 1]);
  return n !== null && n >= 1 && n <= FACE_SIZE ? n - 1 : null;
}

interface Mem {
  /** Outside: the row it is reading out, or -1 before the first. */
  row: number;
  /** Inside: the rows the human described, by y. */
  rows: Record<number, number[]>;
  /** Inside: rows told and not yet reported as done. */
  pending: number[];
  /** Inside: the row a line without a number means. */
  next: number;
  /** Inside: the human said "clear" and the tiles are not all off yet. */
  clearing: boolean;
  /** Inside: an empty row was taken in silence; say "row done" only if the human waits for it. */
  owed: boolean;
  since: number | null;
}

/** After an empty row (nothing to flip) it says nothing, unless the human says nothing either for this long. */
export const EMPTY_ROW_WAIT_MS = 5_000;

const LINES = ['mirrored-glyph.out.intro', 'mirrored-glyph.relay', 'mirrored-glyph.out.done', 'mirrored-glyph.in.ask', 'mirrored-glyph.in.next', 'mirrored-glyph.in.cleared'] as const;

function outside(ctx: ScriptCtx<Mem>): Play | null {
  const { mem } = ctx;
  const symbol = ctx.objs('f3-glyph').map((g) => canonOf(ctx.o, g));
  if (symbol.length === 0) return null;
  const sayRow = (y: number) => {
    mem.row = y;
    relay(ctx, 'mirrored-glyph.relay', rowPieces({ y, xs: symbol.filter((t) => t.y === y).map((t) => t.x) }));
  };
  const asked = ctx.heard.flatMap((h) => rowAsked(h.text) ?? []).at(-1);
  if (mem.row < 0) {
    ctx.say('mirrored-glyph.out.intro');
    sayRow(0);
  } else if (asked !== undefined) sayRow(asked);
  else if (ctx.has('again')) sayRow(mem.row);
  else if (ctx.has('go', 'yes')) {
    if (mem.row + 1 < FACE_SIZE) sayRow(mem.row + 1);
    else ctx.say('mirrored-glyph.out.done', { force: true });
  }
  return { action: null, status: `reading the symbol out: row ${mem.row + 1} of ${FACE_SIZE}` };
}

function inside(ctx: ScriptCtx<Mem>): Play | null {
  const { mem, o } = ctx;
  let heard = false;
  for (const h of ctx.heard) {
    if (h.tokens.some((t) => t.t === 'face')) continue;
    if (wordsOf(h.text).some((w) => w === 'clear' || w === 'reset')) {
      Object.assign(mem, { rows: {}, pending: [], next: 0, clearing: true, owed: false });
      heard = true;
      continue;
    }
    const row = parseRow(h.text, mem.next < FACE_SIZE ? mem.next : null);
    if (!row) continue;
    heard = true;
    mem.owed = false;
    ctx.cancel('mirrored-glyph.in.ask');
    mem.rows[row.y] = row.xs;
    if (!mem.pending.includes(row.y)) mem.pending.push(row.y);
    mem.next = row.y + 1;
  }
  const tiles = ctx.objs('f3-tile');
  if (mem.clearing) {
    if (tiles.some((t) => t.state !== 'off')) return { action: { type: 'use', object: 'clear' }, status: 'the partner said clear: pressing CLEAR' };
    mem.clearing = false;
    mem.since = ctx.now;
    ctx.say('mirrored-glyph.in.cleared', { force: true });
  }
  // My own tiles, against what the human said about the rows they described so far.
  const wrong = tiles.filter((t) => {
    const at = canonOf(o, t);
    const want = mem.rows[at.y];
    return want !== undefined && want.includes(at.x) !== (t.state !== 'off');
  });
  if (wrong.length) {
    // The row being worked on first, and in it the nearest tile.
    const y = Math.min(...wrong.map((t) => canonOf(o, t).y));
    const target = wrong.filter((t) => canonOf(o, t).y === y).sort((a, b) => far(o.position, a) - far(o.position, b))[0]!;
    return { action: { type: 'use', col: target.col, row: target.row }, status: `flipping row ${y + 1}: ${wrong.length} tiles to go` };
  }
  if (mem.pending.length) {
    // An empty row took no work: the human is already on the next one, so nothing is said.
    const empty = mem.pending.every((y) => (mem.rows[y] ?? []).length === 0);
    mem.pending = [];
    mem.since = ctx.now;
    if (empty) mem.owed = true;
    else ctx.say('mirrored-glyph.in.next', { force: true });
  } else if (mem.owed && !heard) {
    // ... unless they wait for it
    if (ctx.now - (mem.since ?? ctx.now) >= EMPTY_ROW_WAIT_MS) {
      mem.owed = false;
      mem.since = ctx.now;
      ctx.say('mirrored-glyph.in.next', { force: true });
    }
  } else if (silent(mem, ctx.now, heard)) ctx.say('mirrored-glyph.in.ask', { force: true });
  return { action: null, status: 'waiting for the partner to describe a row' };
}

export const mirroredGlyphScript: PuzzleScript<Mem> = {
  id: 'mirrored-glyph',
  lines: LINES,
  init: () => ({ row: -1, rows: {}, pending: [], next: 0, clearing: false, owed: false, since: null }),
  play: (ctx) => (ctx.o.you === 'out' ? outside(ctx) : inside(ctx)),
};
