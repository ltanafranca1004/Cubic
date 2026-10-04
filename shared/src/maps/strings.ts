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
  // Carryable item and a target to drop it on. In string maps the item id is
  // "<side><face>-<x>-<y>" and targets accept anything; give `name` / `props` for named ones.
  I: { object: 'item' },
  U: { object: 'target' },
  // The stub puzzles' crystal (every face until its real puzzle lands).
  C: { object: 'crystal' },

  // Each puzzle adds its own characters in its own section below, and nowhere else.
  // A character means one thing on every face: check the other sections before picking one.
  // ---------- face 1: hidden-code ----------
  // The floor keypad (inside): a key per digit, ENTER, and the cells of the display.
  '0': { object: 'key', name: '0' },
  '1': { object: 'key', name: '1' },
  '2': { object: 'key', name: '2' },
  '3': { object: 'key', name: '3' },
  '4': { object: 'key', name: '4' },
  '5': { object: 'key', name: '5' },
  '6': { object: 'key', name: '6' },
  '7': { object: 'key', name: '7' },
  '8': { object: 'key', name: '8' },
  '9': { object: 'key', name: '9' },
  e: { object: 'key', name: 'enter' },
  d: { object: 'display' },

  // ---------- face 2: equation-safe ----------

  // ---------- face 3: mirrored-glyph ----------

  // ---------- face 4: botanical-mirror ----------
  // A pot: a target that takes anything (the flower is made during the game, so it cannot
  // be named here); the puzzle hands back whatever is not the flower.
  p: { object: 'target' },

  // ---------- face 5: sequence-laser ----------

  // ---------- face 6: laser-path ----------
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
