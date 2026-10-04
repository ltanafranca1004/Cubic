import type { FaceId } from '../../types';
import { same } from './grid';
import type { PuzzleScript } from './types';

// ROSE AND POT. The outside player carries the rose from face 1 to the pot on the puzzle's
// own face. As the outside player the bot does it alone, once face 1 is solved (so it does
// not walk off while the human needs it there). As the inside player it can only say whose
// job it is.

/** Where the rose lies at the start of a game. */
const ROSE_FACE: FaceId = 1;

export const rosePotScript: PuzzleScript<null> = {
  id: 'rose-pot',
  lines: ['rose-pot.take', 'rose-pot.yours'],
  init: () => null,

  errand({ o, objs, say }) {
    const potFace = o.puzzleList.find((p) => p.id === 'rose-pot')?.face;
    if (o.you !== 'out' || potFace === undefined) return null;
    const pos = o.position;
    if (o.carrying !== null) {
      const pot = objs('target')[0];
      if (!pot) return { action: { type: 'go_face', face: potFace }, status: `carrying the ${o.carrying} to the pot on face ${potFace}` };
      return { action: same(pot, pos) ? { type: 'drop' } : { type: 'goto', col: pot.col, row: pot.row }, status: `putting the ${o.carrying} in the pot` };
    }
    if (!o.solvedFaces.includes(ROSE_FACE)) return null;
    const rose = o.items.find((i) => i.kind === 'rose');
    if (rose) {
      say('rose-pot.take');
      return { action: same(rose, pos) ? { type: 'pick_up' } : { type: 'goto', col: rose.col, row: rose.row }, status: 'fetching the rose' };
    }
    return o.face === ROSE_FACE ? null : { action: { type: 'go_face', face: ROSE_FACE }, status: 'going back for the rose' };
  },

  play({ o, say }) {
    if (o.you === 'in') say('rose-pot.yours', { every: 50_000 });
    return null;
  },
};
