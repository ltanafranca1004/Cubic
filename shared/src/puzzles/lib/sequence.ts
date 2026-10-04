// LIGHT SEQUENCE: shows a sequence one step at a time, driven by onTick, and checks the
// presses that answer it. Any length: the sequence is whatever array you pass.
//
//   interface State { show: SeqShow; entered: number[] }
//   const order = (ctx: PuzzleCtx) => makeSequence((i) => ctx.rand(FACE, i), 7, 7); // 7 presses over 7 symbols
//   onTick(s, ctx, dt) { if (seqAdvance(s.show, dt, order(ctx).length)) ctx.emit('seq-step'); },
//   // in visible(): const lit = seqLitIndex(s.show, order(ctx).length); symbol order(ctx)[lit] is lit
//   onUse(s, ctx, side, tile) {
//     const res = seqPress(s.entered, order(ctx), symbolAt(tile));
//     if (res === 'wrong') ctx.strike(side); // entered is reset
//     if (res === 'done') s.done = true;
//   },

/** How long each step of the sequence stays lit. */
export const SEQ_STEP_MS = 500;

export interface SeqShow {
  playing: boolean;
  /** Ms since the playback started. */
  t: number;
}

export const newSeqShow = (): SeqShow => ({ playing: false, t: 0 });

/** (Re)start the playback from the first step. */
export function seqStart(q: SeqShow): void {
  q.playing = true;
  q.t = 0;
}

/** Call from onTick. Returns true when the lit step changed (also when the playback ended). */
export function seqAdvance(q: SeqShow, dtMs: number, length: number, stepMs: number = SEQ_STEP_MS): boolean {
  if (!q.playing) return false;
  const before = Math.floor(q.t / stepMs);
  q.t += dtMs;
  if (q.t >= length * stepMs) {
    q.playing = false;
    q.t = 0;
    return true;
  }
  return Math.floor(q.t / stepMs) !== before;
}

/** The index (into your sequence) of the step that is lit now, or null when nothing plays. */
export function seqLitIndex(q: SeqShow, length: number, stepMs: number = SEQ_STEP_MS): number | null {
  if (!q.playing) return null;
  const i = Math.floor(q.t / stepMs);
  return i < length ? i : null;
}

/**
 * A sequence of `length` symbols out of `symbols` (0..symbols-1), from your own random
 * source, e.g. `(i) => ctx.rand(FACE, i)`. With length <= symbols every symbol appears at
 * most once (one press per symbol); a longer one repeats, never twice in a row.
 */
export function makeSequence(rand: (i: number) => number, length: number, symbols: number): number[] {
  const out: number[] = [];
  let pool: number[] = [];
  for (let i = 0; i < length; i++) {
    if (pool.length === 0) pool = Array.from({ length: symbols }, (_, n) => n);
    let pick = rand(i) % pool.length;
    if (pool[pick] === out[i - 1] && pool.length > 1) pick = (pick + 1) % pool.length;
    out.push(pool.splice(pick, 1)[0]!);
  }
  return out;
}

/**
 * One press of `symbol` against `sequence`. Mutates `entered` (the presses so far):
 * 'next' = right, more to go; 'done' = that was the last one; 'wrong' = reset to empty.
 */
export function seqPress(entered: number[], sequence: readonly number[], symbol: number): 'next' | 'done' | 'wrong' {
  if (sequence[entered.length] !== symbol) {
    entered.length = 0;
    return 'wrong';
  }
  entered.push(symbol);
  return entered.length === sequence.length ? 'done' : 'next';
}
