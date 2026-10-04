import type { PuzzleCtx, PuzzleInitCtx, PuzzleLine, PuzzleModule, VisibleObject } from './types';
import { SOLID } from '../maps/types';
import { FACE_SIZE } from '../types';
import { FLOWER_ID, flowerKind } from './chain';
import { hazardEnter } from './lib/hazard';
import { onLine, safeLine } from './lib/path';
import { boxAt, pushBox, resetBoxes, type Box } from './lib/push';
import { around, at, type XY } from './util';

// LASER AND INVISIBLE PATH (face 6: Cave outside, Lava room inside). Needs face 5.
//
// Outside: once face 5 is solved its laser comes up through the middle of the cave floor
// and runs north. Two mirror boxes ("/" and "\") are pushed like sokoban boxes (walk into
// one; never pulled) to bend the beam onto the wooden crate on the edge. Rocks and solid
// terrain stop the beam and the boxes. The beam burns the crate: the FLOWER for face 4
// appears next to it, and the safe path through the room below shows on the cave floor.
//
// Inside: the outer ring is floor, everything else is lava. Any lava tile off the safe path
// (and every lava tile before the crate burns) drops the player back on the ring next to
// the start of the path, with a strike. The path is the same after a fall, and only the
// outside player sees it. The inside player walks it to the button and presses E: solved.
// The lava is only hot (deadly) while the laser of face 5 is on and this face is unsolved:
// before that nobody has a reason to be here and the pathfinding (bot, test scripts) walks
// straight across; after the solve it cools again.
//
// NEVER STUCK: E on the RESET tile (outside) puts both mirrors back where they started.
// A mirror can cover a path tile on the outside player's screen: RESET uncovers it.
// EDGE RULE: mirrors never reach the ring (pushBox refuses it), rocks and the beam source
// are not on it, the crate on the ring does not block, and lava never blocks.
//
// Map objects used: outside "f6-source" (where the beam starts), "f6-rock", "f6-crate"
// (on the ring), "reset"; inside "button". The mirrors move, so they are listed here.

const FACE = 6;
const BEAM = '#ff3b3b';

/** Where the mirrors start. The id's first part is the kind: fwd = "/", back = "\". */
export const MIRROR_START: readonly Box[] = [
  { id: 'fwd-a', x: 4, y: 2 },
  { id: 'back-b', x: 9, y: 4 },
];
/** First tile of the safe path, and the ring tile beside it where a fall puts you back. */
export const PATH_START: XY = { x: 1, y: 5 };
export const RESPAWN: XY = { x: 0, y: 5 };

interface State {
  mirrors: Box[];
  /** The beam has burnt the crate: the flower is out and the path exists. */
  burnt: boolean;
  done: boolean;
}

export type MirrorKind = 'fwd' | 'back';
export const mirrorKind = (b: Pick<Box, 'id'>): MirrorKind => (b.id.startsWith('fwd') ? 'fwd' : 'back');

const ring = (t: XY): boolean => t.x === 0 || t.y === 0 || t.x === FACE_SIZE - 1 || t.y === FACE_SIZE - 1;
const inFace = (t: XY): boolean => t.x >= 0 && t.y >= 0 && t.x < FACE_SIZE && t.y < FACE_SIZE;

/**
 * The beam as a pure function of where the mirrors are. It starts in the middle of `start`
 * heading north (canonical -y), turns at every mirror ("/": north<->east, south<->west;
 * "\": north<->west, south<->east) and ends on the tile where `stops` is true or on the
 * last tile before the edge. `points` are the corners (tile centres), `tiles` every tile
 * it crosses after `start`.
 */
