import type { BotAction } from '../actions';
import type { Observation } from '../observe';
import type { Heard, Token } from '../talk';
import type { Cell } from './grid';

// THE PUZZLE SCRIPT INTERFACE: how the AI partner learns one puzzle.
//
// One file per puzzle module id (shared/src/puzzles/<id>), registered in ./index.ts. The
// partner core (../partner.ts) does everything that is not about a puzzle: finding the
// human, the portal, "wait" / "go", safe walking, small talk. When the bot stands on a
// puzzle's face with the human on the same wall, the core asks that puzzle's script what
// to do. A puzzle with no script still works: the bot says it does not know this one,
// keeps off everything it can see on that face, and follows the human.
//
// A script is pure, like the puzzle it plays: no clock of its own (ctx.now), no
// randomness, no networking. It reads ONLY ctx.o (observe(): what its own side can see, in
// its own screen coordinates) and what the human typed (ctx.heard / ctx.tokens). It never
// reads GameState or the puzzle's own state.

export interface ScriptCtx<M> {
  /** What this side sees right now. */
  o: Observation;
  /** The script's own memory. Mutate it. Starts as init() and is reset whenever the bot enters the face. */
  mem: M;
  /** What the human said since the last decision, one entry per chat line, oldest first. */
  heard: readonly Heard[];
  /** All tokens of `heard`, flattened. */
  tokens: readonly Token[];
  /** Did the human say any of these kinds of word? */
  has(...kinds: Token['t'][]): boolean;
  /** Game time in ms. */
  now: number;
  /** The strike counter went up since the last decision. */
  struck: boolean;
  /** Objects of one type that this side sees on this face. */
  objs(type: string): Observation['objects'];
  /**
   * Say one of this script's `lines`. By default a line is said once per visit to the face.
   * `every`: again after this many ms. `force`: now, whatever was said before.
   * Returns whether it was said.
   */
  say(key: string, opts?: { every?: number; force?: boolean }): boolean;
}

/** What a script wants the body to do right now. */
export interface Play {
  /** Where to walk next (re-asked before every step), or null to stand still. */
  action: BotAction | null;
  /** The human depends on the body staying exactly here (a plate, a pane): nothing else may move it. */
  hold?: boolean;
  /** Hazard tiles this action is allowed to enter (its own target). */
  allow?: (Cell | undefined)[];
  /** One line on what it is doing, for the logs and the model. */
  status: string;
}

export interface PuzzleScript<M = unknown> {
  /** The puzzle module's id (shared/src/puzzles), e.g. "glyph-code". */
  id: string;
  /** Every line key this script can say, each starting with "<id>.". The words live in server/src/ai/scripted.ts. */
  lines: readonly string[];
  /** A fresh memory. JSON-serializable. */
  init(): M;
  /**
   * Tiles on this face that no walk may enter while the puzzle is unsolved, from what this
   * side can see: trap floor, sign stones, panes, dark bridges. Asked on every decision
   * made on this face, also when the bot is only passing through.
   */
  hazards?(o: Observation): Cell[];
  /**
   * The bot is on this face, the puzzle is unsolved and the human is on the same wall.
   * Return what to do, or null if this side has nothing to do here (the core then waits
   * with the human). A script is "done" when the face is solved: it is not asked again.
   */
  play(ctx: ScriptCtx<M>): Play | null;
  /**
   * Work this puzzle needs away from its face (carrying something across the cube). Asked
   * on every decision on any face, before the bot follows the human. Null = nothing now.
   */
  errand?(ctx: ScriptCtx<M>): Play | null;
}
