import { plateDoor } from './plateDoor';
import { rosePot } from './rosePot';
import type { PuzzleModule } from './types';

export * from './types';

/**
 * Every puzzle in the game. Add yours here (one per face).
 * The portal on face 6 opens once all of these are solved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PUZZLES: PuzzleModule<any>[] = [plateDoor, rosePot];
