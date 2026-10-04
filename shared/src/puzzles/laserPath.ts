import type { PuzzleCtx, PuzzleInitCtx, PuzzleLine, PuzzleModule, VisibleObject } from './types';
import { SOLID } from '../maps/types';
import { FACE_SIZE } from '../types';
import { FLOWER_ID, flowerKind } from './chain';
import { hazardEnter } from './lib/hazard';
import { boxAt, pushBox, resetBoxes, type Box } from './lib/push';
import { at, type XY } from './util';

// LASER AND LAVA (face 6: Cave outside, Lava room inside). Needs face 5.
//
// Outside: once face 5 is solved its laser comes up through the middle of the cave floor
// and runs north. Two mirror boxes ("/" and "\") are pushed like sokoban boxes (walk into
// one; never pulled) to bend the beam onto the wooden crate on the edge of the face. Rocks
// and solid terrain stop the beam and the boxes. The beam burns the crate: the FLOWER for
// face 4 lies where it stood, and the mirrors LOCK (no push moves them, RESET does nothing
// any more): the beam is frozen, and it stays drawn.
//
// Inside: the outer ring is floor, everything else is HOT lava from the first second of the
// game. A step into it drops the player back on the ring with a strike. There is no safe
// way through until the crate burns. From then on THE BEAM IS THE PATH: the lava tiles
// right behind the frozen beam (same canonical tiles), from the ring tile where the crate
// stood to the button, which sits behind the beam source. Nothing shows it inside: every
// lava tile looks the same, the outside player reads the beam out. The inside player walks
// it to the button and presses E: solved, and the lava crusts over ("cold", walkable).
// It is LAVA TO LOOK AT the whole time: all 99 tiles are in visible('in') in every state,
// and the room is `bright`, so no darkness hides them.
//
// A fall puts the player on RESPAWN before the burn, and on the ring tile where the path
// starts (the crate's tile) after it.
//
// NEVER STUCK: until the crate burns, E on the RESET tile (outside) puts both mirrors back
// where they started. After the burn nothing can be moved, so nothing can be lost.
// EDGE RULE: mirrors never reach the ring (pushBox refuses it), rocks and the beam source
// are not on it, and lava never blocks. ONE EXCEPTION: the crate stands on the ring and is
// solid for the outside player until it burns away.
//
// Map objects used: outside "f6-source" (where the beam starts), "f6-rock", "f6-crate"
// (on the ring), "reset"; inside "button" (on the tile behind the source). The mirrors
// move, so they are listed here.

const FACE = 6;
const BEAM = '#ff3b3b';

/** Where the mirrors start. The id's first part is the kind: fwd = "/", back = "\". */
export const MIRROR_START: readonly Box[] = [
  { id: 'fwd-a', x: 4, y: 2 },
  { id: 'back-b', x: 9, y: 4 },
];
/** Mirrors that burn the crate: where the dev tools' "Solve puzzle" puts them. */
export const MIRROR_SOLVED: readonly Box[] = [
  { id: 'fwd-a', x: 5, y: 2 },
  { id: 'back-b', x: 9, y: 2 },
];
/** The ring tile a fall puts you back on while there is no path yet. After the burn: the crate's tile. */
export const RESPAWN: XY = { x: 0, y: 5 };

