// Menu scenery: the sky, the clouds, the Cubic logo and the two cubes of the side select.
import { C, ROLE, type Ramp } from '../../client/src/style/tokens';
import { Img } from './img';

/** 4x4 ordered dither thresholds. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * The sky: a strip 8px wide (tile it sideways) from deep blue down to a pale horizon, with
 * ordered dither between the palette steps so there is no gradient the palette cannot hold.
 */
function sky(dir: string): void {
  const H = 360;
  const stops: [number, string][] = [
    [0, ROLE.skyTop],
    [0.3, ROLE.sky],
    [0.72, ROLE.skyLow],
    [1, C.white],
  ];
  const g = new Img(8, H);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    // hold each colour flat for the first 55% of its band, dither the rest into the next
    const k = Math.max(0, ((t - t0) / (t1 - t0) - 0.55) / 0.45);
    // coarse 2x2 dither cells so the pattern reads as a band, not as noise
    for (let x = 0; x < 8; x++) g.set(x, y, k * 16 > BAYER[(Math.floor(y / 2) % 4) * 4 + (Math.floor(x / 2) % 4)]! ? c1 : c0);
  }
  g.save(`${dir}/ui/sky.png`);
}

/**
 * A cloud from a row of lumps (circles sitting on one flat base): white body, a mist
 * underside and a sky-coloured rim along the bottom, no outline.
 */
function cloud(w: number, h: number, lumps: [number, number, number][]): Img {
  const g = new Img(w, h);
  const base = h - 1;
  for (const [cx, r, lift] of lumps) {
    const cy = base - lift - r;
    for (let y = 0; y <= base; y++)
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // a circle, extended straight down to the base
        if (dx * dx + dy * dy <= r * r || (y > cy && Math.abs(dx) <= r && y <= base)) g.set(x, y, ROLE.cloud);
      }
  }
  // round the two bottom corners
  for (let x = 0; x < w; x++) {
    if (!g.get(x - 1, base) || !g.get(x + 1, base)) g.set(x, base, null);
  }
  // underside: mist where there is little cloud below, stepped so it follows the lumps
  const shadeH = Math.max(2, Math.round(h * 0.14));
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      if (!g.get(x, y)) continue;
      let below = 0;
      while (g.get(x, y + below + 1)) below++;
      if (below < shadeH + ((x >> 2) & 1)) g.set(x, y, ROLE.cloudShade);
      if (below === 0) g.set(x, y, ROLE.skyLow);
    }
  return g;
}

function clouds(dir: string): void {
  // far to near: small and flat to large and tall
  cloud(40, 12, [[9, 5, 0], [19, 8, 0], [30, 6, 0]]).save(`${dir}/ui/cloud-1.png`);
  cloud(64, 20, [[10, 7, 0], [24, 12, 0], [40, 14, 1], [54, 8, 0]]).save(`${dir}/ui/cloud-2.png`);
  cloud(96, 32, [[14, 10, 0], [32, 17, 2], [54, 21, 3], [74, 15, 1], [86, 9, 0]]).save(`${dir}/ui/cloud-3.png`);
  cloud(144, 46, [[18, 13, 0], [42, 22, 3], [70, 28, 6], [98, 24, 4], [122, 17, 1], [134, 9, 0]]).save(`${dir}/ui/cloud-4.png`);
}

/** Letters as rectangles [x, y, w, h] in a 25x35 box, strokes 6 wide. */
const LETTERS: Record<string, [number, number, number, number][]> = {
  C: [[0, 0, 25, 6], [0, 0, 6, 35], [0, 29, 25, 6], [19, 0, 6, 10], [19, 25, 6, 10]],
  U: [[0, 0, 6, 35], [19, 0, 6, 35], [0, 29, 25, 6]],
  B: [[0, 0, 6, 35], [0, 0, 21, 6], [0, 14, 21, 7], [0, 29, 21, 6], [19, 3, 6, 13], [19, 19, 6, 13]],
  I: [[0, 0, 25, 6], [9, 0, 7, 35], [0, 29, 25, 6]],
};

/**
 * The logo: CUBIC in square block letters, each a little slab seen from the front and
 * above. CUB is the outside (green), IC is the inside (amber): the game in one word.
 */
