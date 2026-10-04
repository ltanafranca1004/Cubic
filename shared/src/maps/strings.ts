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

  // ---------- face 2: equation-safe ----------

  // ---------- face 3: mirrored-glyph ----------

  // ---------- face 4: botanical-mirror ----------

  // ---------- face 5: sequence-laser ----------
  // A symbol tile (seven per side, same tiles; the i-th in map order is the i-th symbol).
  u: { object: 'f5-symbol' },
  v: { object: 'f5-replay' },
  // The laser emitter: a target. The puzzle hands back anything that is not the battery.
  w: { object: 'target', name: 'f5-emitter' },

  // ---------- face 6: laser-path ----------
  // A rock (stops the beam and the player), the wooden crate the beam burns, the RESET
  // tile, where the beam comes up, and the button in the lava. The mirrors move, so they
  // are not map objects: their start tiles are in the module.
  x: { object: 'f6-rock' },
  y: { object: 'f6-crate' },
  z: { object: 'reset' },
  Y: { object: 'f6-source' },
  X: { object: 'button' },
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
