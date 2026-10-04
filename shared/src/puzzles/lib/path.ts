import { around, at, keyOf, mix, type XY } from '../util';

// SEEDED SAFE PATH: one winding line of tiles through a field, the same on the server and
// on both clients.
//
//   const field = lavaTiles(ctx);                 // every tile the line may use
//   const line = safeLine(ctx.seed, s.attempt, field, START, BUTTON);
//   // one side is shown `line`, the other has to walk it: onLine(line, tile)
//
// Bump `attempt` to draw a different line through the same field.

/**
 * The safe line through `field` from `start` to `goal` (both in `field`, both included), in
 * walking order. It is the cheapest path over per-tile costs mixed from (seed, attempt), so
 * it winds and it never touches itself (no shortcut to guess). [] when there is no way.
 */
export function safeLine(seed: number, attempt: number, field: readonly XY[], start: XY, goal: XY): XY[] {
  const inField = new Map(field.map((t) => [keyOf(t), t]));
  if (!inField.has(keyOf(start)) || !inField.has(keyOf(goal))) return [];
  // Mostly cheap or very dear, little in between: the line swerves around the dear tiles.
  const cost = (t: XY) => {
    const r = mix(seed, attempt, t.x, t.y) % 100;
    return r < 40 ? 1 : r < 60 ? 12 : 90;
  };
  const dist = new Map<string, number>([[keyOf(start), cost(start)]]);
  const prev = new Map<string, XY>();
  const open = new Map<string, XY>([[keyOf(start), start]]);
  const closed = new Set<string>();
  while (open.size) {
    let cur: XY | null = null;
    for (const t of open.values()) if (!cur || dist.get(keyOf(t))! < dist.get(keyOf(cur))!) cur = t;
    if (!cur) break;
    open.delete(keyOf(cur));
    closed.add(keyOf(cur));
    if (at(cur, goal)) break;
    for (const n of around(cur)) {
      const k = keyOf(n);
      if (!inField.has(k) || closed.has(k)) continue;
      const d = dist.get(keyOf(cur))! + cost(n);
      if (d < (dist.get(k) ?? Infinity)) {
        dist.set(k, d);
        prev.set(k, cur);
        open.set(k, n);
      }
    }
  }
  if (!dist.has(keyOf(goal))) return [];
  const line: XY[] = [];
  for (let t: XY | undefined = goal; t; t = prev.get(keyOf(t))) line.unshift({ x: t.x, y: t.y });
  return line;
}

/** Is `t` one of the tiles of `line`? */
export const onLine = (line: readonly XY[], t: XY): boolean => line.some((p) => at(p, t));
