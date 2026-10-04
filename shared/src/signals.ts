import { canonToScreen } from './cube';
import type { FaceId, GameState, Ping, QuickChat, Side } from './types';

// Pings and quick chat: the wordless ways to reach your partner through the wall. The
// rules live here (cooldown, fade, who sees what); the server enforces them and the
// client draws them. Outside face N and inside face N are the two sides of one wall, so
// "the same face" means the same face NUMBER, whatever the side.

/** A ping marker is gone this long after it was dropped. */
export const PING_FADE_MS = 4000;
/** One ping per player per this long. */
export const PING_COOLDOWN_MS = 2000;
/** A quick-chat bubble stays over the speaker this long. */
export const BUBBLE_MS = 3000;

/** The four fixed quick-chat lines, on keys 1 to 4. */
export const QUICK_CHATS = ['Here!', 'Wait', 'Yes', 'No'] as const;
export type QuickIndex = 0 | 1 | 2 | 3;

/** A valid quick-chat number from the wire (0..3), or null. */
export function quickIndex(value: unknown): QuickIndex | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < QUICK_CHATS.length ? (value as QuickIndex) : null;
}

/** May this player ping now? `lastAt` is their previous ping (null = never). */
export function canPing(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= PING_COOLDOWN_MS;
}

/** The ping `side` would drop right now: on their own tile. */
export function makePing(state: Pick<GameState, 'players'>, side: Side, id: number, now: number): Ping {
  const { face, x, y } = state.players[side].pose;
  return { id, from: side, face, x, y, at: now };
}

/** How visible a ping is, 1 (fresh) to 0 (gone): it holds, then fades over its last half. */
export function pingAlpha(at: number, now: number): number {
  const age = now - at;
  if (age < 0) return 1;
  if (age >= PING_FADE_MS) return 0;
  return Math.min(1, ((PING_FADE_MS - age) / PING_FADE_MS) * 2);
}

export const pingAlive = (at: number, now: number): boolean => now - at < PING_FADE_MS;
export const bubbleAlive = (at: number, now: number): boolean => now - at < BUBBLE_MS;

/**
 * Does a viewer standing on `viewerFace` see a marker or bubble on `face`? Only on the
 * same wall: outside N and inside N. The side never matters.
 */
export function sameWall(face: FaceId, viewerFace: FaceId): boolean {
  return face === viewerFace;
}

/** What one player sees of the pings and bubbles, in THEIR screen tiles. */
export interface SignalView {
  pings: { id: number; sx: number; sy: number; mine: boolean; alpha: number }[];
  bubbles: { id: number; sx: number; sy: number; mine: boolean; text: string }[];
}

export const NO_SIGNALS: SignalView = { pings: [], bubbles: [] };

/**
 * The markers and bubbles `viewer` sees right now. Everything is drawn on the viewer's own
 * side of the wall: a partner's ping sits on the tile directly behind theirs, and their
 * bubble floats where they stand on the other side. Both only while the viewer is on the
 * same wall. Your own bubble is always over your own head.
 * `at` on every ping and quick chat must be on the same clock as `now`.
 */
export function signalsFor(state: Pick<GameState, 'players'>, viewer: Side, pings: readonly Ping[], quicks: readonly QuickChat[], now: number): SignalView {
  const me = state.players[viewer].pose;
  const at = (x: number, y: number) => canonToScreen(viewer, me.face, me.up, x, y);
  const view: SignalView = { pings: [], bubbles: [] };
  for (const p of pings) {
    if (!pingAlive(p.at, now) || !sameWall(p.face, me.face)) continue;
    const [sx, sy] = at(p.x, p.y);
    view.pings.push({ id: p.id, sx, sy, mine: p.from === viewer, alpha: pingAlpha(p.at, now) });
  }
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
