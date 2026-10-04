import type { PuzzleCtx } from '../types';
import type { Side } from '../../types';
import { at, type XY } from '../util';

// HAZARD TILES: step on one and you are put back on the respawn tile, with a strike.
//
//   onEnter(s, ctx, side, tile) {
//     if (side === 'in' && hazardEnter(ctx, side, tile, lavaTiles(s, ctx), START)) ctx.emit('burn');
//   },
//
// Never put the respawn tile on a hazard, and keep hazards off the outer ring.

/**
 * If `tile` is one of `hazards`: teleport `side` to `respawn` (same face), add a strike and
 * return true. Otherwise do nothing and return false.
 */
export function hazardEnter(ctx: Pick<PuzzleCtx, 'teleport' | 'strike'>, side: Side, tile: XY, hazards: readonly XY[], respawn: XY): boolean {
  if (!hazards.some((h) => at(h, tile))) return false;
  ctx.teleport(side, respawn.x, respawn.y);
  ctx.strike(side);
  return true;
}
