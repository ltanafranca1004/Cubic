import { SIZE, VIEW } from './tokens';

// ONE PIXEL GRID. Menus, HUD and the game view all draw at the same whole-number scale,
// so an art pixel is the same size everywhere on screen. The scale is the largest that
// still leaves the design's minimum logical screen (480x270).

export function uiScale(width = window.innerWidth, height = window.innerHeight): number {
  return Math.max(1, Math.min(8, Math.floor(Math.min(width / SIZE.minWidth, height / SIZE.minHeight))));
}

/** The window in art pixels at the current scale (rounded up: the canvas covers the window). */
export function logicalSize(): { width: number; height: number; scale: number } {
  const scale = uiScale();
  return { width: Math.ceil(window.innerWidth / scale), height: Math.ceil(window.innerHeight / scale), scale };
}

// IN GAME the screen is split in two: the game view on the left, as large as it can be,
// and one HUD column on the right. Each has its own whole-number scale, so both stay on a
// pixel grid: the DOM at `hudScale` (the "u" of ui/css.ts while playing) and the game view
// at `viewZoom`. The sizes they share are in VIEW (style/tokens.ts).

/** The scale of the in-game DOM: the largest that leaves the HUD column its logical height. */
export function hudScale(width = window.innerWidth, height = window.innerHeight): number {
  return Math.max(1, Math.min(uiScale(width, height), Math.floor(height / VIEW.hudHeight)));
}

/**
 * The game view's own zoom: the largest whole number at which the view, its frame and the
 * edge labels fit the height, and the HUD column still gets its minimum width. For example
 * x5 at 1920x1080 and x3 at 1280x720.
 */
export function viewZoom(width = window.innerWidth, height = window.innerHeight): number {
  const u = hudScale(width, height);
  const tall = (height - VIEW.chromeY * u) / VIEW.px;
  const wide = (width - (VIEW.chromeX + VIEW.columnMin) * u) / VIEW.px;
  return Math.max(1, Math.floor(Math.min(tall, wide)));
}
