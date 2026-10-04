import { CANON_UP, FACES, NORMALS, canonRight, type FaceId, type Side } from '@cubic/shared';
import { IDENTITY, apply, mul, rotAxis, rotX, rotY, type Mat3, type V3 } from '../../cube/mat';
import { easeInOut, easeOut } from '../../game/transition';
import { playerFlip, playerFrames, type Facing, type PlayerFrames } from '../../game/turtle';

// THE ENDING, the pure part (no Phaser, no DOM: the tests import this file).
// "Passed cube 1!": the won cube flashes, opens like a box into its cross-shaped net, the
// outside turtle jumps off the lid and lands beside the inside turtle, the two run in a
// circle and the title card drops in. Everything on screen at a moment is a function of
// ONE number, the milliseconds since the win event, so two clients that start from the
// same event show the same thing. Nothing here is random and nothing reads a clock.
//
// The model: the cube spans -1..1, standing on the grass on face 6 (-y), face 1 (+z)
// towards the camera, face 5 (+y) on top. The four walls hinge on their bottom edges and
// fall outwards; the top is a lid hinged on the back wall (face 3). Flat, the net is a
// cross: 4 - 6 - 2 across, 1 in front of 6, then 3 and 5 behind it. What lies face up is
// the INSIDE of every wall: the rooms, in daylight.

// ---------- the knobs ----------

/** Beat 1: every face flashes in its biome colour. */
export const FLASH_MS = 600;
/** The lid starts to open, and the outside turtle jumps off it. */
export const LID_AT = 800;
export const LID_MS = 1000;
/** When each wall starts to fall and how long it takes: the front first, the back (it carries the lid) last. */
export const WALL_AT: Readonly<Record<1 | 2 | 3 | 4, number>> = { 1: 1700, 2: 1900, 4: 1900, 3: 2200 };
export const WALL_MS: Readonly<Record<1 | 2 | 3 | 4, number>> = { 1: 1300, 2: 1300, 4: 1300, 3: 1500 };
/** The cube lies flat. */
export const FLAT_AT = WALL_AT[3] + WALL_MS[3];
/** The jump: off the lid, through the air, onto the floor beside the inside turtle. */
export const JUMP_AT = LID_AT;
export const JUMP_MS = 2000;
/** The top of the arc, in half cube edges above the straight line from take-off to landing. */
export const JUMP_HEIGHT = 1.8;
/** Together: two hops for joy, then they run. */
export const RUN_AT = FLAT_AT + 800;
/** One lap of the circle. */
export const RUN_LAP_MS = 2400;
/** The circle's radius (half cube edges), and how long the two take to spread out to it. */
export const RUN_RADIUS = 0.62;
export const RUN_SPREAD_MS = 700;
/** The title card drops in, the turtles keep running behind it. */
export const CARD_AT = RUN_AT + 2400;
export const CARD_DROP_MS = 600;
/** The whole sequence. */
export const ENDING_MS = CARD_AT + CARD_DROP_MS;
/** From here on any key or tap goes straight to the title card. */
export const SKIP_AFTER_MS = 2000;
/** One walk frame. */
export const WALK_FRAME_MS = 110;
/** One idle frame (standing, breathing). */
export const IDLE_FRAME_MS = 420;
/** The camera: how far it looks down on the cube, and how far it starts turned to the side. */
export const PITCH = Math.PI / 6;
export const YAW = -0.5;
/** The white veil the sequence opens through. */
export const VEIL_MS = 260;
/** How high a joy hop is (half cube edges). */
export const HOP_HEIGHT = 0.3;

const Q = Math.PI / 2;
const clamp01 = (k: number): number => Math.max(0, Math.min(1, k));
const span = (t: number, at: number, ms: number): number => clamp01((t - at) / ms);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Where the inside turtle waits, where the outside turtle starts (on the lid) and lands, and the circle's centre. */
const IN_SPOT: V3 = [-0.22, -1, 0];
const TOP_SPOT: V3 = [0, 1, 0.2];
const OUT_SPOT: V3 = [0.22, -1, 0];
const CENTRE: V3 = [0, -1, 0];

