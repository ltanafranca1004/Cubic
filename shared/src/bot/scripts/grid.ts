import { FACE_SIZE } from '../../types';
import type { Observation } from '../observe';
import { DIRS, type Dir } from '../talk';

// Small geometry on the observation grid, for the partner core and the puzzle scripts.
// Everything is in the observer's own screen coordinates (col 0 = their left, row 0 = top).

/** A tile in the observer's own screen coordinates. */
export interface Cell {
  col: number;
  row: number;
}

export const VEC: Record<Dir, Cell> = { up: { col: 0, row: -1 }, down: { col: 0, row: 1 }, left: { col: -1, row: 0 }, right: { col: 1, row: 0 } };
export const same = (a: Cell | undefined, b: Cell | undefined): boolean => !!a && !!b && a.col === b.col && a.row === b.row;
export const cellKey = (c: Cell) => `${c.col},${c.row}`;
export const around = (c: Cell): Cell[] => DIRS.map((d) => ({ col: c.col + VEC[d].col, row: c.row + VEC[d].row })).filter((n) => n.col >= 0 && n.row >= 0 && n.col < FACE_SIZE && n.row < FACE_SIZE);
/** Terrain this side sees as floor (objects and items stand on floor). */
export const walkable = (o: Observation, c: Cell): boolean => !'#T~'.includes(o.grid[c.row]?.[c.col] ?? '#');
export const far = (a: Cell, b: Cell) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/** Shortest walk over the terrain this side sees, from `from` to `to` (both included), or null. */
export function route(o: Observation, from: Cell, to: Cell, blocked: (c: Cell) => boolean = () => false): Cell[] | null {
  const prev = new Map<string, Cell | null>([[cellKey(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    if (same(cur, to)) {
      const path: Cell[] = [];
      for (let c: Cell | null = cur; c; c = prev.get(cellKey(c)) ?? null) path.unshift(c);
      return path;
    }
    for (const n of around(cur)) {
      if (prev.has(cellKey(n)) || !walkable(o, n) || blocked(n)) continue;
      prev.set(cellKey(n), cur);
      queue.push(n);
    }
  }
  return null;
}

/** Every tile that can be walked to from `from` without entering a `blocked` one. */
export function flood(o: Observation, from: Cell, blocked: (c: Cell) => boolean): Cell[] {
  const seen = new Set<string>([cellKey(from)]);
  const out = [from];
  for (let i = 0; i < out.length; i++) {
    for (const n of around(out[i]!)) {
      if (seen.has(cellKey(n)) || !walkable(o, n) || blocked(n)) continue;
      seen.add(cellKey(n));
      out.push(n);
    }
  }
  return out;
}

/**
 * My screen vector as the partner sees it through the wall: mirrored left-right, then
 * turned by `k` quarter turns (their compass drift against mine). Which `k` is what the
 * two players agree on with a landmark.
 */
export function throughWall(v: Cell, k: number): Cell {
  let c = -v.col;
  let r = v.row;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [c, r] = [-r, c];
  return { col: c + 0, row: r + 0 }; // + 0: never a negative zero
}

/** The direction word of a one-tile step. */
export const dirOf = (v: Cell): Dir | null => DIRS.find((d) => VEC[d].col === v.col && VEC[d].row === v.row) ?? null;

/**
 * The landmark answer ("up left": where the far end is on the partner's screen) picks the
 * turn. `v` is the same vector on my screen. null if the answer fits no turn, or more than one.
 */
export function agreeTurn(v: Cell, answer: readonly Dir[]): number | null {
  const vertical = answer.filter((d) => d === 'up' || d === 'down');
  const sideways = answer.filter((d) => d === 'left' || d === 'right');
  if (vertical.length !== 1 || sideways.length !== 1) return null;
  const want = { col: VEC[sideways[0]!].col, row: VEC[vertical[0]!].row };
  const fits = [0, 1, 2, 3].filter((k) => {
    const t = throughWall(v, k);
    return Math.sign(t.col) === want.col && Math.sign(t.row) === want.row;
  });
  return fits.length === 1 ? fits[0]! : null;
}
