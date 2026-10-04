import { stepPose } from './cube';
import { CANON_UP } from './cube';
import { SPAWN, isSolidTile, loadWorld, objectsOn } from './maps';
import type { MapObject, World } from './maps/types';
import { PUZZLES } from './puzzles';
import type { ItemEvent, PuzzleCtx, PuzzleInitCtx, PuzzleLine, PuzzleModule, VisibleObject } from './puzzles/types';
import { mix } from './puzzles/util';
import { FACES, SIDES, type FaceId, type GameEvent, type GameState, type InteractOnly, type Item, type Side, type TileRef } from './types';

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

/**
 * A fresh game. `seed` is what every puzzle's random content comes from: the server passes
 * real randomness, tests pass a fixed number (the default is derived from `now`).
 */
export function createGame(now: number, env: GameEnv = defaultEnv, seed: number = mix(now)): GameState {
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
  const init: PuzzleInitCtx = { world: env.world, seed, objects: (side: Side, face: FaceId, type?: string) => objectsOn(env.world, side, face, type) };
  const puzzles: Record<string, unknown> = {};
  for (const p of env.puzzles) puzzles[p.id] = p.init(init);
  return { players: { out: player('out'), in: player('in') }, puzzles, items, solved: [], strikes: 0, seed, startedAt: now, wonAt: null };
}

/** The game's seed as a plain number. A hand-built state without one reads as 0. */
export const seedOf = (state: Pick<GameState, 'seed'>): number => state.seed ?? 0;

function makeCtx(state: GameState, env: GameEnv, puzzle: AnyPuzzle, now: number, events: GameEvent[]): PuzzleCtx {
  return {
    world: env.world,
    seed: seedOf(state),
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
    rand: (...keys) => mix(seedOf(state), ...keys),
    faceSolved: (face) => state.solved.includes(face),
    spawnItem: ({ id, kind, side, face, x, y, props }) => {
      if (state.items[id]) throw new Error(`duplicate item id "${id}"`);
      state.items[id] = { id, kind, side, face, x, y, carriedBy: null, placedOn: null, props: { ...props } };
    },
    giveItem: (side, id) => {
      const item = state.items[id];
      const player = state.players[side];
      if (!item || (player.carrying !== null && player.carrying !== id)) return false;
      for (const s of SIDES) if (state.players[s].carrying === id) state.players[s].carrying = null;
      Object.assign(item, { side, carriedBy: side, placedOn: null });
      player.carrying = id;
      return true;
    },
    removeItem: (id) => {
      for (const s of SIDES) if (state.players[s].carrying === id) state.players[s].carrying = null;
      delete state.items[id];
    },
  };
}

/** Every puzzle is solved: the portal (if the world has one) is awake. */
export function portalOpen(state: GameState, env: GameEnv = defaultEnv): boolean {
  return env.puzzles.every((p) => state.solved.includes(p.face));
}

