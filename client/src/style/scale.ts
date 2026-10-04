import { DESKTOP, hudScaleFor, layoutMode, uiScaleFor, viewZoomFor, type Device, type LayoutMode } from './fit';

// ONE PIXEL GRID. Menus, HUD and the game view all draw at a whole-number scale, so an art
// pixel is the same size everywhere on screen. The scale is the largest that still leaves
// the design's minimum logical screen (480x270).
//
// The arithmetic is in ./fit.ts (pure, tested). This file binds it to the real window:
// which device this is, and how much of the window may be drawn on.

let found: Device | null = null;

/**
 * The device we run on, decided once. Touch means the MAIN pointer is a finger (a phone, a
 * tablet): a laptop with a touch screen, or a narrow desktop window, is still a desktop.
 * `?touch` forces it, to try the touch layout with a mouse.
 */
export function device(): Device {
  if (found) return found;
  if (typeof window === 'undefined') return DESKTOP; // node: the check scripts in tools/screens
  const flag = new URLSearchParams(window.location.search).get('touch');
  const media = (q: string) => !!window.matchMedia?.(q).matches;
  const touch = flag !== null ? flag !== '0' : media('(pointer: coarse)') || (media('(any-pointer: coarse)') && media('(hover: none)'));
  found = touch ? { touch, dpr: Math.max(1, window.devicePixelRatio || 1) } : DESKTOP;
  return found;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLElement | null = null;

/** The notch, the rounded corners and the home bar (env(safe-area-inset-*)), in CSS pixels. */
export function safeInsets(): Insets {
  if (!device().touch) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.documentElement.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
}

let last: { width: number; height: number } | null = null;

/**
 * The part of the window the game is laid out in. On a desktop that is the window. On a
 * touch screen it stops short of the notch on the left, right and top (the bottom is
 * kept: the picture may run under the home bar, the controls stay clear of it in CSS), and
 * it does not shrink while the on-screen keyboard is up, so typing never rescales the game.
 */
export function viewport(): { width: number; height: number } {
  if (!device().touch) return { width: window.innerWidth, height: window.innerHeight };
  const inset = safeInsets();
  const width = window.innerWidth - inset.left - inset.right;
  const height = window.innerHeight - inset.top;
  const typing = document.activeElement instanceof HTMLInputElement;
  if (typing && last && width === last.width && height < last.height) return last;
  last = { width, height };
  return last;
}

export function uiScale(width = viewport().width, height = viewport().height): number {
  return uiScaleFor(width, height, device());
}

/** The window in art pixels at the current scale (rounded up: the canvas covers the window). */
export function logicalSize(): { width: number; height: number; scale: number } {
  const { width, height } = viewport();
  const scale = uiScale(width, height);
  return { width: Math.ceil(width / scale), height: Math.ceil(height / scale), scale };
}

// IN GAME the screen is split in two: the game view on the left, as large as it can be,
// and one HUD column on the right. Each has its own whole-number scale, so both stay on a
// pixel grid: the DOM at `hudScale` (the "u" of ui/css.ts while playing) and the game view
// at `viewZoom`. The sizes they share are in VIEW (style/tokens.ts). A touch screen gets
// one of the two touch layouts instead (./fit.ts, ui/mobile).

/** Which in-game layout this window gets. */
export function layout(width = viewport().width, height = viewport().height): LayoutMode {
  return layoutMode(width, height, device());
}

/** The scale of the in-game DOM: the largest that leaves the HUD column its logical height. */
export function hudScale(width = viewport().width, height = viewport().height): number {
  return hudScaleFor(width, height, device());
}

/**
 * The game view's own zoom: the largest whole number at which the view, its frame and the
 * edge labels fit the height, and the HUD column still gets its minimum width. For example
 * x5 at 1920x1080 and x3 at 1280x720.
 */
export function viewZoom(width = viewport().width, height = viewport().height): number {
  return viewZoomFor(width, height, device());
}
