import type { MapObject } from '../maps/types';
import { FLOWER_COLOURS, type FlowerColour } from './chain';
import { lockedUntil } from './lib/deps';
import type { PuzzleCtx, PuzzleInitCtx, PuzzleModule } from './types';
import { at, mix } from './util';

// BOTANICAL MIRROR (face 4: Forest outside, Greenhouse inside). The last step of the chain
// 2 -> 5 -> 6 -> 4: it needs the flower that face 6 leaves outside when it is solved.
//
// Outside: five empty pots. Inside: the same five pots, on the same tiles, each with a
// flower of a different colour (which colour stands where is different every game). The
// outside player plants the flower in the pot that holds its colour inside; only the
// inside player can see which one that is, and they see the room mirrored.
//
//  - The pots sleep until face 6 is solved: a flower put in one comes straight back.
//  - The wrong pot: one strike, and the flower is back in the outside player's hands.
//  - The right pot: the flower stays and blooms. Solved.
//
// Nothing here blocks: pots are walked over, on both sides.
//
// Map objects used: "target" on the OUTSIDE only (legend `p`). A pot takes anything, and
// what is not a flower is handed straight back. The inside pots are drawn on the same
// tiles through visible(), so there is no mirrored copy.

const FACE = 4;
const FLOWER = 'flower-';

interface State {
  /** Index of the pot the flower was planted in (the pots in map order), once it is right. */
  bloom: number | null;
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

const colourAt = (ctx: PuzzleCtx, pot: number): FlowerColour => potColours(ctx.seed)[pot % FLOWER_COLOURS.length]!;

export const botanicalMirror: PuzzleModule<State> = {
  id: 'botanical-mirror',
  face: FACE,
  bright: true,

  init: () => ({ bloom: null }),

  onItem(s, ctx, ev) {
    if (ev.kind !== 'placed' || ev.side !== 'out' || ev.tile.face !== FACE || !ev.target) return;
    const pot = pots(ctx).findIndex((p) => at(p, ev.tile));
    if (pot < 0) return;
    // Not a flower, or a pot that already blooms: hand it back, no harm done.
    if (!ev.item.kind.startsWith(FLOWER) || s.bloom !== null) {
      ctx.giveItem(ev.side, ev.item.id);
      return;
    }
    if (lockedUntil(ctx, 6)) {
      ctx.giveItem(ev.side, ev.item.id);
      ctx.emit('puzzle');
      return;
    }
    if (ev.item.kind !== FLOWER + colourAt(ctx, pot)) {
      ctx.strike(ev.side);
      ctx.giveItem(ev.side, ev.item.id);
      return;
    }
    s.bloom = pot;
    ctx.emit('chime');
  },

  isSolved: (s) => s.bloom !== null,

  visible(s, ctx, side) {
    const locked = lockedUntil(ctx, 6);
    return pots(ctx).map((p, i) =>
      side === 'in'
        ? { type: 'f4-flowerpot', x: p.x, y: p.y, state: colourAt(ctx, i) }
        : { type: 'f4-pot', x: p.x, y: p.y, state: i === s.bloom ? `bloom-${colourAt(ctx, i)}` : locked ? 'locked' : 'empty' },
    );
  },

  objective(s, ctx, side) {
    if (s.bloom !== null) return 'The flower is in bloom.';
    if (side === 'in') return "Five flowers. Tell your partner which pot matches their flower's colour (you see the room mirrored).";
    return lockedUntil(ctx, 6) ? 'Five empty pots. They are waiting for a flower.' : 'Plant the flower in the pot your partner names.';
  },
};
