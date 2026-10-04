import { parseRow } from '../../src/bot/scripts/mirroredGlyph';
import type { HumanScript } from '../partnerSim';

// The simulated human for MIRRORED GLYPH (face 3), either side, only from its own screen.
// Outside: it reads the symbol in the snow out row by row, in the row convention of
// src/bot/scripts/mirroredGlyph.ts ("row 3 skip 3 flip 1 skip 5 flip 1"), one row each time
// the AI asks for the next. Inside: it flips the tiles of the row the AI's relay line
// described, then says "next".

const SIZE = 12;

/** A row the way a person types it: digits, and "row 2 skip" for an empty one. */
function typed(y: number, xs: number[], colon: boolean): string {
  const head = `row ${y + 1}${colon ? ':' : ''}`;
  if (xs.length === 0) return `${head} skip`;
  const parts: string[] = [];
  const last = Math.max(...xs);
  for (let x = 0; x <= last; ) {
    const on = xs.includes(x);
    let n = 0;
    while (x <= last && xs.includes(x) === on) [x, n] = [x + 1, n + 1];
    parts.push(`${on ? 'flip' : 'skip'} ${n}`);
  }
  return `${head} ${parts.join(' ')}`;
}

export interface MirroredGlyphHumanOptions {
  /** Outside: type "row 3: skip 4 flip 5" (with the colon). */
  colon?: boolean;
  /** Outside: say nothing until the AI asks. */
  shy?: boolean;
  /** Outside: never say anything. */
  mute?: boolean;
  /** Outside: describe another symbol: every row shifted one tile along. */
  lie?: boolean;
  /** Outside: say only this many rows, then stop. */
  rows?: number;
  /** Outside: after this row (0 based) say "clear" once and start again from the top. */
  clearAfter?: number;
  /** Inside: ask "again" for the first row this many times before flipping. */
  again?: number;
}

interface Mem {
  /** Outside: the next row to say. Inside: the row being flipped. */
  y: number;
  row: { y: number; xs: number[] } | null;
  waiting: boolean;
  cleared: boolean;
  agains: number;
}

export const mirroredGlyphHuman = (opts: MirroredGlyphHumanOptions = {}): HumanScript<Mem> => ({
  id: 'mirrored-glyph',
  init: () => ({ y: 0, row: null, waiting: false, cleared: false, agains: 0 }),
  play(ctx) {
    const { mem } = ctx;
    if (ctx.side === 'out') {
      const line = ctx.next();
      if (opts.mute) return;
      const sayRow = () => {
        if (mem.y >= (opts.rows ?? SIZE)) return;
        const xs = ctx
          .seen('f3-glyph')
          .filter((g) => g.y === mem.y)
          .map((g) => g.x + (opts.lie ? 1 : 0))
          .filter((x) => x < SIZE - 1);
        ctx.say(typed(mem.y, xs, opts.colon ?? false));
        mem.waiting = true;
      };
      if (line?.key === 'mirrored-glyph.in.ask') return sayRow(); // it asked: say the current row (again)
      if (line?.key === 'mirrored-glyph.in.cleared') {
        mem.y = 0;
        return sayRow();
      }
      if (mem.waiting) {
        if (line?.key !== 'mirrored-glyph.in.next') return;
        if (opts.clearAfter === mem.y && !mem.cleared) {
          mem.cleared = true;
          return ctx.say('clear');
        }
        mem.y++;
        mem.waiting = false;
      }
      if (opts.shy) return;
      sayRow();
      return;
    }
    // inside: "row three skip three flip one ...": counted from MY RIGHT, which is canonical x = 0
    if (!mem.row) {
      for (let line = ctx.next(); line && !mem.row; line = ctx.next()) {
        if (line.key !== 'mirrored-glyph.relay') continue;
        if (mem.agains < (opts.again ?? 0)) {
          mem.agains++;
          ctx.say('again');
          return;
        }
        mem.row = parseRow(String(line.args?.words ?? ''));
      }
      if (!mem.row) return;
    }
    const { y, xs } = mem.row;
    const wrong = ctx
      .seen('f3-tile')
      .filter((t) => t.y === y && xs.includes(t.x) !== (t.state !== 'off'))
      .sort((a, b) => (y % 2 ? b.x - a.x : a.x - b.x));
    if (wrong.length) {
      if (ctx.walk(wrong[0]!)) ctx.interact();
      return;
    }
    mem.row = null;
    ctx.say('next');
  },
});
