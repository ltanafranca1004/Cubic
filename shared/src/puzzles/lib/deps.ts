import type { FaceId } from '../../types';
import type { PuzzleCtx } from '../types';

// CHAIN DEPENDENCIES: a puzzle that only works once another face is solved.
// The chain is 2 -> 5 -> 6 -> 4 (faces 1 and 3 stand alone).
//
//   onItem(s, ctx, ev) {
//     if (lockedUntil(ctx, 6)) { ctx.giveItem(ev.side, ev.item.id); return; } // not yet: hand it back
//   },

/** True while the puzzle on `face` is still unsolved. */
export const lockedUntil = (ctx: Pick<PuzzleCtx, 'faceSolved'>, face: FaceId): boolean => !ctx.faceSolved(face);
