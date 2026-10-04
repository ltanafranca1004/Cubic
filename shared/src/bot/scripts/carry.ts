import type { Side } from '../../types';
import type { Observation } from '../observe';
import { same } from './grid';
import type { Play } from './types';

// CARRYING across the cube, for a script's errand(): fetch an item from the face that gave
// it and place it on a target on another face. Only from what this side sees: the item on
// its own face, what it holds, which faces are solved.

export interface CarryJob {
  /** The side that can carry it (items live on one side). */
  side: Side;
  /** The item's kind, as in Observation.items / carrying. */
  kind: string;
  /** Puzzle id of the face that hands the item out once it is solved. */
  from: string;
  /** Puzzle id of the face it goes to. */
  to: string;
  /** Object type (as this side sees it on the `to` face) to stand on and drop. */
  target: string;
}

/**
 * The next thing to do for a carrying job, or null: not my side, the item is not out yet,
 * it is already on its target, or I cannot tell where it is (it was dropped on a face I am
 * not on: only then does the bot not go looking).
 */
export function carryTo(o: Observation, job: CarryJob): Play | null {
  const faceOf = (id: string) => o.puzzleList.find((p) => p.id === id)?.face;
  const from = faceOf(job.from);
  const to = faceOf(job.to);
  if (o.you !== job.side || from === undefined || to === undefined || !o.solvedFaces.includes(from)) return null;
  if (o.carrying === job.kind) {
    if (o.face !== to) return { action: { type: 'go_face', face: to }, status: `carrying the ${job.kind} to face ${to}` };
    const target = o.objects.find((x) => x.type === job.target);
    if (!target) return null;
    return same(o.position, target) ? { action: { type: 'drop' }, status: `placing the ${job.kind}` } : { action: { type: 'goto', col: target.col, row: target.row }, allow: [target], status: `carrying the ${job.kind} to the ${job.target}` };
  }
  if (o.carrying) return null;
  const item = o.items.find((i) => i.kind === job.kind);
  if (item) {
    if (o.objects.some((x) => x.type === job.target && same(x, item))) return null; // it is in place
    return same(o.position, item) ? { action: { type: 'pick_up' }, status: `picking up the ${job.kind}` } : { action: { type: 'goto', col: item.col, row: item.row }, allow: [item], status: `fetching the ${job.kind}` };
  }
  // Not in sight: it lies where it came out, unless I am already there.
  return o.face === from ? null : { action: { type: 'go_face', face: from }, status: `going to face ${from} for the ${job.kind}` };
}
