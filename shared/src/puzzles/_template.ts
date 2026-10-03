import type { PuzzleModule } from './types';

// PUZZLE TEMPLATE. Copy this file, rename it, fill it in, then register the module in
// ./index.ts. Read ./README.md first. Rules:
//  - Pure logic only: no sockets, DOM, timers, Math.random or Date.now (use ctx.now).
//  - State must be plain JSON. Mutate `s` in place inside the hooks.
//  - Hooks only fire for tiles on `face`. Coordinates are canonical (same for both sides).
//  - Whatever you do not return from `visible` for a side, that side cannot see.

interface State {
  done: boolean;
}

export const myPuzzle: PuzzleModule<State> = {
  id: 'my-puzzle', // unique
  face: 2, // the face this puzzle owns

  init: (_ctx) => ({ done: false }),

  // Optional: block a tile for one side (on top of walls/trees/water).
  isBlocked(_s, _ctx, _side, _tile) {
    return false;
  },

  // Optional: someone stepped onto a tile of this face.
  onEnter(s, ctx, side, tile) {
    const goal = ctx.objects('out', 2, 'crystal')[0];
    if (side === 'out' && goal && goal.x === tile.x && goal.y === tile.y) {
      s.done = true;
      ctx.emit('my-sound');
    }
  },

  // Optional: someone stepped off a tile of this face.
  onLeave(_s, _ctx, _side, _tile) {},

  // Optional: called every TICK_MS on the server.
  onTick(_s, _ctx, _dtMs) {},

  isSolved: (s) => s.done,

  // Optional: what each side sees. Return different things per side.
  visible(_s, _ctx, _side) {
    return [];
  },

  // Optional: objective text per side.
  objective(_s, _ctx, side) {
    return side === 'out' ? 'What the outside player should know.' : 'What the inside player should know.';
  },
};
