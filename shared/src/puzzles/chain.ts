import type { FaceId } from '../types';
import { mix } from './util';

// What the chain hands from one face to the next. Shared by the puzzles that give and take
// these items, so they agree on ids, kinds and the flower's colour without reading each
// other's state.

/** The battery: face 2 (equation-safe) spawns it INSIDE, face 5's emitter accepts it. */
export const BATTERY_ID = 'battery';
export const BATTERY_KIND = 'battery';

/**
 * The flowers of face 4 (botanical-mirror): one of each colour, all OUTSIDE.
 *  - One comes out of the crate of face 6 (laser-path) when the beam burns it: id FLOWER_ID,
 *    colour flowerColour(seed), different every game.
 *  - The other four lie about from the start, one on each face of START_FLOWER_FACES, on one
 *    of that face's "flower-spot" map objects (startFlowers).
 * Each goes into the outside pot whose inside pot holds its colour.
 */
export const FLOWER_ID = 'flower';
export const FLOWER_COLOURS = ['red', 'blue', 'yellow', 'pink', 'white'] as const;
export type FlowerColour = (typeof FLOWER_COLOURS)[number];
export const FLOWER_KIND = 'flower-';

/** The colour of the flower the crate of face 6 drops, from the game seed (ctx.seed). */
export const flowerColour = (seed: number): FlowerColour => FLOWER_COLOURS[mix(seed, 4001) % FLOWER_COLOURS.length]!;

/** Item kind of the crate's flower, e.g. "flower-red" (the sprite and HUD icon are keyed by it). */
export const flowerKind = (seed: number): string => FLOWER_KIND + flowerColour(seed);

/** The item id of this game's flower of `colour`: the crate's is FLOWER_ID, the others "flower-<colour>". */
export const flowerId = (seed: number, colour: FlowerColour): string => (colour === flowerColour(seed) ? FLOWER_ID : FLOWER_KIND + colour);

/** Map object type (legend `f`): a tile where a loose flower may lie at the start. Never shown. */
export const FLOWER_SPOT = 'flower-spot';
/** The faces the four loose flowers lie on, one each. Never face 4 (the pots) or face 6 (the crate's). */
export const START_FLOWER_FACES: readonly FaceId[] = [1, 2, 3, 5];

/** The four flowers that lie about from the start: every colour but the crate's, shuffled over the faces by the seed. */
export function startFlowers(seed: number): { id: string; kind: string; colour: FlowerColour; face: FaceId }[] {
  const colours = FLOWER_COLOURS.filter((c) => c !== flowerColour(seed));
  for (let i = colours.length - 1; i > 0; i--) {
    const j = mix(seed, 4002, i) % (i + 1);
    [colours[i], colours[j]] = [colours[j]!, colours[i]!];
  }
  return START_FLOWER_FACES.flatMap((face, i) => (colours[i] ? [{ id: FLOWER_KIND + colours[i], kind: FLOWER_KIND + colours[i], colour: colours[i], face }] : []));
}
