import type { FaceId, Side } from '@cubic/shared';

// THE FACES AS THEY ARE NOW, for whoever draws the cube outside the game view (the ending,
// scenes/ending). The game scene registers the painter; the caller only ever asks here, so
// either side can land first (like the cube map in cube/api.ts).

/**
 * All twelve faces, 192 x 192 each, laid out like the map (x right, y down, the face's own
 * up at the top): the texture of a wall, the same from both sides. The outside ones are
 * what the outside player sees. The inside ones are fully lit and mirrored left to right,
 * so that on the back of a wall they show exactly what the inside player saw.
 */
export type FaceShots = Record<Side, Record<FaceId, HTMLCanvasElement>>;

let painter: (() => FaceShots | null) | null = null;

export function registerFacePainter(fn: (() => FaceShots | null) | null): void {
  painter = fn;
}

/** The faces of the running game, or null when there is none. */
export const faceShots = (): FaceShots | null => painter?.() ?? null;
