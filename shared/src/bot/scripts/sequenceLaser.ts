import { carryBattery } from './equationSafe';
import { same } from './grid';
import { symbolsIn } from './kit456';
import { ASK_MS, relay } from './relayKit';
import type { Play, PuzzleScript } from './types';

// SEQUENCE LASER (face 5), both sides.
//
// INSIDE (doing, carrying): fetch the battery face 2 left inside (errand), put it in the
// emitter, then press the seven buttons in the order the human SAYS. The order is only
// ever shown outside: this side never sees it, so it waits for the names ("sun moon star",
// one or several per message), presses each one it was told, and asks when the human is
// silent. A button that is already lit is skipped, so the human may repeat the whole order.
// After a strike everything it was told is dropped and it asks for the order again.
//
// OUTSIDE (relay): once the laser has power, press REPLAY so the show starts from its first
// symbol, watch which symbol is lit on each look, and say the order in two parts:
//   [the order is, A, then, B, then, C]   [next, D, then, E, then, F, then, G]
// "again" (or a strike) repeats both parts.

const ID = 'sequence-laser';
const RELAY = `${ID}.relay`;
const SYMBOL = 'f5-symbol';
/** No symbol lit for this long after REPLAY: press it again. */
const WATCH_MS = 3_000;

interface Mem {
  /** The battery is in (seen on the face). */
  powered: boolean;
  /** When I last heard something useful, or asked. */
  since: number | null;
  /** Inside: symbols I was told and have not pressed yet. */
  queue: string[];
  /** Outside: the show I am watching since I pressed REPLAY. */
  watch: { at: number; seen: string[] } | null;
  /** Outside: the order, once a whole show was watched. */
  order: string[] | null;
  told: boolean;
}

export const litName = (state: string | undefined): string | null => (state?.endsWith('-lit') ? state.slice(0, -4) : null);

/** The order in two parts a human can follow: three, then the rest. */
export const orderLines = (order: readonly string[]): string[][] => {
  const part = (head: string, names: readonly string[]) => [head, ...names.flatMap((n, i) => (i ? ['then', n] : [n]))];
  return order.length <= 3 ? [part('the order is', order)] : [part('the order is', order.slice(0, 3)), part('next', order.slice(3))];
};

/** One look at the outside symbols while a show plays. Returns the order when the show is over and whole. */
export function watchShow(watch: { at: number; seen: string[] }, states: readonly (string | undefined)[], now: number): string[] | 'again' | null {
  const on = states.map(litName).find((s) => s !== null) ?? null;
  if (on) {
    if (watch.seen.at(-1) !== on) watch.seen.push(on);
    return null;
  }
  if (watch.seen.length === 0) return now - watch.at > WATCH_MS ? 'again' : null;
  return watch.seen.length === states.length && new Set(watch.seen).size === states.length ? watch.seen : 'again';
}

export const sequenceLaserScript: PuzzleScript<Mem> = {
  id: ID,
  lines: [RELAY, `${ID}.in.battery`, `${ID}.in.how`, `${ID}.in.first`, `${ID}.in.next`, `${ID}.in.strike`, `${ID}.out.dark`, `${ID}.out.how`, `${ID}.out.strike`],
  init: () => ({ powered: false, since: null, queue: [], watch: null, order: null, told: false }),

  // The battery: from where face 2 left it (inside) to the emitter. Only the inside player can carry it.
  errand({ o, mem }) {
    if (o.you !== 'in') return null;
    if (o.puzzleId === ID) mem.powered = o.objects.some((x) => x.type === 'f5-emitter' && x.state !== 'dead');
    if (mem.powered) return null;
    return carryBattery(o);
  },

  play(ctx): Play | null {
    const { o, mem, heard, now, struck, objs, say, has } = ctx;
    const symbols = objs(SYMBOL);

    if (o.you === 'in') {
      if (!objs('f5-emitter').some((e) => e.state === 'powered')) {
        say(`${ID}.in.battery`);
        return null; // the errand fetches it
      }
      say(`${ID}.in.how`);
      const named = heard.flatMap((h) => symbolsIn(h.text));
      if (named.length) {
        mem.queue.push(...named);
        ctx.cancel(`${ID}.in.first`, `${ID}.in.next`);
      }
      if (struck) {
        // a wrong press: the buttons went dark, and what I was told may be wrong too
        mem.queue = [];
        mem.since = now;
        say(`${ID}.in.strike`, { force: true });
        return { action: null, status: 'a wrong symbol: asking for the order again' };
      }
      const button = (name: string) => symbols.find((s) => s.state === name || s.state === `${name}-lit`);
      // already lit (pressed in its place), or not a button I can see: nothing to press
      while (mem.queue.length && (!button(mem.queue[0]!) || litName(button(mem.queue[0]!)!.state))) mem.queue.shift();
      if (mem.queue.length) {
        mem.since = now;
        return { action: { type: 'use', object: SYMBOL, state: mem.queue[0]! }, status: `pressing ${mem.queue[0]}, as told` };
      }
      if (mem.since === null || named.length) mem.since = now;
      if (now - mem.since >= ASK_MS) {
        mem.since = now;
        say(symbols.some((s) => litName(s.state)) ? `${ID}.in.next` : `${ID}.in.first`, { force: true });
      }
      return { action: null, status: 'waiting to be told the next symbol' };
    }

    // ---- outside: watch, then say ----
    const replay = objs('f5-replay')[0];
    if (!replay || replay.state !== 'on') {
      say(`${ID}.out.dark`);
      return null;
    }
    if (!mem.order) {
      if (!mem.watch) {
        if (same(o.position, replay)) mem.watch = { at: now, seen: [] }; // this step presses it
        return { action: { type: 'use', col: replay.col, row: replay.row }, status: 'pressing REPLAY to watch the order from the start' };
      }
      const seen = watchShow(mem.watch, symbols.map((s) => s.state), now);
      if (seen === 'again') mem.watch = null;
      else if (seen) mem.order = seen;
      return { action: null, hold: true, status: 'watching the symbols light up' };
    }
    const tell = () => orderLines(mem.order!).forEach((pieces) => relay(ctx, RELAY, pieces));
    if (!mem.told) {
      mem.told = true;
      say(`${ID}.out.how`);
      tell();
    } else if (struck) {
      say(`${ID}.out.strike`, { force: true });
      tell();
    } else if (has('again')) tell();
    return { action: null, status: `told the order: ${mem.order.join(' ')}` };
  },
};
