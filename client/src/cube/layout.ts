import { FACE_SIZE, SPAWN, defaultEnv, type FaceId, type Side, type TileKind, type World } from '@cubic/shared';

// WHAT IS ON A FACE: the list of tile, object, item and player frames to draw for one side
// of one face, read from the real maps and assets/manifest.json. Pure (no DOM), so the
// tests can check it; faces.ts turns the list into pixels.

type Frames = number | number[];

export interface CubeManifest {
  tilesets?: Record<string, { image: string; tiles: Partial<Record<TileKind, number[]>> }>;
  objects?: Record<string, { image: string; frames: Record<string, Frames>; sides?: Partial<Record<Side, Record<string, Frames>>> }>;
  items?: Record<string, { image: string; frame: number }>;
  players?: Partial<Record<Side, { image: string; idle?: number[]; walk: number[] }>>;
}

/** One 16px frame of a sheet, drawn on one tile. */
export interface FaceOp {
  image: string;
  frame: number;
  x: number;
  y: number;
}

// the same pick as the game view (style/art.ts), so a tile is the same variant on the cube
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;
const first = (f: Frames | undefined): number | null => (f === undefined ? null : typeof f === 'number' ? f : (f[0] ?? null));

/**
 * What to draw for one side of one face, in order: every tile, then the map's objects and
 * items, then (if asked) the player standing where the game starts. Pure: no DOM.
 */
export function faceOps(manifest: CubeManifest, side: Side, face: FaceId, player: boolean, world: World = defaultEnv.world): FaceOp[] {
  const ops: FaceOp[] = [];
  const map = world[side][face];
  const set = manifest.tilesets?.[`${side}-${face}`];
  if (set) {
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const kind = map.tiles[y]![x]!;
        const list = set.tiles[kind] ?? set.tiles.floor;
        if (!list?.length) continue;
        ops.push({ image: set.image, frame: kind === 'water' ? list[0]! : list[hash(face, x, y) % list.length]!, x, y });
      }
  }
  for (const o of map.objects) {
    if (o.type === 'item') {
      const item = manifest.items?.[String(o.props.kind ?? '')] ?? manifest.items?.default;
      if (item) ops.push({ image: item.image, frame: item.frame, x: o.x, y: o.y });
      continue;
    }
    const entry = manifest.objects?.[o.type] ?? manifest.objects?.unknown;
    if (!entry) continue;
    const frames = entry.sides?.[side] ?? entry.frames;
    const frame = first(frames.default) ?? first(Object.values(frames)[0]);
    if (frame !== null) ops.push({ image: entry.image, frame, x: o.x, y: o.y });
  }
  const hero = manifest.players?.[side];
  if (player && face === 1 && hero) ops.push({ image: hero.image, frame: hero.idle?.[0] ?? 0, x: SPAWN[side].x, y: SPAWN[side].y });
  return ops;
}

/** The texel size (16, 8 or 4 per tile) that best fits a cube whose edge is `edge` pixels. */
export function texelFor(edge: number): number {
  const want = edge / FACE_SIZE;
  return want >= 12 ? 16 : want >= 6 ? 8 : 4;
}
