import type { Side } from '@cubic/shared';

// WHERE THINGS STAND ON THE SIDE SELECT. Pure arithmetic, no Phaser and no DOM, so it can
// be tested (client/test/side.test.ts). SideSelectScene draws from it and nothing else.
//
// Each side has a small cube and one turtle. The turtle stands in the middle of the FACE
// of its side: outside, the grass on top of the cube; inside, the room cut into the front
// wall. It stands there in every state (idle, hover, selected): the states only change how
// it looks (turtleIn), so nothing has to move, at any size.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a side's cube shows: nobody there, the pointer over it, or a player has picked it. */
export type SideState = 'idle' | 'hover' | 'selected';

/** The cube pictures (assets/ui/cube-*.png), in their own pixels. */
export const CUBE_ART = { w: 46, h: 44 } as const;
/** The turtle's frame (sprites/player-*.png). */
export const TURTLE_ART = 16;
/**
 * The outside cube is shown from higher up than its picture is drawn: the grass is 8 rows
 * deeper (and the wall 8 rows shorter), so a whole turtle fits on it. See OUT_STRIPS.
 */
export const GRASS_ROWS = 20;
/** The face a turtle stands on, inside its cube picture: the grass, and the open room. */
export const FACE_ART: Record<Side, Box> = {
  out: { x: 1, y: 1, w: 44, h: GRASS_ROWS },
  in: { x: 6, y: 18, w: 34, h: 22 },
};

/**
 * How the deeper outside cube is cut from cube-out.png: [first row, row count, mirrored]
 * strips of the picture, stacked top to bottom. The grass (rows 1 to 12) is followed by 8
 * of its own rows mirrored (so the specks do not line up), then the lip, then the wall
 * without its first course.
 */
export const OUT_STRIPS: readonly (readonly [number, number, boolean])[] = [
  [0, 13, false],
  [3, 8, true],
  [13, 3, false],
  [24, 20, false],
];

export interface SideSpot {
  /** The cube picture on screen. */
  cube: Box;
  /** The face the turtle stands on. */
  face: Box;
  /** The turtle's frame. */
  turtle: Box;
  /** The turtle's centre: where its sprite is anchored (origin 0.5, 0.5). */
  anchor: { x: number; y: number };
}

/** The panel in the middle, where the arrows wait. */
export const PANEL = { w: 132, h: 140 } as const;
/** The bottom bar (LEAVE, the status line, the main button): its top, up from the bottom of the screen. */
export const BAR = 30;
/** Clear pixels between the panel and the bottom bar. */
const PANEL_GAP = 6;

export interface SideLayout {
  /** Screen pixels per art pixel of the cubes and turtles. */
  zoom: number;
  slotX: Record<Side | 'mid', number>;
  cubeTop: number;
  /** The middle panel. It starts just above the cubes, or higher on a short screen: it never reaches the bottom bar. */
  panel: Box;
  /** The top of the bottom bar. */
  barY: number;
  spots: Record<Side, SideSpot>;
}

const centred = (box: Box, size: number): Box => ({ x: box.x + (box.w - size) / 2, y: box.y + (box.h - size) / 2, w: size, h: size });

/** The side select of a W x H logical screen. Every number is a whole pixel. */
export function sideLayout(W: number, H: number): SideLayout {
  // the diorama is the game world seen closer: its art is shown at a whole multiple
  const zoom = H >= 340 ? 3 : 2;
  const slotX = { out: Math.round(W * 0.2), mid: Math.round(W / 2), in: Math.round(W * 0.8) };
  const cubeTop = Math.round(H * 0.56 - (CUBE_ART.h * zoom) / 2) + 12;
  const spot = (side: Side): SideSpot => {
    const cube = { x: slotX[side] - (CUBE_ART.w * zoom) / 2, y: cubeTop, w: CUBE_ART.w * zoom, h: CUBE_ART.h * zoom };
    const art = FACE_ART[side];
    const face = { x: cube.x + art.x * zoom, y: cube.y + art.y * zoom, w: art.w * zoom, h: art.h * zoom };
    const turtle = centred(face, TURTLE_ART * zoom);
    return { cube, face, turtle, anchor: { x: turtle.x + turtle.w / 2, y: turtle.y + turtle.h / 2 } };
  };
  const barY = H - BAR;
  const panel = { x: slotX.mid - PANEL.w / 2, y: Math.min(cubeTop - 14, barY - PANEL_GAP - PANEL.h), w: PANEL.w, h: PANEL.h };
  return { zoom, slotX, cubeTop, panel, barY, spots: { out: spot('out'), in: spot('in') } };
}

/** Which state a side shows. A touch screen has no hover: only picked or not. */
export function sideState(picked: boolean, hovered: boolean, touch: boolean): SideState {
  if (picked) return 'selected';
  return hovered && !touch ? 'hover' : 'idle';
}

/**
 * The turtle of a side in a state: where it stands and how it looks. It stands on the same
 * spot in all three (the middle of its face), always fully opaque. Idle it waits: still,
 * and in stone grey (idleTone) instead of its own colours.
 */
export function turtleIn(layout: SideLayout, side: Side, state: SideState): { box: Box; anchor: { x: number; y: number }; alpha: number; grey: boolean; moving: boolean } {
  const { turtle, anchor } = layout.spots[side];
  return { box: turtle, anchor, alpha: 1, grey: state === 'idle', moving: state !== 'idle' };
}

/**
 * A turtle's colour while nobody has its side: most of the colour taken out (a statue of
 * the turtle), the light and dark kept, so it reads on the grass and in the dark room
 * alike and its ink outline stays. Half transparent, the green turtle vanished on the grass.
 */
export function idleTone(r: number, g: number, b: number): [number, number, number] {
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c: number) => Math.round(c * 0.2 + grey * 0.8);
  return [mix(r), mix(g), mix(b)];
}

/** The side whose cube is under this point of the screen, if any. */
export function sideAt(layout: SideLayout, x: number, y: number): Side | null {
  for (const side of ['out', 'in'] as const) {
    const c = layout.spots[side].cube;
    if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return side;
  }
  return null;
}

export const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
export const centreOf = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
