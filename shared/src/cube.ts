import { GRID, type FaceId, type Pose, type Side, type Vec } from './types';
import { add, cross, dot, eq, neg, scale } from './vec';

// Cube math. A player stands on a face with an "up" vector (the 3D direction that is
// screen-up for them) and canonical tile coords. Walking over an edge re-orients "up", so
// a loop around a corner brings you back turned 90 degrees: the cube's surface is not flat.

export const NORMALS: Readonly<Record<FaceId, Vec>> = {
  1: [0, 0, 1],
  2: [1, 0, 0],
  3: [0, 0, -1],
  4: [-1, 0, 0],
  5: [0, 1, 0],
  6: [0, -1, 0],
};

/** The up direction each face's map is drawn in. */
export const CANON_UP: Readonly<Record<FaceId, Vec>> = {
  1: [0, 1, 0],
  2: [0, 1, 0],
  3: [0, 1, 0],
  4: [0, 1, 0],
  5: [0, 0, -1],
  6: [0, 0, 1],
};

/** Centre of the tile grid in tile units. */
const C = (GRID - 1) / 2;

export function faceByNormal(v: Vec): FaceId {
  for (const f of [1, 2, 3, 4, 5, 6] as const) if (eq(NORMALS[f], v)) return f;
  throw new Error(`not a face normal: ${v.join(',')}`);
}

/** Map +x direction of a face (canonical right, as seen from outside). */
export const canonRight = (face: FaceId): Vec => cross(CANON_UP[face], NORMALS[face]);

/** Screen-right for a viewer. The inside viewer sees the wall from behind: mirrored. */
export const viewRight = (side: Side, face: FaceId, up: Vec): Vec =>
  side === 'out' ? cross(up, NORMALS[face]) : cross(up, neg(NORMALS[face]));

/** Screen tile (as the viewer sees the face) to canonical tile. */
export function screenToCanon(side: Side, face: FaceId, up: Vec, sx: number, sy: number): [number, number] {
  const o = add(scale(viewRight(side, face, up), sx - C), scale(up, C - sy));
  return [Math.round(C + dot(o, canonRight(face))), Math.round(C - dot(o, CANON_UP[face]))];
}

/** Canonical tile to the screen tile the viewer sees it at. */
export function canonToScreen(side: Side, face: FaceId, up: Vec, x: number, y: number): [number, number] {
  const o = add(scale(canonRight(face), x - C), scale(CANON_UP[face], C - y));
  return [Math.round(C + dot(o, viewRight(side, face, up))), Math.round(C - dot(o, up))];
}

/**
 * One step in SCREEN space (dx,dy: exactly one of them is -1 or 1). Ignores walls.
 * Walking off the screen edge lands on the neighbouring face: off the top the new up is
 * -oldNormal, off the bottom +oldNormal, sideways it is unchanged.
 */
export function stepPose(pose: Pose, dx: number, dy: number): { pose: Pose; crossed: boolean } {
  const { side, up } = pose;
  let face = pose.face;
  let nextUp = up;
  let [sx, sy] = canonToScreen(side, face, up, pose.x, pose.y);
  sx += dx;
  sy += dy;
  let crossed = false;
  if (sx < 0 || sx >= GRID || sy < 0 || sy >= GRID) {
    const right = viewRight(side, face, up);
    const n = NORMALS[face];
    const heading = dx ? (dx > 0 ? right : neg(right)) : dy < 0 ? up : neg(up);
    face = faceByNormal(heading);
    nextUp = dy < 0 ? neg(n) : dy > 0 ? n : up;
    sx = (sx + GRID) % GRID;
    sy = (sy + GRID) % GRID;
    crossed = true;
  }
  const [x, y] = screenToCanon(side, face, nextUp, sx, sy);
  return { pose: { side, face, up: nextUp, x, y, dir: dx > 0 ? 1 : dx < 0 ? -1 : pose.dir }, crossed };
}

/** Degrees (0/90/180/270) between the player's up and the face's canonical up. */
export function compassDrift(pose: Pick<Pose, 'face' | 'up'>): 0 | 90 | 180 | 270 {
  const cu = CANON_UP[pose.face];
  if (eq(pose.up, cu)) return 0;
  if (eq(pose.up, neg(cu))) return 180;
  return dot(cross(cu, pose.up), NORMALS[pose.face]) > 0 ? 90 : 270;
}

/** The face reached by walking off each screen edge. */
export function neighbours(pose: Pick<Pose, 'side' | 'face' | 'up'>): Record<'up' | 'down' | 'left' | 'right', FaceId> {
  const right = viewRight(pose.side, pose.face, pose.up);
  return {
    up: faceByNormal(pose.up),
    down: faceByNormal(neg(pose.up)),
    left: faceByNormal(neg(right)),
    right: faceByNormal(right),
  };
}

/** Every up vector a player can have on a face (the 4 directions in its plane). */
export function upsOn(face: FaceId): Vec[] {
  const u = CANON_UP[face];
  const r = canonRight(face);
  return [u, r, neg(u), neg(r)];
}

/** 0 = same face, 1 = adjacent, 2 = opposite. */
export function faceDistance(a: FaceId, b: FaceId): 0 | 1 | 2 {
  if (a === b) return 0;
  return eq(NORMALS[a], neg(NORMALS[b])) ? 2 : 1;
}
