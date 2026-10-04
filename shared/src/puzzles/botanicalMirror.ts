import type { MapObject } from '../maps/types';
import { FACE_SIZE, type FaceId } from '../types';
import { FLOWER_COLOURS, FLOWER_KIND, FLOWER_SPOT, startFlowers, type FlowerColour } from './chain';
import type { PuzzleCtx, PuzzleInitCtx, PuzzleModule } from './types';
import { around, at, keyOf, mix, type XY } from './util';

// BOTANICAL MIRROR (face 4: Forest outside, Greenhouse inside). The last step of the chain
// 2 -> 5 -> 6 -> 4: one of its five flowers is in the crate of face 6.
//
// Outside: five empty pots. Inside: the same five pots, on the same tiles, each with a
// flower of a different colour (which colour stands where is different every game). The
// outside player plants a flower of every colour in the pot that holds that colour inside;
// only the inside player can see which one that is, and they see the room mirrored.
//
//  - THE FLOWERS (all outside, the inside player never sees them): four lie about from the
//    start, one each on faces 1, 2, 3 and 5, on a spot the seed picks (onStart). The fifth
//    comes out of the crate of face 6 when the beam burns it (chain.ts says which colour).
//  - THE POTS ARE SOLID, on both sides: nobody walks onto or through one. To plant, stand on
//    a tile next to the pot, FACING it (walk or bump towards it), and press E or Q.
//  - The wrong pot: one strike, and the flower is back in the outside player's hands.
//  - The right pot: the flower stays and blooms, for good. All five: solved.
//  - A pot never sleeps: a flower can be planted as soon as it is in hand.
//
// Map objects used: "target" on the OUTSIDE only (legend `p`): a pot takes anything, and
// what is not a flower is handed straight back. The inside pots are drawn on the same
// tiles through visible(), so there is no mirrored copy. "flower-spot" (legend `f`) on the
// outside of faces 1, 2, 3 and 5: where a loose flower may lie.

const FACE = 4;
/** Key for ctx.rand: which spot of a face its flower lies on. */
const K_SPOT = 20;

interface State {
  /** Per pot (map order): its flower is planted. */
  planted: boolean[];
}

/** The pots, in map order (row by row). Pot i is the same tile on both sides. */
const pots = (ctx: PuzzleInitCtx): MapObject[] => ctx.objects('out', FACE, 'target');

/** The colour of the flower in each inside pot of a game: a shuffle of all five, from the seed. */
export function potColours(seed: number): FlowerColour[] {
  const list = [...FLOWER_COLOURS];
  for (let i = list.length - 1; i > 0; i--) {
    const j = mix(seed, FACE, i) % (i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

const colourAt = (ctx: PuzzleInitCtx, pot: number): FlowerColour => potColours(ctx.seed)[pot % FLOWER_COLOURS.length]!;
const ring = (t: XY): boolean => t.x === 0 || t.y === 0 || t.x === FACE_SIZE - 1 || t.y === FACE_SIZE - 1;

/** The tiles of one outside face a player can walk to from its ring, with the real blockers. */
function reachable(ctx: PuzzleCtx, face: FaceId): Set<string> {
  const free = (t: XY) => !ctx.blocked('out', { face, x: t.x, y: t.y });
  const open: XY[] = [];
  for (let y = 0; y < FACE_SIZE; y++) for (let x = 0; x < FACE_SIZE; x++) if (ring({ x, y }) && free({ x, y })) open.push({ x, y });
  const seen = new Set(open.map(keyOf));
  for (let i = 0; i < open.length; i++)
    for (const n of around(open[i]!)) {
      if (seen.has(keyOf(n)) || !free(n)) continue;
      seen.add(keyOf(n));
      open.push(n);
    }
  return seen;
}

export const botanicalMirror: PuzzleModule<State> = {
  id: 'botanical-mirror',
  face: FACE,
  bright: true,

  init: (ctx) => ({ planted: pots(ctx).map(() => false) }),

  // The four loose flowers: each on one of its face's spots that is off the ring, can be
  // walked to from the ring and holds no item yet.
  onStart(_s, ctx) {
    for (const f of startFlowers(ctx.seed)) {
      const walk = reachable(ctx, f.face);
      const items = Object.values(ctx.state.items);
      const spots = ctx.objects('out', f.face, FLOWER_SPOT).filter((t) => !ring(t) && walk.has(keyOf(t)) && !items.some((i) => i.side === 'out' && i.face === f.face && at(i, t)));
      const spot = spots[ctx.rand(FACE, K_SPOT, f.face) % Math.max(1, spots.length)];
      if (spot && !ctx.state.items[f.id]) ctx.spawnItem({ id: f.id, kind: f.kind, side: 'out', face: f.face, x: spot.x, y: spot.y });
    }
  },

  // A pot is in the way, for both players. None is on the ring (the edge rule).
  isBlocked: (_s, ctx, _side, tile) => !ring(tile) && pots(ctx).some((p) => at(p, tile)),

  onItem(s, ctx, ev) {
    if (ev.kind !== 'placed' || ev.side !== 'out' || ev.tile.face !== FACE || !ev.target) return;
    const pot = pots(ctx).findIndex((p) => at(p, ev.tile));
    if (pot < 0) return;
    // Not a flower: hand it back, no harm done. (A pot in bloom takes nothing more: the engine refuses it.)
    if (!ev.item.kind.startsWith(FLOWER_KIND) || s.planted[pot]) {
      ctx.giveItem(ev.side, ev.item.id);
      return;
    }
    if (ev.item.kind !== FLOWER_KIND + colourAt(ctx, pot)) {
      ctx.strike(ev.side);
      ctx.giveItem(ev.side, ev.item.id);
      return;
    }
    // it stays: a placed item is never picked up again
    s.planted[pot] = true;
    ctx.emit('chime');
  },

  isSolved: (s) => s.planted.length > 0 && s.planted.every(Boolean),

  // The dev tools' "Solve puzzle": every pot blooms; the flowers still lying about are gone.
  devSolve(s, ctx) {
    s.planted = s.planted.map(() => true);
    for (const item of Object.values(ctx.state.items)) if (item.side === 'out' && item.kind.startsWith(FLOWER_KIND) && !item.placedOn) ctx.removeItem(item.id);
  },

  // Inside nothing changes when a twin is planted outside (the objective counts them);
  // outside a planted pot shows its flower.
  visible(s, ctx, side) {
    return pots(ctx).map((p, i) =>
      side === 'in'
        ? { type: 'f4-flowerpot', x: p.x, y: p.y, state: colourAt(ctx, i) }
        : { type: 'f4-pot', x: p.x, y: p.y, state: s.planted[i] ? `bloom-${colourAt(ctx, i)}` : 'empty' },
    );
  },

  objective(s, _ctx, side) {
    const done = s.planted.filter(Boolean).length;
    const all = s.planted.length;
    if (done === all) return 'Every pot is in bloom.';
    if (side === 'in') return `Five flowers bloom here. Your partner plants their twins outside. ${done} of ${all} planted.`;
    return `Five empty pots. A flower lies on every other face. Stand by a pot, face it, plant. ${done} of ${all} planted.`;
  },
};
