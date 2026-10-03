import { stepPose } from './cube';
import { CANON_UP } from './cube';
import { SPAWN, isSolidTile, loadWorld, objectsOn } from './maps';
import type { MapObject, World } from './maps/types';
import { PUZZLES } from './puzzles';
import type { ItemEvent, PuzzleCtx, PuzzleModule, VisibleObject } from './puzzles/types';
import { FACES, SIDES, type FaceId, type GameEvent, type GameState, type Item, type Side, type TileRef } from './types';

// The game engine: pure functions over GameState. The server runs them as the truth, the
// client runs the same code to predict its own moves.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPuzzle = PuzzleModule<any>;

/** Maps + puzzles a game runs on. Tests build their own; the game uses `defaultEnv`. */
export interface GameEnv {
  world: World;
  puzzles: AnyPuzzle[];
}

export const defaultEnv: GameEnv = { world: loadWorld(), puzzles: PUZZLES };

const objectId = (o: MapObject, side: Side, face: FaceId) => o.name || `${side}${face}-${o.x}-${o.y}`;

export function createGame(now: number, env: GameEnv = defaultEnv): GameState {
  const items: Record<string, Item> = {};
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const o of objectsOn(env.world, side, face, 'item')) {
        const id = objectId(o, side, face);
        if (items[id]) throw new Error(`duplicate item id "${id}"`);
        items[id] = { id, kind: String(o.props.kind ?? 'item'), side, face, x: o.x, y: o.y, carriedBy: null, placedOn: null, props: { ...o.props } };
      }
    }
  }
  const player = (side: Side) => ({
    side,
    pose: { side, face: 1 as FaceId, up: CANON_UP[1], x: SPAWN[side].x, y: SPAWN[side].y, dir: 1 as const },
    connected: false,
    isAI: false,
    steps: 0,
    carrying: null,
  });
  const init = { world: env.world, objects: (side: Side, face: FaceId, type?: string) => objectsOn(env.world, side, face, type) };
  const puzzles: Record<string, unknown> = {};
  for (const p of env.puzzles) puzzles[p.id] = p.init(init);
  return { players: { out: player('out'), in: player('in') }, puzzles, items, solved: [], strikes: 0, startedAt: now, wonAt: null };
}

function makeCtx(state: GameState, env: GameEnv, puzzle: AnyPuzzle, now: number, events: GameEvent[]): PuzzleCtx {
  return {
    world: env.world,
    state,
    now,
    get solved() {
      return state.solved.includes(puzzle.face);
    },
    objects: (side, face, type) => objectsOn(env.world, side, face, type),
    player: (side) => state.players[side].pose,
    item: (id) => state.items[id],
    isOn: (side, tile) => {
      const p = state.players[side].pose;
      return p.face === tile.face && p.x === tile.x && p.y === tile.y;
    },
    emit: (name, data) => events.push({ type: 'puzzle', puzzle: puzzle.id, name, ...(data ? { data } : {}) }),
    strike: (side) => {
      state.strikes++;
      events.push({ type: 'strike', side });
    },
    teleport: (side, x, y) => {
      const pose = state.players[side].pose;
      state.players[side].pose = { ...pose, x, y };
    },
  };
}

/** Every puzzle is solved: the portal is awake. */
export function portalOpen(state: GameState, env: GameEnv = defaultEnv): boolean {
  return env.puzzles.every((p) => state.solved.includes(p.face));
}

const onPortal = (state: GameState, env: GameEnv, side: Side) => {
  const p = state.players[side].pose;
  return objectsOn(env.world, side, p.face, 'portal').some((o) => o.x === p.x && o.y === p.y);
};

/** Latch newly solved puzzles and check the win. Runs after every move, interact and tick. */
function settle(state: GameState, env: GameEnv, now: number, events: GameEvent[]): void {
  for (const p of env.puzzles) {
    if (state.solved.includes(p.face)) continue;
    if (p.isSolved(state.puzzles[p.id], makeCtx(state, env, p, now, events))) {
      state.solved.push(p.face);
      state.solved.sort();
      events.push({ type: 'solve', face: p.face, puzzle: p.id });
    }
  }
  if (state.wonAt === null && portalOpen(state, env) && state.players.out.pose.face === state.players.in.pose.face && onPortal(state, env, 'out') && onPortal(state, env, 'in')) {
    state.wonAt = now;
    events.push({ type: 'win' });
  }
}

/** Can `side` stand on this tile right now? (terrain + puzzle blockers) */
export function isBlocked(state: GameState, side: Side, tile: TileRef, env: GameEnv = defaultEnv, now = 0): boolean {
  if (isSolidTile(env.world, side, tile.face, tile.x, tile.y)) return true;
  return env.puzzles.some((p) => p.face === tile.face && p.isBlocked?.(state.puzzles[p.id], makeCtx(state, env, p, now, []), side, tile));
}

/**
 * Move `side` one tile in THEIR screen space. Mutates `state`, returns what happened.
 * dx,dy: exactly one of them is -1 or 1; anything else is ignored.
 */
