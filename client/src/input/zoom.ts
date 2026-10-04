import { zoomed } from '../style/scale';
import { TAP_SLOP, cancelsPinch, isDoubleTap, ownsItsTaps, type Tap } from './zoomRules';

// THE PAGE DOES NOT ZOOM. A phone zooms a page on a double tap and on a pinch, and iOS
// Safari does so whatever the viewport meta says (it ignores user-scalable=no and
// maximum-scale), so the meta alone holds nothing. Three things hold it, each enough by
// itself on the browsers that honour it:
//
//   - touch-action in CSS (ui/mobile/css.ts, and index.html before the script is in);
//   - the events a pinch is made of are cancelled: a second finger going down or moving,
//     and Safari's own gesturestart / gesturechange / gestureend;
//   - the second tap of a double tap is cancelled, and its click is given back (cancelling
//     a touchend takes the click with it, and a button tapped twice is pressed twice).
//
// AND IF IT ZOOMED ANYWAY (visualViewport.scale is not 1), all three stand down, here and
// in the CSS (html[data-zoomed]): the same guards that could not stop the zoom would
// otherwise stop the two fingers that undo it, which is how the game got stuck zoomed in.
// The layout keeps its x1 size meanwhile (style/scale.ts visibleSize), and at x1 the page
// is locked again. The rules themselves are in ./zoomRules.ts (pure, tested).

/**
 * Hold the page at x1 (see above). Returns the way to stop. Listens on the document, in
 * the capture phase, so nothing can swallow an event first.
 */
export function guardZoom(): () => void {
  const offs: (() => void)[] = [];
  const on = (type: string, fn: (e: Event) => void, capture = true) => {
    document.addEventListener(type, fn, { capture, passive: false });
    offs.push(() => document.removeEventListener(type, fn, { capture }));
  };
  const cancel = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };

  // a pinch: Safari's gesture events, and everywhere the second finger
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) on(type, (e) => !zoomed() && cancel(e));
  // (and a double click made of two taps is nothing either, outside a text field)
  on('dblclick', (e) => !zoomed() && !ownsItsTaps(e.target as HTMLElement | null) && cancel(e));
  const twoFingers = (e: Event) => {
    if (cancelsPinch((e as TouchEvent).touches?.length ?? 0, zoomed())) cancel(e);
  };
  on('touchstart', twoFingers);
  on('touchmove', twoFingers);

  // a double tap. In the bubble phase: by then the canvas has taken its own taps (Phaser
  // cancels them), and those need nothing from here.
  let start: Tap | null = null;
  let last: Tap | null = null;
  on('touchstart', (e) => {
    const t = (e as TouchEvent).touches;
    start = t?.length === 1 ? { t: e.timeStamp, x: t[0]!.clientX, y: t[0]!.clientY } : null;
    if (!start) last = null; // a second finger: whatever this is, it is not a double tap
  });
  on(
    'touchend',
    (e) => {
      const touch = (e as TouchEvent).changedTouches?.[0];
      const from = start;
      start = null;
      if (!touch || !from || ((e as TouchEvent).touches?.length ?? 0) > 0) return;
      if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > TAP_SLOP) {
        last = null; // the end of a drag
        return;
      }
      const tap: Tap = { t: e.timeStamp, x: touch.clientX, y: touch.clientY };
      const second = isDoubleTap(last, tap);
      last = tap;
      const target = e.target as HTMLElement | null;
      if (!second || zoomed() || e.defaultPrevented || !e.cancelable || ownsItsTaps(target)) return;
      e.preventDefault();
      target?.click?.(); // the click the browser now leaves out
    },
    false,
  );

  return () => {
    for (const off of offs) off();
  };
}
