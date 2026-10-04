import { botanicalMirror } from './botanicalMirror';
import { equationSafe } from './equationSafe';
import { hiddenCode } from './hiddenCode';
import { laserPath } from './laserPath';
import { mirroredGlyph } from './mirroredGlyph';
import { sequenceLaser } from './sequenceLaser';
import type { PuzzleModule } from './types';

export * from './types';

/**
 * Every puzzle in the game, one per face. The game is won when all of them are solved.
 * Faces: 1 hidden-code, 2 equation-safe, 3 mirrored-glyph, 4 botanical-mirror,
 * 5 sequence-laser, 6 laser-path. Chain: 2 -> 5 -> 6 -> 4; 1 and 3 stand alone.
 * The ids, faces and export names are fixed: replace a module's file, not this list.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PUZZLES: PuzzleModule<any>[] = [hiddenCode, equationSafe, mirroredGlyph, botanicalMirror, sequenceLaser, laserPath];
