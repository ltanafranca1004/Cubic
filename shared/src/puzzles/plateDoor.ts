import type { PuzzleModule } from './types';

// EXAMPLE PUZZLE (face 1). Copy _template.ts, not this file, to start your own.
// Inside stands on a plate; while they do, a door on the outside is open. Outside walks
// through the door and takes the crystal behind it. Neither side can see the other's part.
//
// Map objects used: outside "door" and "crystal", inside "plate".

interface State {
  /** The inside player is on the plate. */
  pressed: boolean;
  /** The outside player has reached the crystal. */
  taken: boolean;
}

const at = (o: { x: number; y: number } | undefined, t: { x: number; y: number }) => !!o && o.x === t.x && o.y === t.y;

export const plateDoor: PuzzleModule<State> = {
  id: 'plate-door',
  face: 1,

  init: () => ({ pressed: false, taken: false }),

  isBlocked(s, ctx, side, tile) {
    if (side !== 'out') return false;
    const door = ctx.objects('out', 1, 'door')[0];
    // Stays open once solved, so nobody gets sealed in.
    return at(door, tile) && !s.pressed && !s.taken;
  },

  onEnter(s, ctx, side, tile) {
    if (side === 'in' && at(ctx.objects('in', 1, 'plate')[0], tile)) {
      s.pressed = true;
      ctx.emit('door-open');
    }
    if (side === 'out' && at(ctx.objects('out', 1, 'crystal')[0], tile)) s.taken = true;
  },

  onLeave(s, ctx, side, tile) {
    if (side === 'in' && at(ctx.objects('in', 1, 'plate')[0], tile)) {
      s.pressed = false;
      if (!s.taken) ctx.emit('door-close');
    }
  },

  isSolved: (s) => s.taken,

  visible(s, ctx, side) {
    if (side === 'in') {
      return ctx.objects('in', 1, 'plate').map((p) => ({ type: 'plate', x: p.x, y: p.y, state: s.pressed ? 'on' : 'off' }));
    }
    const open = s.pressed || s.taken;
    return [
      ...ctx.objects('out', 1, 'door').map((d) => ({ type: 'door', x: d.x, y: d.y, state: open ? 'open' : 'closed' })),
      ...ctx.objects('out', 1, 'crystal').map((c) => ({ type: 'crystal', x: c.x, y: c.y, state: s.taken ? 'taken' : 'idle' })),
    ];
  },

  objective(s, _ctx, side) {
    if (side === 'in') return 'A plate on the floor. It is wired to something you cannot see.';
    return s.pressed ? 'The door is open. Go!' : 'A crystal sits behind a sealed door. Its mechanism is somewhere inside.';
  },
};
