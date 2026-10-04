import type { Side } from '@cubic/shared';

// THE NARRATOR'S LINES. Text only: they are shown as captions (no TTS). Plain and a bit
// dry, and every line stays under NARRATOR_MAX characters (test/onboarding.test.ts checks).
// When a line is said is decided in ui/onboarding/rules.ts.

export const NARRATOR_MAX = 80;

export const NARRATOR = {
  /** Said when a game starts. One list per side; the Nth game of the session takes line N. */
  intro: {
    out: ['One cube. One of you on it, one of you in it. Nobody planned this well.', 'You are outside a cube. Your partner is not. Talk it out.'],
    in: ['You are inside a cube. Your partner is outside. It could be worse. Slightly.', 'Six walls and one friend on the wrong side of them. Start talking.'],
  } satisfies Record<Side, string[]>,
  /** Said when the first puzzle of a game is solved. */
  firstSolve: ['One puzzle down. The cube pretends not to be impressed.', 'That worked. Try not to let it go to your heads.'],
};

/** Line `n` of a list, wrapping around: no randomness, so the same game always says the same thing. */
export const narratorLine = (lines: readonly string[], n: number): string => lines[((n % lines.length) + lines.length) % lines.length]!;
