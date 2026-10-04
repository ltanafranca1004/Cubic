import type { PuzzleCtx, PuzzleInitCtx, PuzzleModule, VisibleObject } from './types';
import type { Side } from '../types';
import { BATTERY_KIND } from './chain';
import { makeSequence, newSeqShow, seqAdvance, seqLitIndex, seqPress, seqStart, type SeqShow } from './lib/sequence';
import { at, type XY } from './util';

// SEQUENCE LASER (face 5: Rooftop outside, Laser room inside). Needs the battery of face 2.
//
// Outside: seven symbol tiles in a circle, dark, and a REPLAY tile. Inside: the same seven
// symbols as buttons on the same canonical tiles (mirrored on screen, never in the data)
// and a dead laser emitter in the middle.
//
//  1. The inside player places the BATTERY in the emitter.
//  2. The outside symbols light up one at a time (0.5 s each), every symbol once, in an
//     order mixed from the game's seed. Only the outside player sees it. E on REPLAY
//     (outside) shows it again.
//  3. The inside player presses E on the buttons in that order. A wrong press is a strike
//     and the entered presses start over (the order stays the same for the whole game).
//  4. The seventh right press fires the laser down through the cube: face 6 gets its beam.
//
// Map objects used: "f5-symbol" x7 on both sides (same tiles; the i-th in map order is
// SYMBOLS[i]), "f5-replay" outside, "target" named "f5-emitter" inside (the battery stays in
// it; any other item placed there is handed straight back).
// Nothing here blocks a tile.

const FACE = 5;
export const SYMBOLS = ['sun', 'moon', 'star', 'bolt', 'drop', 'leaf', 'eye'] as const;
const EMITTER = 'f5-emitter';

interface State {
  /** The battery is in the emitter. */
  powered: boolean;
  /** The playback of the order on the outside symbols. */
  show: SeqShow;
  /** Symbols the inside player has pressed so far (all right). */
  entered: number[];
  done: boolean;
}

/** The tiles of the seven symbols; index = symbol. The same tiles on both sides. */
const symbolTiles = (ctx: PuzzleInitCtx, side: Side): XY[] => ctx.objects(side, FACE, 'f5-symbol');

/** This game's order: every symbol exactly once. */
const order = (ctx: Pick<PuzzleCtx, 'rand'>): number[] => makeSequence((i) => ctx.rand(FACE, i), SYMBOLS.length, SYMBOLS.length);

export const sequenceLaser: PuzzleModule<State> = {
  id: 'sequence-laser',
  face: FACE,
  bright: true,

  init: () => ({ powered: false, show: newSeqShow(), entered: [], done: false }),

  onItem(s, ctx, ev) {
    if (ev.kind !== 'placed' || ev.tile.face !== FACE || ev.target?.name !== EMITTER) return;
    if (ev.item.kind !== BATTERY_KIND) {
      ctx.giveItem(ev.side, ev.item.id); // only the battery fits: anything else comes straight back
      return;
    }
    if (s.powered) return;
    s.powered = true;
    seqStart(s.show);
    ctx.emit('toggle');
  },

  onTick(s, ctx, dtMs) {
    if (seqAdvance(s.show, dtMs, SYMBOLS.length) && s.show.playing) ctx.emit('toggle');
  },

  onUse(s, ctx, side, tile) {
    if (!s.powered || s.done) return; // dead until the battery is in
    if (side === 'out') {
      if (!ctx.objects('out', FACE, 'f5-replay').some((r) => at(r, tile))) return;
      seqStart(s.show);
      ctx.emit('toggle');
      return;
    }
    const symbol = symbolTiles(ctx, 'in').findIndex((t) => at(t, tile));
    if (symbol < 0) return;
    const res = seqPress(s.entered, order(ctx), symbol);
    if (res === 'wrong') ctx.strike(side);
    else if (res === 'next') ctx.emit('key');
    else {
      s.done = true;
      s.show = newSeqShow();
      ctx.emit('laser');
      ctx.emit('chime');
    }
  },

  isSolved: (s) => s.done,

  visible(s, ctx, side) {
    const out: VisibleObject[] = [];
    const tiles = symbolTiles(ctx, side);
    if (side === 'out') {
      // the lit symbol is only ever shown out here
      const step = seqLitIndex(s.show, SYMBOLS.length);
      const lit = step === null ? -1 : order(ctx)[step]!;
      tiles.forEach((t, i) => out.push({ type: 'f5-symbol', x: t.x, y: t.y, state: s.done || i === lit ? `${SYMBOLS[i]}-lit` : SYMBOLS[i] }));
      for (const r of ctx.objects('out', FACE, 'f5-replay')) out.push({ type: 'f5-replay', x: r.x, y: r.y, state: s.powered && !s.done ? 'on' : 'off' });
      return out;
    }
    // inside: a button is lit once it has been pressed in the right place
    tiles.forEach((t, i) => out.push({ type: 'f5-symbol', x: t.x, y: t.y, state: s.done || s.entered.includes(i) ? `${SYMBOLS[i]}-lit` : SYMBOLS[i] }));
    for (const e of ctx.objects('in', FACE, 'target')) out.push({ type: 'f5-emitter', x: e.x, y: e.y, state: s.done ? 'firing' : s.powered ? 'powered' : 'dead' });
    return out;
  },

  objective(s, _ctx, side) {
    if (s.done) return 'The laser fires down through the cube.';
    if (side === 'out') return 'Seven symbols wait in the dark. Power awakens the light.';
    return s.powered ? 'Press symbols to light them. Find the hidden sequence.' : 'The laser sleeps. Wake it with power.';
  },
};
