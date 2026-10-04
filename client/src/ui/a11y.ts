// Accessibility rules that are plain arithmetic or wording, kept free of the DOM so they
// can be tested (client/test/input.test.ts).

export type TextSize = 's' | 'm' | 'l';

/**
 * The pixel multiple reading text is drawn at (chat, objective, captions, bubbles).
 * `u` is the whole-number UI scale. The font is a pixel font, so the size moves in whole
 * multiples and stays crisp: S is one step under the UI, M matches it, L is one step over.
 * It never goes under 1 (the font's own size), so on a small window S and M are the same.
 */
export function textScale(u: number, size: TextSize): number {
  return Math.max(1, u + (size === 's' ? -1 : size === 'l' ? 1 : 0));
}

/** What a cell of the HUD's cube net says to a screen reader and in its tooltip. */
export function netCellLabel(face: number, c: { solved: boolean; here: boolean; portal: boolean }): string {
  const notes = [c.solved ? 'solved' : 'not solved', ...(c.here ? ['you are here'] : []), ...(c.portal ? ['the portal is awake'] : [])];
  return `Face ${face}: ${notes.join(', ')}`;
}
