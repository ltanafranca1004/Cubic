import type { PuzzleModule } from './types';
import { FLOWER_ID, flowerKind } from './chain';
import { at } from './util';

// LASER AND INVISIBLE PATH (face 6: Cave outside, Lava room inside).
// STUB: either player presses E on the crystal of this face and it is solved. It keeps the
// game winnable until the real puzzle replaces this file (same id, same face, same export).
//
// Map objects used: "crystal" on both sides (same tile).

const FACE = 6;

interface State {
  done: boolean;
}

export const laserPath: PuzzleModule<State> = {
  id: 'laser-path',
  face: FACE,

  init: () => ({ done: false }),

  onUse(s, ctx, side, tile) {
    if (s.done || !ctx.objects(side, FACE, 'crystal').some((c) => at(c, tile))) return;
    s.done = true;
    // Like the real puzzle: the flower appears outside, for a pot on face 4.
    const c = ctx.objects('out', FACE, 'crystal')[0];
    ctx.spawnItem({ id: FLOWER_ID, kind: flowerKind(ctx.seed), side: 'out', face: FACE, x: c.x, y: c.y });
  },

  isSolved: (s) => s.done,

  visible: (s, ctx, side) => ctx.objects(side, FACE, 'crystal').map((c) => ({ type: 'crystal', x: c.x, y: c.y, state: s.done ? 'taken' : 'idle' })),

  objective: () => 'A crystal. Press E on it.',
};