export function traceBeam(start: XY, mirrors: readonly Box[], stops: (t: XY) => boolean): { points: XY[]; tiles: XY[] } {
  const points: XY[] = [{ x: start.x, y: start.y }];
  const tiles: XY[] = [];
  let cur: XY = points[0]!;
  let dx = 0;
  let dy = -1;
  // four mirrors could make a loop: the beam gives up after crossing every tile twice
  for (let guard = 0; guard < FACE_SIZE * FACE_SIZE * 2; guard++) {
    const next = { x: cur.x + dx, y: cur.y + dy };
    if (!inFace(next)) break;
    cur = next;
    tiles.push(cur);
    if (stops(cur)) break;
    const m = boxAt(mirrors, cur);
    if (!m) continue;
    points.push(cur);
    [dx, dy] = mirrorKind(m) === 'fwd' ? [-dy, -dx] : [dy, dx];
  }
  if (!at(points[points.length - 1], cur)) points.push(cur);
  return { points, tiles };
}

const source = (ctx: PuzzleInitCtx): XY | undefined => ctx.objects('out', FACE, 'f6-source')[0];
const fixed = (ctx: PuzzleInitCtx, t: XY): boolean => ['f6-source', 'f6-rock'].some((type) => ctx.objects('out', FACE, type).some((o) => at(o, t)));
const solidOut = (ctx: PuzzleInitCtx, t: XY): boolean => SOLID[ctx.world.out[FACE].tiles[t.y]![t.x]!];

function beam(s: State, ctx: PuzzleInitCtx): { points: XY[]; tiles: XY[] } {
  const from = source(ctx);
  return from ? traceBeam(from, s.mirrors, (t) => solidOut(ctx, t) || fixed(ctx, t)) : { points: [], tiles: [] };
}

/**
 * The lava tiles a path may use: under open cave floor only (no terrain, no fixed object,
 * no mirror start, not beside a stalagmite), so the outside player can always see it drawn.
 */
function field(ctx: PuzzleInitCtx): XY[] {
  const tiles = ctx.world.out[FACE].tiles;
  const objects = ctx.objects('out', FACE);
  const out: XY[] = [];
  for (let y = 1; y < FACE_SIZE - 1; y++)
    for (let x = 1; x < FACE_SIZE - 1; x++) {
      const t = { x, y };
      if (solidOut(ctx, t) || objects.some((o) => at(o, t)) || MIRROR_START.some((m) => at(m, t))) continue;
      if (around(t).some((n) => tiles[n.y]![n.x] === 'tree')) continue;
      out.push(t);
    }
  return out;
}

/** The safe path, from PATH_START to the button, in walking order. Never rerolled. */
export function safePath(ctx: PuzzleInitCtx): XY[] {
  const button = ctx.objects('in', FACE, 'button')[0];
  return button ? safeLine(ctx.seed, 0, field(ctx), PATH_START, button) : [];
}

/** Is the lava deadly? Only while the laser is on and the button has not been pressed. */
const hot = (s: State, ctx: Pick<PuzzleCtx, 'faceSolved'>): boolean => ctx.faceSolved(5) && !s.done;

/** Burn the crate if the beam is on it. Called after anything that can move the beam. */
function settleBeam(s: State, ctx: PuzzleCtx): void {
  if (s.burnt || !ctx.faceSolved(5)) return;
  const crate = ctx.objects('out', FACE, 'f6-crate')[0];
  if (!crate || !beam(s, ctx).tiles.some((t) => at(t, crate))) return;
  s.burnt = true;
  ctx.emit('burn');
  // the flower lands on the floor tile beside the crate, off the ring
  const spot = around(crate).find((n) => !ring(n)) ?? crate;
  if (!ctx.state.items[FLOWER_ID]) ctx.spawnItem({ id: FLOWER_ID, kind: flowerKind(ctx.seed), side: 'out', face: FACE, x: spot.x, y: spot.y });
}

