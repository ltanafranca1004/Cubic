import { NORMALS, compassDrift, faceDistance, neighbours, upsOn, viewRight, type FaceId, type Side, type Vec } from '@cubic/shared';
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
