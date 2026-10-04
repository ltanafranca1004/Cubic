import { C } from '../../style/tokens';
import { bitmap, type Rect } from './common';

// The items the puzzles hand out, drawn the same way as the objects: once, in code, for
// both sprites/items.png (/tools/art) and CodeArt's placeholder. The key is the item `kind`.

/** A battery: the charge the equation safe gives up. */
function battery(rect: Rect): void {
  rect(6, 2, 4, 2, C.ink);
  rect(7, 2, 2, 1, C.silver);
  rect(4, 3, 8, 12, C.ink);
  rect(5, 4, 6, 10, C.slate);
  rect(5, 4, 6, 3, C.amber);
  rect(5, 4, 1, 10, C.silver);
  bitmap(rect, 6, 8, ['..##', '.##.', '####', '.##.', '##..'], C.lemon);
}

/** Petal, petal shade and heart of each flower colour. */
const FLOWERS: Record<string, readonly [string, string, string]> = {
  'flower-red': [C.red, C.crimson, C.lemon],
  'flower-blue': [C.sky, C.blue, C.lemon],
  'flower-yellow': [C.lemon, C.amber, C.rust],
  'flower-pink': [C.pink, C.hotPink, C.lemon],
  'flower-white': [C.white, C.mist, C.amber],
};

function flower(rect: Rect, [petal, shade, heart]: readonly [string, string, string]): void {
  rect(7, 9, 2, 6, C.ink);
  rect(7, 9, 1, 5, C.green);
  rect(8, 11, 3, 1, C.green);
  rect(4, 12, 3, 1, C.green);
  bitmap(rect, 3, 1, ['..#####..', '.#######.', '#########', '#########', '#########', '#########', '#########', '.#######.', '..#####..'], C.ink);
  bitmap(rect, 4, 2, ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'], petal);
  bitmap(rect, 4, 2, ['.......', '.......', '.......', '#.....#', '##...##', '.#####.', '..###..'], shade);
  rect(6, 4, 3, 3, heart);
}

const DRAW: Record<string, (rect: Rect) => void> = {
  battery,
  ...Object.fromEntries(Object.entries(FLOWERS).map(([kind, colours]) => [kind, (rect: Rect) => flower(rect, colours)])),
};

/** Every item kind drawn here, in sheet order (after the rose, the key and the bundle). */
export const PUZZLE_ITEMS: readonly string[] = Object.keys(DRAW);

/** Draw a puzzle item. False if `kind` is not one of them (nothing was drawn). */
export function drawPuzzleItem(rect: Rect, kind: string): boolean {
  const draw = DRAW[kind];
  if (!draw) return false;
  draw(rect);
  return true;
}
