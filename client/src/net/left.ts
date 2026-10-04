// The seat a tab pressed Leave on, as it is kept in sessionStorage. Pure: no socket, no DOM.

/** How long the server holds a seat after Leave (SEAT_HOLD_MS in server/src/rooms.ts). */
export const SEAT_HOLD_MS = 60_000;

/** A seat as we keep it. `solo` and `at` (when Leave was pressed, our clock) only on the left seat. */
export type Saved = { code: string; token: string; solo?: boolean; at?: number };

/**
 * The solo game a tab pressed Leave in: until when the server holds it (our clock), or
 * null when there is none or the window has passed. A friend room is not offered: its
 * code is what brings you back.
 */
export function soloLeftUntil(left: Saved | null, now: number): number | null {
  if (!left?.solo || typeof left.at !== 'number') return null;
  const until = left.at + SEAT_HOLD_MS;
  return now < until ? until : null;
}
