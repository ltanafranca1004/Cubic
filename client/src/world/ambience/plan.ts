import { FACE_SIZE, type FaceId, type Side, type TileKind } from '@cubic/shared';

// What lives on each face: which effects, how many of each, which sound loop. Pure data
// and pure functions (no Phaser, no DOM), so client/test/ambience.test.ts can check the
// caps and the rules. AmbienceScene.ts draws what this file decides.

export type EffectId =
  // outside 1, grass
  | 'tufts'
  | 'flowers'
  | 'butterflies'
  | 'wind'
  // outside 2, desert
  | 'sand'
  | 'shimmer'
  | 'tumbleweed'
  // outside 3, snow
  | 'snow'
  | 'breath'
  | 'iceSparkle'
  // outside 4, forest
  | 'fireflies'
  | 'leaves'
  | 'birds'
  // outside 5, rooftop
  | 'cloudShadows'
  | 'gulls'
  | 'flags'
  // outside 6, cave
  | 'drips'
  | 'crystals'
  // any outside face with water tiles
  | 'waterGlints'
  // the biome layer (world/biomes): what is drawn over the player
  | 'canopy'
  | 'wade'
  | 'footprints'
  // inside, every room
  | 'motes'
  | 'wallLights'
  | 'tint';

export type LoopId = 'grass' | 'desert' | 'snow' | 'forest' | 'rooftop' | 'cave' | 'hum';
/** What the player walks on: picks the colour of the footstep dust and its sound. */
export type Surface = 'grass' | 'sand' | 'snow' | 'leaves' | 'roof' | 'stone' | 'room';

export interface Motion {
  /** settings().reduceMotion */
  reduceMotion: boolean;
  /** settings().screenShake */
  screenShake: boolean;
}

export interface FacePlan {
  effects: EffectId[];
  /** The most moving things (particles and creatures) alive at once on this face. */
  cap: number;
  /** The most tile decorations (tufts, flowers, shards, flags, wall lights). */
  decorCap: number;
  loop: LoopId;
  /** Playback rate of the loop: every room hums at its own pitch. */
  loopRate: number;
  surface: Surface;
}

/** Hard ceiling for any face, whatever its effects ask for. */
export const PARTICLE_CAP = 48;
export const PARTICLE_CAP_REDUCED = 16;
export const DECOR_CAP = 28;

const OUTSIDE: Record<FaceId, { effects: EffectId[]; loop: LoopId; surface: Surface }> = {
  1: { effects: ['tufts', 'flowers', 'butterflies', 'wind', 'waterGlints', 'wade', 'canopy'], loop: 'grass', surface: 'grass' },
  2: { effects: ['sand', 'shimmer', 'tumbleweed', 'waterGlints', 'canopy'], loop: 'desert', surface: 'sand' },
  3: { effects: ['snow', 'breath', 'iceSparkle', 'footprints', 'canopy'], loop: 'snow', surface: 'snow' },
  4: { effects: ['fireflies', 'leaves', 'birds', 'waterGlints', 'canopy'], loop: 'forest', surface: 'leaves' },
  5: { effects: ['cloudShadows', 'gulls', 'flags', 'waterGlints', 'canopy'], loop: 'rooftop', surface: 'roof' },
  6: { effects: ['drips', 'crystals', 'waterGlints', 'canopy'], loop: 'cave', surface: 'stone' },
};
const INSIDE: EffectId[] = ['tint', 'wallLights', 'motes'];
/** Left out with reduce motion: things that sweep the whole view or wobble. */
const REDUCED_OUT: EffectId[] = ['shimmer', 'wind', 'tumbleweed', 'cloudShadows'];
/** One pitch per room, around the recorded one. */
const HUM_RATE: Record<FaceId, number> = { 1: 1, 2: 1.06, 3: 1.12, 4: 0.94, 5: 1.19, 6: 0.89 };

export function facePlan(side: Side, face: FaceId, motion: Motion): FacePlan {
  const base = side === 'out' ? OUTSIDE[face] : { effects: INSIDE, loop: 'hum' as const, surface: 'room' as const };
  let effects = [...base.effects];
  if (motion.reduceMotion) effects = effects.filter((e) => !REDUCED_OUT.includes(e));
  // The shimmer is a jitter: it goes with screen shake off too.
  if (!motion.screenShake) effects = effects.filter((e) => e !== 'shimmer');
  return {
    effects,
    cap: motion.reduceMotion ? PARTICLE_CAP_REDUCED : PARTICLE_CAP,
    decorCap: DECOR_CAP,
    loop: base.loop,
    loopRate: side === 'in' ? HUM_RATE[face] : 1,
    surface: base.surface,
  };
}