// ---------- the clock ----------

export type Phase = 'flash' | 'unfold' | 'meet' | 'run' | 'card';

export function phaseAt(t: number): Phase {
  return t < LID_AT ? 'flash' : t < FLAT_AT ? 'unfold' : t < RUN_AT ? 'meet' : t < CARD_AT ? 'run' : 'card';
}

/** May a key or a tap skip to the card now? Not in the first two seconds, and not once it is there. */
export const canSkip = (elapsed: number): boolean => elapsed >= SKIP_AFTER_MS && elapsed < CARD_AT;

/**
 * The time on the timeline, from the time since the win event. A skip (made `skippedAt`
 * ms after the event) jumps to the card; from there the clock runs on as before.
 */
export function endingClock(elapsed: number, skippedAt: number | null): number {
  return skippedAt === null ? elapsed : Math.max(elapsed, CARD_AT + (elapsed - skippedAt));
}

/** When the card shows, in ms since the win event: at once with reduce motion or when the game was found already won. */
export function cardDelay(elapsed: number, skippedAt: number | null, reduceMotion: boolean): number {
  return reduceMotion ? 0 : Math.max(0, CARD_AT - endingClock(elapsed, skippedAt));
}

// ---------- one frame ----------

export interface TurtleFrame {
  /** The point of the ground (or of the lid) the turtle is over, in the model. */
  at: V3;
  /** How high above it, in half cube edges. */
  lift: number;
  facing: Facing;
  walking: boolean;
  /** Counts frames of the walk (or of the idle). */
  tick: number;
  /** On the ground: it has a shadow. */
  grounded: boolean;
}

export interface EndingFrame {
  phase: Phase;
  /** 0..1: how much of its biome colour every face shows. */
  flash: number;
  /** 0..1: the white veil over everything. */
  veil: number;
  /** The camera's turn to the side, in radians. 0 once the cube lies flat. */
  yaw: number;
  /** The lid's hinge on the back wall: 0 shut, a quarter turn = standing on the wall's edge. */
  lid: number;
  /** Each wall's hinge: 0 standing, a quarter turn = flat on the grass. */
  walls: Record<1 | 2 | 3 | 4, number>;
  /** 1..0: the dark around the inside player, lifting. (The outside player never has it.) */
  darkness: number;
  turtles: Record<Side, TurtleFrame>;
  /** The title card is up. */
  card: boolean;
}

/** A wall falling: it speeds up like a thing that falls, hits the grass and bounces once. */
export function fall(k: number): number {
  k = clamp01(k);
  if (k >= 1) return 1;
  if (k < 0.8) return (k / 0.8) ** 2;
  return 1 - 0.07 * Math.sin((Math.PI * (k - 0.8)) / 0.2);
}

/** The facing of a turtle running the circle at angle `a` (it moves along (-sin a, cos a) in x, z). */
export function runFacing(a: number): Facing {
  const dx = -Math.sin(a);
  const dz = Math.cos(a);
  // z comes towards the camera: down the screen
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : dz > 0 ? 'down' : 'up';
}

/** With "reduce motion": the cube flat on the grass, the two turtles side by side, the card. */
const STILL: EndingFrame = {
  phase: 'card',
  flash: 0,
  veil: 0,
  yaw: 0,
  lid: Q,
  walls: { 1: Q, 2: Q, 3: Q, 4: Q },
  darkness: 0,
  turtles: {
    out: { at: OUT_SPOT, lift: 0, facing: 'down', walking: false, tick: 0, grounded: true },
    in: { at: IN_SPOT, lift: 0, facing: 'down', walking: false, tick: 0, grounded: true },
  },
  card: true,
};

