// Face tilesets. Outside faces are cut from the Ninja Adventure pack (CC0, see
// vendor/ninja-adventure) and snapped to Resurrect 64. Inside faces are our own dark
// rooms: the same wall seen from behind, keeping the biome's hue as an accent.
import { C, FACE_STYLE, type Ramp } from '../../client/src/style/tokens';
import { Img, luma, type Color } from './img';

const T = 16;
const VENDOR = new URL('./vendor/ninja-adventure/', import.meta.url).pathname;
const sheets = {
  F: () => Img.load(`${VENDOR}TilesetFloor.png`),
  N: () => Img.load(`${VENDOR}TilesetNature.png`),
  W: () => Img.load(`${VENDOR}TilesetWater.png`),
  D: () => Img.load(`${VENDOR}TilesetDungeon.png`),
  I: () => Img.load(`${VENDOR}TilesetInteriorFloor.png`),
};
type SheetId = keyof typeof sheets;
const cache: Partial<Record<SheetId, Img>> = {};
const sheet = (id: SheetId) => (cache[id] ??= sheets[id]());

/** One 16x16 tile of a vendor sheet, by tile column and row. */
export const cut = (id: SheetId, x: number, y: number): Img => sheet(id).crop(x * T, y * T, T, T);
type Pick = [SheetId, number, number];

/** Frame layout shared by every tileset (8 columns): see TILE_FRAMES. */
export const TILE_FRAMES = { floor: [0, 1, 2, 3, 4], wall: [5, 6, 7], tree: [8, 9, 10], water: [11, 12, 13, 14] };
/** Plain floor most of the time, a detail now and then. */
export const FLOOR_WEIGHTED = [0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4];

interface OutSpec {
  /** Five floor tiles: the first is the plain one. 'flat' = that tile with its marks removed. */
  floor: (Pick | [SheetId, number, number, 'flat'])[];
  /** The floor's colours, darkest first (the pack's own greens and tans are off-palette). */
  floorRamp: string[];
  wall: Pick[];
  tree: Pick[];
  /** Recolour the trees by brightness, darkest (the outline) first. */
  treeRamp?: string[];
  /** Water colours, darkest first: deep, body, shine. */
  water: [string, string, string];
}

const OUT: Record<1 | 2 | 3 | 4 | 5 | 6, OutSpec> = {
  // 1 grass
  1: {
    floor: [['F', 0, 12], ['F', 1, 12], ['F', 2, 12], ['F', 3, 12], ['F', 4, 12]],
    floorRamp: [C.green, C.grass],
    wall: [['N', 17, 17], ['N', 18, 17], ['N', 19, 17]],
    tree: [['N', 10, 9], ['N', 10, 9], ['N', 1, 10]],
    treeRamp: [C.ink, C.pine, C.greenDark, C.green],
    water: [C.blue, C.sky, C.skyLight],
  },
  // 2 desert
  2: {
    floor: [['F', 0, 5], ['F', 1, 5], ['F', 2, 5], ['F', 3, 5], ['F', 4, 5]],
    floorRamp: [C.sandDark, C.sand],
    wall: [['N', 4, 13], ['N', 5, 13], ['N', 6, 13]],
    tree: [['N', 12, 9], ['N', 12, 10], ['N', 12, 9]],
    water: [C.teal, C.turquoise, C.aqua],
  },
  // 3 snow
  3: {
    floor: [['F', 0, 19], ['F', 1, 19], ['F', 2, 19], ['F', 3, 19], ['F', 4, 19]],
    floorRamp: [C.mist, C.white],
    wall: [['N', 4, 12], ['N', 9, 12], ['N', 7, 12]],
    tree: [['N', 5, 12], ['N', 10, 13], ['N', 5, 12]],
    water: [C.sky, C.skyLight, C.white],
  },
  // 4 forest
  4: {
    floor: [['F', 11, 12], ['F', 12, 12], ['F', 13, 12], ['F', 14, 12], ['F', 15, 12]],
    floorRamp: [C.pine, C.greenDark],
    wall: [['N', 6, 14], ['N', 17, 17], ['N', 6, 14]],
    tree: [['N', 10, 9], ['N', 10, 8], ['N', 0, 10]],
    treeRamp: [C.ink, C.greenDark, C.green, C.grass],
    water: [C.tealDark, C.teal, C.turquoise],
  },
  // 5 rooftop: warm tiles under an open sky
  5: {
    floor: [['I', 11, 4, 'flat'], ['I', 11, 4], ['I', 14, 5], ['I', 11, 4], ['I', 14, 5]],
    floorRamp: [C.peach, C.skin],
    wall: [['D', 2, 1], ['D', 3, 1], ['D', 2, 1]],
    tree: [['N', 10, 8], ['N', 10, 8], ['N', 10, 8]],
    treeRamp: [C.ink, C.pine, C.greenDark, C.green],
    water: [C.blue, C.sky, C.skyLight],
  },
  // 6 cave
  6: {
    floor: [['I', 12, 13], ['I', 12, 13], ['I', 13, 13], ['I', 12, 13], ['I', 13, 13]],
    floorRamp: [C.slate, C.mauve, C.mauve, C.silver],
    wall: [['N', 6, 15], ['N', 15, 9], ['N', 6, 15]],
    tree: [['N', 1, 14], ['N', 2, 14], ['N', 1, 14]],
    water: [C.navy, C.indigo, C.blue],
  },
};

