import type { PuzzleCtx, PuzzleModule } from './types';
import { around, at, flood, keyOf, mix, type XY } from './util';

// MIRROR MAZE (face 4: Forest outside, Echo room inside).
// Inside is a walled room with a crystal at the far end. Its floor is a trap: only one
// winding line of tiles holds. That line is marked on the OTHER side of the wall, as pale
// stones on the forest floor, tile for tile. The outside player reads the stones, the
// inside player walks them.
//
// The inside player sees the wall from behind, so the outside player's "left" is the
// inside player's "right" (and both views can be turned by compass drift). The module
// only compares canonical tiles; working out the directions is the players' job.
//
// Why it takes two: the safe tiles are only drawn for the outside player, they come from
// the game's start time, and every fall draws a new line. Guessing teaches nothing.
//
// Never stuck: a wrong tile puts the inside player back on the doorway (one strike).
// Once the crystal is taken the whole floor holds.
//
// Map objects used: inside "entry" (the doorway) and "crystal". The room is whatever
// floor is walled in with the crystal behind the doorway.

export const MAZE_FACE = 4;

interface State {
  /** Falls so far: each one changes the safe line. */
  attempt: number;
  /** Safe tiles walked since the last fall ("x,y"), shown to the inside player. */
  walked: string[];
  taken: boolean;
}

/**
 * The safe line through `field`, from the tile behind `entry` to `goal`, in walking
 * order. It is the cheapest path over per-tile costs mixed from (seed, attempt), so it
 * winds, it never touches itself (no shortcut to guess), and it is the same on the
 * server and on both clients.
 */
export function safeLine(seed: number, attempt: number, field: readonly XY[], entry: XY, goal: XY): XY[] {
  const inField = new Map(field.map((t) => [keyOf(t), t]));
  const start = around(entry).find((n) => inField.has(keyOf(n)));
  if (!start || !inField.has(keyOf(goal))) return [];
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

interface Layout {
  entry: XY;
  crystal: XY;
  /** The trap floor: every tile walled in with the crystal, behind the doorway. */
  field: XY[];
}

function layout(ctx: PuzzleCtx): Layout | null {
  const entry = ctx.objects('in', MAZE_FACE, 'entry')[0];
  const crystal = ctx.objects('in', MAZE_FACE, 'crystal')[0];
  if (!entry || !crystal) return null;
  return { entry, crystal, field: flood(ctx.world.in[MAZE_FACE].tiles, crystal, [entry]) };
}

// The line is asked for on every draw and every AI turn: keep the last one. A pure cache,
// keyed by everything the line depends on.
let memo: { key: string; line: XY[] } | null = null;
function lineOf(s: State, ctx: PuzzleCtx, l: Layout): XY[] {
  const key = `${ctx.state.startedAt}:${s.attempt}:${keyOf(l.entry)}:${keyOf(l.crystal)}:${l.field.map(keyOf).join(' ')}`;
  if (memo?.key !== key) memo = { key, line: safeLine(ctx.state.startedAt, s.attempt, l.field, l.entry, l.crystal) };
  return memo.line;
}

const open = (s: State, ctx: PuzzleCtx) => s.taken || ctx.solved;

export const mirrorMaze: PuzzleModule<State> = {
  id: 'mirror-maze',
  face: MAZE_FACE,

  init: () => ({ attempt: 0, walked: [], taken: false }),

  onEnter(s, ctx, side, tile) {
    if (side !== 'in' || open(s, ctx)) return;
    const l = layout(ctx);
    if (!l || !l.field.some((t) => at(t, tile))) return;
    if (lineOf(s, ctx, l).some((t) => at(t, tile))) {
      if (!s.walked.includes(keyOf(tile))) s.walked.push(keyOf(tile));
      if (at(l.crystal, tile)) {
        s.taken = true;
        ctx.emit('maze-taken');
      } else ctx.emit('maze-safe');
      return;
    }
    // The floor gives way: back to the doorway, and the safe line moves.
    s.attempt++;
    s.walked = [];
    ctx.teleport('in', l.entry.x, l.entry.y);
    ctx.strike('in');
    ctx.emit('maze-fall');
  },

  isSolved: (s) => s.taken,

  visible(s, ctx, side) {
    const l = layout(ctx);
    if (!l) return [];
    if (side === 'out') {
      // In walking order: the first stone is the one behind the doorway, the last is the crystal's.
      const line = lineOf(s, ctx, l);
      return line.map((t, i) => ({ type: 'trail', x: t.x, y: t.y, state: i === 0 ? 'start' : i === line.length - 1 ? 'end' : 'stone' }));
    }
    const mark = (k: string) => {
      const [x, y] = k.split(',').map(Number);
      return { type: 'step', x: x!, y: y! };
    };
    return [...s.walked.map(mark), { type: 'entry', x: l.entry.x, y: l.entry.y }, { type: 'crystal', x: l.crystal.x, y: l.crystal.y, state: s.taken ? 'taken' : 'idle' }];
  },

  objective(s, _ctx, side) {
    if (side === 'out') return 'Pale stones mark the safe floor behind this wall. They move when your partner falls.';
    return s.walked.length ? 'The floor held. Ask for the next step before you take it.' : 'A walled room with a crystal at the far end. Most of this floor will not hold you.';
  },
};