/** Everything the scene draws at `t` ms on the timeline (see endingClock). */
export function endingFrame(t: number, reduceMotion = false): EndingFrame {
  if (reduceMotion) return STILL;
  t = Math.max(0, t);
  const phase = phaseAt(t);
  const walls = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<1 | 2 | 3 | 4, number>;
  for (const f of [1, 2, 3, 4] as const) walls[f] = Q * fall(span(t, WALL_AT[f], WALL_MS[f]));
  const idle = Math.floor(t / IDLE_FRAME_MS);
  const walk = Math.floor(t / WALK_FRAME_MS);

  let out: TurtleFrame;
  let inn: TurtleFrame;
  if (t < RUN_AT) {
    // two hops for joy once the cube is flat
    const hop = t < FLAT_AT ? 0 : HOP_HEIGHT * Math.abs(Math.sin(2 * Math.PI * span(t, FLAT_AT, RUN_AT - FLAT_AT)));
    const landed = t >= JUMP_AT + JUMP_MS;
    inn = { at: IN_SPOT, lift: hop, facing: landed ? 'right' : 'down', walking: false, tick: idle, grounded: true };
    if (t < JUMP_AT) out = { at: TOP_SPOT, lift: 0, facing: 'down', walking: false, tick: idle, grounded: false };
    else if (!landed) {
      const k = span(t, JUMP_AT, JUMP_MS);
      const at: V3 = [lerp(TOP_SPOT[0], OUT_SPOT[0], k), lerp(TOP_SPOT[1], OUT_SPOT[1], k), lerp(TOP_SPOT[2], OUT_SPOT[2], k)];
      out = { at, lift: JUMP_HEIGHT * 4 * k * (1 - k), facing: 'down', walking: true, tick: walk, grounded: false };
    } else out = { at: OUT_SPOT, lift: hop, facing: 'left', walking: false, tick: idle, grounded: true };
  } else {
    // the circle: the two are always opposite each other, and spread out to it from where they stood
    const a = (2 * Math.PI * (t - RUN_AT)) / RUN_LAP_MS;
    const r = lerp(OUT_SPOT[0], RUN_RADIUS, easeOut(span(t, RUN_AT, RUN_SPREAD_MS)));
    const on = (angle: number): TurtleFrame => ({
      at: [CENTRE[0] + r * Math.cos(angle), CENTRE[1], CENTRE[2] + r * Math.sin(angle)],
      lift: 0,
      facing: runFacing(angle),
      walking: true,
      tick: walk,
      grounded: true,
    });
    out = on(a);
    inn = on(a + Math.PI);
  }

  return {
    phase,
    flash: t < 120 ? t / 120 : t < 350 ? 1 : 1 - span(t, 350, FLASH_MS - 350),
    veil: 1 - span(t, 0, VEIL_MS),
    yaw: YAW * (1 - easeInOut(span(t, LID_AT, FLAT_AT - LID_AT))) + 0, // (+ 0: never -0)
    lid: Q * easeInOut(span(t, LID_AT, LID_MS)),
    walls,
    darkness: 1 - easeInOut(span(t, LID_AT, FLAT_AT - 400 - LID_AT)),
    turtles: { out, in: inn },
    card: t >= CARD_AT,
  };
}

// ---------- the turtle's look ----------

/** Which frame of its sheet a turtle shows, and whether it is mirrored (left = the walk-right row, flipped). */
export function turtleLook(entry: PlayerFrames, turtle: Pick<TurtleFrame, 'facing' | 'walking' | 'tick'>): { index: number; flip: boolean } {
  const list = playerFrames(entry, turtle.facing, turtle.walking);
  return { index: list[Math.abs(turtle.tick) % list.length] ?? 0, flip: playerFlip(true, turtle.facing, 1) };
}

// ---------- the cube, hinged open ----------

/** One face of the opening cube, in the model: its centre, its half edges (map right, map up) and its OUTER normal. */
export interface NetQuad {
  face: FaceId;
  c: V3;
  r: V3;
  u: V3;
  n: V3;
}

const UP: V3 = [0, 1, 0];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** (floating point leaves 1e-17 where a zero belongs: tidy, so a flat face is exactly flat) */
const tidy = (v: V3): V3 => v.map((x) => Math.round(x * 1e9) / 1e9 + 0) as unknown as V3;

