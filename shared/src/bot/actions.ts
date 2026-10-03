import { screenToCanon, stepPose } from '../cube';
import { defaultEnv, itemsOn, visibleObjects, type GameEnv } from '../game';
import { GRID, type FaceId, type GameState, type Pose, type Side } from '../types';
import { findPath, type Move } from './path';

// The AI's body: high-level actions turned into ordinary steps. The server walks them one
// at a time through applyMove / applyInteract, so the AI cannot teleport or cheat.

export type BotAction =
  /** Walk to a tile of the current face, in your own screen coords. */
  | { type: 'goto'; col: number; row: number }
  /** Walk to another face (1-6) by the shortest route. */
  | { type: 'go_face'; face: number }
  /** Walk onto the nearest visible object or item of this type/kind on your face ("plate", "crystal", "portal", "rose", ...). */
  | { type: 'step_on'; object: string }
  /** Walk in a straight line in your screen space. */
  | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; steps?: number }
  /** Pick up the item you are standing on. */
  | { type: 'pick_up' }
  /** Put down the item you carry (on a pot/target it gets placed). */
  | { type: 'drop' }
  /** Stay where you are. */
  | { type: 'wait' };

export const BOT_ACTION_TYPES = ['goto', 'go_face', 'step_on', 'move', 'pick_up', 'drop', 'wait'] as const;

/** One thing the body does next: a step, or E. */
export type BotStep = Move | 'interact';

const DIRS: Record<string, Move> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const MAX_LINE = GRID * 2;

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
      return col !== null && row !== null && col >= 0 && col < GRID && row >= 0 && row < GRID ? { type: 'goto', col, row } : null;
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
): { steps: BotStep[] } | { error: string } {
  const pose = state.players[side].pose;
  /** Shortest walk inside the leash. If only the leash is in the way, say so. */
  const walk = (goal: (p: Pose) => boolean, error: string) => {
    const path = findPath(state, side, goal, env, leash);
    if (path) return { steps: path };
    return { error: leash && findPath(state, side, goal, env) ? LEASH_ERROR : error };
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
  }
}

export const isFace = (n: number): n is FaceId => Number.isInteger(n) && n >= 1 && n <= 6;
