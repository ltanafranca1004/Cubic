import { glyphCodePuzzle } from './glyphCode';
import { mirrorMaze } from './mirrorMaze';
import { plateDoor } from './plateDoor';
import { rosePot } from './rosePot';
import { skylight } from './skylight';
import type { PuzzleModule } from './types';

export * from './types';
export { CODE_LEN, glyphCode } from './glyphCode';
export { safeLine } from './mirrorMaze';

/**
 * Every puzzle in the game. Add yours here (one per face).
 * The portal on face 6 opens once all of these are solved.
 * Faces: 1 plate-door, 3 glyph-code, 4 mirror-maze, 5 skylight, 6 rose-pot (and the portal).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PUZZLES: PuzzleModule<any>[] = [plateDoor, glyphCodePuzzle, mirrorMaze, skylight, rosePot];
