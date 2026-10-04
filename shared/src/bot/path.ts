import { stepPose } from '../cube';
import { defaultEnv, isBlocked, visibleObjects, type GameEnv } from '../game';
import type { FaceId, GameState, Pose, Side, TileRef } from '../types';

// Pathfinding over the cube surface: breadth-first search in (face, up, tile) space using
// the same stepPose and blockers as a real move, so a path is always legal to walk.

/** A step in the walker's own screen space. */
export type Move = readonly [dx: number, dy: number];

export const MOVES: readonly Move[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const keyOf = (p: Pose) => `${p.face}|${p.up.join(',')}|${p.x},${p.y}`;

/**
 * Shortest list of moves from `side`'s current pose to a pose accepted by `goal`,
 * or null if there is none. Blockers are evaluated against the current state.
 * `allow` fences the search: the path never crosses onto a face it rejects (the AI's leash).
 * `avoid` marks poses the path may never enter, goal included (hot lava, tiles a puzzle
 * script keeps off): the walker's own rules on top of the real blockers. See hazardAvoid.
 */
export function findPath(
  state: GameState,
  side: Side,
  goal: (pose: Pose) => boolean,
  env: GameEnv = defaultEnv,
  allow?: (face: FaceId) => boolean,
  avoid?: (pose: Pose) => boolean,
): Move[] | null {
  const start = state.players[side].pose;
  if (goal(start)) return [];
  const prev = new Map<string, { from: string; move: Move }>();
  const seen = new Set<string>([keyOf(start)]);
  let frontier: Pose[] = [start];
  while (frontier.length) {
    const next: Pose[] = [];
    for (const pose of frontier) {
      for (const move of MOVES) {
        const { pose: to } = stepPose(pose, move[0], move[1]);
        const k = keyOf(to);
        if (seen.has(k) || isBlocked(state, side, to, env) || avoid?.(to)) continue;
        if (allow && to.face !== pose.face && !allow(to.face)) continue;
        seen.add(k);
        prev.set(k, { from: keyOf(pose), move });
        if (goal(to)) {
          const path: Move[] = [];
          for (let at = k; prev.has(at); at = prev.get(at)!.from) path.unshift(prev.get(at)!.move);
          return path;
        }
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * What the body knows to be deadly, from what its OWN side sees: an object of this type in
 * this state. Face 6 inside: the lava ("f6-lava", "hot" while face 5 is solved and face 6
 * is not; "cold" lava is plain floor).
 */
export const HAZARD_OBJECTS: readonly { type: string; state: string }[] = [{ type: 'f6-lava', state: 'hot' }];
/** Objects that stand in the middle of a hazard: as deadly as it, while the face has any hazard tile. */
export const HAZARD_ISLANDS: readonly string[] = ['button'];

/** The tiles of one face that are deadly for `side` right now (canonical). */
export function hazardTiles(state: GameState, side: Side, face: FaceId, env: GameEnv = defaultEnv): TileRef[] {
  const objects = visibleObjects(state, side, face, env);
  const hot = objects.filter((o) => HAZARD_OBJECTS.some((h) => h.type === o.type && h.state === o.state));
  if (hot.length === 0) return [];
  return [...hot, ...objects.filter((o) => HAZARD_ISLANDS.includes(o.type))].map((o) => ({ face, x: o.x, y: o.y }));
}

/**
 * An `avoid` predicate for findPath / planAction: true on every tile, on any face, that is
 * deadly for `side` right now. `except` (canonical tiles) are walked anyway: a path the
 * partner read out. Evaluated against the current state, once per face.
 */
export function hazardAvoid(state: GameState, side: Side, env: GameEnv = defaultEnv, except: readonly TileRef[] = []): (pose: Pose) => boolean {
  const byFace = new Map<FaceId, Set<string>>();
  const free = new Set(except.map((t) => `${t.face}|${t.x},${t.y}`));
  return (pose) => {
    let tiles = byFace.get(pose.face);
    if (!tiles) byFace.set(pose.face, (tiles = new Set(hazardTiles(state, side, pose.face, env).map((t) => `${t.x},${t.y}`))));
    return tiles.has(`${pose.x},${pose.y}`) && !free.has(`${pose.face}|${pose.x},${pose.y}`);
  };
}

/** Moves to reach a tile (on any face). */
export function pathTo(state: GameState, side: Side, target: TileRef, env: GameEnv = defaultEnv): Move[] | null {
  return findPath(state, side, (p) => p.face === target.face && p.x === target.x && p.y === target.y, env);
}