/** The face the portal is on, or null: without a portal the game is won on the last solve. */
export const portalFace = (env: GameEnv = defaultEnv): FaceId | null => FACES.find((face) => SIDES.some((side) => objectsOn(env.world, side, face, 'portal').length > 0)) ?? null;

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
  // No portal in the world: the last solve wins. With one, both players have to stand on it.
  const arrived = portalFace(env) !== null
    ? state.players.out.pose.face === state.players.in.pose.face && onPortal(state, env, 'out') && onPortal(state, env, 'in')
    : env.puzzles.length > 0;
  if (state.wonAt === null && portalOpen(state, env) && arrived) {
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

  // Pushing: only within a face. A puzzle may move its box out of the way first.
  if (!crossed) {
    let pushed = false;
    for (const p of env.puzzles) {
      if (p.face === to.face && p.onPush?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, toTile, to.x - from.x, to.y - from.y)) pushed = true;
    }
    if (pushed) events.push({ type: 'push', side });
  }

  if (isBlocked(state, side, toTile, env, now)) {
    player.pose = { ...from, dir: to.dir };
    events.push({ type: 'bump', side });
    if (events.length > 1) settle(state, env, now, events); // something was pushed
    return events;
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

/**
 * E key, in this order: drop the carried item on this tile; else pick up the item lying on
 * it; else "use" the tile (the onUse hook of the puzzle on this face, with a `use` event).
 * `only` narrows it: 'drop' (Q key) never picks up, 'pick' never drops, and neither uses.
 */
export function applyInteract(state: GameState, side: Side, now: number = Date.now(), env: GameEnv = defaultEnv, only?: InteractOnly): GameEvent[] {
  if (state.wonAt !== null) return [];
  const events: GameEvent[] = [];
  const player = state.players[side];
  if (only === 'drop' && !player.carrying) return [];
  if (only === 'pick' && player.carrying) return [];
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
  } else if (!lying || lying.placedOn) {
    const users = env.puzzles.filter((p) => p.face === face && p.onUse);
    if (only || users.length === 0) return [];
    events.push({ type: 'use', side });
    for (const p of users) p.onUse!(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, tile);
  } else {
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

/** The lines (beams) `side` sees over `face`, from the face's puzzle. Canonical tile centres. */
export function linesOn(state: GameState, side: Side, face: FaceId, env: GameEnv = defaultEnv): PuzzleLine[] {
  return env.puzzles.flatMap((p) => (p.face === face && p.lines ? p.lines(state.puzzles[p.id], makeCtx(state, env, p, 0, []), side) : []));
}

/** Is the inside of `face` drawn fully lit? (its puzzle is `bright`) */
export const brightFace = (face: FaceId, env: GameEnv = defaultEnv): boolean => env.puzzles.some((p) => p.face === face && !!p.bright);

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

// ---------- DEV ONLY ----------
// Engine-level cheats for the dev tools (client/src/dev, the server's `dev` socket message
// behind DEV_COMMANDS=1). Never call these from game code, puzzles or the AI.

/**
 * DEV ONLY. Force-latch the puzzle on `face` as solved, whatever the puzzle itself thinks.
 * The puzzle's own state is not touched (a door it controls stays as it was).
 */
export function devSolve(state: GameState, face: FaceId, now: number = Date.now(), env: GameEnv = defaultEnv): GameEvent[] {
  const puzzle = env.puzzles.find((p) => p.face === face);
  if (state.wonAt !== null || !puzzle || state.solved.includes(face)) return [];
  state.solved.push(face);
  state.solved.sort();
  const events: GameEvent[] = [{ type: 'solve', face, puzzle: puzzle.id }];
  settle(state, env, now, events);
  return events;
}

/**
 * DEV ONLY. Put `side` on `face` with the face's canonical up, on the free tile nearest the
 * spawn point. The puzzles see it as stepping off the old tile and onto the new one.
 */
export function devTeleport(state: GameState, side: Side, face: FaceId, now: number = Date.now(), env: GameEnv = defaultEnv): GameEvent[] {
  if (state.wonAt !== null) return [];
  const player = state.players[side];
  const from = player.pose;
  const spawn = SPAWN[side];
  const tiles: TileRef[] = [];
  env.world[side][face].tiles.forEach((row, y) => row.forEach((_, x) => tiles.push({ face, x, y })));
  const far = (t: TileRef) => Math.abs(t.x - spawn.x) + Math.abs(t.y - spawn.y);
  const to = tiles.sort((a, b) => far(a) - far(b)).find((t) => !isBlocked(state, side, t, env, now));
  if (!to) return [];
  const events: GameEvent[] = [];
  const fromTile: TileRef = { face: from.face, x: from.x, y: from.y };
  player.pose = { side, face, up: CANON_UP[face], x: to.x, y: to.y, dir: from.dir };
  for (const p of env.puzzles) if (p.face === from.face) p.onLeave?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, fromTile);
  for (const p of env.puzzles) if (p.face === face) p.onEnter?.(state.puzzles[p.id], makeCtx(state, env, p, now, events), side, to);
  settle(state, env, now, events);
  return events;
}
