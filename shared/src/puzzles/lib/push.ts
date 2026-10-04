import { SOLID, type TileKind } from '../../maps/types';
import { FACE_SIZE } from '../../types';
import { at, type XY } from '../util';

// SOKOBAN BOXES: pushed, never pulled. A box stops at solid terrain, at another box and at
// the outer ring of the face (the edge rule: nothing may ever block a ring tile).
//
//   interface State { boxes: Box[] }
//   init: (ctx) => ({ boxes: ctx.objects('out', FACE, 'box').map((o) => ({ id: o.name, x: o.x, y: o.y })) }),
//   isBlocked: (s, _ctx, side, tile) => side === 'out' && !!boxAt(s.boxes, tile),
//   onPush: (s, ctx, side, tile, dx, dy) => side === 'out' && !!pushBox(s.boxes, tile, dx, dy, floorOf(ctx.world.out[FACE].tiles)),
//   // RESET tile: resetBoxes(s.boxes, startBoxes(ctx))

export interface Box extends XY {
  /** Stable name, e.g. the map object's name. Picks the art ("mirror-a", "crate"). */
  id: string;
}

export const boxAt = (boxes: readonly Box[], t: XY): Box | undefined => boxes.find((b) => at(b, t));

/** A `free` test from a face's terrain: true for tiles a box can stand on (not solid). */
export const floorOf =
  (tiles: readonly (readonly TileKind[])[]) =>
  (t: XY): boolean =>
    !SOLID[tiles[t.y]![t.x]!];

/**
 * Push the box on `tile` one step by (dx, dy) (the canonical step from onPush). Mutates the
 * box and returns it, or returns null when there is no box there or it cannot move:
 * off the face, onto the ring (unless `ring` is true), onto another box, or `free` says no.
 */
export function pushBox(boxes: Box[], tile: XY, dx: number, dy: number, free: (t: XY) => boolean, ring = false): Box | null {
  const box = boxAt(boxes, tile);
  if (!box) return null;
  const to = { x: box.x + dx, y: box.y + dy };
  const min = ring ? 0 : 1;
  const max = FACE_SIZE - 1 - min;
  if (to.x < min || to.y < min || to.x > max || to.y > max) return null;
  if (boxAt(boxes, to) || !free(to)) return null;
  box.x = to.x;
  box.y = to.y;
  return box;
}

/** Put every box back where `start` says (same ids). Mutates `boxes`. */
export function resetBoxes(boxes: Box[], start: readonly Box[]): void {
  boxes.length = 0;
  for (const b of start) boxes.push({ id: b.id, x: b.x, y: b.y });
}
