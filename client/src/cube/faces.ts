import { FACES, FACE_SIZE, TILE_PX, type FaceId, type Side } from '@cubic/shared';
import { asset } from '../style/assets';
import { C, FACE_STYLE } from '../style/tokens';
import { faceOps, type CubeManifest } from './layout';
import { pack, type CubeFaces, type FaceTex } from './raster';

// THE SIX FACE TEXTURES, baked from the real maps with the real tiles, objects, items and
// the turtles (assets/manifest.json), so the cube always shows the world as it is. Baked
// once per (side, texel size) and kept.

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

/** The colour a face has before (or without) its art: its biome outside, a dark room inside. */
const flat = (side: Side, face: FaceId): string => (side === 'out' ? FACE_STYLE[face].base : C.shadow);

const cache = new Map<string, FaceTex>();

/**
 * One face as a texture, `texel` pixels per map tile (16 = the art as drawn; smaller sizes
 * are cut down with nearest-neighbour, so a pixel stays a pixel).
 */
export function bakeFace(art: CubeArt | null, side: Side, face: FaceId, texel: number, player = false): FaceTex {
  const key = `${art ? 'art' : 'flat'}:${side}:${face}:${texel}:${player}`;
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
    for (const op of faceOps(art.manifest, side, face, player)) {
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
  cache.set(key, tex);
  return tex;
}

/** All six faces of one side. */
export function bakeFaces(art: CubeArt | null, side: Side, texel: number, player = false): CubeFaces {
  const faces = {} as CubeFaces;
  for (const face of FACES) faces[face] = bakeFace(art, side, face, texel, player);
  return faces;
}
