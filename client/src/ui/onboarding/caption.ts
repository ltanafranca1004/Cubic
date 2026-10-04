import { CAPTION_MAX_MS, clearCaption, showCaption as show } from '../captions';

// THE NARRATOR'S CAPTION. The narrator's lines go to the game's caption component
// (ui/captions.ts), the same one the AI partner's speech uses. The onboarding rules decide
// how long a line stays (rules.ts), so it is held up until they pass null.

let shown: number | null = null;

/** Show a narrator line, or pass null to take it away. */
export function showCaption(text: string | null): void {
  if (text) shown = show(text, { ms: CAPTION_MAX_MS });
  else if (shown !== null) {
    clearCaption(shown); // only our own line: a newer caption stays
    shown = null;
  }
}