export const laserPath: PuzzleModule<State> = {
  id: 'laser-path',
  face: FACE,

  init: () => ({ mirrors: MIRROR_START.map((b) => ({ ...b })), burnt: false, done: false }),

  // Mirrors, rocks and the beam source are in the outside player's way. None is ever on the ring.
  isBlocked: (s, ctx, side, tile) => side === 'out' && !ring(tile) && (!!boxAt(s.mirrors, tile) || fixed(ctx, tile)),

  onPush(s, ctx, side, tile, dx, dy) {
    if (side !== 'out') return false;
    const flower = ctx.state.items[FLOWER_ID];
    const free = (t: XY) => !solidOut(ctx, t) && !fixed(ctx, t) && !(flower && !flower.carriedBy && flower.face === FACE && at(flower, t));
    if (!pushBox(s.mirrors, tile, dx, dy, free)) return false;
    settleBeam(s, ctx);
    return true;
  },

  onUse(s, ctx, side, tile) {
    if (side === 'out') {
      if (!ctx.objects('out', FACE, 'reset').some((r) => at(r, tile))) return;
      resetBoxes(s.mirrors, MIRROR_START);
      ctx.emit('toggle');
      settleBeam(s, ctx);
      return;
    }
    // the button only works once there is a path to it
    if (!s.burnt || s.done || !ctx.objects('in', FACE, 'button').some((b) => at(b, tile))) return;
    s.done = true;
    ctx.emit('chime');
  },

  onEnter(s, ctx, side, tile) {
    if (side !== 'in' || !hot(s, ctx) || ring(tile)) return;
    if (s.burnt && onLine(safePath(ctx), tile)) return;
    if (hazardEnter(ctx, side, tile, [tile], RESPAWN)) ctx.emit('splash');
  },

  // Face 5 can be solved while the mirrors already stand right: the beam arrives on a tick.
  onTick(s, ctx) {
    settleBeam(s, ctx);
  },

  isSolved: (s) => s.done,

  visible(s, ctx, side) {
    const out: VisibleObject[] = [];
    if (side === 'in') {
      // every lava tile looks the same: the path is not in here
      const button = ctx.objects('in', FACE, 'button')[0];
      for (let y = 1; y < FACE_SIZE - 1; y++)
        for (let x = 1; x < FACE_SIZE - 1; x++) if (!at(button, { x, y })) out.push({ type: 'f6-lava', x, y, state: hot(s, ctx) ? 'hot' : 'cold' });
      if (button) out.push({ type: 'button', x: button.x, y: button.y, state: s.done ? 'on' : 'off' });
      return out;
    }
    // the path first, in walking order; a mirror standing on a path tile covers it
    if (s.burnt) safePath(ctx).forEach((t, i, line) => out.push({ type: 'f6-path', x: t.x, y: t.y, state: i === line.length - 1 ? 'goal' : 'path' }));
    for (const m of s.mirrors) out.push({ type: 'f6-mirror', x: m.x, y: m.y, state: mirrorKind(m) });
    const src = source(ctx);
    if (src) out.push({ type: 'f6-source', x: src.x, y: src.y, state: ctx.faceSolved(5) ? 'on' : 'off' });
    for (const c of ctx.objects('out', FACE, 'f6-crate')) out.push({ type: 'f6-crate', x: c.x, y: c.y, state: s.burnt ? 'burnt' : 'whole' });
    return out;
  },

  lines(s, ctx, side) {
    if (side !== 'out' || !ctx.faceSolved(5)) return [];
    const { points } = beam(s, ctx);
    const out: PuzzleLine[] = [];
    for (let i = 1; i < points.length; i++) out.push({ from: [points[i - 1]!.x, points[i - 1]!.y], to: [points[i]!.x, points[i]!.y], colour: BEAM });
    return out;
  },

  objective(s, ctx, side) {
    if (s.done) return 'The lava has cooled.';
    if (side === 'out') {
      if (s.burnt) return 'Take the flower. Guide your partner over the lava along the path you see. RESET moves the mirrors off it.';
      return ctx.faceSolved(5) ? 'Push the mirrors so the beam hits the wooden crate. E on RESET puts them back.' : 'Mirrors to push, a crate on the edge, and no beam yet: the laser above needs solving.';
    }
    if (!ctx.faceSolved(5)) return 'Cold rock and a button in the middle. The laser above is still dead.';
    return s.burnt ? 'A safe path crosses the lava to the button. Only your partner can see it. Press E on the button.' : 'The laser has lit the lava. Stay on the outer ring until your partner burns the crate.';
  },
};
