import { C } from '../../style/tokens';
import { bitmap, type Draw, type Rect, type Sprite } from './common';

// Face 6 (Laser and Invisible Path): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

/** A rock: stops the beam, the mirrors and the player. */
function rock(rect: Rect): void {
  rect(3, 4, 10, 10, C.ink);
  rect(2, 7, 12, 7, C.ink);
  rect(5, 3, 6, 2, C.ink);
  rect(4, 5, 8, 8, C.slate);
  rect(3, 8, 10, 5, C.slate);
  rect(5, 4, 5, 3, C.silver);
  rect(4, 7, 3, 2, C.silver);
  rect(8, 10, 4, 2, C.shadow);
}

/** A pushable mirror box: `fwd` is "/", `back` is "\". */
function mirror(rect: Rect, state: string): void {
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, C.navy);
  rect(2, 2, 12, 1, C.blue);
  for (let i = 0; i < 10; i++) {
    const x = state === 'back' ? 3 + i : 12 - i;
    rect(x, 3 + i, 1, 1, C.white);
    if (x > 3) rect(x - 1, 3 + i, 1, 1, C.skyLight);
    if (x < 12) rect(x + 1, 3 + i, 1, 1, C.sky);
  }
}

/** The wooden crate on the edge: `whole`, or `burnt` (a heap of ash, walked over). */
function crate(rect: Rect, state: string): void {
  if (state === 'burnt') {
    rect(4, 11, 8, 2, C.ink);
    rect(5, 10, 6, 1, C.shadow);
    rect(6, 9, 3, 1, C.slate);
    rect(3, 12, 2, 1, C.shadow);
    rect(11, 12, 2, 1, C.shadow);
    rect(8, 11, 1, 1, C.orange);
    return;
  }
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, C.copper);
  rect(2, 2, 12, 2, C.sand);
  rect(2, 12, 12, 2, C.rust);
  rect(2, 2, 2, 12, C.sandDark);
  rect(12, 2, 2, 12, C.sandDark);
  for (let i = 0; i < 8; i++) rect(4 + i, 4 + i, 1, 1, C.rust);
}

/** Where the laser of face 5 comes up through the floor: `off`, `on`. */
function source(rect: Rect, state: string): void {
  const on = state === 'on';
  rect(3, 3, 10, 10, C.ink);
  rect(4, 2, 8, 12, C.ink);
  rect(4, 4, 8, 8, C.slate);
  rect(4, 4, 8, 1, C.silver);
  rect(6, 6, 4, 4, C.ink);
  rect(7, 7, 2, 2, on ? C.white : C.maroon);
  if (on) {
    rect(6, 6, 4, 1, C.red);
    rect(6, 9, 4, 1, C.red);
    rect(6, 6, 1, 4, C.red);
    rect(9, 6, 1, 4, C.red);
    rect(7, 0, 2, 4, C.red);
  }
}

/** A run of `w` pixels on row `y` from `x`, wrapping round the tile: the pattern joins up with the next tile. */
function run(rect: Rect, x: number, y: number, w: number, colour: string): void {
  for (let i = 0; i < w; i++) rect((((x + i) % 16) + 16) % 16, y, 1, 1, colour);
}

/** How many frames the hot lava has. */
const LAVA_FRAMES = 4;
/** The swells of the hot lava: row, start, length. Each is two rows deep with a bright crest. */
const SWELLS: readonly (readonly [number, number, number])[] = [
  [1, 1, 7],
  [5, 9, 6],
  [9, 3, 8],
  [13, 11, 6],
];
/** The cracks of the cooled crust (`#`) and where they still glow (`o`). */
const CRUST = [
  '......#.........',
  '..##..#....#....',
  '.#..#o.....#....',
  '#....#....#.....',
  '......###o......',
  '.......#........',
  '.......#....##..',
  '......#....#..#.',
  '##...o....#....#',
  '..###....o......',
  '...#.....#......',
  '...#......#.....',
  '..#........o#...',
  '.#...........#..',
  '#.....#.......##',
  '......#.........',
];

