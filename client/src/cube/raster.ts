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
export function outline(t: Target, ink: number): void {
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

// THE ROOM. The same six textures seen from INSIDE the cube: a camera on the view's z axis,
// outside the open side, looks into the box in perspective. Only the inner side of a face
// is drawn; a face that turns its back to the camera is left out, and what is beyond the
// room stays empty (dark, on the HUD).

export interface RoomOptions extends DrawOptions {
  /** How far the camera is from the cube's centre, in half-edges (more than the cube's corner, 1.74). */
  cam: number;
}

/** The faces whose inner side the camera sees. From outside a box these never overlap. */
export function roomFaces(m: Mat3, cam: number): FaceId[] {
  return FACES.filter((face) => cam * apply(m, NORMALS[face])[2] < 1 - 1e-4);
}

/**
 * Where a cube-space point lands on the target, in perspective. `half` is half the edge of
 * the open side (the square nearest the camera) when the room is seen straight on.
 */
export function projectRoom(m: Mat3, o: RoomOptions, p: V3): [number, number] {
  const s = apply(m, p);
  const k = (o.half * (o.cam - 1)) / (o.cam - s[2]);
  return [o.cx + s[0] * k, o.cy - s[1] * k];
}

/** Draw the room into the target: one ray per pixel, so the texels stay sharp. The view must be a proper rotation. */
export function drawRoom(t: Target, faces: CubeFaces, m: Mat3, o: RoomOptions): void {
  const { width, height, px, id } = t;
  const focal = o.half * (o.cam - 1);
  for (const face of roomFaces(m, o.cam)) {
    const tex = faces[face];
    const size = tex.size;
    const n = apply(m, NORMALS[face]);
    const r = apply(m, canonRight(face));
    const u = apply(m, CANON_UP[face]);
    let x0 = width;
    let x1 = -1;
    let y0 = height;
    let y1 = -1;
    for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const k = focal / (o.cam - (n[2] + p * r[2] + q * u[2]));
      const x = o.cx + (n[0] + p * r[0] + q * u[0]) * k;
      const y = o.cy - (n[1] + p * r[1] + q * u[1]) * k;
      x0 = Math.min(x0, Math.floor(x));
      x1 = Math.max(x1, Math.ceil(x));
      y0 = Math.min(y0, Math.floor(y));
      y1 = Math.max(y1, Math.ceil(y));
    }
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(width - 1, x1);
    y1 = Math.min(height - 1, y1);
    // the wall's inner side is lit: it faces back into the room
    const k = Math.round(shadeOf([-n[0], -n[1], -n[2]], o.light, o.ambient) * 256);
    // the camera's height over the wall's plane (n . P = 1)
    const above = 1 - o.cam * n[2];
    for (let y = y0; y <= y1; y++) {
      const dy = -(y + 0.5 - o.cy);
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - o.cx;
        // the ray through this pixel, from the camera at (0, 0, cam)
        const along = dx * n[0] + dy * n[1] - focal * n[2];
        if (along < 1e-9) continue;
        const s = above / along;
        const hx = s * dx - n[0];
        const hy = s * dy - n[1];
        const hz = o.cam - s * focal - n[2];
        const p = hx * r[0] + hy * r[1] + hz * r[2];
        if (p < -1 || p > 1) continue;
        const q = hx * u[0] + hy * u[1] + hz * u[2];
        if (q < -1 || q > 1) continue;
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

// THE CUBE COMING APART (the ending, scenes/ending). The same texels, shade and ink, but
// every face is a quad of its own, anywhere in space, seen from either side, and a depth
// per pixel decides what is in front: faces on hinges pass in front of each other in ways
// a painter's order cannot follow. Sprites (the turtles) go into the same depth.

export interface DepthTarget extends Target {
  /** How near the camera each pixel is (larger = nearer); -Infinity where nothing is drawn. */
  depth: Float32Array;
}

export function createDepthTarget(width: number, height: number): DepthTarget {
  return { ...createTarget(width, height), depth: new Float32Array(width * height).fill(-Infinity) };
}

export function clearDepthTarget(t: DepthTarget): void {
  clearTarget(t);
  t.depth.fill(-Infinity);
}

/** One face in SCREEN space (the view already applied): x right, y up, z to the viewer, in half edges. */
export interface Quad {
  /** What the outline tells apart (a face number). */
  id: number;
  /** Its centre, its half edges (texture right, texture up) and its outer normal. */
  c: V3;
  r: V3;
  u: V3;
  n: V3;
  /** The texture of its outer side, and of the side seen from behind (the same layout: it shows mirrored). */
  tex: FaceTex;
  back?: FaceTex;
  /** Mix this colour (packed) into every texel, by `amount` 0..1. */
  tint?: number;
  amount?: number;
}

/** Draw one quad, either side, where it is nearer than what is there. */
export function drawQuad(t: DepthTarget, quad: Quad, o: Pick<DrawOptions, 'cx' | 'cy' | 'half' | 'light' | 'ambient'>): void {
  const { width, height, px, id, depth } = t;
  const { c, r, u, n } = quad;
  const front = n[2] >= 0;
  const tex = front ? quad.tex : (quad.back ?? quad.tex);
  const size = tex.size;
  const cx = o.cx + c[0] * o.half;
  const cy = o.cy - c[1] * o.half;
  const ax = r[0] * o.half;
  const ay = -r[1] * o.half;
  const bx = u[0] * o.half;
  const by = -u[1] * o.half;
  const d = ax * by - ay * bx;
  if (Math.abs(d) < 1e-6) return; // edge on
  const ex = Math.abs(ax) + Math.abs(bx);
  const ey = Math.abs(ay) + Math.abs(by);
  const x0 = Math.max(0, Math.floor(cx - ex));
  const x1 = Math.min(width - 1, Math.ceil(cx + ex));
  const y0 = Math.max(0, Math.floor(cy - ey));
  const y1 = Math.min(height - 1, Math.ceil(cy + ey));
  const k = Math.round(shadeOf(front ? n : [-n[0], -n[1], -n[2]], o.light, o.ambient) * 256);
  const mix = Math.round(Math.max(0, Math.min(1, quad.amount ?? 0)) * 256);
  const tint = quad.tint ?? 0;
  const tr = tint & 0xff;
  const tg = (tint >> 8) & 0xff;
  const tb = (tint >> 16) & 0xff;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const p = (dx * by - dy * bx) / d;
      if (p < -1 || p > 1) continue;
      const q = (ax * dy - ay * dx) / d;
      if (q < -1 || q > 1) continue;
      const i = y * width + x;
      const z = c[2] + p * r[2] + q * u[2];
      if (z <= depth[i]!) continue;
      let tu = Math.floor((p + 1) * 0.5 * size);
      let tv = Math.floor((1 - q) * 0.5 * size);
      if (tu >= size) tu = size - 1;
      if (tv >= size) tv = size - 1;
      const texel = tex.px[tv * size + tu]!;
      let cr = texel & 0xff;
      let cg = (texel >> 8) & 0xff;
      let cb = (texel >> 16) & 0xff;
      if (mix > 0) {
        cr += ((tr - cr) * mix) >> 8;
        cg += ((tg - cg) * mix) >> 8;
        cb += ((tb - cb) * mix) >> 8;
      }
      if (k < 256) {
        cr = (cr * k) >> 8;
        cg = (cg * k) >> 8;
        cb = (cb * k) >> 8;
      }
      px[i] = (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
      id[i] = quad.id;
      depth[i] = z;
    }
  }
}

/** A sprite's pixels (packed like a FaceTex), `width` x `height`. */
export interface SpritePx {
  width: number;
  height: number;
  px: Uint32Array;
}

/**
 * Draw a sprite upright with its top-left at (x, y), all of it at one depth: it shows
 * where nothing nearer is. `flip` mirrors it left to right; `scale` (a whole number) is
 * how many target pixels one of its pixels takes.
 */
export function drawSprite(t: DepthTarget, sprite: SpritePx, x: number, y: number, z: number, flip = false, scale = 1): void {
  const { width, height, px, depth } = t;
  for (let dy = 0; dy < sprite.height * scale; dy++) {
    const ty = y + dy;
    if (ty < 0 || ty >= height) continue;
    const sy = Math.floor(dy / scale);
    for (let dx = 0; dx < sprite.width * scale; dx++) {
      const tx = x + dx;
      if (tx < 0 || tx >= width) continue;
      const sx = Math.floor(dx / scale);
      const c = sprite.px[sy * sprite.width + (flip ? sprite.width - 1 - sx : sx)]!;
      if (c >>> 24 < 128) continue;
      const i = ty * width + tx;
      if (z < depth[i]!) continue;
      px[i] = (c | 0xff000000) >>> 0;
      depth[i] = z;
    }
  }
}

/** Darken a box of pixels that are already drawn and not nearer than `z` (a shadow on the ground). `keep` 0..1 of the light stays. */
export function shadeBox(t: DepthTarget, x: number, y: number, w: number, h: number, z: number, keep: number): void {
  const { width, height, px, depth } = t;
  const k = Math.round(keep * 256);
  for (let ty = Math.max(0, y); ty < Math.min(height, y + h); ty++) {
    for (let tx = Math.max(0, x); tx < Math.min(width, x + w); tx++) {
      const i = ty * width + tx;
      const c = px[i]!;
      if (c >>> 24 === 0 || depth[i]! > z) continue;
      px[i] = (0xff000000 | ((((c >> 16) & 0xff) * k) >> 8 << 16) | ((((c >> 8) & 0xff) * k) >> 8 << 8) | (((c & 0xff) * k) >> 8)) >>> 0;
    }
  }
}
