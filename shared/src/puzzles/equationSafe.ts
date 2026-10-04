import type { PuzzleModule } from './types';
import { BATTERY_ID, BATTERY_KIND } from './chain';
import { at } from './util';

// EQUATION SAFE (face 2: Desert outside, Vault inside).
// STUB: either player presses E on the crystal of this face and it is solved. It keeps the
// game winnable until the real puzzle replaces this file (same id, same face, same export).
//
// Map objects used: "crystal" on both sides (same tile).

const FACE = 2;

interface State {
  done: boolean;
}

export const equationSafe: PuzzleModule<State> = {
  id: 'equation-safe',
  face: FACE,

  init: () => ({ done: false }),

  onUse(s, ctx, side, tile) {
    if (s.done || !ctx.objects(side, FACE, 'crystal').some((c) => at(c, tile))) return;
    s.done = true;
    // Like the real puzzle: the battery appears inside, for face 5.
    const c = ctx.objects('in', FACE, 'crystal')[0];
    ctx.spawnItem({ id: BATTERY_ID, kind: BATTERY_KIND, side: 'in', face: FACE, x: c.x, y: c.y });
  },

  isSolved: (s) => s.done,

  visible: (s, ctx, side) => ctx.objects(side, FACE, 'crystal').map((c) => ({ type: 'crystal', x: c.x, y: c.y, state: s.done ? 'taken' : 'idle' })),

  objective: () => 'A crystal. Press E on it.',
};
