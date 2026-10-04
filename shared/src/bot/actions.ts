import { screenToCanon, stepPose } from '../cube';
import { defaultEnv, itemsOn, visibleObjects, type GameEnv } from '../game';
import { FACE_SIZE, type FaceId, type GameState, type Pose, type Side } from '../types';
import { findPath, type Move } from './path';

// The AI's body: high-level actions turned into ordinary steps. The server walks them one
// at a time through applyMove / applyInteract, so the AI cannot teleport or cheat.

export type BotAction =
  /** Walk to a tile of the current face, in your own screen coords. */
  | { type: 'goto'; col: number; row: number }
  /** Walk to another face (1-6) by the shortest route. */
  | { type: 'go_face'; face: number }
  /** Walk onto the nearest visible object or item of this type/kind on your face ("crystal", "key", "battery", ...). */
  | { type: 'step_on'; object: string }
  /** Walk in a straight line in your screen space. */
  | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; steps?: number }
  /** Pick up the item you are standing on. */
  | { type: 'pick_up' }
  /** Put down the item you carry (on a pot/target it gets placed). */
  | { type: 'drop' }
  /**
   * Press E with empty hands (a key, a button, a flip tile, RESET): the puzzle's onUse hook.
   * With a tile (col, row: your own screen coords) or an object type (the nearest one you
   * see on your face; `state` narrows it, e.g. object "key", state "7"): walk there first,
   * then press. With neither: press where you stand. ONE press per plan: an action that is
   * re-planned after the press presses again, so the caller decides when it is done.
   */
  | { type: 'use'; col?: number; row?: number; object?: string; state?: string }
  /** Stay where you are. */
  | { type: 'wait' };

export const BOT_ACTION_TYPES = ['goto', 'go_face', 'step_on', 'move', 'pick_up', 'drop', 'use', 'wait'] as const;

/** One thing the body does next: a step, or E. */
export type BotStep = Move | 'interact';

const DIRS: Record<string, Move> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const MAX_LINE = FACE_SIZE * 2;

/** Check an action that came from outside (the model). Returns null if it is not usable. */
export function parseAction(raw: unknown): BotAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  // Arguments may come flat or nested under "args".
  const args = (a.args && typeof a.args === 'object' ? a.args : a) as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null);
  switch (a.type) {
    case 'goto': {
      const col = int(args.col);
      const row = int(args.row);
      return col !== null && row !== null && col >= 0 && col < FACE_SIZE && row >= 0 && row < FACE_SIZE ? { type: 'goto', col, row } : null;
    }
    case 'go_face': {
      const face = int(args.face);
      return face !== null && face >= 1 && face <= 6 ? { type: 'go_face', face } : null;
    }
    case 'step_on':
      return typeof args.object === 'string' && args.object.length > 0 && args.object.length < 40 ? { type: 'step_on', object: args.object.toLowerCase() } : null;
    case 'move': {
      if (typeof args.dir !== 'string' || !DIRS[args.dir]) return null;
      const steps = int(args.steps) ?? 1;
      return { type: 'move', dir: args.dir as 'up', steps: Math.min(MAX_LINE, Math.max(1, steps)) };
    }
    case 'use': {
      const col = int(args.col);
      const row = int(args.row);
      const inFace = (n: number) => n >= 0 && n < FACE_SIZE;
      if (col !== null && row !== null) return inFace(col) && inFace(row) ? { type: 'use', col, row } : null;
      if (args.object == null) return { type: 'use' };
      if (typeof args.object !== 'string' || args.object.length === 0 || args.object.length >= 40) return null;
      return { type: 'use', object: args.object.toLowerCase(), ...(typeof args.state === 'string' && args.state.length < 40 ? { state: args.state } : {}) };
    }
    case 'pick_up':
    case 'drop':
    case 'wait':
      return { type: a.type };
    default:
      return null;
  }
}

/** Why the leash refused a walk. The brain reads it as the action's result. */
export const LEASH_ERROR = 'that is more than one face away from your partner. Stay within earshot of them';

/**
 * Turn an action into steps from the current state, or explain why it cannot be done.
 * `leash` says which faces the body may walk onto (see leashAllows): a planned walk never
 * leaves them, and an action with no way around is refused.
 */
