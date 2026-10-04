import { mix } from './util';

// What the chain hands from one face to the next. Shared by the puzzles that give and take
// these items, so they agree on ids, kinds and the flower's colour without reading each
// other's state.

/** The battery: face 2 (equation-safe) spawns it INSIDE, face 5's emitter accepts it. */
export const BATTERY_ID = 'battery';
export const BATTERY_KIND = 'battery';

/** The flower: face 6 (laser-path) spawns it OUTSIDE, a pot on face 4 accepts it. */
export const FLOWER_ID = 'flower';
export const FLOWER_COLOURS = ['red', 'blue', 'yellow', 'pink', 'white'] as const;
export type FlowerColour = (typeof FLOWER_COLOURS)[number];

/** The colour of this game's flower, from the game seed (ctx.seed). */
export const flowerColour = (seed: number): FlowerColour => FLOWER_COLOURS[mix(seed, 4001) % FLOWER_COLOURS.length];

/** Item kind of the flower, e.g. "flower-red" (the sprite and HUD icon are keyed by it). */
export const flowerKind = (seed: number): string => `flower-${flowerColour(seed)}`;
