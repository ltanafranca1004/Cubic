import type { PuzzleScript } from './types';

export * from './types';
export * from './grid';

/**
 * What the AI partner knows how to play: one script per puzzle module id. Add yours here.
 * A puzzle in shared/src/puzzles with no script here still runs: the bot says it does not
 * know that one yet, keeps off everything it sees on that face, and stays with the human.
 * (Empty right now: the scripts for the six V2 puzzles are not written yet.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PUZZLE_SCRIPTS: PuzzleScript<any>[] = [];
