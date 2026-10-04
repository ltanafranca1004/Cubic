import type { MapObject, World } from '../maps/types';
import type { FaceId, GameState, Item, Pose, Side, TileRef } from '../types';

// THE PUZZLE MODULE INTERFACE.
// A puzzle is a plain object implementing PuzzleModule. It owns one face (both sides of
// it) and a small JSON-serializable state. The engine (shared/src/game.ts) calls the hooks;
// modules never touch networking, sockets, the DOM or timers. The same module code runs on
// the server (authoritative) and on the client (move prediction).

/** Something a side can see on the puzzle's face. The client picks art by type + state. */
export interface VisibleObject {
  type: string;
  x: number;
  y: number;
  /** Art variant, e.g. "open" | "closed". Omit for the default look. */
  state?: string;
}

/**
 * Something happened to a carryable item.
 *  - picked: `side` picked it up from `tile`
 *  - dropped: `side` put it down on `tile`
 *  - placed: `side` dropped it on `target` (a map object of type "target" that accepts it)
 */
export interface ItemEvent {
  kind: 'picked' | 'dropped' | 'placed';
  side: Side;
  item: Readonly<Item>;
  tile: TileRef;
  target?: MapObject;
}

/** Read-only helpers available while creating the initial state. */
/** A straight line drawn over a face (a laser beam), between canonical tile centres. */
export interface PuzzleLine {
  from: [x: number, y: number];
  to: [x: number, y: number];
  /** CSS colour, e.g. "#ff4040". */
  colour: string;
}

/** A new carryable item for ctx.spawnItem. */
export interface ItemSpawn {
  id: string;
  kind: string;
  side: Side;
  face: FaceId;
  x: number;
  y: number;
  props?: Item['props'];
}

export interface PuzzleInitCtx {
  readonly world: World;
  /** The game's seed (GameState.seed). Mix your random content from it: `mix(ctx.seed, ...)`. */
  readonly seed: number;
  /** Map objects on one side of a face, optionally by type. */
  objects(side: Side, face: FaceId, type?: string): MapObject[];
}

/** Passed to every hook. Mutate your own state object `s`; use these helpers for the rest. */
export interface PuzzleCtx extends PuzzleInitCtx {
  /** Whole game, read only. Use the helpers below to change anything outside your state. */
  readonly state: Readonly<GameState>;
  /** True once this puzzle's face is solved (latched by the engine). */
  readonly solved: boolean;
  /** Epoch ms of the move or tick being processed. */
  readonly now: number;
  player(side: Side): Readonly<Pose>;
  /** A carryable item by id (undefined if the map has none with that id). */
  item(id: string): Readonly<Item> | undefined;
  /** Is that side's player standing on this tile right now? */
  isOn(side: Side, tile: TileRef): boolean;
  /** Fire a custom event (sound / effect hook on the client), e.g. emit('door-open'). */
  emit(name: string, data?: Record<string, string | number | boolean>): void;
  /** Add a strike caused by `side`. */
  strike(side: Side): void;
  /** Put a player on another tile of the face they are on (e.g. back to the start). */
  teleport(side: Side, x: number, y: number): void;
  /**
   * The puzzles' only randomness: a 32-bit unsigned integer mixed from the game's seed and
   * `keys` (`mix(seed, ...keys)`). Same keys = same number, on the server and both clients.
   * e.g. `ctx.rand(this.face, i) % 10` for the i-th digit.
   */
  rand(...keys: number[]): number;
  /** Is the puzzle on `face` solved (latched)? For chains: face 4 waits for face 6. */
  faceSolved(face: FaceId): boolean;
  /** Add a carryable item lying on a tile. Throws if the id is already in use. */
  spawnItem(item: ItemSpawn): void;
  /**
   * Put item `id` in `side`'s hands, wherever it is, even if it was just placed on a target
   * (clears placedOn). False (and nothing changes) if there is no such item or that player
   * already carries a different one.
   */
  giveItem(side: Side, id: string): boolean;
  /** Delete an item for good (also out of the hands of whoever carries it). */
  removeItem(id: string): void;
}

export interface PuzzleModule<S = unknown> {
  /** Unique id, also the key of this puzzle's state in GameState.puzzles. */
  id: string;
  /** The face this puzzle lives on. Hooks only fire for tiles on this face. */
  face: FaceId;

  /** Initial state. Must be JSON-serializable (no classes, Maps, Sets, functions). */
  init(ctx: PuzzleInitCtx): S;

  /** Extra blocking on top of solid terrain: return true to stop `side` entering `tile`. */
  isBlocked?(s: S, ctx: PuzzleCtx, side: Side, tile: TileRef): boolean;

  /** `side` just stepped onto `tile`. */
  onEnter?(s: S, ctx: PuzzleCtx, side: Side, tile: TileRef): void;

  /** `side` just stepped off `tile` (also fires when they walk off the face). */
  onLeave?(s: S, ctx: PuzzleCtx, side: Side, tile: TileRef): void;

  /**
   * `side` pressed E on `tile` (where they stand, on this face) with empty hands and no
   * item to pick up there. This is how keys, buttons and flip tiles are pressed.
   */
  onUse?(s: S, ctx: PuzzleCtx, side: Side, tile: TileRef): void;

  /**
   * `side` is trying to step onto `tile` of this face from the tile next to it on the SAME
   * face (never across an edge). dx, dy is the canonical step (tile minus where they stand).
   * Called before the block check: move your box and return true, and the engine emits
   * `push` and then checks isBlocked again. Return false when nothing moved.
   */
  onPush?(s: S, ctx: PuzzleCtx, side: Side, tile: TileRef, dx: number, dy: number): boolean;

  /**
   * A carryable item was picked up, dropped or placed on a target. Unlike the tile hooks
   * this fires for EVERY face, because items travel across the cube.
   */
  onItem?(s: S, ctx: PuzzleCtx, ev: ItemEvent): void;

  /** Server clock, every TICK_MS. For timers and moving things. Not predicted by clients. */
  onTick?(s: S, ctx: PuzzleCtx, dtMs: number): void;

  /** Checked after every move and tick. The first true latches the face as solved. */
  isSolved(s: S, ctx: PuzzleCtx): boolean;

  /**
   * PER-SIDE VISIBILITY. What `side` can see of this puzzle on its face.
   * Return an entry to override or add to the map objects that side has on this face
   * (same x,y replaces the map object). Anything you do not return for a side stays
   * invisible to it, and never reaches the AI partner playing that side.
   */
  visible?(s: S, ctx: PuzzleCtx, side: Side): VisibleObject[];

  /** One line of objective text for `side` while on this face. */
  objective?(s: S, ctx: PuzzleCtx, side: Side): string;

  /** Lines `side` sees over this face (beams), drawn after the objects. Canonical tile centres. */
  lines?(s: S, ctx: PuzzleCtx, side: Side): PuzzleLine[];

  /** The INSIDE of this face is drawn fully lit (no darkness around the player). */
  bright?: boolean;
}

/** How often the server calls onTick. */
export const TICK_MS = 250;
