import type { Dir } from './keymap';

// The on-screen d-pad's one rule, with no DOM in it (client/test/mobile.test.ts): which
// direction a thumb is pressing, from where it is on the pad.

/** The middle of the pad, as a share of its half size, where no direction is pressed. */
export const PAD_DEADZONE = 0.22;
/** To leave the direction already held, the other axis must lead by this much (no flicker on a diagonal). */
export const PAD_STICKY = 1.25;

/**
 * `dx`, `dy`: the touch point from the centre of the pad, in the same unit as `half` (half
 * the pad's side). The stronger axis wins, as on a gamepad stick. A thumb that slides off
 * the pad keeps its direction (the angle still says which), so there is no outer limit.
 */
export function dpadDir(dx: number, dy: number, half: number, held: Dir | null = null): Dir | null {
  if (half <= 0 || Math.hypot(dx, dy) < half * PAD_DEADZONE) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const heldIsX = held === 'left' || held === 'right';
  const horizontal = held === null ? ax > ay : heldIsX ? ax * PAD_STICKY > ay : ax > ay * PAD_STICKY;
  return horizontal ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}
