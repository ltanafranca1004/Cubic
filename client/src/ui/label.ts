import { FACE_SIZE, TILE_PX, canonToScreen, symbolLabel, symbolLabelText, type GameState, type Side } from '@cubic/shared';
import { CARRY_PX } from '../game/turtle';

// THE LABEL OVER YOUR OWN TURTLE: the name of the face 5 symbol you stand on ("BOLT").
// Pure (no DOM): what it says and where it goes. ui/cubicUI.ts draws it as a tag in the
// same DOM layer as the quick-chat bubbles, so it is the same pixels in WebGL and Canvas
// and follows the text size, high contrast and reduce motion settings like they do.
//
// The name comes from /shared (symbolLabel: by tile, through what the side sees), in the
// words the AI partner uses. It is made here, on this client, for this player only.

/** A label over your own turtle: its screen tile, the words, and the art pixels to clear above the head (a carried item). */
export interface TileLabel {
  sx: number;
  sy: number;
  text: string;
  lift: number;
}

/** Art pixels between the label and the turtle (or the item on its head). */
export const LABEL_GAP = 2;

/** The label for `side` right now, in its own screen tiles, or null when it stands on no symbol. */
export function tileLabel(state: GameState, side: Side): TileLabel | null {
  const hit = symbolLabel(state, side);
  if (!hit) return null;
  const player = state.players[side];
  const [sx, sy] = canonToScreen(side, player.pose.face, player.pose.up, hit.x, hit.y);
  return { sx, sy, text: symbolLabelText(hit.name), lift: player.carrying ? CARRY_PX : 0 };
}

/**
 * Where a label of `box` art pixels goes in the view: centred over the turtle, above its
 * head and the item it carries; under its feet when there is no room above; and never
 * over the side edges. It never lands on the turtle's own tile, so the symbol stays clear.
 */
export function labelSpot(label: TileLabel, box: { w: number; h: number }, view: number = FACE_SIZE * TILE_PX): { left: number; top: number; under: boolean } {
  const left = Math.max(0, Math.min(view - box.w, Math.round((label.sx + 0.5) * TILE_PX - box.w / 2)));
  const above = label.sy * TILE_PX - label.lift - LABEL_GAP - box.h;
  const under = above < 0;
  return { left, top: under ? (label.sy + 1) * TILE_PX + LABEL_GAP : above, under };
}
