import { NORMALS, neg, type FaceId, type Vec } from '@cubic/shared';

// FACE TRANSITIONS, the pure part (no Phaser, no DOM: the tests import this file).
// Walking over a cube edge is drawn in the walker's own screen space, so the direction of
// the turn is just the screen direction walked. Each face is painted with its own `up`
// (the old face with the up from before the step, the new one with the up after it), which
// is what makes the shared edge line up on every edge, around the 270-degree corners and
// with any compass drift.

/** Outside: the cube rolls over the edge. */
export const ROLL_MS = 500;
/** Inside: the character hops the wall while the view slides. */
export const HOP_MS = 400;
/** "Reduce motion": a quick cross-fade instead. */
export const FADE_MS = 160;

export type TransitionKind = 'roll' | 'hop' | 'fade';

export function transitionKind(side: 'out' | 'in', reduceMotion: boolean): TransitionKind {
  return reduceMotion ? 'fade' : side === 'out' ? 'roll' : 'hop';
}

export const transitionMs = (kind: TransitionKind): number => (kind === 'roll' ? ROLL_MS : kind === 'hop' ? HOP_MS : FADE_MS);

/**
 * The player's `up` just before a step that crossed onto face `to` (the inverse of
 * stepPose): off the top the old up pointed at the new face, off the bottom away from it,
 * and sideways it did not change.
 */
export function upBeforeFlip(to: FaceId, upAfter: Vec, dy: number): Vec {
  return dy < 0 ? NORMALS[to] : dy > 0 ? neg(NORMALS[to]) : upAfter;
}

/** Slow start, slow end. */
export const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

// ---------- the roll: a turning cube, drawn one pixel column at a time ----------

/** Camera distance from the cube centre, in face widths. Closer = stronger perspective. */
const CAMERA = 2;
/** How dark a face is when it is seen edge-on. */
const SHADE = 0.55;

interface Rig {
  /** Half a face. */
  a: number;
  /** Camera distance and focal length: a face seen head-on is drawn 1:1. */
  d: number;
  f: number;
  sin: number;
  cos: number;
  /** Shrinks the whole cube so that the turning corner never leaves the view. */
  zoom: number;
}

function rig(size: number, theta: number): Rig {
  const a = size / 2;
  const d = CAMERA * size;
  const f = d - a;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  // The shared edge is the nearest point (tallest), the two far edges are the widest.
  const tall = f / (d - a * (sin + cos));
  const wideOld = (f * (cos + sin)) / (d - a * (cos - sin));
  const wideNew = (f * (cos + sin)) / (d - a * (sin - cos));
  return { a, d, f, sin, cos, zoom: 1 / Math.max(1, tall, wideOld, wideNew) };
}

export interface Strip {
  /** 0 = the face being left, 1 = the face being entered, -1 = nothing (background). */
  face: -1 | 0 | 1;
  /** Which pixel column (or row) of that face to draw. */
  src: number;
  /** Where it starts across the roll axis, and how long it is, in whole pixels. */
  start: number;
  length: number;
  /** 1 = full brightness; less as the face turns away. */
  light: number;
}

/**
 * One frame of the roll. `turn` goes 0 (old face head-on) to 1 (new face head-on), a
 * quarter turn of the cube. Returns one strip per screen pixel along the direction walked,
 * for a step in the POSITIVE direction (right or down: the new face comes in from the far
 * end). For left or up, mirror both the index and `src` (see `mirrorStrip`).
 */
