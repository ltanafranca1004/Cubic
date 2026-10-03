import { GRID, TILE_PX, type FaceId, type Side } from '../types';
import { TILE_KINDS, type FaceMap, type MapObject, type TileKind } from './types';

// Loader for Tiled JSON maps (.tmj). See /maps/README.md for the authoring rules.
// Expected: 10x10 orthogonal map, 16px tiles, a tile layer named "tiles" and an
// object layer named "objects". Tile data must be uncompressed (CSV / JSON array).

interface TmjProperty {
  name: string;
  value: string | number | boolean;
}
interface TmjTilesetTile {
  id: number;
  type?: string;
  class?: string;
  properties?: TmjProperty[];
}
interface TmjTileset {
  firstgid: number;
  source?: string;
  tiles?: TmjTilesetTile[];
}
interface TmjObject {
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  height?: number;
  gid?: number;
  properties?: TmjProperty[];
}
interface TmjLayer {
  name: string;
  type: string;
  data?: number[] | string;
  objects?: TmjObject[];
}
interface Tmj {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TmjLayer[];
  tilesets?: TmjTileset[];
}

const FLIP_MASK = 0x1fffffff;

const prop = (props: TmjProperty[] | undefined, name: string) => props?.find((p) => p.name === name)?.value;

function tileKind(gid: number, tilesets: TmjTileset[]): TileKind {
  const id = gid & FLIP_MASK;
  if (id === 0) return 'floor';
  const set = [...tilesets].sort((a, b) => b.firstgid - a.firstgid).find((t) => t.firstgid <= id);
  const tile = set?.tiles?.find((t) => t.id === id - set.firstgid);
  // "kind" custom property, or the tile's class/type, names the terrain. Default: floor.
  const kind = prop(tile?.properties, 'kind') ?? tile?.type ?? tile?.class;
  return TILE_KINDS.includes(kind as TileKind) ? (kind as TileKind) : 'floor';
}

/** Build a FaceMap from a parsed .tmj file. Throws on bad input. */
export function parseTmj(side: Side, face: FaceId, json: unknown): FaceMap {
  const where = `${side}-${face}.tmj`;
  const map = json as Tmj;
  if (map.width !== GRID || map.height !== GRID) throw new Error(`${where}: map must be ${GRID}x${GRID} tiles`);
  if (map.tilewidth !== TILE_PX || map.tileheight !== TILE_PX) throw new Error(`${where}: tiles must be ${TILE_PX}px`);

  const tileLayer = map.layers.find((l) => l.type === 'tilelayer' && l.name === 'tiles');
  if (!tileLayer) throw new Error(`${where}: missing tile layer named "tiles"`);
  if (!Array.isArray(tileLayer.data)) throw new Error(`${where}: tile layer must be saved uncompressed (CSV)`);
  const data = tileLayer.data;
  if (data.length !== GRID * GRID) throw new Error(`${where}: tile layer has ${data.length} tiles`);

  const tilesets = map.tilesets ?? [];
  const tiles: TileKind[][] = [];
  for (let y = 0; y < GRID; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < GRID; x++) row.push(tileKind(data[y * GRID + x] ?? 0, tilesets));
    tiles.push(row);
  }

  const objects: MapObject[] = [];
  const objectLayer = map.layers.find((l) => l.type === 'objectgroup' && l.name === 'objects');
  for (const o of objectLayer?.objects ?? []) {
    const type = o.type || o.class || String(prop(o.properties, 'type') ?? '');
    if (!type) throw new Error(`${where}: object "${o.name ?? ''}" at ${o.x},${o.y} has no "type"`);
    // Tile objects (with a gid) are anchored bottom-left in Tiled, everything else top-left.
    const py = o.gid ? o.y - (o.height ?? TILE_PX) : o.y;
    const x = Math.floor(o.x / TILE_PX);
    const y = Math.floor(py / TILE_PX);
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) throw new Error(`${where}: object "${type}" is off the map`);
    const props: MapObject['props'] = {};
    for (const p of o.properties ?? []) if (p.name !== 'type') props[p.name] = p.value;
    objects.push({ type, x, y, name: o.name ?? '', props });
  }
  return { side, face, tiles, objects };
}
