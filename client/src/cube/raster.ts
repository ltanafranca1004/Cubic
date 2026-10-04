import { CANON_UP, FACES, NORMALS, canonRight, type FaceId } from '@cubic/shared';
import { apply, type Mat3, type V3 } from './mat';

// THE PIXEL CUBE. A small software rasterizer: six square textures, one view matrix, a
// buffer of pixels. Orthographic, backface culled, painted far to near, sampled with
// nearest-neighbour, one flat shade per face and a one pixel ink outline on every edge.
// It only touches typed arrays, so the same pixels come out under WebGL, Canvas and node
// (the unit tests); the callers scale the result by whole numbers.

/** A square face texture. Pixels are packed like ImageData read as Uint32 (0xAABBGGRR). */
export interface FaceTex {
  size: number;
  px: Uint32Array;
}

export type CubeFaces = Record<FaceId, FaceTex>;

export interface Target {
  width: number;
  height: number;
  px: Uint32Array;
  /** Which face covers each pixel (0 = none). Used for the outline and by the tests. */
  id: Uint8Array;
}

export interface DrawOptions {
  /** Where the cube's centre lands, in target pixels. */
  cx: number;
  cy: number;
  /** Half the cube's edge, in target pixels. */
  half: number;
  /** Outline colour (packed), or null for none. */
  ink: number | null;
  /** Unit vector towards the light, in screen space (x right, y up, z to the viewer). */
  light?: V3;
  /** Brightness of a face turned fully away from the light, 0..1. */
  ambient?: number;
}

/** From above, a little to the left and in front: the top face is the brightest. */
export const LIGHT: V3 = [-0.33, 0.82, 0.47];

export function createTarget(width: number, height: number): Target {
  return { width, height, px: new Uint32Array(width * height), id: new Uint8Array(width * height) };
}

export function clearTarget(t: Target): void {
  t.px.fill(0);
  t.id.fill(0);
}

/** Pack an '#rrggbb' colour as an opaque pixel. */
export function pack(color: string): number {
  const v = parseInt(color.slice(1), 16);
  return (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
}

/** A face's flat shade, 0..1, from its screen-space normal. */
export function shadeOf(normal: V3, light: V3 = LIGHT, ambient = 0.62): number {
  const d = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
  return Math.min(1, ambient + (1 - ambient) * d * 1.18);
}

/** Faces turned towards the viewer, farthest first (painter's order). */
export function visibleFaces(m: Mat3): FaceId[] {
  return FACES.map((face) => ({ face, z: apply(m, NORMALS[face])[2] }))
    .filter((f) => f.z > 1e-4)
    .sort((a, b) => a.z - b.z)
    .map((f) => f.face);
}

/** Where a cube-space point (the cube spans -1..1) lands on the target. */
export function project(m: Mat3, o: DrawOptions, p: V3): [number, number] {
  const s = apply(m, p);
  return [o.cx + s[0] * o.half, o.cy - s[1] * o.half];
}

/** Draw the cube into the target. The target is not cleared first. */
export function drawCube(t: Target, faces: CubeFaces, m: Mat3, o: DrawOptions): void {
  const { width, height, px, id } = t;
  const drawn: FaceId[] = visibleFaces(m);
  for (const face of drawn) {
    const tex = faces[face];
    const size = tex.size;
    const n = apply(m, NORMALS[face]);
    const r = apply(m, canonRight(face));
    const u = apply(m, CANON_UP[face]);
    // the face on screen: centre c, and the half-edge vectors a (map right) and b (map up)
    const cx = o.cx + n[0] * o.half;
    const cy = o.cy - n[1] * o.half;
    const ax = r[0] * o.half;
    const ay = -r[1] * o.half;
    const bx = u[0] * o.half;
    const by = -u[1] * o.half;
    const d = ax * by - ay * bx;
    if (Math.abs(d) < 1e-6) continue; // edge on
    const ex = Math.abs(ax) + Math.abs(bx);
    const ey = Math.abs(ay) + Math.abs(by);
    const x0 = Math.max(0, Math.floor(cx - ex));
    const x1 = Math.min(width - 1, Math.ceil(cx + ex));
    const y0 = Math.max(0, Math.floor(cy - ey));
    const y1 = Math.min(height - 1, Math.ceil(cy + ey));
    const k = Math.round(shadeOf(n, o.light, o.ambient) * 256);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const p = (dx * by - dy * bx) / d;
        if (p < -1 || p > 1) continue;
        const q = (ax * dy - ay * dx) / d;
        if (q < -1 || q > 1) continue;
        // nearest texel: p runs left to right, q bottom to top
        let tu = Math.floor((p + 1) * 0.5 * size);
        let tv = Math.floor((1 - q) * 0.5 * size);
        if (tu >= size) tu = size - 1;
        if (tv >= size) tv = size - 1;
        const c = tex.px[tv * size + tu]!;
        const i = y * width + x;
        px[i] = k >= 256 ? c | 0xff000000 : (0xff000000 | ((((c >> 16) & 0xff) * k) >> 8 << 16) | ((((c >> 8) & 0xff) * k) >> 8 << 8) | (((c & 0xff) * k) >> 8)) >>> 0;
        id[i] = face;
      }
    }
  }
  if (o.ink !== null) outline(t, o.ink);
}

/**
 * One pixel of ink wherever two faces meet and all around the silhouette. Each boundary
 * is inked on one side only, so an inner edge is one pixel wide, not two.
 */
function outline(t: Target, ink: number): void {
  const { width, height, px, id } = t;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const f = id[i]!;
      if (!f) continue;
      const right = x + 1 < width ? id[i + 1]! : 0;
      const down = y + 1 < height ? id[i + width]! : 0;
      const left = x > 0 ? id[i - 1]! : 0;
      const up = y > 0 ? id[i - width]! : 0;
      if (right !== f || down !== f || left === 0 || up === 0) px[i] = ink;
    }
  }
}
