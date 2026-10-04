import { keyOf, type XY } from '../util';

// FLIP SET: a set of tiles of one face that are "on" (flipped). Plain JSON: a sorted list
// of "x,y" keys, so two equal sets serialize the same.
//
//   interface State { on: FlipSet }
//   onUse(s, _ctx, side, tile) { if (side === 'in') flipToggle(s.on, tile); },
//   isSolved: (s) => flipEquals(s.on, TARGET),
//   visible: (s) => flipTiles(s.on).map((t) => ({ type: 'flip', x: t.x, y: t.y, state: 'on' })),

export type FlipSet = string[];

export const newFlipSet = (tiles: readonly XY[] = []): FlipSet => [...new Set(tiles.map(keyOf))].sort();

export const flipHas = (set: readonly string[], t: XY): boolean => set.includes(keyOf(t));

/** Flip one tile. Mutates `set`. Returns true if the tile is now on. */
export function flipToggle(set: FlipSet, t: XY): boolean {
  const k = keyOf(t);
  const i = set.indexOf(k);
  if (i >= 0) {
    set.splice(i, 1);
    return false;
  }
  set.push(k);
  set.sort();
  return true;
}

/** Turn every tile off. Mutates `set`. */
export function flipClear(set: FlipSet): void {
  set.length = 0;
}

/** Exactly the tiles of `target` are on, no more and no fewer. */
export function flipEquals(set: readonly string[], target: readonly XY[]): boolean {
  const want = newFlipSet(target);
  return want.length === set.length && want.every((k) => set.includes(k));
}

/** The tiles that are on. */
export const flipTiles = (set: readonly string[]): XY[] =>
  set.map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x!, y: y! };
  });