export function planAction(
  state: GameState,
  side: Side,
  action: BotAction,
  env: GameEnv = defaultEnv,
  leash?: (face: FaceId) => boolean,
  /** Tiles of the CURRENT face (the walker's own screen coords) that no step may enter. */
  avoidTiles: readonly { col: number; row: number }[] = [],
  /** Poses on ANY face that no step may enter (findPath's `avoid`), e.g. hazardAvoid() in ./path. */
  avoidPose?: (pose: Pose) => boolean,
): { steps: BotStep[] } | { error: string } {
  const pose = state.players[side].pose;
  const banned = new Set(avoidTiles.map((t) => screenToCanon(side, pose.face, pose.up, t.col, t.row).join(',')));
  const avoid = banned.size || avoidPose ? (p: Pose) => (p.face === pose.face && banned.has(`${p.x},${p.y}`)) || !!avoidPose?.(p) : undefined;
  /** Shortest walk inside the leash. If only the leash is in the way, say so. */
  const walk = (goal: (p: Pose) => boolean, error: string): { steps: BotStep[]; error?: undefined } | { error: string; steps?: undefined } => {
    const path = findPath(state, side, goal, env, leash, avoid);
    if (path) return { steps: path };
    return { error: leash && findPath(state, side, goal, env, undefined, avoid) ? LEASH_ERROR : error };
  };
  switch (action.type) {
    case 'wait':
      return { steps: [] };
    case 'pick_up':
      if (state.players[side].carrying) return { error: 'already carrying something' };
      if (!itemsOn(state, side, pose.face).some((i) => i.x === pose.x && i.y === pose.y && !i.placedOn)) return { error: 'there is no item on this tile' };
      return { steps: ['interact'] };
    case 'drop':
      if (!state.players[side].carrying) return { error: 'not carrying anything' };
      return { steps: ['interact'] };
    case 'move': {
      const steps = Array<Move>(action.steps ?? 1).fill(DIRS[action.dir]!);
      // A straight line can run over an edge: follow it, and refuse it at the leash.
      let at = pose;
      for (const [dx, dy] of steps) {
        const to = stepPose(at, dx, dy).pose;
        if (leash && to.face !== at.face && !leash(to.face)) return { error: LEASH_ERROR };
        if (avoid?.(to)) return { error: 'that walk crosses a tile that is not safe right now' };
        at = to;
      }
      return { steps };
    }
    case 'goto': {
      const [x, y] = screenToCanon(side, pose.face, pose.up, action.col, action.row);
      return walk((p) => p.face === pose.face && p.x === x && p.y === y, 'no way to reach that tile right now');
    }
    case 'go_face':
      return walk((p) => p.face === action.face, 'no way to reach that face right now');
    case 'step_on': {
      // Only things this side can see on its own face.
      const spots = [
        ...visibleObjects(state, side, pose.face, env).filter((o) => o.type === action.object),
        ...itemsOn(state, side, pose.face).filter((i) => i.kind === action.object || action.object === 'item'),
      ];
      if (spots.length === 0) return { error: `you cannot see any "${action.object}" on this face` };
      return walk((p) => p.face === pose.face && spots.some((s) => s.x === p.x && s.y === p.y), `the ${action.object} cannot be reached right now`);
    }
    case 'use': {
      // E only "uses" with empty hands and no loose item underfoot: otherwise it drops or picks up.
      if (state.players[side].carrying) return { error: 'your hands are full: drop what you carry first' };
      const loose = (p: { x: number; y: number }) => itemsOn(state, side, pose.face).some((i) => i.x === p.x && i.y === p.y && !i.placedOn);
      let spots: { x: number; y: number }[];
      if (action.col !== undefined && action.row !== undefined) {
        const [x, y] = screenToCanon(side, pose.face, pose.up, action.col, action.row);
        spots = [{ x, y }];
      } else if (action.object !== undefined) {
        spots = visibleObjects(state, side, pose.face, env).filter((o) => o.type === action.object && (action.state === undefined || o.state === action.state));
        if (spots.length === 0) return { error: `you cannot see any "${action.object}"${action.state === undefined ? '' : ` showing "${action.state}"`} on this face` };
      } else spots = [pose];
      spots = spots.filter((s) => !loose(s));
      if (spots.length === 0) return { error: 'an item lies there: E would pick it up' };
      const there = walk((p) => p.face === pose.face && spots.some((s) => s.x === p.x && s.y === p.y), 'no way to reach that tile right now');
      return there.steps ? { steps: [...there.steps, 'interact'] } : { error: there.error };
    }
  }
}

export const isFace = (n: number): n is FaceId => Number.isInteger(n) && n >= 1 && n <= 6;
