import { numberWord } from '../vocab';
import { same } from './grid';
import { colourIn, rowColumnIn } from './kit456';
import { ASK_MS, canonOf, relay, type Tile } from './relayKit';
import type { Play, PuzzleScript } from './types';

// BOTANICAL MIRROR (face 4), both sides. Five flowers (one lying on each other face, the
// one of face 6 in its crate until it burns) go into five pots; each pot takes the colour
// its twin inside holds. The pots are solid: a flower is planted from the tile next to one.
//
// THE CONVENTION for naming a pot (both ways): [the pot is, row, R, column, C], one to
// twelve. Rows are counted from the edge of the wall beside FACE 5 (the roof), columns from
// the edge beside FACE 3. Those two edges are the same for both players whichever way their
// screen is turned and although the inside is mirrored, so each counts on their own screen
// from the edges their HUD cube shows. (It is the canonical grid of the face: row = y + 1,
// column = x + 1. Upright, the outside player counts from the top and from their left, the
// inside player from the top and from their right.)
//
// OUTSIDE (doing, carrying). It never sees the flowers inside, so with the human on the
// wall it asks, pot by pot: [the pot is, row, R, column, C] "What colour is the flower in
// that pot?", and remembers each answer ("pink"; "row 4 column 9 is pink" also counts).
// Once it knows every open pot it fetches the flowers one at a time (errand: the faces it
// has not searched yet, face 6 only once that face is solved) and plants each in the pot of
// its colour, human or no human. A strike: what it was told was wrong. It forgets the
// colours, says [the flower is, pink] and asks for the row and column of the pot for the
// flower in its hands ("row 4 column 9"), plants it there, then asks the other pots again.
//
// INSIDE (relay): the first time it is on the wall with the human it names every pot with
// its colour, [the pot is, row, R, column, C, the flower is, pink]; all of them again on
// "again" and after a strike, and one pot when the human says a colour or a row and a
// column. A human who is there and silent is asked for the colour of their flower. (It does
// not see which pots are planted: nothing changes inside.)

const ID = 'botanical-mirror';
const RELAY = `${ID}.relay`;
/** The face-6 puzzle: its flower is in the crate, and is not fetched before that face is solved. */
const CRATE = 'laser-path';
const KIND = 'flower-';
export const isFlower = (kind: string) => kind.startsWith(KIND);

interface Mem {
  /** When I last asked or heard something I could use. */
  since: number | null;
  /** Outside: the colour of each pot as the human told it, by canonical tile "x,y". */
  colours: Record<string, string>;
  /** Outside: the pot my last question was about. */
  asked: Tile | null;
  /** Outside: every open pot has a colour: I fetch and plant. */
  go: boolean;
  /** Outside: a strike took my colours: first the pot for the flower in my hands, by row and column. */
  fix: boolean;
  /** Outside: faces I have found no loose flower on. */
  empty: number[];
  /** Inside: I have named every pot once (not again on each visit: the human asks, or says a colour). */
  told: boolean;
}

const key = (t: Tile) => `${t.x},${t.y}`;

/** The relay line that names a canonical tile. */
export const potLine = (t: { x: number; y: number }): string[] => ['the pot is', 'row', numberWord(t.y + 1), 'column', numberWord(t.x + 1)];
/** The relay line of the inside: a pot and the colour of its flower. */
export const potColourLine = (t: { x: number; y: number }, colour: string): string[] => [...potLine(t), 'the flower is', colour];

