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

/** One lava tile of the inside room: `hot`, or `cold` (dark rock, safe to walk). */
function lava(rect: Rect, state: string): void {
  if (state === 'cold') {
    rect(0, 0, 16, 16, C.shadow);
    bitmap(rect, 2, 3, ['.##.....##..', '#...........', '.....##.....', '..........#.', '..#.........', '.....#...##.', '##..........', '........#...'], C.slate);
    return;
  }
  rect(0, 0, 16, 16, C.vermilion);
  bitmap(rect, 1, 2, ['..###.....##..', '.#...#........', '........###...', '...#...#...#..', '..###.........', '.........##...', '##......#..#..', '.....##.......', '....#..#....##', '..............', '.##.....###...'], C.orange);
  bitmap(rect, 3, 4, ['.#........', '......#...', '..........', '.#........', '.......#..', '..........', '...#......'], C.amber);
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
];