/** How many of an effect's things to keep alive. Reduce motion keeps about a third. */
const COUNT: Partial<Record<EffectId, number>> = {
  tufts: 14,
  flowers: 6,
  butterflies: 3,
  wind: 3,
  sand: 22,
  shimmer: 6,
  snow: 34,
  iceSparkle: 3,
  fireflies: 7,
  leaves: 7,
  birds: 3,
  cloudShadows: 2,
  gulls: 3,
  flags: 3,
  drips: 3,
  crystals: 6,
  waterGlints: 2,
  motes: 12,
  wallLights: 4,
  footprints: 8,
};
/** Decorations sit still, so reduce motion keeps all of them (they just stop swaying). */
const STILL: EffectId[] = ['tufts', 'flowers', 'flags', 'crystals', 'wallLights', 'footprints', 'canopy', 'wade'];

export function effectCount(effect: EffectId, motion: Motion): number {
  const n = COUNT[effect] ?? 1;
  return motion.reduceMotion && !STILL.includes(effect) ? Math.max(1, Math.round(n / 3)) : n;
}

/** Counts live things against a cap. The scene asks before it adds anything. */
export class Budget {
  private used = 0;
  constructor(readonly cap: number) {}

  get count(): number {
    return this.used;
  }

  /** True (and counted) when there is room for one more. */
  take(): boolean {
    if (this.used >= this.cap) return false;
    this.used++;
    return true;
  }

  release(): void {
    if (this.used > 0) this.used--;
  }
}

// ----- birds -----

/** A hopping bird takes off when the player is this close, in tiles. */
export const FLEE_TILES = 2.2;
/** A bird only lands this far from the player, so it does not flee at once. */
export const LAND_TILES = FLEE_TILES + 1.5;

interface Point {
  x: number;
  y: number;
}

/** Positions in tiles (fractions allowed). */
export function shouldFlee(bird: Point, player: Point): boolean {
  return Math.hypot(bird.x - player.x, bird.y - player.y) <= FLEE_TILES;
}

/** The unit direction a fleeing bird flies: away from the player, and always upwards. */
export function fleeVector(bird: Point, player: Point): Point {
  const dx = bird.x - player.x || 0.5;
  const x = dx / Math.hypot(dx, 1.5);
  return { x, y: -Math.sqrt(1 - x * x) };
}

// ----- where things go -----

const hash = (a: number, b: number, c: number) => {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
};

export interface Tile {
  x: number;
  y: number;
}

/**
 * Up to `max` tiles of a face that pass `want`, the same ones every time (so both the
 * first visit and the tenth show the same meadow). `seed` keeps two effects apart.
 */
export function pickTiles(tiles: TileKind[][], want: (kind: TileKind, x: number, y: number) => boolean, max: number, seed: number): Tile[] {
  const all: (Tile & { order: number })[] = [];
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      const kind = tiles[y]?.[x];
      if (kind !== undefined && want(kind, x, y)) all.push({ x, y, order: hash(seed, x, y) });
    }
  }
  return all
    .sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x)
    .slice(0, Math.max(0, max))
    .map(({ x, y }) => ({ x, y }));
}

/** A floor tile with a solid tile next to it (crystal shards grow at the foot of rocks). */
export function besideSolid(tiles: TileKind[][], x: number, y: number): boolean {
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => {
    const kind = tiles[y + dy!]?.[x + dx!];
    return kind !== undefined && kind !== 'floor';
  });
}

// ----- the inside light -----

/** The same falloff GameScene darkens the inside with: 1 = lit, 0 = dark. Distances in tiles. */
export const LIGHT_NEAR = 1.5;
export const LIGHT_FAR = 5.5;
export function lightAt(distance: number): number {
  return 1 - Math.min(1, Math.max(0, (distance - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR)));
}

/** Only the face you are on has effects: one key per (side, face, orientation, motion settings). */
export function faceKey(side: Side, face: FaceId, up: readonly number[], motion: Motion): string {
  return `${side}:${face}:${up.join(',')}:${motion.reduceMotion ? 'r' : ''}${motion.screenShake ? '' : 's'}`;
}
