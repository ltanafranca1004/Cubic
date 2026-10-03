import { stepPose } from '../cube';
import { defaultEnv, isBlocked, type GameEnv } from '../game';
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
 */
export function findPath(state: GameState, side: Side, goal: (pose: Pose) => boolean, env: GameEnv = defaultEnv, allow?: (face: FaceId) => boolean): Move[] | null {
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
        if (seen.has(k) || isBlocked(state, side, to, env)) continue;
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

/** Moves to reach a tile (on any face). */
export function pathTo(state: GameState, side: Side, target: TileRef, env: GameEnv = defaultEnv): Move[] | null {
  return findPath(state, side, (p) => p.face === target.face && p.x === target.x && p.y === target.y, env);
}
