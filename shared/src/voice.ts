import { CANON_UP, faceDistance, neighbours } from './cube';
import { FACES, GRID, type FaceId, type GameState, type Pose } from './types';

// Proximity voice: how well the two players hear each other, from where they stand on the
// cube. Outside face N and inside face N are the same wall, so they count as the SAME face.
// Tune the numbers here.

/** Both on the same face: full volume. */
export const VOICE_SAME_FACE_GAIN = 1;
/** One face apart. */
export const VOICE_ADJACENT_GAIN = 0.35;
/** Opposite faces: silent. */
export const VOICE_OPPOSITE_GAIN = 0;
/** Within this many tiles of an edge, your voice starts to belong to the face beyond it. */
export const VOICE_EDGE_FADE_TILES = 3;
/** Signal bars shown on the HUD: gain needed for 1, 2 and 3 bars. */
export const VOICE_BAR_THRESHOLDS = [0.04, 0.3, 0.7] as const;

/**
 * How much a player "counts" as being on each face. Standing mid-face you are fully on
 * it; near an edge you are partly on the neighbour (half and half on the last tile), so
 * crossing an edge does not change anything and the volume never jumps.
 */
export function facePresence(pose: Pick<Pose, 'face' | 'x' | 'y'>): Partial<Record<FaceId, number>> {
  // In canonical orientation the outside view is the map as drawn.
  const n = neighbours({ side: 'out', face: pose.face, up: CANON_UP[pose.face] });
  const toEdge: [FaceId, number][] = [
    [n.up, pose.y],
    [n.down, GRID - 1 - pose.y],
    [n.left, pose.x],
    [n.right, GRID - 1 - pose.x],
  ];
  const out: Partial<Record<FaceId, number>> = {};
  let spill = 0;
  for (const [face, tiles] of toEdge) {
    const w = 0.5 * Math.max(0, 1 - tiles / VOICE_EDGE_FADE_TILES);
    if (w > 0) {
      out[face] = w;
      spill += w;
    }
  }
  out[pose.face] = Math.max(0, 1 - spill);
  return out;
}

export interface VoiceMix {
  /** 0 (silent) to 1 (clear). */
  gain: number;
}

/**
 * How loud the players are to each other right now. Symmetric.
 *
 * Each player's presence is spread over faces (see facePresence). We pair the two
 * presences up as favourably as possible: whatever both have on the same face counts at
 * full volume, what can be paired across adjacent faces counts at the adjacent gain, and
 * only what is forced onto opposite faces is silent. So two players side by side are clear
 * even next to an edge, and the volume fades as one of them walks away over it.
 */
export function voiceMix(state: Pick<GameState, 'players'>): VoiceMix {
  const a = facePresence(state.players.out.pose);
  const b = facePresence(state.players.in.pose);
  const restA: Partial<Record<FaceId, number>> = {};
  const restB: Partial<Record<FaceId, number>> = {};
  let same = 0;
  let rest = 0;
  for (const f of FACES) {
    const shared = Math.min(a[f] ?? 0, b[f] ?? 0);
    same += shared;
    restA[f] = (a[f] ?? 0) - shared;
    restB[f] = (b[f] ?? 0) - shared;
    rest += restA[f]!;
  }
  // Of the rest, the part that can only be paired with the opposite face is lost.
  let forcedOpposite = 0;
  for (const f of FACES) {
    const opposite = FACES.find((g) => faceDistance(f, g) === 2)!;
    forcedOpposite = Math.max(forcedOpposite, restA[f]! + restB[opposite]! - rest);
  }
  const adjacent = rest - forcedOpposite;
  const gain = same * VOICE_SAME_FACE_GAIN + adjacent * VOICE_ADJACENT_GAIN + forcedOpposite * VOICE_OPPOSITE_GAIN;
  return { gain: Math.min(1, Math.max(0, gain)) };
}

/** 0-3 bars for the HUD signal indicator. */
export function signalBars(gain: number): 0 | 1 | 2 | 3 {
  return VOICE_BAR_THRESHOLDS.filter((t) => gain >= t).length as 0 | 1 | 2 | 3;
}
