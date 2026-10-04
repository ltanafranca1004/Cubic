// ---- faces 1-3 (scripts-a) ----
import { equationSafeScript } from './equationSafe';
import { hiddenCodeScript } from './hiddenCode';
import { mirroredGlyphScript } from './mirroredGlyph';
// ---- end faces 1-3 ----
// ---- faces 4-6 (scripts-b) ----
import { botanicalMirrorScript } from './botanicalMirror';
import { laserPathScript } from './laserPath';
import { sequenceLaserScript } from './sequenceLaser';
// ---- end faces 4-6 ----
import type { PuzzleScript } from './types';

export * from './types';
export * from './grid';
// ---- faces 1-3 (scripts-a) ----
export * from './carry';
export * from './relayKit';
export { hiddenCodeScript, digitsIn } from './hiddenCode';
export { equationSafeScript, carryBattery, countsIn } from './equationSafe';
export { mirroredGlyphScript, parseRow, rowPieces, type GlyphRow } from './mirroredGlyph';
// ---- end faces 1-3 ----
// ---- faces 4-6 (scripts-b) ----
export { botanicalMirrorScript, potLine } from './botanicalMirror';
export { sequenceLaserScript, orderLines } from './sequenceLaser';
export { laserPathScript, mirrorPush, stepLine } from './laserPath';
// ---- end faces 4-6 ----

/**
 * What the AI partner knows how to play: one script per puzzle module id. Add yours here.
 * A puzzle in shared/src/puzzles with no script here still runs: the bot says it does not
 * know that one yet, keeps off everything it sees on that face, and stays with the human.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PUZZLE_SCRIPTS: PuzzleScript<any>[] = [
  // ---- faces 1-3 (scripts-a) ----
  hiddenCodeScript,
  equationSafeScript,
  mirroredGlyphScript,
  // ---- end faces 1-3 ----
  // ---- faces 4-6 (scripts-b) ----
  botanicalMirrorScript,
  sequenceLaserScript,
  laserPathScript,
  // ---- end faces 4-6 ----
];