interface State {
  mirrors: Box[];
  /** The beam has burnt the crate: the flower is out, the mirrors are locked and the beam is the path. */
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

const crateOf = (ctx: PuzzleInitCtx): XY | undefined => ctx.objects('out', FACE, 'f6-crate')[0];

/**
 * The safe tiles of the lava room, in walking order: from the ring tile where the crate
 * stood, back along the frozen beam, to the tile behind the beam source (the button).
 * [] until the crate burns.
 */
function safePath(s: State, ctx: PuzzleInitCtx): XY[] {
  const from = source(ctx);
  return s.burnt && from ? [from, ...beam(s, ctx).tiles].reverse() : [];
}

/** Burn the crate if the beam is on it. Called after anything that can move the beam. */
function settleBeam(s: State, ctx: PuzzleCtx): void {
  if (s.burnt || !ctx.faceSolved(5)) return;
  const crate = crateOf(ctx);
  if (!crate || !beam(s, ctx).tiles.some((t) => at(t, crate))) return;
  burn(s, ctx, crate);
  ctx.emit('burn');
}

/** The crate is ash: the mirrors are locked, the beam is the path and the flower lies where the crate stood. */
function burn(s: State, ctx: PuzzleCtx, crate: XY): void {
  s.burnt = true;
  const spot = crate;
  if (!ctx.state.items[FLOWER_ID]) ctx.spawnItem({ id: FLOWER_ID, kind: flowerKind(ctx.seed), side: 'out', face: FACE, x: spot.x, y: spot.y });
}

export const laserPath: PuzzleModule<State> = {
  id: 'laser-path',
  face: FACE,

  init: () => ({ mirrors: MIRROR_START.map((b) => ({ ...b })), burnt: false, done: false }),

  // Mirrors, rocks and the beam source are in the outside player's way. None is ever on the
  // ring. The crate is, and it is solid until it burns away (the one exception to the edge rule).
  isBlocked: (s, ctx, side, tile) => side === 'out' && (ring(tile) ? !s.burnt && at(crateOf(ctx), tile) : !!boxAt(s.mirrors, tile) || fixed(ctx, tile)),

  onPush(s, ctx, side, tile, dx, dy) {
    if (side !== 'out' || s.burnt) return false; // burnt: the mirrors are locked
    const flower = ctx.state.items[FLOWER_ID];
    const free = (t: XY) => !solidOut(ctx, t) && !fixed(ctx, t) && !(flower && !flower.carriedBy && flower.face === FACE && at(flower, t));
    if (!pushBox(s.mirrors, tile, dx, dy, free)) return false;
    settleBeam(s, ctx);
    return true;
  },

  onUse(s, ctx, side, tile) {
    if (side === 'out') {
      if (s.burnt || !ctx.objects('out', FACE, 'reset').some((r) => at(r, tile))) return; // burnt: locked
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
    if (side !== 'in' || s.done || ring(tile)) return;
    const path = safePath(s, ctx);
    if (path.some((p) => at(p, tile))) return;
    if (hazardEnter(ctx, side, tile, [tile], path[0] ?? RESPAWN)) ctx.emit('splash');
  },

  // Face 5 can be solved while the mirrors already stand right: the beam arrives on a tick.
  onTick(s, ctx) {
    settleBeam(s, ctx);
  },

  isSolved: (s) => s.done,

  // The lava lights the room: the inside player sees all of it, not only the tiles nearby.
  bright: true,

  // The dev tools' "Solve puzzle": the mirrors stand in the beam, the crate is burnt, the flower is out
  // and the lava is cold, as after the button.
  devSolve(s, ctx) {
    const crate = crateOf(ctx);
    if (!s.burnt && crate) {
      if (!beam(s, ctx).tiles.some((t) => at(t, crate))) resetBoxes(s.mirrors, MIRROR_SOLVED);
      burn(s, ctx, crate);
    }
    s.done = true;
  },

  visible(s, ctx, side) {
    const out: VisibleObject[] = [];
    if (side === 'in') {
      // every lava tile looks the same, hot until the button is pressed: the path is not in here
      const button = ctx.objects('in', FACE, 'button')[0];
      for (let y = 1; y < FACE_SIZE - 1; y++)
        for (let x = 1; x < FACE_SIZE - 1; x++) if (!at(button, { x, y })) out.push({ type: 'f6-lava', x, y, state: s.done ? 'cold' : 'hot' });
      if (button) out.push({ type: 'button', x: button.x, y: button.y, state: s.done ? 'on' : 'off' });
      return out;
    }
    for (const m of s.mirrors) out.push({ type: 'f6-mirror', x: m.x, y: m.y, state: mirrorKind(m) });
    const src = source(ctx);
    if (src) out.push({ type: 'f6-source', x: src.x, y: src.y, state: ctx.faceSolved(5) ? 'on' : 'off' });
    for (const c of ctx.objects('out', FACE, 'f6-crate')) out.push({ type: 'f6-crate', x: c.x, y: c.y, state: s.burnt ? 'burnt' : 'whole' });
    return out;
  },

  lines(s, ctx, side) {
    if (side !== 'out' || !(ctx.faceSolved(5) || s.burnt)) return [];
    const { points } = beam(s, ctx);
    const out: PuzzleLine[] = [];
    for (let i = 1; i < points.length; i++) out.push({ from: [points[i - 1]!.x, points[i - 1]!.y], to: [points[i]!.x, points[i]!.y], colour: BEAM });
    return out;
  },

  objective(s, ctx, side) {
    if (s.done) return 'The lava has crusted over. The beam still burns in the cave.';
    if (side === 'out') {
      if (s.burnt) return 'The crate is ash, the mirrors are locked. The beam is the safe path: call it from the edge to its source.';
      return ctx.faceSolved(5) ? 'Push the mirrors: bend the beam onto the crate on the edge. RESET puts them back.' : 'Two mirrors, a crate on the edge. The cave waits for light from above.';
    }
    if (s.burnt) return 'Still lava everywhere. Your partner sees the safe way: walk only where they say, to the button.';
    return 'Hot lava, and a button in the middle. Stay on the edge: there is no safe way yet.';
  },
};