/**
 * The six faces at a moment of the unfolding. A wall turns about its bottom edge, its top
 * going outwards (the turn that carries "up" onto its normal); the lid turns the same way
 * about the back wall's top edge, and then rides on the back wall.
 */
export function netQuads(frame: Pick<EndingFrame, 'lid' | 'walls'>): NetQuad[] {
  const quads: NetQuad[] = [];
  const quad = (face: FaceId, move: (p: V3) => V3, turn: Mat3) => quads.push({ face, c: tidy(move(NORMALS[face])), r: tidy(apply(turn, canonRight(face))), u: tidy(apply(turn, CANON_UP[face])), n: tidy(apply(turn, NORMALS[face])) });
  for (const face of FACES) {
    if (face === 6) quad(face, (p) => p, IDENTITY);
    else if (face !== 5) {
      const n = NORMALS[face];
      const hinge = sub(n, UP);
      const turn = rotAxis(cross(UP, n), frame.walls[face]);
      quad(face, (p) => add(hinge, apply(turn, sub(p, hinge))), turn);
    } else {
      const back = NORMALS[3];
      const axis = cross(UP, back);
      const wallHinge = sub(back, UP);
      const lidHinge = add(back, UP);
      const lidTurn = rotAxis(axis, frame.lid);
      const wallTurn = rotAxis(axis, frame.walls[3]);
      quad(face, (p) => add(wallHinge, apply(wallTurn, sub(add(lidHinge, apply(lidTurn, sub(p, lidHinge))), wallHinge))), mul(wallTurn, lidTurn));
    }
  }
  return quads;
}

// ---------- on the screen ----------

/** The camera at a moment: looking down on the cube from the front, turned `yaw` to the side. */
export const endingView = (yaw: number): Mat3 => mul(rotX(PITCH), rotY(yaw));

export interface EndingLayout {
  /** Half the cube's edge, in art pixels. */
  half: number;
  /** Where the cube's centre lands. */
  cx: number;
  cy: number;
  /** The first row of grass: the sky is above it. */
  horizon: number;
}

/** Between the horizon and the far end of the flat net, and under its near end. */
const NET_GAP = 6;

/**
 * Where everything goes on a screen of `width` x `height` art pixels: the sky takes the
 * top third, and the cube is as large as the flat net (6 half edges wide, 8 deep, seen at
 * PITCH) fits on the grass under it. Whole pixels.
 */
export function endingLayout(width: number, height: number): EndingLayout {
  const sin = Math.sin(PITCH);
  const cos = Math.cos(PITCH);
  const horizon = Math.round(height * 0.34);
  const room = height - horizon - 2 * NET_GAP;
  const half = Math.max(12, Math.min(72, Math.floor(Math.min(room / (8 * sin), (width - 24) / 6))));
  // the net's middle is the model point (0, -1, -1)
  const middle = horizon + NET_GAP + 4 * sin * half;
  return { half, cx: Math.round(width / 2), cy: Math.round(middle - (cos - sin) * half), horizon };
}

/** How many screen pixels one pixel of a turtle takes: the turtle stays about a quarter of a face wide. */
export const turtleScale = (layout: EndingLayout): number => Math.max(1, Math.round(layout.half / 40));

/** Where a model point lands: whole pixels, and its depth (larger = nearer the camera). */
export function projectPoint(view: Mat3, layout: EndingLayout, p: V3): { x: number; y: number; depth: number } {
  const s = apply(view, p);
  return { x: Math.round(layout.cx + s[0] * layout.half), y: Math.round(layout.cy - s[1] * layout.half), depth: s[2] };
}

/** Where a turtle is drawn: the point under its feet, lifted, on the screen. */
export function turtlePoint(view: Mat3, layout: EndingLayout, turtle: Pick<TurtleFrame, 'at' | 'lift'>): { x: number; y: number; depth: number } {
  return projectPoint(view, layout, [turtle.at[0], turtle.at[1] + turtle.lift, turtle.at[2]]);
}
