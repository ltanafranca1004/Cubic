import { GRID, type FaceId, type Side } from '../types';
import type { FaceMap, MapObject, TileKind } from './types';

/**
 * String map legend: one character per tile, 10 rows of 10.
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
};

/** Build a FaceMap from 10 strings of 10 legend characters. Throws on bad input. */
export function parseStringMap(side: Side, face: FaceId, rows: readonly string[]): FaceMap {
  const where = `${side}-${face}`;
  if (rows.length !== GRID) throw new Error(`map ${where}: expected ${GRID} rows, got ${rows.length}`);
  const tiles: TileKind[][] = [];
  const objects: MapObject[] = [];
  rows.forEach((row, y) => {
    if (row.length !== GRID) throw new Error(`map ${where}: row ${y} has ${row.length} chars, expected ${GRID}`);
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
