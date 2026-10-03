import { faceDistance } from './cube';
import type { GameState, Pose } from './types';

// Proximity voice: how well two players hear each other, from the faces they stand on.
// Outside face N and inside face N are the two sides of one wall, so they count as the
// SAME face. The rule is flat per face: where you stand on a face does not matter.

/** Same face (same wall): clear. */
export const VOICE_SAME = 1.0;
/** Adjacent face (shares an edge): quiet. */
export const VOICE_ADJ = 0.35;
/** Opposite face: silent. Always. */
export const VOICE_OPP = 0;
/** The client ramps the gain over this long when it changes, so crossing an edge does not pop. */
export const VOICE_RAMP_MS = 150;

const GAIN_BY_FACE_DISTANCE = [VOICE_SAME, VOICE_ADJ, VOICE_OPP] as const;

export interface VoiceMix {
  /** 0 (silent) to 1 (clear). */
  gain: number;
}

/** Gain between any two players. Only their faces matter; side and tile do not. */
export function voiceGain(a: Pick<Pose, 'face'>, b: Pick<Pose, 'face'>): number {
  return GAIN_BY_FACE_DISTANCE[faceDistance(a.face, b.face)];
}

/** How loud the two players are to each other right now. Symmetric. */
export function voiceMix(state: Pick<GameState, 'players'>): VoiceMix {
  return { gain: voiceGain(state.players.out.pose, state.players.in.pose) };
}

/** Signal bars for the HUD: 3 on the same face, 1 on an adjacent face, 0 on the opposite one. */
export function signalBars(gain: number): 0 | 1 | 2 | 3 {
  if (gain >= VOICE_SAME) return 3;
  return gain > VOICE_OPP ? 1 : 0;
}
