import { FACE_SIZE, screenToCanon, type FaceId, type TileKind, type Vec } from '@cubic/shared';
import { PROPS, SHORE, TALL, type PropName } from './sheet';

// WHAT GROWS WHERE. The outside faces are dressed from this file: how a solid tile is
// drawn on each face (a tree is an oak in the forest, a cactus in the desert), the
// landmarks, and the small things on the floor that nobody bumps into.
//
// Pure data and pure functions: no Phaser, no DOM. It only LOOKS: what blocks is decided
// by the map in shared/src/maps and nothing here. client/test/biomes.test.ts checks every
// entry against the real maps, so moving a puzzle onto a decorated tile fails a test
// instead of hiding the puzzle.

/** How a prop moves. `tree`, `blades` and `gust` follow the wind; `blink` is a slow glint. */
export type Anim = 'still' | 'tree' | 'blades' | 'gust' | 'blink';

const ANIM: Partial<Record<PropName, Anim>> = {
  oakA: 'tree',
  oakB: 'tree',
  oakC: 'tree',
  pineA: 'tree',
  pineB: 'tree',
  palm: 'tree',
  bushA: 'tree',
  bushB: 'tree',
  planterA: 'tree',
  planterB: 'tree',
  tallGrassA: 'blades',
  tallGrassB: 'blades',
  grassFront: 'blades',
  fern: 'blades',
  reeds: 'blades',
  dryBush: 'gust',
  glowShroom: 'blink',
  puddleCave: 'blink',
  puddleRoof: 'blink',
};

/**
 * A `tree` tile, per face. The list is picked from by position, so repeat a name to make
 * it more common.
 */
export const TREES: Record<FaceId, readonly PropName[]> = {
  1: ['bushA', 'bushB', 'bushA'],
  2: ['cactusA', 'cactusB', 'cactusA', 'cactusC'],
  3: ['pineA', 'pineB', 'pineA'],
  4: ['oakA', 'oakB', 'oakA', 'oakC', 'oakA', 'oakB', 'oakA'],
  5: ['planterA', 'planterB'],
  6: ['stalagA', 'stalagB', 'stalagC', 'stalagA'],
};
/** A `tree` tile with water beside it, where that is something else: the oasis has palms. */
export const TREES_BY_WATER: Partial<Record<FaceId, PropName>> = { 2: 'palm' };

/** What the decor legend's characters stand on. */
export type Ground = 'floor' | 'water' | 'solid';

interface Entry {
  props: readonly PropName[];
  on: Ground;
  /** Water drips onto this tile from above (the ambience layer drops it). */
  drip?: boolean;
  /** Tall enough to wade through: it is drawn over the player's feet and rustles. */
  wade?: boolean;
}

/** One character per tile in DECOR below. `.` is nothing. */
export const DECOR_LEGEND: Readonly<Record<string, Entry>> = {
  g: { props: ['tallGrassA', 'tallGrassB'], on: 'floor', wade: true },
  f: { props: ['flowersA', 'flowersB'], on: 'floor' },
  r: { props: ['reeds'], on: 'floor' },
  l: { props: ['lilyA', 'lilyB'], on: 'water' },
  F: { props: ['fern'], on: 'floor' },
  m: { props: ['shroomRed', 'shroomRedB'], on: 'floor' },
  n: { props: ['shroomBrown'], on: 'floor' },
  p: { props: ['pebblesA', 'pebblesB'], on: 'floor' },
  b: { props: ['bones'], on: 'floor' },
  d: { props: ['dryBush'], on: 'floor' },
  w: { props: ['dune'], on: 'floor' },
  s: { props: ['driftA', 'driftB'], on: 'floor' },
  x: { props: ['rubbleA', 'rubbleB'], on: 'floor' },
  h: { props: ['glowShroom'], on: 'floor' },
  u: { props: ['puddleCave'], on: 'floor', drip: true },
  v: { props: ['puddleRoof'], on: 'floor' },
  o: { props: ['moss'], on: 'floor' },
  // landmarks: a solid tile of the map drawn as something of its own
  '*': { props: ['snowman'], on: 'solid' },
  // nothing to see until the drop lands
  '!': { props: [], on: 'water', drip: true },
};

/**
 * The outside faces, canonical like the maps in shared/src/maps/default.ts (same rows,
 * same columns). Each face is composed around one thing to remember it by.
 */