function logo(dir: string): void {
  const S = 2; // the letter boxes are drawn at twice their 25x35 design size
  const DEPTH = 8;
  const GAP = 10;
  const word: [string, Ramp][] = [['C', ROLE.out], ['U', ROLE.out], ['B', ROLE.out], ['I', ROLE.in], ['C', ROLE.in]];
  const lw = 25 * S;
  const w = word.length * lw + (word.length - 1) * GAP + 2;
  const h = 35 * S + DEPTH + 2;
  const g = new Img(w, h);
  word.forEach(([ch, ramp], n) => {
    const ox = 1 + n * (lw + GAP);
    const face = new Img(lw, 35 * S);
    for (const [x, y, rw, rh] of LETTERS[ch]!) face.rect(x * S, y * S, rw * S, rh * S, ramp.base);
    // the slab's side, under every face pixel
    for (let d = DEPTH; d >= 1; d--) g.blit(face.clone().map(() => (d > DEPTH - 2 ? ramp.deep : ramp.dark)), ox, 1 + d);
    // the face: lit along every top edge, a second soft band under it
    const lit = face.clone().map((_, x, y) => (!face.get(x, y - 1) || !face.get(x, y - 3) ? ramp.light : ramp.base));
    g.blit(lit, ox, 1);
  });
  g.outline(C.ink, true);
  g.save(`${dir}/ui/logo.png`);
}

/**
 * The two cubes of the side select, drawn small and shown at 3x like a zoomed piece of
 * the game world. Same cube twice: one seen whole (stand on top), one cut open (stand inside).
 */
function cubes(dir: string): void {
  const W = 48;
  const H = 46;
  const TOP = 12;
  const draw = (open: boolean) => {
    const g = new Img(W, H);
    // top face: meadow
    g.rect(2, 2, W - 4, TOP, C.grass);
    for (const [x, y] of [[6, 5], [14, 9], [21, 4], [30, 10], [38, 6], [42, 11], [10, 12], [26, 7]] as const) g.set(x, y, C.green).set(x + 1, y - 1, C.green);
    g.rect(2, 2, W - 4, 1, C.grassLight);
    // the front lip of the grass, then the front wall
    g.rect(2, 2 + TOP, W - 4, 2, C.green);
    for (let x = 4; x < W - 4; x += 6) g.rect(x, 4 + TOP, 3, 1, C.green);
    const fy = 4 + TOP;
    const fh = H - fy - 2;
    g.rect(2, fy, W - 4, fh, C.mauve);
    // stone courses
    for (let y = fy + 6; y < fy + fh; y += 7) g.rect(2, y, W - 4, 1, C.slate);
    for (let row = 0, y = fy; y < fy + fh; y += 7, row++) for (let x = 2 + (row % 2 ? 6 : 12); x < W - 2; x += 12) g.rect(x, y + (row === 0 ? 1 : 0), 1, 6, C.slate);
    for (let x = 4; x < W - 4; x += 6) g.rect(x, 4 + TOP, 3, 1, C.green);
    g.rect(2, fy + fh - 2, W - 4, 2, C.slate);
    if (open) {
      // cut the front wall away: a dark room with a lit floor
      const rx = 7;
      const ry = fy + 3;
      const rw = W - 14;
      const rh = fh - 6;
      g.rect(rx - 1, ry - 1, rw + 2, rh + 2, C.ink);
      g.rect(rx, ry, rw, rh, C.shadow);
      g.rect(rx, ry, rw, 3, C.ink);
      // floor tiles and a pool of amber light in the middle
      g.rect(rx, ry + rh - 6, rw, 6, C.slate);
      for (let x = rx + 5; x < rx + rw; x += 6) g.rect(x, ry + rh - 6, 1, 6, C.shadow);
      g.rect(rx + 9, ry + rh - 5, rw - 18, 4, ROLE.in.deep);
      g.rect(rx + 12, ry + rh - 4, rw - 24, 2, ROLE.in.dark);
      // a lantern hook's glow on the back wall
      g.rect(rx + rw - 8, ry + 5, 3, 4, ROLE.in.base).rect(rx + rw - 7, ry + 4, 1, 1, C.slate);
      g.set(rx + rw - 7, ry + 6, C.lemon);
    }
    g.outline(C.ink);
    // no empty margin: the scene measures and outlines the cube by the image size
    return g.crop(1, 1, W - 2, H - 2);
  };
  draw(false).save(`${dir}/ui/cube-out.png`);
  draw(true).save(`${dir}/ui/cube-in.png`);
}

export function buildScenery(dir: string): void {
  sky(dir);
  clouds(dir);
  logo(dir);
  cubes(dir);
}