/** Four frames of water: a body colour with two bands of shine that drift sideways. */
function water([deep, body, shine]: [string, string, string]): Img[] {
  return [0, 1, 2, 3].map((f) => {
    const g = new Img(T, T, body);
    const band = (y: number, x: number, w: number, c: string) => {
      for (let i = 0; i < w; i++) g.set((x + i + f * 4) % T, y, c);
    };
    band(3, 2, 5, shine);
    band(4, 4, 2, shine);
    band(10, 9, 5, shine);
    band(11, 11, 2, shine);
    band(7, 13, 3, deep);
    band(14, 4, 3, deep);
    return g;
  });
}

/** A soft contact shadow so props sit on the ground instead of floating on it. */
function grounded(floor: Img, prop: Img, shade: string): Img {
  const g = floor.clone();
  for (let x = 0; x < T; x++) {
    let bottom = -1;
    for (let y = T - 1; y >= 0; y--)
      if (prop.get(x, y)) {
        bottom = y;
        break;
      }
    if (bottom >= 10 && bottom < T - 1) g.set(x, bottom + 1, shade);
  }
  return g.blit(prop, 0, 0);
}

/** The colour most of a tile is made of. */
function common(t: Img): string {
  const n = new Map<string, number>();
  for (const c of t.px) if (c) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Recolour a set of tiles by brightness rank with one shared scale, so they stay one material. */
function rampAll(tiles: Img[], ramp: readonly string[]): Img[] {
  const all = [...new Set(tiles.flatMap((t) => [...t.colours()]))].sort((a, b) => luma(a) - luma(b));
  const to = new Map(all.map((c, i) => [c, ramp[Math.min(ramp.length - 1, Math.floor((i / all.length) * ramp.length))]!]));
  return tiles.map((t) => t.map((c) => to.get(c)!));
}

function outside(face: 1 | 2 | 3 | 4 | 5 | 6): Img {
  const spec = OUT[face];
  const out = new Img(T * 8, T * 2);
  const put = (i: number, img: Img) => out.blit(img, (i % 8) * T, Math.floor(i / 8) * T);
  const floors = rampAll(
    spec.floor.map(([s, x, y, flat]) => {
      const t = cut(s, x, y);
      return flat ? t.rect(0, 0, T, T, common(t)) : t;
    }),
    spec.floorRamp,
  );
  floors.forEach((f, i) => put(i, f));
  const shade = FACE_STYLE[face].ramp.deep;
  spec.wall.forEach(([s, x, y], i) => put(5 + i, grounded(floors[0]!, cut(s, x, y).quantize(), shade)));
  const trees = spec.tree.map(([s, x, y]) => cut(s, x, y));
  (spec.treeRamp ? rampAll(trees, spec.treeRamp) : trees.map((t) => t.quantize())).forEach((t, i) => put(8 + i, grounded(floors[0]!, t, shade)));
  water(spec.water).forEach((w, i) => put(11 + i, w));
  return out;
}

// ---------- inside: our own tiles ----------

function insideFloor(ramp: Ramp, variant: number): Img {
  const g = new Img(T, T, C.shadow);
  // flagstones: grout on the right and bottom edge, a chipped highlight top-left
  g.rect(T - 1, 0, 1, T, C.ink).rect(0, T - 1, T, 1, C.ink);
  g.rect(0, 0, T - 1, 1, C.slate).rect(0, 0, 1, T - 1, C.slate);
  g.set(0, 0, C.shadow);
  const specks: [number, number][][] = [
    [],
    [[4, 5], [5, 5], [10, 11]],
    [[11, 3], [3, 10], [4, 10]],
    [[7, 7], [8, 8], [6, 12], [12, 6]],
  ];
  for (const [x, y] of specks[variant % 4]!) g.set(x, y, C.ink);
  if (variant === 4) {
    // a rune the colour of the biome behind this wall
    g.art(5, 5, ['.xxxx.', 'x....x', 'x.xx.x', 'x.xx.x', 'x....x', '.xxxx.'], { x: ramp.base });
  }
  return g;
}

function insideWall(ramp: Ramp, variant: number): Img {
  const g = insideFloor(ramp, 0);
  const k: Record<string, Color> = { o: C.ink, l: ramp.light, b: ramp.base, d: ramp.dark, e: ramp.deep, s: C.slate, h: C.shadow };
  // a pillar seen from above: lit cap in the biome hue, dark front face
  g.art(0, 0, [
    '.oooooooooooooo.',
    'olllllllllllllbo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'olbbbbbbbbbbbbdo',
    'obddddddddddddeo',
    'oeeeeeeeeeeeeeeo',
    'oessssssssssssso',
    'oeshhhhhhhhhhhso',
    'oeshhhhhhhhhhhso',
    'oeeeeeeeeeeeeeeo',
    '.oooooooooooooo.',
  ], k);
  if (variant === 1) g.set(5, 5, ramp.dark).set(6, 5, ramp.dark).set(10, 7, ramp.light);
  if (variant === 2) g.rect(6, 4, 4, 1, ramp.dark).rect(6, 6, 4, 1, ramp.dark);
  return g;
}

function inside(face: 1 | 2 | 3 | 4 | 5 | 6): Img {
  const ramp = FACE_STYLE[face].ramp;
  const out = new Img(T * 8, T * 2);
  const put = (i: number, img: Img) => out.blit(img, (i % 8) * T, Math.floor(i / 8) * T);
  for (let i = 0; i < 5; i++) put(i, insideFloor(ramp, i));
  for (let i = 0; i < 3; i++) put(5 + i, insideWall(ramp, i));
  // No inside map has trees or water yet. If one does: a stalagmite and a dark pool.
  for (let i = 0; i < 3; i++) {
    const g = insideFloor(ramp, 0);
    g.art(4, 2, ['...oo...', '..odso..', '..odso..', '.odddso.', '.odddso.', 'oddddsso', 'oddddsso', 'oeddddso', 'oeeddddo', '.oooooo.'], { o: C.ink, d: C.slate, s: C.mauve, e: C.shadow });
    put(8 + i, g);
  }
  water([C.ink, C.navy, ramp.deep]).forEach((w, i) => put(11 + i, w));
  return out;
}

export function buildTiles(dir: string): Record<string, { image: string; tiles: Record<string, number[]> }> {
  const manifest: Record<string, { image: string; tiles: Record<string, number[]> }> = {};
  for (const face of [1, 2, 3, 4, 5, 6] as const) {
    outside(face).save(`${dir}/tiles/out-${face}.png`);
    inside(face).save(`${dir}/tiles/in-${face}.png`);
    for (const side of ['out', 'in'])
      manifest[`${side}-${face}`] = { image: `tiles/${side}-${face}.png`, tiles: { ...TILE_FRAMES, floor: FLOOR_WEIGHTED } };
  }
  return manifest;
}