export const DECOR: Record<FaceId, readonly string[]> = {
  // Grass: a meadow taller than the turtle down the west side, a lily pond with reeds in the south east.
  1: [
    'g...........',
    '..g.....f...',
    '.ggg....f...',
    '..gg..f.....',
    '............',
    '...f...f....',
    '........r...',
    'gg.....r.l..',
    'ggg...r.l...',
    'gg.g...r....',
    '..ggg.......',
    'g.gg....f...',
  ],
  // Desert: the oasis. Palms and reeds round the pool, bare sand and bones away from it.
  2: [
    '............',
    '......w.....',
    '....p.......',
    '......r.....',
    '....r...r...',
    '...r..l.....',
    '.w..r...r...',
    '.....rf.....',
    '.........d..',
    '....b.......',
    '.p....w.....',
    '............',
  ],
  // Snow: the snowman by the frozen pond, drifts blown up against nothing in particular.
  3: [
    '...s........',
    '............',
    '.....s......',
    '.s........s.',
    '........s...',
    '............',
    '............',
    '...s...*....',
    '............',
    '.....s......',
    '............',
    's......s....',
  ],
  // Forest: the clearing belongs to the stepping stones, so everything grows in the ring of trees around it.
  4: [
    '..Fn.m..F.F.',
    '............',
    'F..........m',
    'm...........',
    '.F........F.',
    '...........n',
    'm..........F',
    '.F..........',
    '...........F',
    'F..........m',
    '...F..m.....',
    '..m..F...F..',
  ],
  // Rooftop: the pool, with a little moss and last night's rain.
  5: [
    '............',
    '.....o......',
    '............',
    '.....v......',
    '............',
    '............',
    '............',
    '....o...v...',
    '............',
    '............',
    '..o....o....',
    '............',
  ],
  // Cave: the black pool under the dripping roof, puddles where the other drips land.
  6: [
    '............',
    '....u.......',
    '...x........',
    '.....h....x.',
    '..h.........',
    '............',
    '.........u..',
    '...u........',
    '........h...',
    '......!.x...',
    '.....u.!....',
    '............',
  ],
};

const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;
const pickBy = <X>(list: readonly X[], face: number, x: number, y: number): X => list[hash(face, x, y) % list.length]!;

export interface Spot {
  x: number;
  y: number;
  ch: string;
  entry: Entry;
  /** The prop drawn here, or null for a bare drip point. */
  prop: PropName | null;
}

const spots = new Map<FaceId, Spot[]>();

/** Every decorated tile of a face. */
export function decorSpots(face: FaceId): readonly Spot[] {
  let list = spots.get(face);
  if (!list) {
    list = [];
    DECOR[face].forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        const entry = DECOR_LEGEND[ch];
        if (!entry) throw new Error(`decor ${face}: unknown character "${ch}" at ${x},${y}`);
        list!.push({ x, y, ch, entry, prop: entry.props.length ? pickBy(entry.props, face, x, y) : null });
      }),
    );
    spots.set(face, list);
  }
  return list;
}

export function decorAt(face: FaceId, x: number, y: number): Spot | null {
  const ch = DECOR[face][y]?.[x];
  if (!ch || ch === '.') return null;
  return decorSpots(face).find((s) => s.x === x && s.y === y) ?? null;
}

const isWater = (tiles: TileKind[][], x: number, y: number) => tiles[y]?.[x] === 'water';

/**
 * The prop that stands in for a tile's own art, or null when the tile keeps it (floor, a
 * plain wall). Water is not a prop: it is drawn from the water sheet.
 */
export function skinAt(tiles: TileKind[][], face: FaceId, x: number, y: number): PropName | null {
  const kind = tiles[y]?.[x];
  if (kind === undefined || kind === 'floor' || kind === 'water') return null;
  const spot = decorAt(face, x, y);
  if (spot?.entry.on === 'solid') return spot.prop;
  if (kind !== 'tree') return null;
  const wet = TREES_BY_WATER[face];
  if (wet && (isWater(tiles, x + 1, y) || isWater(tiles, x - 1, y) || isWater(tiles, x, y + 1) || isWater(tiles, x, y - 1))) return wet;
  return pickBy(TREES[face], face, x, y);
}

