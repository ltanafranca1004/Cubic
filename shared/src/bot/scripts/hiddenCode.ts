import { CODE_DIGITS, CODE_MARK, readCode } from '../../puzzles/hiddenCode';
import { numberWord } from '../vocab';
import { canonOf, numberOf, onlyNumbersAnd, relay, silent, wordsOf } from './relayKit';
import type { Play, PuzzleScript, ScriptCtx } from './types';

// HIDDEN CODE (face 1). Outside: a 3-digit number laid out in the grass. Inside: a keypad.
//
// AI outside (relay): it reads the number off the tiles it sees (turned back upright with
// its own compass, like a player who walks until the view is upright) and says "the code
// is 4 7 2". Again on "again" / "repeat" / "what", and after a strike.
// AI inside (doing): it waits for the human's digits ("4 7 2", "four seven two", "472", or
// one digit per line), and only with all three does it walk to the keys, press them and
// ENTER. It sees no number itself: with a silent human it asks after 15 s and presses
// nothing.

interface Mem {
  /** Inside: the digits heard so far. */
  code: string;
  /** Inside: all three were heard and it has started typing. */
  typing: boolean;
  /** Outside: the number was read out at least once. */
  told: boolean;
  since: number | null;
}

const LINES = ['hidden-code.out.intro', 'hidden-code.relay', 'hidden-code.ask.first', 'hidden-code.ask.next', 'hidden-code.wrong'] as const;

/** The digits of one chat line, or null if the line is about something else. */
export function digitsIn(text: string): string | null {
  const words = wordsOf(text);
  if (!onlyNumbersAnd(words)) return null;
  // "472" is three digits, "four" is one. "one" on its own is a digit, in "the first one" too: fine.
  const digits = words.flatMap((w) => (/^\d+$/.test(w) ? [...w] : numberOf(w) !== null && numberOf(w)! <= 9 ? [String(numberOf(w))] : []));
  return digits.length ? digits.join('') : null;
}

function outside(ctx: ScriptCtx<Mem>): Play | null {
  const code = readCode(ctx.objs(CODE_MARK).map((m) => ({ type: m.type, ...canonOf(ctx.o, m) })));
  if (!code) return null;
  if (!ctx.mem.told || ctx.has('again') || ctx.struck) {
    ctx.say('hidden-code.out.intro');
    relay(ctx, 'hidden-code.relay', ['the code is', ...[...code].map((d) => numberWord(Number(d)))]);
    ctx.mem.told = true;
  }
  return { action: null, status: 'read the number out: waiting for the partner to type it' };
}

function inside(ctx: ScriptCtx<Mem>): Play | null {
  const { mem } = ctx;
  if (ctx.struck) {
    // The display is empty again: what I typed was not the number. Start over with the human.
    mem.code = '';
    mem.typing = false;
    mem.since = ctx.now;
    ctx.say('hidden-code.wrong', { force: true });
  }
  let heard = false;
  for (const h of ctx.heard) {
    if (mem.typing || h.tokens.some((t) => t.t === 'face')) continue;
    if (h.tokens.some((t) => t.t === 'no')) mem.code = ''; // "no, wrong": forget what was said so far
    const digits = digitsIn(h.text);
    if (!digits) continue;
    heard = true;
    // All three at once replace everything; fewer are the next ones.
    const joined = digits.length >= CODE_DIGITS ? digits : mem.code + digits;
    mem.code = joined.length > CODE_DIGITS ? digits.slice(0, CODE_DIGITS) : joined;
  }
  if (mem.code.length < CODE_DIGITS) {
    if (silent(mem, ctx.now, heard)) ctx.say(mem.code ? 'hidden-code.ask.next' : 'hidden-code.ask.first', { force: true });
    return { action: null, status: mem.code ? `heard ${mem.code.length} of ${CODE_DIGITS} digits: waiting for the rest` : 'waiting for the partner to read the number out' };
  }
  if (!mem.typing) {
    mem.typing = true;
    relay(ctx, 'hidden-code.relay', ['press', ...[...mem.code].map((d) => numberWord(Number(d)))]); // what I understood
  }
  // Asked again before every step: the display says how many digits are in.
  const typed = ctx.objs('display').filter((d) => d.state !== 'empty').length;
  return { action: { type: 'use', object: 'key', state: typed < CODE_DIGITS ? mem.code[typed]! : 'enter' }, status: `typing ${mem.code}: ${typed} in` };
}

export const hiddenCodeScript: PuzzleScript<Mem> = {
  id: 'hidden-code',
  lines: LINES,
  init: () => ({ code: '', typing: false, told: false, since: null }),
  play: (ctx) => (ctx.o.you === 'out' ? outside(ctx) : inside(ctx)),
};
