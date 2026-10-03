import type { PuzzleModule } from './types';

// EXAMPLE CARRY PUZZLE (face 6). The outside player finds a rose on face 1 and has to
// carry it to the pot on face 6, the far side of the cube from where they start, so the
// two players drift out of earshot on the way.
//
// Map objects used: outside item "rose" (kind "rose") on face 1, outside "target" on face 6.

interface State {
  planted: boolean;
}

export const rosePot: PuzzleModule<State> = {
  id: 'rose-pot',
  face: 6,

  init: () => ({ planted: false }),

  // Fires for item events on every face.
  onItem(s, ctx, ev) {
    if (ev.kind === 'placed' && ev.item.kind === 'rose' && ev.tile.face === 6) {
      s.planted = true;
      ctx.emit('bloom');
    }
  },

  isSolved: (s) => s.planted,

  objective(_s, ctx, side) {
    if (side === 'in') return 'The floor here hums. Something outside is missing.';
    const carrying = ctx.state.players.out.carrying !== null;
    return carrying ? 'An empty pot. Put the rose in it (E).' : 'An empty pot. It wants a flower from far away.';
  },
};
