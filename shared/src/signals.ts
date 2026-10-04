import { canonToScreen } from './cube';
import type { FaceId, GameState, QuickChat, Side } from './types';

// Quick chat: the wordless way to reach your partner through the wall. The rules live
// here (how long a bubble stays, who sees it); the server enforces them and the client
// draws them. Outside face N and inside face N are the two sides of one wall, so
// "the same face" means the same face NUMBER, whatever the side.

/** A quick-chat bubble stays over the speaker this long. */
export const BUBBLE_MS = 3000;

/** The four fixed quick-chat lines, on keys 1 to 4. */
export const QUICK_CHATS = ['Here!', 'Wait', 'Yes', 'No'] as const;
export type QuickIndex = 0 | 1 | 2 | 3;

/** A valid quick-chat number from the wire (0..3), or null. */
export function quickIndex(value: unknown): QuickIndex | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < QUICK_CHATS.length ? (value as QuickIndex) : null;
}

export const bubbleAlive = (at: number, now: number): boolean => now - at < BUBBLE_MS;

/**
 * Does a viewer standing on `viewerFace` see a bubble on `face`? Only on the
 * same wall: outside N and inside N. The side never matters.
 */
export function sameWall(face: FaceId, viewerFace: FaceId): boolean {
  return face === viewerFace;
}

/** What one player sees of the quick-chat bubbles, in THEIR screen tiles. */
export interface SignalView {
  bubbles: { id: number; sx: number; sy: number; mine: boolean; text: string }[];
}

export const NO_SIGNALS: SignalView = { bubbles: [] };

/**
 * The bubbles `viewer` sees right now. Everything is drawn on the viewer's own side of
 * the wall: the partner's bubble floats where they stand on the other side, only while
 * the viewer is on the same wall. Your own bubble is always over your own head.
 * `at` on every quick chat must be on the same clock as `now`.
 */
export function signalsFor(state: Pick<GameState, 'players'>, viewer: Side, quicks: readonly QuickChat[], now: number): SignalView {
  const me = state.players[viewer].pose;
  const at = (x: number, y: number) => canonToScreen(viewer, me.face, me.up, x, y);
  const view: SignalView = { bubbles: [] };
  // one bubble per speaker: their latest line
  const latest = new Map<Side, QuickChat>();
  for (const q of quicks) if (bubbleAlive(q.at, now) && quickIndex(q.index) !== null && (latest.get(q.from)?.at ?? -Infinity) <= q.at) latest.set(q.from, q);
  for (const q of latest.values()) {
    const who = state.players[q.from].pose;
    if (!sameWall(who.face, me.face)) continue;
    const [sx, sy] = at(who.x, who.y);
    view.bubbles.push({ id: q.id, sx, sy, mine: q.from === viewer, text: QUICK_CHATS[quickIndex(q.index)!] });
  }
  return view;
}
