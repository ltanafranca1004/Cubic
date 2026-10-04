import { SIZE, VIEW } from './tokens';

// WHAT FITS WHERE. The arithmetic behind the pixel grid, with no DOM in it, so it can be
// tested (client/test/mobile.test.ts). style/scale.ts binds it to the real window.
//
// Three layouts in game:
//   desktop   mouse and keyboard: the view on the left, one HUD column on the right.
//   wide      a tablet held sideways: the desktop layout, moved to the top of the screen,
//             with a strip under it for the touch controls.
//   compact   a phone held sideways: the view in the middle at the largest zoom the height
//             allows, a rail on each side for the touch controls, and the HUD column folded
//             away into a panel.
//
// WHOLE PIXELS. On a desktop one art pixel is a whole number of CSS pixels, as it always
// was. A phone has three or so device pixels per CSS pixel and very few CSS pixels, so
// there the grid is the DEVICE pixel: every scale is a whole number of device pixels per
// art pixel (x5 device pixels on an iPhone is 1.667 CSS pixels), which is just as crisp
// and lets the view fill the height instead of stopping at x1.

export interface Device {
  /** A touch screen is the main pointer (or ?touch forces it). */
  touch: boolean;
  /** Device pixels per CSS pixel. */
  dpr: number;
}

export const DESKTOP: Device = { touch: false, dpr: 1 };

export type LayoutMode = 'desktop' | 'wide' | 'compact';

/** The touch layouts, in CSS pixels (thumbs do not scale with the art). */
export const TOUCH = {
  /** The menus' minimum logical height on a touch screen (SIZE.minHeight on a desktop). */
  minHeight: 250,
  /** From this size up a touch screen gets the desktop layout plus a control strip. */
  wideMinWidth: 960,
  wideMinHeight: 600,
  /** wide: the least height of the strip under the view that holds the controls. */
  strip: 124,
  /** compact: the least width of the rail on each side of the view. */
  rail: 180,
  /** The d-pad: never larger, never smaller. */
  padMax: 132,
  /** ... and on a tablet, where there is room and the hand is further away. */
  padWide: 156,
  padMin: 104,
  /** An action button: never wider, never narrower (44 is the smallest a thumb hits). */
  buttonMax: 64,
  buttonMin: 44,
  buttonHeight: 56,
  /** Between controls, and from a control to the screen edge. */
  margin: 8,
  gap: 6,
} as const;

/** Everything above and below the view in the desktop grid: frame, edge bands and their gaps. */
const MID_CHROME = 2 * VIEW.frame + 2 * VIEW.edge + 4;

/** The largest scale on the pixel grid that is not over `v`. */
export function wholeDown(v: number, d: Device): number {
  if (!d.touch) return Math.floor(v);
  return Math.floor(v * d.dpr + 1e-6) / d.dpr;
}

/** A CSS length moved onto a whole device pixel (so a canvas edge is never between two). */
export function snap(v: number, d: Device): number {
  return Math.round(v * d.dpr) / d.dpr;
}

/** Taller than wide: a phone or tablet held upright. */
export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

export function layoutMode(width: number, height: number, d: Device): LayoutMode {
  if (!d.touch) return 'desktop';
  return width >= TOUCH.wideMinWidth && height >= TOUCH.wideMinHeight ? 'wide' : 'compact';
}

/** The scale of the menus: the largest that still leaves the design's minimum logical screen. */
export function uiScaleFor(width: number, height: number, d: Device): number {
  const minHeight = d.touch ? TOUCH.minHeight : SIZE.minHeight;
  return Math.max(1, Math.min(8, wholeDown(Math.min(width / SIZE.minWidth, height / minHeight), d)));
}

/** The scale of the in-game DOM. */
export function hudScaleFor(width: number, height: number, d: Device): number {
  const ui = uiScaleFor(width, height, d);
  switch (layoutMode(width, height, d)) {
    case 'desktop':
      return Math.max(1, Math.min(ui, Math.floor(height / VIEW.hudHeight)));
    case 'wide':
      return Math.max(1, Math.min(ui, wholeDown((height - TOUCH.strip) / VIEW.hudHeight, d)));
    case 'compact':
      return ui; // the column is a panel of its own there
  }
}

/** The game view's zoom. */
export function viewZoomFor(width: number, height: number, d: Device): number {
  const u = hudScaleFor(width, height, d);
  const beside = (width - (VIEW.chromeX + VIEW.columnMin) * u) / VIEW.px;
  switch (layoutMode(width, height, d)) {
    case 'desktop':
      return Math.max(1, Math.floor(Math.min((height - VIEW.chromeY * u) / VIEW.px, beside)));
    case 'wide':
      return Math.max(1, wholeDown(Math.min((height - TOUCH.strip - MID_CHROME * u) / VIEW.px, beside), d));
    case 'compact':
      return Math.max(1, wholeDown(Math.min(height / VIEW.px, (width - 2 * TOUCH.rail) / VIEW.px), d));
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface CompactLayout {
  u: number;
  z: number;
  /** The game view, in CSS pixels from the top left of the safe area. */
  view: { x: number; y: number; size: number };
  /** The width of the rail on each side of the view. */
  rail: number;
  /** The part of a rail next to the view that holds the label of the face across that edge. */
  band: number;
  /** The side of the d-pad. */
  pad: number;
  /** The width of one action button (three in a row). */
  button: number;
}

/** A phone held sideways: where the view sits and how large the controls beside it are. */
export function compactLayout(width: number, height: number, d: Device): CompactLayout {
  const u = hudScaleFor(width, height, d);
  const z = viewZoomFor(width, height, d);
  const size = VIEW.px * z;
  const x = snap((width - size) / 2, d);
  const y = snap(Math.max(0, (height - size) / 2), d);
  const band = Math.ceil((VIEW.edge + 2) * u);
  const room = x - band - 2 * TOUCH.margin;
  return {
    u,
    z,
    view: { x, y, size },
    rail: x,
    band,
    pad: Math.floor(clamp(Math.min(room, height * 0.42), TOUCH.padMin, TOUCH.padMax)),
    button: Math.floor(clamp((room - 2 * TOUCH.gap) / 3, TOUCH.buttonMin, TOUCH.buttonMax)),
  };
}

export interface WideLayout {
  u: number;
  z: number;
  /** The height of the view with its frame and edge labels. */
  mid: number;
  /** What is left under it for the controls. */
  strip: number;
  pad: number;
  button: number;
}

/** A tablet held sideways: the desktop layout at the top, the controls in the strip below. */
export function wideLayout(width: number, height: number, d: Device): WideLayout {
  const u = hudScaleFor(width, height, d);
  const z = viewZoomFor(width, height, d);
  const mid = VIEW.px * z + MID_CHROME * u;
  const strip = Math.max(0, height - mid);
  // (the labels are drawn at the HUD's scale there, so the buttons grow with it)
  return { u, z, mid, strip, pad: Math.floor(clamp(strip - TOUCH.margin, TOUCH.padMin, TOUCH.padWide)), button: Math.max(TOUCH.buttonMax, Math.round(40 * u)) };
}
