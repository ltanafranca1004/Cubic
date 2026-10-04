import { WALK_HOLD_MS, canonToScreen, type FaceId, type Side, type Vec } from '@cubic/shared';

// The turtle's look, as pure math (no Phaser, no DOM): which way it faces, which frames
// of its sheet play, and how the item it carries rides, bobs and hops. The scene
// (./GameScene.ts) and the sheet art (../style/art.ts) only apply what this returns.

// ---------- facing ----------

/** Which way the character faces ON SCREEN (the inside view is mirrored: this is after the mirror). */
export type Facing = 'down' | 'up' | 'left' | 'right';

/** The facing of a screen step (dx, dy), y down. Null when it is not a step along one axis. */
export function facingOf(dx: number, dy: number): Facing | null {
  if (dx !== 0 && dy !== 0) return null;
  if (dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return null;
}

/**
 * The facing of a step between two canonical tiles of one face, as `side` sees it with
 * `up` as screen-up. Both tiles go through canonToScreen, so the rotation of the view and
 * the inside mirror are already in the answer: a canonical step to the right is a step to
 * screen-left for the inside player. Null when the tiles are not one step apart.
 */
export function facingFromStep(side: Side, face: FaceId, up: Vec, from: { x: number; y: number }, to: { x: number; y: number }): Facing | null {
  const [ax, ay] = canonToScreen(side, face, up, from.x, from.y);
  const [bx, by] = canonToScreen(side, face, up, to.x, to.y);
  if (Math.abs(bx - ax) + Math.abs(by - ay) !== 1) return null;
  return facingOf(bx - ax, by - ay);
}

// ---------- frames ----------

/**
 * A player's entry in assets/manifest.json. `walk` and `idle` are the frames of a sheet
 * with one look (they face right, the game mirrors them by `Pose.dir`). A sheet with a
 * row per direction also lists `walkDown`, `walkUp` and `walkRight` (left = right
 * mirrored), and may list `idleUp` / `idleRight`; `idle` is then the idle facing down.
 */
export interface PlayerFrames {
  image: string;
  idle?: number[];
  walk: number[];
  walkDown?: number[];
  walkUp?: number[];
  walkRight?: number[];
  idleUp?: number[];
  idleRight?: number[];
}

const some = (list: number[] | undefined): number[] | undefined => (list?.length ? list : undefined);

/** Does the sheet have walk rows by direction? Then only "left" is mirrored. */
export function hasFacing(entry: PlayerFrames): boolean {
  return !!(some(entry.walkDown) ?? some(entry.walkUp) ?? some(entry.walkRight));
}

/** The frames to play for a facing, walking or standing. Never empty unless `walk` is. */
export function playerFrames(entry: PlayerFrames, facing: Facing, walking: boolean): number[] {
  const side = facing === 'left' || facing === 'right';
  const walk = some(facing === 'up' ? entry.walkUp : side ? entry.walkRight : entry.walkDown) ?? entry.walk;
  if (walking) return walk;
  // Standing keeps the facing when the sheet has an idle for it; else the one idle there is.
  return some(facing === 'up' ? entry.idleUp : side ? entry.idleRight : undefined) ?? some(entry.idle) ?? walk;
}

/** Mirror the sprite? By facing when the sheet has directions, else by the pose's own `dir`. */
export function playerFlip(directional: boolean, facing: Facing, dir: number): boolean {
  return directional ? facing === 'left' : dir < 0;
}

/** How long after the last step the player still shows the walk frame (it follows the walking pace: shared/src/pace.ts). */
export { WALK_HOLD_MS };

// ---------- the carried item ----------

/** The carried item rides this far above the character's top-left corner. */
export const CARRY_PX = 11;

/** While walking the carried item dips one pixel on every other step. */
export function carryBob(walking: boolean, tick: number): 0 | 1 {
  return walking && Math.abs(Math.floor(tick)) % 2 === 1 ? 1 : 0;
}

/** Picking up and putting down: the item hops between the tile and the head. */
export const ITEM_HOP_MS = 200;
/** The top of that hop, in pixels above the straight line between its two ends. */
export const ITEM_HOP_PX = 5;

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the hopping item is at progress `k` (0..1): along the line from `from` to `to`,
 * lifted by a parabola that is `height` at the middle. Whole pixels, and exactly `from`
 * at 0 and `to` at 1, so nothing jumps when the hop starts or ends.
 */
export function itemHop(k: number, from: Point, to: Point, height: number = ITEM_HOP_PX): Point {
  k = Math.max(0, Math.min(1, k));
  const lift = Math.round(4 * height * k * (1 - k));
  return { x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k) - lift };
}
