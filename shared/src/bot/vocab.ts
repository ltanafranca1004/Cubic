// The words the AI partner's RELAY lines are built from. A relay line tells the human an
// answer that changes every game (a code, counts, an order, a path, a pot), so it cannot be
// one banked clip. Instead every piece below is banked ONCE as its own clip and the server
// plays a relay line by chaining them: no live text-to-speech call for a puzzle answer.
//
// A relay line is a list of these pieces, in order (relayText joins them for the caption
// and for the browser voice). A script must use ONLY these pieces in a relay line; add a
// piece here (and bank it) before using a new one.

import { SYMBOL_NAMES } from '../symbols';

export const VOCAB_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const;
export const VOCAB_COLOURS = ['red', 'blue', 'yellow', 'pink', 'white'] as const;
/** The seven symbols of face 5: the one list in ../symbols.ts (the puzzle and the label over the turtle use it too). */
export const VOCAB_SYMBOLS = SYMBOL_NAMES;
export const VOCAB_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export const VOCAB_WORDS = ['row', 'column', 'flip', 'skip', 'then', 'next', 'pot', 'bushes', 'birds', 'rocks', 'press', 'step'] as const;
export const VOCAB_PHRASES = ['the code is', 'the order is', 'the path is', 'the pot is', 'the flower is'] as const;

export const VOCAB: readonly string[] = [...VOCAB_NUMBERS, ...VOCAB_COLOURS, ...VOCAB_SYMBOLS, ...VOCAB_DIRECTIONS, ...VOCAB_WORDS, ...VOCAB_PHRASES];
export type VocabPiece = (typeof VOCAB)[number];

const KNOWN = new Set<string>(VOCAB);

/** Is this a piece a relay line may use? */
export const isVocab = (piece: string): boolean => KNOWN.has(piece);

/** The number word for 0..12 (throws outside it: say bigger numbers digit by digit). */
export function numberWord(n: number): string {
  const word = VOCAB_NUMBERS[n];
  if (word === undefined) throw new Error(`no number word for ${n}`);
  return word;
}

/** A number said digit by digit: 384 -> ['three', 'eight', 'four']. */
export const digitWords = (n: number | string): string[] => [...String(n)].map((d) => numberWord(Number(d)));

/** The caption (and the browser voice's text) of a relay line. Throws on a piece outside the vocabulary. */
export function relayText(pieces: readonly string[]): string {
  for (const p of pieces) if (!isVocab(p)) throw new Error(`"${p}" is not in the relay vocabulary (shared/src/bot/vocab.ts)`);
  return pieces.join(' ');
}
