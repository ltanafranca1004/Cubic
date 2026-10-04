// The rules of input/zoom.ts, with no DOM in them, so they can be tested
// (client/test/zoom.test.ts).

export interface Tap {
  /** When the finger lifted, in ms. */
  t: number;
  x: number;
  y: number;
}

/** A second tap this soon and this close to the first is a double tap to a phone. */
export const DOUBLE_TAP = { ms: 400, px: 48 } as const;
/** A finger that travelled further than this was a drag, not a tap. */
export const TAP_SLOP = 16;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  const dt = next.t - prev.t;
  return dt >= 0 && dt <= DOUBLE_TAP.ms && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP.px;
}

/** Text being edited: a double tap there selects a word, and is the field's own business. */
export function ownsItsTaps(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** What to do with a touchstart or touchmove: cancel it when it is the second finger of a pinch. */
export function cancelsPinch(touches: number, pageZoomed: boolean): boolean {
  return !pageZoomed && touches > 1;
}
