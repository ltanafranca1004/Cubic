import { SOLID, type TileKind } from '../maps/types';
import { FACE_SIZE } from '../types';

// Small pure helpers shared by the puzzle modules. No state, no clock, no randomness of
// their own: anything "random" is mixed from numbers the caller passes in.

export interface XY {
  x: number;
  y: number;
}

export const at = (o: XY | undefined, t: XY): boolean => !!o && o.x === t.x && o.y === t.y;
export const keyOf = (t: XY): string => `${t.x},${t.y}`;

/**
 * A 32-bit hash of a list of numbers. This is the puzzles' only source of variation:
 * feed it `ctx.state.startedAt` (different every game, the same on server and client) and
 * whatever else should change the result (an attempt counter, a tile).
 */
export function mix(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    // startedAt is epoch ms, wider than 32 bits: fold both halves in.
    for (const part of [v % 0x100000000, Math.floor(v / 0x100000000)]) {
      h ^= part >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      h ^= h >>> 16;
    }
  }
  return h >>> 0;
}

const STEPS: readonly XY[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** The up to four tiles next to `t` on the same face. */
export const around = (t: XY): XY[] => STEPS.map((d) => ({ x: t.x + d.x, y: t.y + d.y })).filter((n) => n.x >= 0 && n.y >= 0 && n.x < FACE_SIZE && n.y < FACE_SIZE);

/**
 * Every walkable tile of one face map that can be reached from `from` without stepping on
 * a tile in `skip`. Terrain only: it does not know about doors or other puzzle blockers.
 */
export function flood(tiles: readonly (readonly TileKind[])[], from: XY, skip: readonly XY[] = []): XY[] {
  const seen = new Set<string>([keyOf(from), ...skip.map(keyOf)]);
  const out: XY[] = [{ x: from.x, y: from.y }];
  for (let i = 0; i < out.length; i++) {
    for (const n of around(out[i]!)) {
      if (seen.has(keyOf(n)) || SOLID[tiles[n.y]![n.x]!]) continue;
      seen.add(keyOf(n));
      out.push(n);
    }
  }
  return out;
}
