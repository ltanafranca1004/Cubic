import { DESKTOP, hudScaleFor, isPortrait, isZoomed, layoutMode, uiScaleFor, viewZoomFor, visibleFrom, type Device, type LayoutMode } from './fit';

// ONE PIXEL GRID. Menus, HUD and the game view all draw at a whole-number scale, so an art
// pixel is the same size everywhere on screen. The scale is the largest that still leaves
// the design's minimum logical screen (480x270).
//
// The arithmetic is in ./fit.ts (pure, tested). This file binds it to the real window:
// which device this is, and how much of the window may be drawn on.

let found: Device | null = null;

/**
 * The device we run on. Touch means the MAIN pointer is a finger (a phone, a tablet): a
 * laptop with a touch screen, or a narrow desktop window, is still a desktop. `?touch`
 * forces it, to try the touch layout with a mouse. Never the user agent or a device name.
 * Read again on every fit (a keyboard clipped onto a tablet, a window dragged to another
 * screen), see onFit below.
 */
export function device(): Device {
  if (found) return found;
  if (typeof window === 'undefined') return DESKTOP; // node: the check scripts in tools/screens
  found = readDevice();
  return found;
}

function readDevice(): Device {
  const flag = new URLSearchParams(window.location.search).get('touch');
  const media = (q: string) => !!window.matchMedia?.(q).matches;
  const touch = flag !== null ? flag !== '0' : media('(pointer: coarse)') || (media('(any-pointer: coarse)') && media('(hover: none)'));
  return touch ? { touch, dpr: Math.max(1, window.devicePixelRatio || 1) } : DESKTOP;
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

/**
 * THE ONE SIZE everything is laid out from: the part of the page that can be seen right
 * now. The visual viewport knows about a phone's sliding toolbars and a tablet's split
 * view where window.innerWidth can lag behind; a browser without it falls back to the
 * layout viewport, then to the window. A page zoomed in with two fingers keeps the size it
 * had at x1 (fit.ts visibleFrom): the game stays as it was laid out, under the zoom.
 */
export function visibleSize(): { width: number; height: number } {
  const vv = window.visualViewport;
  const el = document.documentElement;
  const layoutSize = el.clientWidth > 0 && el.clientHeight > 0 ? { width: el.clientWidth, height: el.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
  const size = visibleFrom(vv ? { width: vv.width, height: vv.height, scale: vv.scale } : null, seenAtRest, layoutSize);
  if (!vv || !isZoomed(vv.scale)) seenAtRest = size;
  return size;
}

/** The last visible size measured with the page at x1. */
let seenAtRest: { width: number; height: number } | null = null;

/**
 * The page is zoomed (iOS Safari lets two fingers and a double tap zoom whatever the
 * viewport meta says). Part of every fit: a pass runs when this flips, and the touch layer
 * (ui/mobile) then lets go of the page so the same two fingers can zoom back out.
 */
export function zoomed(): boolean {
  return typeof window !== 'undefined' && isZoomed(window.visualViewport?.scale);
}

let last: { width: number; height: number } | null = null;

/**
 * The part of the window the game is laid out in. On a desktop that is the window. On a
 * touch screen it stops short of the notch on the left, right and top (the bottom is
 * kept: the picture may run under the home bar, the controls stay clear of it in CSS), and
 * it does not shrink while the on-screen keyboard is up, so typing never rescales the game.
 */
export function viewport(): { width: number; height: number } {
  const size = visibleSize();
  if (!device().touch) return size;
  const inset = safeInsets();
  const width = size.width - inset.left - inset.right;
  const height = size.height - inset.top;
  const typing = document.activeElement instanceof HTMLInputElement;
  if (typing && last && width === last.width && height < last.height) return last;
  last = { width, height };
  return last;
}

/** Held upright: taller than wide, by the same size everything else uses. */
export function upright(): boolean {
  const { width, height } = visibleSize();
  return isPortrait(width, height);
}

// RE-FIT. Everything that lays out from the size above subscribes here, and nowhere else:
// one pass, in the order of subscription, whenever the size, the safe area, the pixel
// density or the pointer changes. The browser has many ways of saying so (and Safari does
// not always say `resize`), so all of them are heard, and a pass only runs when one of
// those numbers really changed.

const fitters: (() => void)[] = [];
let fitKey = '';
let queued = 0;
let listening = false;

function measureKey(): string {
  found = readDevice();
  const { width, height } = viewport();
  const inset = safeInsets();
  return [width, height, inset.top, inset.right, inset.bottom, inset.left, found.touch, found.dpr, zoomed()].join();
}

/** Lay everything out again now (after mounting something that changes the layout). */
export function refit(): void {
  fitKey = measureKey();
  for (const fn of [...fitters]) fn();
}

function check(): void {
  queued = 0;
  if (measureKey() !== fitKey) refit();
}

function queue(): void {
  if (!queued) queued = requestAnimationFrame(check);
}

function listen(): void {
  listening = true;
  fitKey = measureKey();
  // a rotation settles late on iOS: look again once it has
  const late = () => {
    queue();
    setTimeout(queue, 120);
    setTimeout(queue, 500);
  };
  window.addEventListener('resize', queue);
  window.addEventListener('orientationchange', late);
  window.addEventListener('pageshow', late);
  window.visualViewport?.addEventListener('resize', queue);
  window.screen?.orientation?.addEventListener?.('change', late);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(queue).observe(document.documentElement);
  for (const q of ['(pointer: coarse)', '(any-pointer: coarse)', '(hover: none)', '(orientation: portrait)']) window.matchMedia?.(q).addEventListener?.('change', queue);
  late(); // and once after the first layout, in case the page was measured before it settled
}

/** Call `fn` on every re-fit. Returns the way to stop. */
export function onFit(fn: () => void): () => void {
  if (!listening) listen();
  fitters.push(fn);
  return () => {
    const i = fitters.indexOf(fn);
    if (i >= 0) fitters.splice(i, 1);
  };
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
