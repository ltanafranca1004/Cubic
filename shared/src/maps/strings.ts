import { FACE_SIZE, type FaceId, type Side } from '../types';
import type { FaceMap, MapObject, TileKind } from './types';

/**
 * String map legend: one character per tile, FACE_SIZE rows of FACE_SIZE.
 * A character is either terrain or an object standing on floor.
 * Add a line here to introduce a new object type (also listed in /maps/README.md).
 */
export const LEGEND: Readonly<Record<string, { tile: TileKind } | { object: string; name?: string; props?: MapObject['props'] }>> = {
  '.': { tile: 'floor' },
  '#': { tile: 'wall' },
  T: { tile: 'tree' },
  '~': { tile: 'water' },
  P: { object: 'plate' },
  D: { object: 'door' },
  C: { object: 'crystal' },
  O: { object: 'portal' },
  // Carryable item and a target to drop it on. In string maps the item id is
  // "<side><face>-<x>-<y>" and targets accept anything; use Tiled for named ones.
  I: { object: 'item' },
  U: { object: 'target' },
  R: { object: 'item', name: 'rose', props: { kind: 'rose' } },
  // Code relay (face 3): the six sign stones outside, the tablet and its lamps inside.
  1: { object: 'glyph', name: 'sun' },
  2: { object: 'glyph', name: 'moon' },
  3: { object: 'glyph', name: 'star' },
  4: { object: 'glyph', name: 'drop' },
  5: { object: 'glyph', name: 'bolt' },
  6: { object: 'glyph', name: 'ring' },
  G: { object: 'tablet' },
  L: { object: 'lamp' },
  // Skylight (face 5): a pane outside lights the bridge with the same name inside.
  S: { object: 'skylight', name: 'a' },
  s: { object: 'skylight', name: 'b' },
  B: { object: 'bridge', name: 'a' },
  b: { object: 'bridge', name: 'b' },
  // Mirror maze (face 4): the doorway of the trap room.
  E: { object: 'entry' },
};

/** Build a FaceMap from FACE_SIZE strings of FACE_SIZE legend characters. Throws on bad input. */
export function parseStringMap(side: Side, face: FaceId, rows: readonly string[]): FaceMap {
  const where = `${side}-${face}`;
  if (rows.length !== FACE_SIZE) throw new Error(`map ${where}: expected ${FACE_SIZE} rows, got ${rows.length}`);
  const tiles: TileKind[][] = [];
  const objects: MapObject[] = [];
  rows.forEach((row, y) => {
    if (row.length !== FACE_SIZE) throw new Error(`map ${where}: row ${y} has ${row.length} chars, expected ${FACE_SIZE}`);
    const line: TileKind[] = [];
    [...row].forEach((ch, x) => {
      const entry = LEGEND[ch];
      if (!entry) throw new Error(`map ${where}: unknown character "${ch}" at ${x},${y}`);
      if ('tile' in entry) line.push(entry.tile);
      else {
        line.push('floor');
        const auto = entry.object === 'item' || entry.object === 'target' ? `${side}${face}-${x}-${y}` : '';
        objects.push({ type: entry.object, x, y, name: entry.name ?? auto, props: { ...entry.props } });
      }
    });
    tiles.push(line);
  });
  return { side, face, tiles, objects };
}
