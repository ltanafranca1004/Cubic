import { BATTERY_KIND } from '../../puzzles/chain';
import type { Observation } from '../observe';
import { digitWords, numberWord } from '../vocab';
import { carryTo } from './carry';
import { numberOf, onlyNumbersAnd, relay, silent, wordsOf } from './relayKit';
import type { Play, PuzzleScript, ScriptCtx } from './types';

// EQUATION SAFE (face 2). Outside: bushes, birds and rocks to count. Inside: a safe, the
// row carved above it (3 x bushes x 2 x birds x rocks) and a keypad.
//
// AI outside (relay): it counts the three kinds it sees and says "three bushes two birds
// one rocks". Again on "again" / "repeat" / "what", and after a strike.
// AI inside (doing): it waits for the human's three counts ("3 bushes 2 birds 1 rock" in
// any order, or bare numbers: three at once are bushes, birds, rocks, one answers what it
// asked for last), works out the product from the row on ITS OWN wall, types it and
// presses ENTER. It never sees what is outside: with a silent human it asks after 15 s,
// kind by kind, and presses nothing.
// The battery that comes out belongs to face 5: carryBattery below is the errand for that
// script (an errand is only asked of a script whose puzzle is still unsolved).

export const KINDS = ['bushes', 'birds', 'rocks'] as const;
export type Kind = (typeof KINDS)[number];
export type Counts = Partial<Record<Kind, number>>;

const KIND_WORDS: Record<string, Kind> = { bush: 'bushes', bushes: 'bushes', berry: 'bushes', berries: 'bushes', bird: 'birds', birds: 'birds', rock: 'rocks', rocks: 'rocks', stone: 'rocks', stones: 'rocks' };
/** What one kind looks like on each side: counted outside, carved inside. */
const SEEN: Record<Kind, { out: string; clue: string }> = { bushes: { out: 'f2-bush', clue: 'bush' }, birds: { out: 'f2-bird', clue: 'bird' }, rocks: { out: 'f2-rock', clue: 'rock' } };
const CLUE_NUMBERS: Record<string, number> = { two: 2, three: 3 };

interface Mem {
  counts: Counts;
  /** Inside: the kind it asked for last: a bare number answers that. */
  asked: Kind | null;
  /** Inside: what it is typing, once all three counts are in. */
  answer: string | null;
  /** Outside: the counts were said at least once. */
  told: boolean;
  since: number | null;
}

const LINES = ['equation-safe.out.intro', 'equation-safe.relay', 'equation-safe.ask.bushes', 'equation-safe.ask.birds', 'equation-safe.ask.rocks', 'equation-safe.wrong'] as const;

const missing = (c: Counts): Kind | undefined => KINDS.find((k) => c[k] === undefined);

/**
 * The counts in one chat line, added to `into`. "3 bushes 2 birds 1 rock" and "bushes 3,
 * birds 2" pair each kind with the number beside it. A line of numbers only: three are
 * bushes, birds, rocks; fewer fill `asked` first, then what is still missing, in that
 * order. Returns whether the line said anything.
 */
export function countsIn(text: string, into: Counts, asked: Kind | null = null): boolean {
  const words = wordsOf(text);
  const count = (i: number) => {
    const n = numberOf(words[i]);
    return n !== null && n >= 1 ? n : null;
  };
  const used = new Set<number>();
  let any = false;
  words.forEach((w, i) => {
    const kind = KIND_WORDS[w];
    if (!kind) return;
    const at = [i - 1, i + 1].find((j) => !used.has(j) && count(j) !== null);
    if (at === undefined) return;
    used.add(at);
    into[kind] = count(at)!;
    any = true;
  });
  if (any || words.some((w) => KIND_WORDS[w]) || !onlyNumbersAnd(words)) return any;
  const bare = words.flatMap((_, i) => (count(i) === null ? [] : [count(i)!]));
  if (bare.length === 0 || bare.length > KINDS.length) return false;
  if (bare.length === KINDS.length) KINDS.forEach((k, i) => (into[k] = bare[i]!));
  else
    for (const n of bare) {
      const kind = asked && bare.length === 1 ? asked : (missing(into) ?? asked);
      if (kind) into[kind] = n;
    }
  return true;
}

/** The product the row carved on the inside wall asks for, with the human's counts. null = I see no row. */
function product(ctx: ScriptCtx<Mem>, counts: Required<Counts>): number | null {
  const clue = ctx.objs('f2-clue');
  if (clue.length === 0) return null;
  let total = 1;
  for (const c of clue) {
    const kind = KINDS.find((k) => SEEN[k].clue === c.state);
    total *= kind ? counts[kind] : (CLUE_NUMBERS[c.state ?? ''] ?? 1);
  }
  return total;
}

function outside(ctx: ScriptCtx<Mem>): Play | null {
  if (!ctx.mem.told || ctx.has('again') || ctx.struck) {
    ctx.say('equation-safe.out.intro');
    // The birds hop about but their number never changes: counting them is enough.
    relay(
      ctx,
      'equation-safe.relay',
      KINDS.flatMap((k) => [numberWord(ctx.objs(SEEN[k].out).length), k]),
    );
    ctx.mem.told = true;
  }
  return { action: null, status: 'said the counts: waiting for the partner to type the answer' };
}

function inside(ctx: ScriptCtx<Mem>): Play | null {
  const { mem } = ctx;
  if (ctx.struck) {
    mem.counts = {};
    mem.answer = null;
    mem.asked = null;
    mem.since = ctx.now;
    ctx.say('equation-safe.wrong', { force: true });
  }
  let heard = false;
  for (const h of ctx.heard) {
    if (mem.answer !== null || h.tokens.some((t) => t.t === 'face')) continue;
    if (!countsIn(h.text, mem.counts, mem.asked)) continue;
    heard = true;
    mem.asked = null;
    ctx.cancel(...KINDS.map((k) => `equation-safe.ask.${k}`));
  }
  const next = missing(mem.counts);
  if (next) {
    if (silent(mem, ctx.now, heard)) {
      mem.asked = next;
      ctx.say(`equation-safe.ask.${next}`, { force: true });
    }
    return { action: null, status: `waiting for the partner's counts: ${KINDS.map((k) => `${k} ${mem.counts[k] ?? '?'}`).join(', ')}` };
  }
  if (mem.answer === null) {
    const total = product(ctx, mem.counts as Required<Counts>);
    if (total === null) return { action: null, status: 'I cannot see the row above the safe' };
    mem.answer = String(total);
    relay(ctx, 'equation-safe.relay', ['press', ...digitWords(total)]); // what I worked out
  }
  const typed = ctx.objs('display').filter((d) => d.state !== 'empty').length;
  return { action: { type: 'use', object: 'key', state: typed < mem.answer.length ? mem.answer[typed]! : 'enter' }, status: `typing ${mem.answer}: ${typed} in` };
}

export const equationSafeScript: PuzzleScript<Mem> = {
  id: 'equation-safe',
  lines: LINES,
  init: () => ({ counts: {}, asked: null, answer: null, told: false, since: null }),
  play: (ctx) => (ctx.o.you === 'out' ? outside(ctx) : inside(ctx)),
};

/**
 * The carrying duty after the safe opens: the inside player takes the battery from in
 * front of the safe to face 5 and puts it in the emitter. Call it from the errand() of the
 * sequence-laser script (face 5 is the unsolved one by then). null = nothing to carry now.
 */
export const carryBattery = (o: Observation): Play | null => carryTo(o, { side: 'in', kind: BATTERY_KIND, from: 'equation-safe', to: 'sequence-laser', target: 'f5-emitter' });
