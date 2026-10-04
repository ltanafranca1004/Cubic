import { FACES, FACE_SIZE, TILE_PX, type FaceId, type Side } from '@cubic/shared';
import { asset } from '../style/assets';
import { FACE_HUD } from '../style/tokens';
import { faceOps, type CubeManifest } from './layout';
import { pack, type CubeFaces, type FaceTex } from './raster';

// THE SIX FACE TEXTURES, baked from the real maps with the real tiles, puzzle objects, items
// and the turtles (assets/manifest.json), so the cube always shows the world as it is at
// the start of a game. Baked once per (side, texel size) and kept.

export interface CubeArt {
  manifest: CubeManifest;
  sheets: Map<string, HTMLImageElement>;
}

let loading: Promise<CubeArt | null> | null = null;

/** The manifest and every sheet it names. Loaded once; null if the manifest is missing. */
export function loadCubeArt(): Promise<CubeArt | null> {
  loading ??= (async () => {
    try {
      const manifest = (await (await fetch(asset('manifest.json'))).json()) as CubeManifest;
      const paths = new Set<string>();
      for (const t of Object.values(manifest.tilesets ?? {})) paths.add(t.image);
      for (const o of Object.values(manifest.objects ?? {})) paths.add(o.image);
      for (const i of Object.values(manifest.items ?? {})) paths.add(i.image);
      for (const p of Object.values(manifest.players ?? {})) if (p) paths.add(p.image);
      const sheets = new Map<string, HTMLImageElement>();
      await Promise.all(
        [...paths].map(
          (path) =>
            new Promise<void>((done) => {
              const img = new Image();
              img.onload = () => {
                sheets.set(path, img);
                done();
              };
              img.onerror = () => done(); // that sheet is left out; its tiles stay the face colour
              img.src = asset(path);
            }),
        ),
      );
      return { manifest, sheets };
    } catch (e) {
      console.warn('[cube] no manifest, drawing flat faces', e);
      return null;
    }
  })();
  return loading;
}

/** The colour a face has before (or without) its art: its biome outside, its room's tint inside. */
const flat = (side: Side, face: FaceId): string => FACE_HUD[face][side];

/**
 * How much of its room's tint an inside face takes on the cube. The six rooms are all the
 * same dark stone, so without it the inside of the cube is six faces nobody can tell apart.
 */
const ROOM_TINT = 0.45;

/** Mix `tint` into every pixel of a texture (packed ABGR), by `amount` 0..1. */
function tinted(px: Uint32Array, tint: string, amount: number): void {
  const t = pack(tint);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  for (let i = 0; i < px.length; i++) {
    const p = px[i]!;
    px[i] = (0xff000000 | (mix((p >>> 16) & 0xff, (t >>> 16) & 0xff) << 16) | (mix((p >>> 8) & 0xff, (t >>> 8) & 0xff) << 8) | mix(p & 0xff, t & 0xff)) >>> 0;
  }
}

const cache = new Map<string, FaceTex>();

/**
 * One face as a texture, `texel` pixels per map tile (16 = the art as drawn; smaller sizes
 * are cut down with nearest-neighbour, so a pixel stays a pixel). `fixed`: leave out what
 * differs from game to game (layout.ts: startObjects).
 */
export function bakeFace(art: CubeArt | null, side: Side, face: FaceId, texel: number, player = false, fixed = false): FaceTex {
  const key = `${art ? 'art' : 'flat'}:${side}:${face}:${texel}:${player}:${fixed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const full = FACE_SIZE * TILE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = full;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = flat(side, face);
  g.fillRect(0, 0, full, full);
  if (art) {
    for (const op of faceOps(art.manifest, side, face, player, fixed)) {
      const sheet = art.sheets.get(op.image);
      if (!sheet) continue;
      const cols = Math.floor(sheet.width / TILE_PX);
      g.drawImage(sheet, (op.frame % cols) * TILE_PX, Math.floor(op.frame / cols) * TILE_PX, TILE_PX, TILE_PX, op.x * TILE_PX, op.y * TILE_PX, TILE_PX, TILE_PX);
    }
  }
  const size = FACE_SIZE * texel;
  let out = g;
  if (size !== full) {
    const small = document.createElement('canvas');
    small.width = small.height = size;
    out = small.getContext('2d', { willReadFrequently: true })!;
    out.imageSmoothingEnabled = false;
    out.drawImage(canvas, 0, 0, full, full, 0, 0, size, size);
  }
  const tex: FaceTex = { size, px: new Uint32Array(out.getImageData(0, 0, size, size).data.buffer) };
  // art with a see-through pixel would leave a hole in the cube: back it with the face colour
  const back = pack(flat(side, face));
  for (let i = 0; i < tex.px.length; i++) if (tex.px[i]! >>> 24 < 255) tex.px[i] = back;
  if (art && side === 'in') tinted(tex.px, flat(side, face), ROOM_TINT);
  cache.set(key, tex);
  return tex;
}

/** All six faces of one side. */
export function bakeFaces(art: CubeArt | null, side: Side, texel: number, player = false, fixed = false): CubeFaces {
  const faces = {} as CubeFaces;
  for (const face of FACES) faces[face] = bakeFace(art, side, face, texel, player, fixed);
  return faces;
}