export function rollStrips(turn: number, size: number): Strip[] {
  const r = rig(size, (Math.max(0, Math.min(1, turn)) * Math.PI) / 2);
  const { a, d, f, sin, cos, zoom } = r;
  const oldFacing = d * cos > a;
  const newFacing = d * sin > a;
  const strips: Strip[] = [];
  const strip = (face: 0 | 1, s: number, depth: number, light: number): Strip => {
    const length = Math.max(1, Math.round((size * zoom * f) / (d - depth)));
    return { face, src: Math.min(size - 1, Math.max(0, Math.floor(s + a))), start: Math.round((size - length) / 2), length: Math.min(size, length), light };
  };
  for (let i = 0; i < size; i++) {
    const x = (i + 0.5 - a) / zoom;
    let hit: Strip | null = null;
    if (oldFacing) {
      const den = f * cos + x * sin;
      const s = den > 1e-9 ? (x * (d - a * cos) + f * a * sin) / den : NaN;
      if (s >= -a && s < a) hit = strip(0, s, s * sin + a * cos, 1 - SHADE * sin);
    }
    if (!hit && newFacing) {
      const den = x * cos - f * sin;
      const s = den < -1e-9 ? (f * a * cos - x * (d - a * sin)) / den : NaN;
      if (s >= -a && s < a) hit = strip(1, s, a * sin - s * cos, 1 - SHADE * cos);
    }
    strips.push(hit ?? { face: -1, src: 0, start: 0, length: 0, light: 0 });
  }
  return strips;
}

/** A positive-direction strip index or source column, as seen for a step left or up. */
export const mirrorStrip = (index: number, size: number): number => size - 1 - index;

/**
 * Where a point of a face is on screen during the roll (positive direction, like
 * rollStrips). `along` is its pixel position in the direction walked, `across` the other
 * axis, both 0..size on that face.
 */
export function rollPoint(turn: number, size: number, face: 0 | 1, along: number, across: number): { along: number; across: number } {
  const { a, d, f, sin, cos, zoom } = rig(size, (Math.max(0, Math.min(1, turn)) * Math.PI) / 2);
  const s = along - a;
  const x = face === 0 ? s * cos - a * sin : a * cos + s * sin;
  const depth = face === 0 ? s * sin + a * cos : a * sin - s * cos;
  const k = (zoom * f) / (d - depth);
  return { along: a + x * k, across: a + (across - a) * k };
}

/**
 * The character steps over the edge during the roll: from the middle of the last tile of
 * the old face to the middle of the first tile of the new one. Returns which face they are
 * on and how far along it (pixels), for the positive direction.
 */
export function rollWalker(turn: number, size: number, tile: number): { face: 0 | 1; along: number } {
  const p = Math.max(0, Math.min(1, turn)) * tile;
  return p < tile / 2 ? { face: 0, along: size - tile / 2 + p } : { face: 1, along: p - tile / 2 };
}

/** Height of the inside player's hop over the wall at progress `k` (0..1), in pixels. */
export const hopLift = (k: number, height: number): number => Math.round(Math.sin(Math.PI * Math.max(0, Math.min(1, k))) * height);

// ---------- the hop: crouch, jump the wall in an arc, land ----------

/** The beats of the hop, as fractions of HOP_MS: on the ground before TAKEOFF and after LANDING. */
export const HOP_TAKEOFF = 0.12;
export const HOP_LANDING = 0.86;
/** The ground shadow: a flat blob this tall, darkest when the character stands on it. */
export const HOP_SHADOW_H = 4;
export const HOP_SHADOW_ALPHA = 0.6;
const SHADOW_ALPHA_APEX = 0.4;
/** The carried item rides this far above the character's head (as it does standing still). */
const CARRY_PX = 11;

export interface HopShape {
  /** The character's size standing still (a tile). */
  size: number;
  /** How far the view slides: a face plus the wall. */
  span: number;
  /** How far the character travels over the ground: a tile plus the wall. */
  reach: number;
  /** The top of the arc, in pixels above the ground. */
  height: number;
}

/** One frame of the hop. Every length is a whole number of pixels. */
export interface HopFrame {
  /** How far the view has slid towards the next room: 0..span, eased. */
  slide: number;
  /** How far the character's ground point has travelled: 0..reach. */
  travel: number;
  /** How high the character is above the ground. */
  lift: number;
  /** The character's drawn size: squashed on the ground, stretched and nearer (bigger) in the air. */
  width: number;
  height: number;
  /** The shadow shrinks and fades as the character rises; it is gone standing still. */
  shadowWidth: number;
  shadowAlpha: number;
}

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k));

/**
 * The hop at progress `k` (0..1). The view slides the whole time (slow, fast, slow); the
 * character crouches, flies over the wall (highest right above it) and lands with a squash.
 * At k = 0 and k = 1 it is exactly the standing character: no jump on either end.
 */
