import { SIZE } from './tokens';

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