export const botanicalMirrorScript: PuzzleScript<Mem> = {
  id: ID,
  lines: [RELAY, `${ID}.out.colour`, `${ID}.out.go`, `${ID}.out.ask`, `${ID}.out.nopot`, `${ID}.out.strike`, `${ID}.in.ask`, `${ID}.in.how`, `${ID}.in.strike`],
  // what was learned across the cube outlives a visit to the face: the colours, the faces searched
  init: (prev) => ({ since: null, colours: { ...prev?.colours }, asked: null, go: prev?.go ?? false, fix: prev?.fix ?? false, empty: [...(prev?.empty ?? [])], told: prev?.told ?? false }),

  // Outside: fetch a flower, carry it to the pots, plant it. Asking the colours is play().
  errand(ctx) {
    const { o, mem } = ctx;
    if (o.you !== 'out') return null;
    const faceOf = (id: string) => o.puzzleList.find((p) => p.id === id)?.face;
    const mine = faceOf(ID)!;
    const here = o.face === mine;
    const pots = here ? o.objects.filter((x) => x.type === 'f4-pot') : [];
    const open = pots.filter((p) => !p.state?.startsWith('bloom-'));
    const carried = o.carrying && isFlower(o.carrying) ? o.carrying.slice(KIND.length) : null;
    // The crate's flower comes out in the middle of face 6: that face is finished first.
    const crate = faceOf(CRATE);
    const out = (face: number) => face !== crate || o.solvedFaces.includes(face);

    if (carried) {
      if (!out(o.face)) return null;
      if (!here) return { action: { type: 'go_face', face: mine }, status: `carrying the ${carried} flower to the pots` };
      if (ctx.struck) {
        // the wrong pot: the flower is back in my hands, and what I was told is not to be trusted
        Object.assign(mem, { colours: {}, asked: null, go: false, fix: true, since: ctx.now });
        ctx.say(`${ID}.out.strike`, { force: true });
        relay(ctx, RELAY, ['the flower is', carried]);
      }
      const pot = open.find((p) => mem.colours[key(canonOf(o, p))] === carried);
      if (pot) return { action: { type: 'place', col: pot.col, row: pot.row }, status: `planting the ${carried} flower in the pot I was told` };
      // which pot: only the human knows (play). Alone here: wait, they have to come.
      return o.voiceSignal < 3 ? { action: null, status: 'waiting by the pots with a flower' } : null;
    }
    if (o.carrying || !mem.go) return null;

    // empty hands, and I know where every flower goes: the next one
    const loose = o.items.find((i) => isFlower(i.kind) && !pots.some((p) => same(p, i)));
    if (loose && out(o.face)) {
      return same(o.position, loose) ? { action: { type: 'pick_up' }, status: 'picking up a flower' } : { action: { type: 'goto', col: loose.col, row: loose.row }, allow: [loose], status: 'fetching the flower I see' };
    }
    if (!here && out(o.face) && !mem.empty.includes(o.face)) mem.empty.push(o.face);
    const near = Object.values(o.edges).map((e) => e.face);
    const next = o.puzzleList
      .map((p) => p.face)
      .filter((f) => f !== mine && !mem.empty.includes(f) && out(f))
      .sort((a, b) => Number(near.includes(b)) - Number(near.includes(a)))[0];
    return next === undefined ? null : { action: { type: 'go_face', face: next }, status: `looking for a flower on face ${next}` };
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
      const open = objs('f4-pot').filter((p) => !p.state?.startsWith('bloom-'));
      const potAt = (t: Tile) => open.find((p) => key(canonOf(o, p)) === key(t));
      const carried = o.carrying && isFlower(o.carrying) ? o.carrying.slice(KIND.length) : null;
      for (const h of heard) {
        const rc = rowColumnIn(h.text);
        const named = rc.row !== undefined && rc.column !== undefined ? { x: rc.column - 1, y: rc.row - 1 } : null;
        // a colour (for the pot named, or the pot I asked about), or only a pot: the one for the flower in my hands
        const colour = colourIn(h.text) ?? (named && mem.fix ? carried : null);
        if (!colour) continue;
        const tile = named ?? (mem.fix ? null : mem.asked);
        if (!tile) continue;
        if (!potAt(tile)) {
          if (named) say(`${ID}.out.nopot`, { force: true });
          continue;
        }
        mem.colours[key(tile)] = colour;
        mem.since = now;
        if (mem.asked && key(mem.asked) === key(tile)) mem.asked = null;
        ctx.cancel(`${ID}.out.colour`, `${ID}.out.ask`);
      }
      const known = (p: (typeof open)[number]) => mem.colours[key(canonOf(o, p))];
      // every pot has a colour, but none is the one in my hands: something I was told is wrong
      if (carried && open.every(known) && !open.some((p) => known(p) === carried)) mem.colours = {};
      if (mem.fix && carried && !open.some((p) => known(p) === carried)) {
        // after a strike: where does THIS flower go?
        if (has('again') || quiet()) {
          relay(ctx, RELAY, ['the flower is', carried]);
          say(`${ID}.out.ask`, { force: true });
        }
        return { action: null, status: 'the wrong pot: asking where the flower in my hands goes' };
      }
      mem.fix = false;
      const unknown = open.filter((p) => !known(p));
      if (unknown.length === 0) {
        if (!mem.go && open.length) {
          mem.go = true;
          say(`${ID}.out.go`, { force: true });
        }
        return null; // the errand fetches and plants
      }
      mem.go = false;
      if (mem.asked && !potAt(mem.asked)) mem.asked = null;
      if (mem.asked === null || has('again') || quiet()) {
        mem.asked ??= canonOf(o, unknown[0]!);
        mem.since = now;
        relay(ctx, RELAY, potLine(mem.asked));
        say(`${ID}.out.colour`, { force: true });
      }
      return { action: null, status: 'asking the colour of each pot' };
    }

    // ---- inside: name every pot, with its colour ----
    const open = objs('f4-flowerpot').filter((p) => p.state);
    if (open.length === 0) return null;
    const tell = (p: (typeof open)[number]) => relay(ctx, RELAY, potColourLine(canonOf(o, p), p.state!));
    if (struck) {
      say(`${ID}.in.strike`, { force: true });
      open.forEach(tell);
    } else if (!mem.told) {
      say(`${ID}.in.how`);
      open.forEach(tell);
      mem.since = now;
    } else if (has('again')) open.forEach(tell);
    else {
      // one pot: the one of the colour they said, or the one they named
      const wanted = new Set<(typeof open)[number]>();
      for (const h of heard) {
        const colour = colourIn(h.text);
        const rc = rowColumnIn(h.text);
        const pot = open.find((p) => p.state === colour) ?? open.find((p) => rc.row !== undefined && rc.column !== undefined && key(canonOf(o, p)) === key({ x: rc.column - 1, y: rc.row - 1 }));
        if (pot) wanted.add(pot);
      }
      wanted.forEach(tell);
      if (wanted.size) mem.since = now;
      else if (quiet()) say(`${ID}.in.ask`, { force: true });
    }
    mem.told = true;
    return { action: null, status: 'told the colour of every pot' };
  },
};
