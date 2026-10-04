// The biome sprites: what is on the two sheets tools/art/biomes.ts writes, and where.
// Pure data with no imports, because the art generator reads this file too: the order here
// IS the order on the sheet, so the game and the PNG cannot drift apart.

/** Props: trees, cacti, the snowman, tall grass... One cell is one tile wide and two high. */
export const PROP_SHEET = 'sprites/biomes.png';
/**
 * The same sheet with every other pixel left out. No longer drawn by the game: a tall prop
 * in front of the player is now faded as a whole (./depth.ts). The art build still writes it.
 */
export const PROP_VEIL = 'sprites/biomes-veil.png';
export const PROP_W = 16;
/** The lower half of a cell sits on the prop's tile; the upper half overhangs the tile above. */
export const PROP_H = 32;
export const PROP_COLS = 16;

/** Every prop and how many frames it has, in sheet order. */
export const PROP_LIST = [
  // swaying things: rest, leaning a little, leaning more, swinging back
  ['oakA', 4],
  ['oakB', 4],
  ['oakC', 4],
  ['pineA', 4],
  ['pineB', 4],
  ['palm', 4],
  ['bushA', 4],
  ['bushB', 4],
  ['planterA', 4],
  ['planterB', 4],
  // still landmarks and terrain
  ['cactusA', 1],
  ['cactusB', 1],
  ['cactusC', 1],
  ['snowman', 1],
  ['stalagA', 1],
  ['stalagB', 1],
  ['stalagC', 1],
  // blades: leaning left, upright, leaning right
  ['tallGrassA', 3],
  ['tallGrassB', 3],
  ['grassFront', 3],
  ['fern', 3],
  ['reeds', 3],
  // small things on the floor
  ['flowersA', 1],
  ['flowersB', 1],
  ['shroomRed', 1],
  ['shroomRedB', 1],
  ['shroomBrown', 1],
  ['glowShroom', 2],
  ['pebblesA', 1],
  ['pebblesB', 1],
  ['rubbleA', 1],
  ['rubbleB', 1],
  ['bones', 1],
  ['dryBush', 2],
  ['dune', 1],
  ['driftA', 1],
  ['driftB', 1],
  ['puddleCave', 2],
  ['puddleRoof', 2],
  ['moss', 1],
  ['lilyA', 1],
  ['lilyB', 1],
  // drawn over the game by the ambience layer
  ['ripple', 3],
] as const;

export type PropName = (typeof PROP_LIST)[number][0];

/** Cell indexes of each prop's frames. */
export const PROPS = (() => {
  const out = {} as Record<PropName, number[]>;
  let next = 0;
  for (const [name, count] of PROP_LIST) {
    out[name] = Array.from({ length: count }, (_, i) => next + i);
    next += count;
  }
  return out;
})();

/** Props drawn into the upper half of their cell: they overhang the tile above them. */
export const TALL: readonly PropName[] = ['oakA', 'oakB', 'oakC', 'pineA', 'pineB', 'palm', 'planterA', 'planterB', 'cactusA', 'snowman', 'stalagA', 'stalagB'];
/** How far a prop that is not TALL may poke above its own tile, in pixels (grass tips, reeds). */
export const POKE_PX = 6;

export const PROP_CELLS = PROP_LIST.reduce((n, [, count]) => n + count, 0);

/**
 * Water: one 16x16 cell per (face, frame, shore). A row is one frame of one face, a column
 * is a shore mask: which of the four screen neighbours are NOT water (a bank is drawn there).
 */
export const WATER_SHEET = 'tiles/water.png';
export const WATER_CELL = 16;
export const WATER_FRAMES = 4;
export const SHORE = { n: 1, e: 2, s: 4, w: 8 } as const;
export const WATER_MASKS = 16;
/** Faces 1 to 6, top to bottom. */
export const waterRow = (face: number, frame: number): number => (face - 1) * WATER_FRAMES + (frame % WATER_FRAMES);
