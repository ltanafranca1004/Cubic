import { VOCAB } from '@cubic/shared';

// Relay lines: an answer that changes every game (a code, an order, a path). A script
// builds one ONLY from the pieces of shared/src/bot/vocab.ts and says relayText(pieces);
// here the server takes the line apart again and plays it as a chain of the pieces' banked
// clips. No text-to-speech call is ever made for a relay line.

const PIECES = new Set(VOCAB);
/** The longest piece, in words ("the code is" = 3). */
const LONGEST = Math.max(...VOCAB.map((p) => p.split(' ').length));

/**
 * The vocabulary pieces a line is made of, in order, or null if any word of it is not
 * part of a piece. relayPieces(relayText(pieces)) gives the pieces back.
 */
export function relayPieces(text: string): string[] | null {
  const words = text.split(' ');
  const pieces: string[] = [];
  for (let i = 0; i < words.length; ) {
    let n = Math.min(LONGEST, words.length - i);
    while (n > 0 && !PIECES.has(words.slice(i, i + n).join(' '))) n--;
    if (n === 0) return null;
    pieces.push(words.slice(i, i + n).join(' '));
    i += n;
  }
  return pieces.length ? pieces : null;
}

/** Silence between two pieces of a chained line, in ms. */
export const RELAY_GAP_MS = 90;
