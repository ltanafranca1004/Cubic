import type { FaceId, Side } from '../types';

/** Terrain. Everything interactive is a MapObject, not a tile. */
export type TileKind = 'floor' | 'wall' | 'tree' | 'water';

export const TILE_KINDS: readonly TileKind[] = ['floor', 'wall', 'tree', 'water'];

/** Terrain nobody can walk on. */
export const SOLID: Readonly<Record<TileKind, boolean>> = {
  floor: false,
  wall: true,
  tree: true,
  water: true,
};

/**
 * Something on the "objects" layer. `type` is what puzzle modules look for
 * (ctx.objects(side, face, 'plate')). Objects never block movement by themselves:
 * a puzzle module's isBlocked decides.
 */
export interface MapObject {
  type: string;
  x: number;
  y: number;
  name: string;
  props: Record<string, string | number | boolean>;
}

/** One side of one face. tiles[y][x], canonical coords (see shared/src/cube.ts). */
export interface FaceMap {
  side: Side;
  face: FaceId;
  tiles: TileKind[][];
  objects: MapObject[];
}

export type World = Record<Side, Record<FaceId, FaceMap>>;
