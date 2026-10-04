import type { PuzzleCtx, PuzzleModule } from './types';
import { at, mix } from './util';

// CODE RELAY (face 3: Snow outside, Frost room inside).
// Inside there is a plate under a tablet. While the inside player stands on the plate the
// tablet shows ONE sign, and the six sign stones outside wake up. The outside player
// steps on the stone with that sign; the tablet then shows the next one. Four right in a
// row solves it. A wrong stone is a strike, and the wall picks a new code.
//
// Why it takes two: the sign is only drawn for the inside player, and the stones only
// listen while the inside player is on the plate. The code comes from the game's start
// time, so it is different every game.
//
// Never stuck: nothing here blocks anyone.
//
// Map objects used: outside "glyph" (name = its sign), inside "plate", "tablet", "lamp".

export const GLYPH_FACE = 3;
/** Signs in one code. */
export const CODE_LEN = 4;

interface State {
  /** Signs entered correctly so far. */
  progress: number;
  /** Wrong stones so far: each one changes the code. */
  attempt: number;
}

/**
 * The code of one game: CODE_LEN signs out of `names`, never the same one twice in a row
 * (you would have to step off and on again). Pure: same inputs, same code.
 */
export function glyphCode(seed: number, attempt: number, names: readonly string[]): string[] {
  const code: string[] = [];
  if (names.length < 2) return code;
  for (let i = 0; i < CODE_LEN; i++) {
    const pool = names.filter((n) => n !== code[i - 1]);
    code.push(pool[mix(seed, attempt, i) % pool.length]!);
  }
  return code;
}

const stones = (ctx: PuzzleCtx) => ctx.objects('out', GLYPH_FACE, 'glyph');
const plates = (ctx: PuzzleCtx) => ctx.objects('in', GLYPH_FACE, 'plate');
const codeOf = (s: State, ctx: PuzzleCtx) =>
  glyphCode(
    ctx.state.startedAt,
    s.attempt,
    stones(ctx).map((g) => g.name),
  );
/** The inside player is on the plate: the tablet shows its sign and the stones listen. */
const reading = (ctx: PuzzleCtx) => plates(ctx).some((p) => ctx.isOn('in', { face: GLYPH_FACE, x: p.x, y: p.y }));
const done = (s: State, ctx: PuzzleCtx) => s.progress >= CODE_LEN || ctx.solved;

export const glyphCodePuzzle: PuzzleModule<State> = {
  id: 'glyph-code',
  face: GLYPH_FACE,

  init: () => ({ progress: 0, attempt: 0 }),

  onEnter(s, ctx, side, tile) {
    if (side === 'in') {
      if (!done(s, ctx) && plates(ctx).some((p) => at(p, tile))) ctx.emit('glyph-wake');
      return;
    }
    const stone = stones(ctx).find((g) => at(g, tile));
    // Asleep stones are just stones: no progress and no strike without a reader inside.
    if (!stone || done(s, ctx) || !reading(ctx)) return;
    if (stone.name === codeOf(s, ctx)[s.progress]) {
      s.progress++;
      ctx.emit('glyph-ok', { step: s.progress });
    } else {
      s.progress = 0;
      s.attempt++;
      ctx.strike('out');
      ctx.emit('glyph-wrong');
    }
  },

  onLeave(s, ctx, side, tile) {
    if (side === 'in' && !done(s, ctx) && plates(ctx).some((p) => at(p, tile))) ctx.emit('glyph-sleep');
  },

  isSolved: (s) => s.progress >= CODE_LEN,

  visible(s, ctx, side) {
    const awake = reading(ctx);
    const solved = done(s, ctx);
    if (side === 'out') {
      // The stones show their own sign, never which one is wanted.
      return stones(ctx).map((g) => ({ type: 'glyph', x: g.x, y: g.y, state: awake || solved ? g.name : `${g.name}-off` }));
    }
    const sign = solved ? 'done' : awake ? (codeOf(s, ctx)[s.progress] ?? 'off') : 'off';
    return [
      ...plates(ctx).map((p) => ({ type: 'plate', x: p.x, y: p.y, state: awake ? 'on' : 'off' })),
      ...ctx.objects('in', GLYPH_FACE, 'tablet').map((t) => ({ type: 'tablet', x: t.x, y: t.y, state: sign })),
      ...ctx.objects('in', GLYPH_FACE, 'lamp').map((l, i) => ({ type: 'lamp', x: l.x, y: l.y, state: solved || i < s.progress ? 'on' : 'off' })),
    ];
  },

  objective(s, ctx, side) {
    const awake = reading(ctx);
    if (side === 'in') {
      if (!awake) return 'A plate under a blank tablet. Stand on it to read the wall.';
      return `The tablet shows one sign at a time (${s.progress} of ${CODE_LEN}). Call it out and stay on the plate.`;
    }
    return awake ? 'The stones are awake. Step only on the sign your partner calls out.' : 'Six stones with signs, all asleep. Someone inside has to read the wall.';
  },
};
