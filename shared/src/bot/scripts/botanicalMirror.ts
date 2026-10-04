import { numberWord } from '../vocab';
import { carryTo } from './carry';
import { same } from './grid';
import { colourIn, rowColumnIn } from './kit456';
import { ASK_MS, canonOf, cellOf, relay } from './relayKit';
import type { Play, PuzzleScript } from './types';

// BOTANICAL MIRROR (face 4), both sides.
//
// THE CONVENTION for naming a pot (both ways): [the pot is, row, R, column, C], one to
// twelve. Rows are counted from the edge of the wall beside FACE 5 (the roof), columns from
// the edge beside FACE 3. Those two edges are the same for both players whichever way their
// screen is turned and although the inside is mirrored, so each counts on their own screen
// from the edges their HUD cube shows. (It is the canonical grid of the face: row = y + 1,
// column = x + 1. Upright, the outside player counts from the top and from their left, the
// inside player from the top and from their right.)
//
// OUTSIDE (doing, carrying): bring the flower face 6 left outside (errand), say its colour
// [the flower is, pink], wait for the human to name the pot, plant it there. It never sees
// the flowers inside. A strike: it says so and asks again.
//
// INSIDE (relay): the colour of the flower is NOT in this side's observation (observe()
// shows only what I carry), so the human says it; then it names the pot of that colour.

const ID = 'botanical-mirror';
const RELAY = `${ID}.relay`;
/** Its two lines (the colour, the question) go out 1.5 s apart: it plants after them, never over them. */
const SPEAK_MS = 3_500;
export const isFlower = (kind: string) => kind.startsWith('flower-');

interface Mem {
  since: number | null;
  /** Outside: the pot the human named (my screen). Inside: the colour the human said. */
  pot: { col: number; row: number } | null;
  colour: string | null;
  /** Outside: when I last said my lines. */
  spoke: number;
}

/** The relay line that names a canonical tile. */
export const potLine = (t: { x: number; y: number }): string[] => ['the pot is', 'row', numberWord(t.y + 1), 'column', numberWord(t.x + 1)];

export const botanicalMirrorScript: PuzzleScript<Mem> = {
  id: ID,
  lines: [RELAY, `${ID}.out.ask`, `${ID}.out.nopot`, `${ID}.out.strike`, `${ID}.in.ask`, `${ID}.in.how`, `${ID}.in.strike`],
  init: () => ({ since: null, pot: null, colour: null, spoke: 0 }),

  // The flower: from where face 6 left it (outside) to this face. Planting it is play().
  errand({ o }) {
    if (o.you !== 'out') return null;
    // no target: which pot is the human's to say (play)
    const kind = o.carrying && isFlower(o.carrying) ? o.carrying : (o.items.find((i) => isFlower(i.kind))?.kind ?? 'flower');
    const job = carryTo(o, { side: 'out', kind, from: 'laser-path', to: ID, target: 'none' });
    // on the face with the flower and the human elsewhere: wait here, they have to come to name the pot
    if (!job && o.puzzleId === ID && o.carrying && isFlower(o.carrying) && o.voiceSignal < 3) return { action: null, status: 'waiting by the pots with the flower' };
    return job;
  },

  play(ctx): Play | null {
    const { o, mem, heard, now, struck, objs, say, has } = ctx;
    const quiet = (): boolean => {
      if (mem.since === null) mem.since = now;
      if (now - mem.since < ASK_MS) return false;
      mem.since = now;
      return true;
    };

    if (o.you === 'out') {
      const pots = objs('f4-pot');
      if (!o.carrying || !isFlower(o.carrying) || pots.some((p) => p.state === 'locked')) return null;
      const tellColour = () => {
        mem.spoke = now;
        relay(ctx, RELAY, ['the flower is', o.carrying!.slice('flower-'.length)]);
      };
      if (struck) {
        // the wrong pot: the flower is back in my hands
        Object.assign(mem, { pot: null, since: now, spoke: now });
        say(`${ID}.out.strike`, { force: true });
        return { action: null, status: 'the wrong pot: asking again' };
      }
      if (mem.since === null) {
        mem.since = now;
        tellColour();
        say(`${ID}.out.ask`);
      }
      const named = heard.map((h) => rowColumnIn(h.text)).find((t) => t.row !== undefined && t.column !== undefined);
      if (named) {
        const cell = cellOf(o, { x: named.column! - 1, y: named.row! - 1 });
        mem.since = now;
        ctx.cancel(`${ID}.out.ask`);
        mem.pot = pots.find((p) => same(p, cell)) ?? null;
        if (!mem.pot) say(`${ID}.out.nopot`, { force: true });
      } else if (has('again')) tellColour();
      if (mem.pot && same(o.position, mem.pot)) return now - mem.spoke < SPEAK_MS ? { action: null, hold: true, status: 'on the pot I was told' } : { action: { type: 'drop' }, status: 'planting the flower in the pot I was told' };
      if (mem.pot) return { action: { type: 'goto', col: mem.pot.col, row: mem.pot.row }, status: 'carrying the flower to the pot I was told' };
      if (quiet()) {
        tellColour();
        say(`${ID}.out.ask`, { force: true });
      }
      return { action: null, status: 'waiting to hear which pot' };
    }

    // ---- inside: name the pot that holds the flower's colour ----
    const colour = heard.map((h) => colourIn(h.text)).filter((c) => c !== null).at(-1) ?? null;
    if (colour) {
      Object.assign(mem, { colour, since: now });
      ctx.cancel(`${ID}.in.ask`);
    }
    const pot = objs('f4-flowerpot').find((p) => p.state === mem.colour);
    if (!pot) {
      say(`${ID}.in.ask`);
      if (quiet()) say(`${ID}.in.ask`, { force: true });
      return { action: null, status: 'waiting to hear the colour of the flower' };
    }
    const tell = () => relay(ctx, RELAY, potLine(canonOf(o, pot)));
    if (struck) {
      say(`${ID}.in.strike`, { force: true });
      tell();
    } else if (colour) {
      say(`${ID}.in.how`);
      tell();
    } else if (has('again')) tell();
    return { action: null, status: `told the pot of the ${mem.colour} flower` };
  },
};
