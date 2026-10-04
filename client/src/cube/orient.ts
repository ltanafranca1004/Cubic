import { NORMALS, compassDrift, faceDistance, neg, neighbours, upsOn, viewRight, type FaceId, type Side, type Vec } from '@cubic/shared';
import { axisAngle, fromRows, mul, rotAxis, rotX, rotY, transpose, type Mat3 } from './mat';
import type { CubeMapDir } from './api';

// HOW THE HUD CUBE IS TURNED. All of it comes from the player's pose through the shared
// cube math (face normal, up vector, viewRight): nothing about the cube is decided here.
// Pure numbers, unit tested in client/test/cube.test.ts.

/** The up vector that gives this compass drift on this face (the inverse of compassDrift). */
export function upFromDrift(face: FaceId, drift: number): Vec {
  return upsOn(face).find((up) => compassDrift({ face, up }) === drift) ?? upsOn(face)[0]!;
}

/**
 * The view that shows a pose's face flat on, its up at the top of the screen: rows are
 * screen right, screen up and the face normal. For the inside player screen right is
 * mirrored (viewRight), so the whole cube is drawn mirrored, as they see their walls.
 */
export function poseView(side: Side, face: FaceId, up: Vec): Mat3 {
  return fromRows(viewRight(side, face, up), up, NORMALS[face]);
}

/** The screen-space rotation that carries the view `from` to the view `to`. */
export function turnBetween(from: Mat3, to: Mat3): { axis: readonly [number, number, number]; angle: number } {
  return axisAngle(mul(to, transpose(from)));
}

/** The view a fraction `t` (0..1) of the way through the turn from `from` to `to`. */
export function turnAt(from: Mat3, to: Mat3, t: number): Mat3 {
  const { axis, angle } = turnBetween(from, to);
  if (t >= 1 || angle === 0) return to;
  return mul(rotAxis(axis, angle * t), from);
}

const Q = Math.PI / 2;
/**
 * The quarter turn that brings the face in a screen direction to the front: the same turn
 * the cube makes when the player walks off that edge of the screen.
 */
export const QUARTER: Record<CubeMapDir, Mat3> = { left: rotY(Q), right: rotY(-Q), up: rotX(Q), down: rotX(-Q) };

// THE INSIDE PLAYER'S HUD CUBE IS A ROOM. They stand in the cube, so their cube is drawn
// from within: the face they are on is the floor at the back, and the four faces around it
// are walls coming towards the camera. Crossing an edge there is a CONCAVE corner: the wall
// ahead tips over towards them and becomes the floor, the opposite turn to the outside cube
// rolling over its convex edge.

/** How far the room's camera is from the cube's centre, in half-edges, on the view's z axis. */
export const ROOM_CAM = 3.5;

/**
 * The inside camera: screen right is the same mirrored right as the game's view
 * (viewRight), up is up, and the floor's normal points AWAY from the viewer. A proper
 * rotation: the mirror is real here, it is the wall seen from behind.
 */
export function roomView(face: FaceId, up: Vec): Mat3 {
  return fromRows(viewRight('in', face, up), up, neg(NORMALS[face]));
}

/** The view the HUD cube rests in for a pose: the cube from outside, the room from inside. */
export const hudView = (side: Side, face: FaceId, up: Vec): Mat3 => (side === 'in' ? roomView(face, up) : poseView(side, face, up));

/** The inside quarter turns: about the same screen axis as the outside ones, the other way round. */
export const ROOM_QUARTER: Record<CubeMapDir, Mat3> = { left: rotY(-Q), right: rotY(Q), up: rotX(-Q), down: rotX(Q) };

/** The quarter turn the HUD cube makes when its player walks off a screen edge. */
export const hudQuarter = (side: Side, dir: CubeMapDir): Mat3 => (side === 'in' ? ROOM_QUARTER : QUARTER)[dir];

/** The wall that rises to become the floor when the inside player walks off a screen edge. */
export const risingWall = (face: FaceId, up: Vec, dir: CubeMapDir): FaceId => neighbours({ side: 'in', face, up })[dir];

/** The face a room view has as its floor. */
export function floorOf(view: Mat3): FaceId {
  return facing([view[0], view[1], view[2], view[3], view[4], view[5], -view[6], -view[7], -view[8]]);
}

/** The face in front of a view, and the faces around it. */
export function facing(view: Mat3): FaceId {
  let best: FaceId = 1;
  let z = -2;
  for (const f of [1, 2, 3, 4, 5, 6] as FaceId[]) {
    const n = NORMALS[f];
    const d = view[6] * n[0] + view[7] * n[1] + view[8] * n[2];
    if (d > z) {
      z = d;
      best = f;
    }
  }
  return best;
}

export type Where = 'front' | 'back' | CubeMapDir;

/** Where another face is, seen from a pose: in front, off one screen edge, or behind. */
export function whereIs(side: Side, face: FaceId, up: Vec, other: FaceId): Where {
  const d = faceDistance(face, other);
  if (d === 0) return 'front';
  if (d === 2) return 'back';
  const n = neighbours({ side, face, up });
  return (['up', 'down', 'left', 'right'] as const).find((dir) => n[dir] === other)!;
}

/** A small fixed tilt, so the faces above and to the right of the front face show too. */
export const HUD_TILT: Mat3 = mul(rotX(0.32), rotY(-0.36));
/** The screen directions whose neighbour face the tilt leaves in view. */
export const TILT_SHOWS: readonly Where[] = ['front', 'up', 'right'];

/**
 * How to point at the partner: a marker on their face when the HUD cube shows it, and the
 * edge to walk off for the shortest way there (null when they are on your face). Behind
 * the cube every edge is two faces away, so it settles on the left one.
 */
export function partnerHint(side: Side, face: FaceId, up: Vec, partner: FaceId): { where: Where; shown: boolean; edge: CubeMapDir | null } {
  const where = whereIs(side, face, up, partner);
  return { where, shown: TILT_SHOWS.includes(where), edge: where === 'front' ? null : where === 'back' ? 'left' : where };
}