/**
 * One lava tile of the inside room. Both states are lava and nothing else in the room is
 * red: `hot` is bright and flows (frames 0 to 3, the deadly one), `cold` is the same lava
 * under a dark crust with glowing cracks, still, and safe to walk.
 */
function lava(rect: Rect, state: string, frame = 0): void {
  if (state === 'cold') {
    rect(0, 0, 16, 16, C.maroon);
    bitmap(rect, 0, 0, CRUST, C.brick);
    bitmap(rect, 0, 0, CRUST.map((r) => r.replaceAll('#', '.').replaceAll('o', '#')), C.orange);
    for (const [x, y] of [[4, 2], [6, 3], [10, 4], [4, 8], [8, 9], [10, 12]] as const) rect(x, y, 1, 1, C.vermilion);
    return;
  }
  const f = ((frame % LAVA_FRAMES) + LAVA_FRAMES) % LAVA_FRAMES;
  const shift = f * 4; // the swells drift right, a quarter tile a frame, and wrap
  rect(0, 0, 16, 16, C.vermilion);
  // slow dark eddies drifting the other way give the flow its depth
  run(rect, 12 - shift, 3, 4, C.red);
  run(rect, 2 - shift, 7, 5, C.red);
  run(rect, 9 - shift, 11, 4, C.red);
  run(rect, 5 - shift, 15, 4, C.red);
  for (const [y, x, w] of SWELLS) {
    run(rect, x + shift, y, w, C.orange);
    run(rect, x + shift + 1, y + 1, w - 2, C.orange);
    run(rect, x + shift + 1, y, w - 4, C.amber);
  }
  // one bubble that swells and bursts
  if (f === 1) rect(11, 9, 1, 1, C.amber);
  if (f === 2) {
    rect(10, 8, 3, 3, C.amber);
    rect(11, 9, 1, 1, C.lemon);
  }
  if (f === 3) {
    rect(10, 7, 3, 1, C.amber);
    rect(9, 9, 1, 1, C.amber);
    rect(13, 9, 1, 1, C.amber);
  }
}

/** A tile of the safe path, drawn on the cave floor for the outside player. `goal` is the button's tile. */
function path(rect: Rect, state: string): void {
  const goal = state === 'goal';
  rect(5, 5, 6, 6, C.ink);
  rect(6, 6, 4, 4, goal ? C.amber : C.green);
  rect(6, 6, 4, 1, goal ? C.lemon : C.grassLight);
  if (goal) {
    rect(3, 3, 10, 1, C.amber);
    rect(3, 12, 10, 1, C.amber);
    rect(3, 3, 1, 10, C.amber);
    rect(12, 3, 1, 10, C.amber);
  }
}

export const DRAW: Record<string, Draw> = { 'f6-rock': rock, 'f6-mirror': mirror, 'f6-crate': crate, 'f6-source': source, 'f6-lava': lava, 'f6-path': path };

export const SPRITES: readonly Sprite[] = [
  { type: 'f6-rock', state: 'default' },
  { type: 'f6-mirror', state: 'fwd' },
  { type: 'f6-mirror', state: 'back' },
  { type: 'f6-crate', state: 'whole' },
  { type: 'f6-crate', state: 'burnt' },
  { type: 'f6-source', state: 'off' },
  { type: 'f6-source', state: 'on' },
  { type: 'f6-lava', state: 'hot' },
  { type: 'f6-lava', state: 'cold' },
  { type: 'f6-path', state: 'path' },
  { type: 'f6-path', state: 'goal' },
  // the other frames of the hot lava, last so no older cell of the sheet moves
  ...Array.from({ length: LAVA_FRAMES - 1 }, (_, i) => ({ type: 'f6-lava', state: 'hot', frame: i + 1 })),
];
