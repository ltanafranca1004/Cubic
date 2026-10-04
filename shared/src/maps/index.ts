import { FACES, FACE_SIZE, SIDES, type FaceId, type Side } from '../types';
import { STRING_MAPS } from './default';
import { TMJ_MAPS } from './generated';
import { parseStringMap } from './strings';
import { parseTmj } from './tmj';
import { SOLID, type FaceMap, type MapObject, type TileKind, type World } from './types';

export * from './types';
export { LEGEND, parseStringMap } from './strings';
export { parseTmj } from './tmj';
export { STRING_MAPS, SPAWN } from './default';

/** Load every face: a Tiled map from /maps when one exists, the string map otherwise. */
export function loadWorld(): World {
  const world = { out: {}, in: {} } as World;
  for (const side of SIDES) {
    for (const face of FACES) {
      const tmj = TMJ_MAPS[`${side}-${face}`];
      world[side][face] = tmj ? parseTmj(side, face, tmj) : parseStringMap(side, face, STRING_MAPS[side][face]);
    }
  }
  return world;
}

export const inBounds = (x: number, y: number) => x >= 0 && x < FACE_SIZE && y >= 0 && y < FACE_SIZE;

export function faceMap(world: World, side: Side, face: FaceId): FaceMap {
  return world[side][face];
}

export function tileAt(world: World, side: Side, face: FaceId, x: number, y: number): TileKind {
  return world[side][face].tiles[y]![x]!;
}

export function isSolidTile(world: World, side: Side, face: FaceId, x: number, y: number): boolean {
  return SOLID[tileAt(world, side, face, x, y)];
}

/** Map objects on one side of one face, optionally filtered by type. */
export function objectsOn(world: World, side: Side, face: FaceId, type?: string): MapObject[] {
  const all = world[side][face].objects;
  return type ? all.filter((o) => o.type === type) : all;
}

/**
 * What each face is called, per side. The one source of names: the HUD, the AI partner's
 * observation, docs and art all follow this. Outside names are the biome of the face.
 */
export const FACE_NAMES: Record<Side, Record<FaceId, string>> = {
  out: { 1: 'Grass', 2: 'Desert', 3: 'Snow', 4: 'Forest', 5: 'Rooftop', 6: 'Cave' },
  in: { 1: 'Plate room', 2: 'Crate room', 3: 'Frost room', 4: 'Echo room', 5: 'Moat room', 6: 'Core' },
};
