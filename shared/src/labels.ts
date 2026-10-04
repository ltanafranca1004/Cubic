import { visibleObjects } from './game';
import { SYMBOL_OBJECT, symbolOf, type SymbolName } from './symbols';
import type { GameState, Side } from './types';

// SYMBOL LABELS: the name of the symbol a player stands on, shown over their own turtle
// (client only: it is never sent anywhere and never drawn for the partner).
//
// The lookup is by TILE, through what that side can see (`visible(side)` of the puzzle):
// outside the symbol tiles, inside the symbol buttons, on the same canonical tiles. No
// screen direction is involved, so the inside mirror cannot swap two names. A label only
// names the tile: it says nothing about the order, a lit symbol or a right or wrong press.

/** What `side` sees on a face, as far as a label needs it. */
export interface LabelObject {
  type: string;
  x: number;
  y: number;
  state?: string;
}

/** The name of the symbol on tile (x, y) among the objects a side sees, or null. Lit or not is the same name. */
export function symbolAt(objects: readonly LabelObject[], x: number, y: number): SymbolName | null {
  for (const o of objects) if (o.type === SYMBOL_OBJECT && o.x === x && o.y === y) return symbolOf(o.state);
  return null;
}

/** The label text of a symbol: the vocabulary word, in capitals ("BOLT"). */
export const symbolLabelText = (name: SymbolName): string => name.toUpperCase();

/** The symbol `side` is standing on right now (canonical tile and name), or null. */
export function symbolLabel(state: GameState, side: Side): { x: number; y: number; name: SymbolName } | null {
  const { face, x, y } = state.players[side].pose;
  const name = symbolAt(visibleObjects(state, side, face), x, y);
  return name ? { x, y, name } : null;
}
