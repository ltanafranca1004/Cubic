import { FACES, SIDES, devSolve, devTeleport, type FaceId, type Side } from '@cubic/shared';
import type { Room } from './rooms';

// The dev command channel (socket message `dev`, used by the client's ?dev tools).
// Off unless the server runs with DEV_COMMANDS=1, and always off in production. The server
// stays the authority: a command changes the room's state here and is broadcast as usual.

/** DEV_COMMANDS=1 turns the channel on, except in production where nothing can. */
export const devCommandsEnabled = (env: { DEV_COMMANDS?: string; NODE_ENV?: string }): boolean => env.DEV_COMMANDS === '1' && env.NODE_ENV !== 'production';

export type DevResult = { ok: true } | { ok: false; error: string };

const no = (error: string): DevResult => ({ ok: false, error });

/** Run one dev command for a socket seated in `room` (null = not in a room). */
export function runDev(enabled: boolean, room: Room | null, cmd: unknown): DevResult {
  if (!enabled) return no('Dev commands are off on this server (needs DEV_COMMANDS=1, never in production).');
  const c = (typeof cmd === 'object' && cmd ? cmd : {}) as { type?: unknown; side?: unknown; face?: unknown };
  if (c.type === 'ping') return { ok: true };
  if (c.type !== 'teleport' && c.type !== 'solve') return no('Unknown dev command.');
  if (!room) return no('Join a room first.');
  if (!FACES.includes(c.face as FaceId)) return no('face must be 1 to 6.');
  const face = c.face as FaceId;
  if (c.type === 'solve') {
    room.devApply((state, now) => devSolve(state, face, now));
    return { ok: true };
  }
  if (!SIDES.includes(c.side as Side)) return no('side must be "out" or "in".');
  const side = c.side as Side;
  room.devApply((state, now) => devTeleport(state, side, face, now));
  return { ok: true };
}