/** The prop drawn on a tile, whatever it stands on: a skin, or the decor of a floor or water tile. */
export function propAt(tiles: TileKind[][], face: FaceId, x: number, y: number): PropName | null {
  const skin = skinAt(tiles, face, x, y);
  if (skin) return skin;
  const kind = tiles[y]?.[x];
  const spot = decorAt(face, x, y);
  if (!spot || !spot.prop || kind === undefined) return null;
  return (spot.entry.on === 'floor' && kind === 'floor') || (spot.entry.on === 'water' && kind === 'water') ? spot.prop : null;
}

export const isTall = (prop: PropName): boolean => TALL.includes(prop);

/** Tall grass on this tile: the player wades through it. */
export function wadeAt(tiles: TileKind[][], face: FaceId, x: number, y: number): boolean {
  return tiles[y]?.[x] === 'floor' && !!decorAt(face, x, y)?.entry.wade;
}

/** Where water drips from above, and whether it lands in water. */
export function dripPoints(tiles: TileKind[][], face: FaceId): { x: number; y: number; water: boolean }[] {
  return decorSpots(face)
    .filter((s) => s.entry.drip && tiles[s.y]?.[s.x] === (s.entry.on === 'water' ? 'water' : 'floor'))
    .map((s) => ({ x: s.x, y: s.y, water: s.entry.on === 'water' }));
}

// ----- the wind -----

/** A gust crosses the face from the left every WIND_STEPS ticks (a tick is 250 ms). */
export const WIND_STEPS = 14;
/** Frames of a swaying prop along one gust: 0 rest, 1 leaning, 2 leaning more, 3 swinging back. */
const TREE_GUST = [0, 0, 0, 0, 0, 0, 1, 2, 2, 1, 0, 3, 0, 0];
/** Blades: 0 left, 1 upright, 2 right. */
const BLADE_GUST = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 0, 1, 1, 1];
const TWO_GUST = [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0];

/** Where in the gust a thing at screen tile sx,sy is: the gust reaches the right side later. */
export function windStep(tick: number, sx: number, sy: number): number {
  const n = WIND_STEPS;
  return (((tick - sx - (sy % 2)) % n) + n) % n;
}

/**
 * The sheet cell of `prop` at this moment. `sx, sy` is where it stands on screen (the wind
 * blows across the screen, not across the map). With reduce motion everything stands still.
 */
export function propCell(prop: PropName, tick: number, sx: number, sy: number, reduceMotion: boolean): number {
  const frames = PROPS[prop];
  const anim = ANIM[prop] ?? 'still';
  const rest = anim === 'blades' ? 1 : 0;
  if (reduceMotion || anim === 'still' || frames.length === 1) return frames[Math.min(rest, frames.length - 1)]!;
  const step = windStep(tick, sx, sy);
  if (anim === 'tree') return frames[TREE_GUST[step]!]!;
  if (anim === 'blades') return frames[BLADE_GUST[step]!]!;
  if (anim === 'gust') return frames[TWO_GUST[step]!]!;
  // blink: two frames, the second for one beat in four, each tile on its own beat
  return frames[(Math.floor(tick / 2) + sx * 3 + sy) % 4 === 0 ? 1 : 0]!;
}

/** True when the tile's own art is replaced by the biome layer (the tile below it is drawn as floor). */
export function dressed(tiles: TileKind[][], face: FaceId, x: number, y: number): boolean {
  return tiles[y]?.[x] === 'water' || skinAt(tiles, face, x, y) !== null;
}

/** The tiles a tall prop on x,y can overhang, whichever way the face is turned. */
export function overhangTiles(x: number, y: number): { x: number; y: number }[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ].filter((t) => t.x >= 0 && t.y >= 0 && t.x < FACE_SIZE && t.y < FACE_SIZE);
}

/** Which screen neighbours of a water tile are land: the bits of SHORE. */
export function shoreMask(tiles: TileKind[][], face: FaceId, up: Vec, sx: number, sy: number): number {
  const land = (nx: number, ny: number): boolean => {
    if (nx < 0 || ny < 0 || nx >= FACE_SIZE || ny >= FACE_SIZE) return true;
    const [x, y] = screenToCanon('out', face, up, nx, ny);
    return tiles[y]?.[x] !== 'water';
  };
  return (land(sx, sy - 1) ? SHORE.n : 0) | (land(sx + 1, sy) ? SHORE.e : 0) | (land(sx, sy + 1) ? SHORE.s : 0) | (land(sx - 1, sy) ? SHORE.w : 0);
}
