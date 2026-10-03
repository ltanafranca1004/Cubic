import { faceDistance } from '../cube';
import { FACES, type FaceId } from '../types';
import type { Observation } from './observe';

// What the AI partner should be working on, and how far it may stray from the human.
// Everything here is computed from the bot's OWN observations (observe()) and what it
// remembers of them. The partner's face is only ever guessed from the voice signal, which
// a human player hears too: it never reads the other player's pose.

/** What the bot has learned so far, from its own observations only. */
export interface BotMemory {
  /** Faces it has stood on, as it last saw them. */
  faces: Partial<Record<FaceId, { puzzle: boolean; objects: string[] }>>;
  /** The face it believes its partner is on, from the voice signal. null = cannot tell. */
  partnerFace: FaceId | null;
}

export const newMemory = (): BotMemory => ({ faces: {}, partnerFace: null });

/** The rules tell both players where the portal is. */
const PORTAL_FACE: FaceId = 6;

const opposite = (face: FaceId): FaceId => FACES.find((f) => faceDistance(face, f) === 2)!;

/**
 * Where the partner is, as far as the voice can tell. Clear = on this wall. Silent = on
 * the opposite face. Faint = on one of the four next faces: keep the last belief while it
 * still fits, otherwise the bot does not know which.
 */
export function hearPartner(believed: FaceId | null, o: Pick<Observation, 'face' | 'voiceSignal'>): FaceId | null {
  if (o.voiceSignal >= 3) return o.face;
  if (o.voiceSignal <= 0) return opposite(o.face);
  return believed !== null && faceDistance(believed, o.face) === 1 ? believed : null;
}

/** Fold one observation into the memory. Returns a new memory. */
export function remember(memory: BotMemory, o: Observation): BotMemory {
  const faces = { ...memory.faces, [o.face]: { puzzle: o.puzzleHere, objects: [...new Set(o.objects.map((x) => x.type))] } };
  for (const f of o.solvedFaces) if (faces[f]) faces[f] = { ...faces[f], puzzle: false };
  return { faces, partnerFace: hearPartner(memory.partnerFace, o) };
}

/** The leash is off while the puzzle itself needs the two apart: carrying an item, or the portal is awake. */
export const leashFree = (o: Pick<Observation, 'carrying' | 'portalOpen' | 'won'>): boolean => o.carrying !== null || o.portalOpen || o.won;

/**
 * May the bot walk onto `face`? Only if that keeps it within one face of its partner.
 * When the voice is faint and the bot cannot tell which next face the partner is on, it
 * may try: `leashBroken` catches the one face that turns out to be too far.
 */
export function leashAllows(o: Observation, memory: BotMemory, face: FaceId): boolean {
  if (leashFree(o) || face === o.face) return true;
  const partner = hearPartner(memory.partnerFace, o);
  return partner === null || faceDistance(face, partner) <= 1;
}

/** The partner is out of earshot (two faces away) and nothing excuses it. */
export const leashBroken = (o: Observation): boolean => o.voiceSignal <= 0 && !leashFree(o);

export type Goal =
  /** Everything is solved: go to the portal. */
  | { kind: 'portal'; face: FaceId }
  /** Carrying an item: take it where it belongs (`face` once a target has been seen). */
  | { kind: 'carry'; item: string; face: FaceId | null }
  /** The partner is out of earshot: get back within one face. */
  | { kind: 'regroup' }
  /** The nearest unsolved puzzle the bot knows about. `inReach`: the leash lets it walk there now. */
  | { kind: 'puzzle'; face: FaceId; here: boolean; inReach: boolean }
  /** Nothing known to do: stay near the partner. */
  | { kind: 'stay' };

/** What the bot should be doing right now. */
export function chooseGoal(o: Observation, memory: BotMemory): Goal {
  const known = remember(memory, o);
  const faceWith = (type: string) => FACES.find((f) => known.faces[f]?.objects.includes(type)) ?? null;
  if (o.won) return { kind: 'stay' };
  if (o.portalOpen) return { kind: 'portal', face: faceWith('portal') ?? PORTAL_FACE };
  if (o.carrying !== null) return { kind: 'carry', item: o.carrying, face: faceWith('target') };
  if (leashBroken(o)) return { kind: 'regroup' };
  const rank = (f: FaceId) => (leashAllows(o, known, f) ? 0 : 10) + faceDistance(o.face, f);
  const [face] = FACES.filter((f) => known.faces[f]?.puzzle && !o.solvedFaces.includes(f)).sort((a, b) => rank(a) - rank(b) || a - b);
  if (face === undefined) return { kind: 'stay' };
  return { kind: 'puzzle', face, here: face === o.face, inReach: leashAllows(o, known, face) };
}