export function hopFrame(k: number, shape: HopShape): HopFrame {
  const { size, span, reach } = shape;
  k = clamp01(k);
  const air = clamp01((k - HOP_TAKEOFF) / (HOP_LANDING - HOP_TAKEOFF));
  const lift = hopLift(air, shape.height);
  const up = shape.height > 0 ? lift / shape.height : 0;
  // Sizes change by two pixels at a time, so the character stays centred on whole pixels.
  let width = size;
  let height = size;
  if (k < HOP_TAKEOFF) {
    const crouch = k / HOP_TAKEOFF;
    width += 2 * Math.round(crouch);
    height -= Math.round(4 * crouch);
  } else if (k >= HOP_LANDING) {
    const squash = (1 - k) / (1 - HOP_LANDING);
    width += 2 * Math.round(squash);
    height -= Math.round(3 * squash);
  } else {
    const near = 2 * Math.round(2 * up);
    width += near;
    height += near + (up < 0.6 ? 2 : 0);
  }
  const grounded = k < HOP_TAKEOFF ? k / HOP_TAKEOFF : k > HOP_LANDING ? (1 - k) / (1 - HOP_LANDING) : 1;
  return {
    slide: Math.round(easeInOut(k) * span),
    travel: Math.round(air * reach),
    lift,
    width,
    height,
    shadowWidth: size - 2 - 2 * Math.round(3 * up),
    shadowAlpha: Math.round((HOP_SHADOW_ALPHA - (HOP_SHADOW_ALPHA - SHADOW_ALPHA_APEX) * up) * grounded * 100) / 100,
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a hop frame is drawn, for a character whose ground tile has its top-left at
 * (gx, gy). The body rises by the lift, the carried item rises with it, and the shadow
 * stays on the floor under the tile whatever the lift.
 */
export function hopBoxes(frame: HopFrame, gx: number, gy: number, size: number): { body: Box; shadow: Box; carried: { x: number; y: number } } {
  const y = gy + size - frame.height - frame.lift;
  return {
    body: { x: gx + (size - frame.width) / 2, y, w: frame.width, h: frame.height },
    shadow: { x: gx + (size - frame.shadowWidth) / 2, y: gy + size - HOP_SHADOW_H, w: frame.shadowWidth, h: HOP_SHADOW_H },
    carried: { x: gx, y: y - CARRY_PX },
  };
}

// ---------- input during a transition ----------

/** A step, or an interact: E (whichever applies), or Q with `only: 'drop'` (never picks up). */
export type Buffered = { kind: 'move'; dx: number; dy: number } | { kind: 'interact'; only?: 'drop' | 'pick' };

/**
 * After a transition this many buffered inputs go out at once; the rest follow one per
 * FLUSH_GAP_MS. The server drops moves over its budget (server/src/rooms.ts LIMITS: a
 * burst of 5, one more every 90 ms), so the flush has to stay under it: 4 plus the held
 * key's own repeat is 5.
 */
export const FLUSH_BURST = 4;
export const FLUSH_GAP_MS = 100;

/**
 * Key presses made while a transition plays. Nothing is dropped: they wait here, in order,
 * and are handed back once the transition is over, paced so the server accepts them all.
 */
export class InputBuffer {
  private queue: Buffered[] = [];
  private burst = FLUSH_BURST;
  private nextAt = 0;

  get length(): number {
    return this.queue.length;
  }

  push(input: Buffered): void {
    this.queue.push(input);
  }

  /** A transition ended at `now`: the next FLUSH_BURST inputs may go at once. */
  release(now: number): void {
    this.burst = FLUSH_BURST;
    this.nextAt = now;
  }

  /** The next input to apply at `now`, or null when there is none or it has to wait. */
  next(now: number): Buffered | null {
    if (!this.queue.length || now < this.nextAt) return null;
    if (this.burst > 0) this.burst--;
    if (this.burst === 0) this.nextAt = now + FLUSH_GAP_MS;
    return this.queue.shift()!;
  }

  clear(): void {
    this.queue = [];
  }
}