export function applyMove(state: GameState, side: Side, dx: number, dy: number, now: number = Date.now(), env: GameEnv = defaultEnv): GameEvent[] {
  if (state.wonAt !== null) return [];
  if (!((Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1))) return [];
  const events: GameEvent[] = [];
  const player = state.players[side];
  const from = player.pose;
  const { pose: to, crossed } = stepPose(from, dx, dy);
  const fromTile: TileRef = { face: from.face, x: from.x, y: from.y };
  const toTile: TileRef = { face: to.face, x: to.x, y: to.y };

  if (isBlocked(state, side, toTile, env, now)) {
    player.pose = { ...from, dir: to.dir };
    return [{ type: 'bump', side }];
  }

  player.pose = to;
  player.steps++;
  events.push(crossed ? { type: 'flip', side, from: from.face, to: to.face, dx, dy } : { type: 'step', side });
  for (const p of env.puzzles) if (p.face === from.face) p.onLeave?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, fromTile);
  for (const p of env.puzzles) if (p.face === to.face) p.onEnter?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, toTile);
  settle(state, env, now, events);
  return events;
}

const accepts = (target: MapObject, item: Item) => {
  const want = target.props.accepts;
  return want === undefined || want === '' || want === item.id || want === item.kind;
};

/** E key: drop the carried item on this tile, or pick up the item lying on it. */
export function applyInteract(state: GameState, side: Side, now: number = Date.now(), env: GameEnv = defaultEnv): GameEvent[] {
  if (state.wonAt !== null) return [];
  const events: GameEvent[] = [];
  const player = state.players[side];
  const { face, x, y } = player.pose;
  const tile: TileRef = { face, x, y };
  const lying = Object.values(state.items).find((i) => !i.carriedBy && i.side === side && i.face === face && i.x === x && i.y === y);
  const fire = (ev: ItemEvent) => {
    for (const p of env.puzzles) p.onItem?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), ev);
  };

  if (player.carrying) {
    const item = state.items[player.carrying]!;
    if (lying) return [{ type: 'bump', side }]; // tile already holds an item
    Object.assign(item, { side, face, x, y, carriedBy: null });
    player.carrying = null;
    const target = objectsOn(env.world, side, face, 'target').find((t) => t.x === x && t.y === y);
    if (target && accepts(target, item)) {
      item.placedOn = objectId(target, side, face);
      events.push({ type: 'place', side, item: item.id, target: item.placedOn });
      fire({ kind: 'placed', side, item, tile, target });
    } else {
      events.push({ type: 'drop', side, item: item.id });
      fire({ kind: 'dropped', side, item, tile });
    }
  } else {
    if (!lying || lying.placedOn) return [];
    lying.carriedBy = side;
    player.carrying = lying.id;
    events.push({ type: 'pickup', side, item: lying.id });
    fire({ kind: 'picked', side, item: lying, tile });
  }
  settle(state, env, now, events);
  return events;
}

/** Server clock: runs every puzzle's onTick. */
export function tick(state: GameState, dtMs: number, now: number = Date.now(), env: GameEnv = defaultEnv): GameEvent[] {
  if (state.wonAt !== null) return [];
  const events: GameEvent[] = [];
  for (const p of env.puzzles) p.onTick?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), dtMs);
  settle(state, env, now, events);
  return events;
}

/** Does any puzzle need the server clock? */
export const needsTick = (env: GameEnv = defaultEnv) => env.puzzles.some((p) => !!p.onTick);

/**
 * What `side` can see on `face`, apart from terrain, players and loose items: its own map
 * objects, overridden/extended by what the face's puzzle shows that side.
 */
export function visibleObjects(state: GameState, side: Side, face: FaceId, env: GameEnv = defaultEnv): VisibleObject[] {
  const byTile = new Map<string, VisibleObject>();
  const open = portalOpen(state, env);
  for (const o of objectsOn(env.world, side, face)) {
    if (o.type === 'item') continue;
    const state_ = o.type === 'portal' ? (open ? 'open' : 'closed') : undefined;
    byTile.set(`${o.x},${o.y}`, { type: o.type, x: o.x, y: o.y, ...(state_ ? { state: state_ } : {}) });
  }
  for (const p of env.puzzles) {
    if (p.face !== face || !p.visible) continue;
    for (const v of p.visible(state.puzzles[p.id], makeCtx(state, env, p, 0, []), side)) byTile.set(`${v.x},${v.y}`, v);
  }
  return [...byTile.values()];
}

/** Items lying on one side of a face (not the carried ones). */
export function itemsOn(state: GameState, side: Side, face: FaceId): Item[] {
  return Object.values(state.items).filter((i) => !i.carriedBy && i.side === side && i.face === face);
}

/** Objective line for `side` on the face they are on. */
export function objectiveFor(state: GameState, side: Side, env: GameEnv = defaultEnv): string {
  const face = state.players[side].pose.face;
  const total = env.puzzles.length;
  const puzzle = env.puzzles.find((p) => p.face === face);
  const pending = puzzle && !state.solved.includes(face);
  const own = pending ? (puzzle.objective?.(state.puzzles[puzzle.id], makeCtx(state, env, puzzle, 0, []), side) ?? '') : '';
  if (objectsOn(env.world, side, face, 'portal').length > 0) {
    if (portalOpen(state, env)) return 'The portal is awake. Both of you, step into it.';
    return `A portal sleeps here. It wakes once every puzzle is solved (${state.solved.length} of ${total}). ${own}`.trim();
  }
  if (!puzzle) return 'Nothing to solve here. Keep walking.';
  if (!pending) return `Face ${face} is open. Head somewhere else.`;
  return own;
}
