// THE SEVEN SYMBOLS of face 5, by name: the one vocabulary everyone uses. The puzzle's
// object states (`sun`, `sun-lit`), the words the AI partner says and hears (bot/vocab.ts,
// one banked voice clip per word) and the label over the turtle (labels.ts) all read this
// list, so both players and the AI call a symbol the same thing.
//
// The order is the map order (the i-th `f5-symbol` object is SYMBOL_NAMES[i]). Do not
// rename or reorder: the committed voice bank is looked up by these words.

export const SYMBOL_NAMES = ['sun', 'moon', 'star', 'bolt', 'drop', 'leaf', 'eye'] as const;
export type SymbolName = (typeof SYMBOL_NAMES)[number];

/** The map object type of a symbol tile (outside) and a symbol button (inside). */
export const SYMBOL_OBJECT = 'f5-symbol';

const KNOWN = new Set<string>(SYMBOL_NAMES);

/** The symbol an object state names: `bolt` and `bolt-lit` are both the bolt. Null for anything else. */
export function symbolOf(state: string | undefined): SymbolName | null {
  if (!state) return null;
  const name = state.endsWith('-lit') ? state.slice(0, -4) : state;
  return KNOWN.has(name) ? (name as SymbolName) : null;
}
