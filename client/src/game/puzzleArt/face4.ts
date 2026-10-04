import type { Draw, Sprite } from './common';

// Face 4 (Mirrored Glyph): the sprites only this face's puzzle uses, both sides.
// Add a draw function per object type to DRAW and every (type, state) it can show to
// SPRITES, then run `npm run art` in /tools. How: see ./index.ts.

export const DRAW: Record<string, Draw> = {};

export const SPRITES: readonly Sprite[] = [];
