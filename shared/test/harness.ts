import assert from 'node:assert/strict';
import {
  TICK_MS,
  applyInteract,
  applyMove,
  defaultEnv,
  needsTick,
  objectsOn,
  pathTo,
  tick,
  type FaceId,
  type GameEnv,
  type GameEvent,
  type GameState,
  type PuzzleCtx,
  type PuzzleInitCtx,
  type PuzzleModule,
  type Side,
  type TileRef,
} from '../src/index';
import { mix } from '../src/puzzles/util';

// Shared helpers for the puzzle smoke tests (puzzles.test.ts, world.test.ts).
// Not a test file itself: `npm test` only runs test/*.test.ts.
// Guide for puzzle authors: /docs/puzzle-tests.md.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPuzzle = PuzzleModule<any>;

/**
 * Game time one step takes. The server lets a player move about once per 90 ms, so this is
 * a fast human. Timed puzzles are solved against this clock, not in zero time.
 */
export const STEP_MS = 100;

/**
 * What a solution script gets. Everything goes through the real engine (applyMove,
 * applyInteract, tick), exactly like a player's key presses: a script cannot teleport or
 * write puzzle state.
 */
export interface Solver {
  /** The game being played. Read it, never write it. */
  readonly state: Readonly<GameState>;
  readonly env: GameEnv;
  /** Every event since the solver was created. */
  readonly events: GameEvent[];
  /** Walk `side` to a tile by the shortest legal path. Fails the test if there is none. */
  go(side: Side, target: TileRef): GameEvent[];
  /** One step in `side`'s own screen space (dx, dy: one of them is -1 or 1). */
  move(side: Side, dx: number, dy: number): GameEvent[];
  /** The E key: drop / place the carried item, pick up the one on this tile, or use the tile. */
  interact(side: Side): GameEvent[];
  /** Let time pass (runs the server tick every TICK_MS). */
  wait(ms: number): GameEvent[];
  /** Tile of a map object. Fails the test if the map has none. `name` narrows it down. */
  find(side: Side, face: FaceId, type: string, name?: string): TileRef;
  /** Tile an item is lying on right now. Fails the test if it is missing or being carried. */
  item(id: string): TileRef;
}

/** Plays `puzzleId` from wherever the players are. See /docs/puzzle-tests.md. */
export type SolutionScript = (t: Solver) => void;

export function solver(state: GameState, env: GameEnv = defaultEnv, startAt = 1000): Solver {
  const events: GameEvent[] = [];
  const ticking = needsTick(env);
  let now = startAt;
  let sinceTick = 0;

  /** Move the clock forward, firing the server tick on every TICK_MS boundary. */
  const advance = (ms: number): GameEvent[] => {
    const out: GameEvent[] = [];
    for (let left = ms; left > 0; ) {
      const slice = Math.min(left, TICK_MS - sinceTick);
      now += slice;
      sinceTick += slice;
      left -= slice;
      if (sinceTick === TICK_MS) {
        sinceTick = 0;
        if (ticking) out.push(...tick(state, TICK_MS, now, env));
      }
    }
    return out;
  };
  const record = (evs: GameEvent[]) => {
    events.push(...evs);
    return evs;
  };

  const t: Solver = {
    state,
    env,
    events,
    move: (side, dx, dy) => record([...advance(STEP_MS), ...applyMove(state, side, dx, dy, now, env)]),
    interact: (side) => record([...advance(STEP_MS), ...applyInteract(state, side, now, env)]),
    wait: (ms) => record(advance(ms)),
    go(side, target) {
      const where = `face ${target.face} ${target.x},${target.y}`;
      const path = pathTo(state, side, target, env);
      assert.ok(path, `no path for ${side} to ${where}`);
      const out: GameEvent[] = [];
      for (const [dx, dy] of path) {
        if (state.wonAt !== null) return out; // the game is over
        const evs = t.move(side, dx, dy);
        assert.ok(!evs.some((e) => e.type === 'bump' && e.side === side), `${side} was blocked on the way to ${where}`);
        out.push(...evs);
      }
      const p = state.players[side].pose;
      assert.deepEqual([p.face, p.x, p.y], [target.face, target.x, target.y], `${side} did not arrive at ${where}`);
      return out;
    },
    find(side, face, type, name) {
      const o = objectsOn(env.world, side, face, type).find((x) => name === undefined || x.name === name);
      assert.ok(o, `no "${type}"${name === undefined ? '' : ` named "${name}"`} on ${side} face ${face}`);
      return { face, x: o.x, y: o.y };
    },
    item(id) {
      const item = state.items[id];
      assert.ok(item, `no item with id "${id}" (items: ${Object.keys(state.items).join(', ') || 'none'})`);
      assert.equal(item.carriedBy, null, `item "${id}" is being carried, it is not on a tile`);
      return { face: item.face, x: item.x, y: item.y };
    },
  };
  return t;
}

