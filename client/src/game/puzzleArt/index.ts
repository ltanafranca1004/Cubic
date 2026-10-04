import * as common from './common';
import * as face1 from './face1';
import * as face2 from './face2';
import * as face3 from './face3';
import * as face4 from './face4';
import * as face5 from './face5';
import * as face6 from './face6';
import type { Draw, Rect, Sprite } from './common';

// THE CO-OP PUZZLE OBJECTS, drawn once, in code, as 16x16 pixel art in palette colours.
// One source for both places that need them: /tools/art puts every sprite listed here on
// sprites/objects.png (and into manifest.json), and CodeArt (../art.ts) draws the same
// pixels as its placeholder, so a puzzle object never shows up as the "unknown" marker.
// Pure: no DOM, no Phaser. It only calls the `rect` it is given.
//
// To add a sprite: in your own faceN.ts write `function mything(rect, state)` with `rect`
// calls in `C.*` colours (style/tokens.ts, nothing else: the generator rejects any other
// colour), add it to DRAW under the map object's `type`, and list every state the puzzle's
// `visible()` can return for it in SPRITES. The first state listed is the frame shown for
// an unknown state. Shared things (keypad, button, RESET, CLEAR) are in ./common.ts.
// Then `cd tools && npm run art` redraws the sheet and the manifest. Items: ./items.ts.

export type { Draw, Rect, Sprite } from './common';
export { PUZZLE_ITEMS, drawPuzzleItem } from './items';

const SETS = [common, face1, face2, face3, face4, face5, face6];

const DRAW: Record<string, Draw> = {};
for (const set of SETS)
  for (const [type, draw] of Object.entries(set.DRAW)) {
    if (DRAW[type]) throw new Error(`puzzleArt: two files draw the object type "${type}"`);
    DRAW[type] = draw;
  }

/** Every sprite the sheet gets, in sheet order (after the older objects). */
export const PUZZLE_SPRITES: readonly Sprite[] = SETS.flatMap((set) => set.SPRITES);

/** Draw a co-op puzzle object. False if `type` is not one of them (nothing was drawn). */
export function drawPuzzleObject(rect: Rect, type: string, state: string | undefined): boolean {
  const draw = DRAW[type];
  if (!draw) return false;
  draw(rect, state ?? 'default');
  return true;
}