/** A read-only PuzzleCtx, for calling a module's isSolved() directly from a test. */
export function puzzleCtx(state: GameState, env: GameEnv, puzzle: AnyPuzzle, now = 0): PuzzleCtx {
  const readOnly = (what: string) => () => assert.fail(`${puzzle.id}: isSolved() must not call ctx.${what}()`);
  return {
    world: env.world,
    seed: state.seed,
    state,
    now,
    solved: state.solved.includes(puzzle.face),
    objects: (side, face, type) => objectsOn(env.world, side, face, type),
    player: (side) => state.players[side].pose,
    item: (id) => state.items[id],
    isOn: (side, tile) => {
      const p = state.players[side].pose;
      return p.face === tile.face && p.x === tile.x && p.y === tile.y;
    },
    emit: readOnly('emit'),
    strike: readOnly('strike'),
    teleport: readOnly('teleport'),
    rand: (...keys) => mix(state.seed, ...keys),
    faceSolved: (face) => state.solved.includes(face),
    spawnItem: readOnly('spawnItem'),
    giveItem: readOnly('giveItem'),
    removeItem: readOnly('removeItem'),
  };
}

/** The module's own verdict, asked directly (not the engine's latch). */
export const isSolvedNow = (state: GameState, env: GameEnv, puzzle: AnyPuzzle) => puzzle.isSolved(state.puzzles[puzzle.id], puzzleCtx(state, env, puzzle));

/**
 * The same env, with every puzzle wrapped so its map lookups are recorded:
 * ctx.objects(side, face, type) and ctx.item(id). `missing` collects the lookups that found
 * nothing, i.e. a puzzle asking for something the maps do not have.
 */
export function recordingEnv(base: GameEnv): { env: GameEnv; missing: Set<string>; found: Set<string> } {
  const missing = new Set<string>();
  const found = new Set<string>();
  const note = (puzzle: string, what: string, ok: boolean) => (ok ? found : missing).add(`${puzzle}: ${what}`);

  const wrap = (p: AnyPuzzle): AnyPuzzle => {
    const spy = <C extends PuzzleInitCtx>(ctx: C): C => {
      // Inherit from the real ctx so its getters (solved) stay live.
      const spied = Object.create(ctx) as C;
      spied.objects = (side, face, type) => {
        const res = ctx.objects(side, face, type);
        if (type !== undefined) note(p.id, `ctx.objects('${side}', ${face}, '${type}')`, res.length > 0);
        return res;
      };
      if ('item' in ctx) {
        const real = ctx as unknown as PuzzleCtx;
        (spied as unknown as PuzzleCtx).item = (id) => {
          const res = real.item(id);
          note(p.id, `ctx.item('${id}')`, res !== undefined);
          return res;
        };
      }
      return spied;
    };
    return {
      id: p.id,
      face: p.face,
      init: (ctx) => p.init(spy(ctx)),
      isSolved: (s, ctx) => p.isSolved(s, spy(ctx)),
      ...(p.isBlocked ? { isBlocked: (s, ctx, side, tile) => p.isBlocked!(s, spy(ctx), side, tile) } : {}),
      ...(p.onEnter ? { onEnter: (s, ctx, side, tile) => p.onEnter!(s, spy(ctx), side, tile) } : {}),
      ...(p.onLeave ? { onLeave: (s, ctx, side, tile) => p.onLeave!(s, spy(ctx), side, tile) } : {}),
      ...(p.onItem ? { onItem: (s, ctx, ev) => p.onItem!(s, spy(ctx), ev) } : {}),
      ...(p.onTick ? { onTick: (s, ctx, dt) => p.onTick!(s, spy(ctx), dt) } : {}),
      ...(p.visible ? { visible: (s, ctx, side) => p.visible!(s, spy(ctx), side) } : {}),
      ...(p.onUse ? { onUse: (s, ctx, side, tile) => p.onUse!(s, spy(ctx), side, tile) } : {}),
      ...(p.onPush ? { onPush: (s, ctx, side, tile, dx, dy) => p.onPush!(s, spy(ctx), side, tile, dx, dy) } : {}),
      ...(p.lines ? { lines: (s, ctx, side) => p.lines!(s, spy(ctx), side) } : {}),
      ...(p.bright ? { bright: true } : {}),
      ...(p.objective ? { objective: (s, ctx, side) => p.objective!(s, spy(ctx), side) } : {}),
    } satisfies AnyPuzzle;
  };
  return { env: { world: base.world, puzzles: base.puzzles.map(wrap) }, missing, found };
}
