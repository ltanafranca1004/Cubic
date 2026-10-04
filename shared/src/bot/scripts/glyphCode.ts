import { SIGNS, type Sign } from '../talk';
import { around, same, walkable } from './grid';
import type { PuzzleScript } from './types';

// CODE RELAY (face 3).
// Inside: stand on the plate, read the tablet's sign out loud, one at a time.
// Outside: ask for the sign, walk onto that stone and no other. The human types the sign
// ("moon"). A strike right after a step means it was the wrong stone.

const RESAY_MS = 25_000;

interface Mem {
  /** Inside: the sign last read out. */
  sign: Sign | null;
  /** Outside: the stone being walked to. */
  target: Sign | null;
  /** Outside: standing on the wanted stone already, so step off it first. */
  stepOff: boolean;
  /** Outside: the last stone that was right. */
  pressed: Sign | null;
}

export const glyphCodeScript: PuzzleScript<Mem> = {
  id: 'glyph-code',
  lines: [
    'glyph-code.plate',
    ...SIGNS.map((s) => `glyph-code.sign.${s}`),
    'glyph-code.wrong',
    'glyph-code.asleep',
    'glyph-code.ready',
    'glyph-code.going',
    'glyph-code.oops',
    'glyph-code.next',
  ],
  init: () => ({ sign: null, target: null, stepOff: false, pressed: null }),

  // The stones: a wrong one is a strike.
  hazards: (o) => o.objects.filter((x) => x.type === 'glyph'),

  play({ o, mem, objs, say, has, tokens, struck }) {
    const pos = o.position;
    if (o.you === 'in') {
      const plate = objs('plate')[0];
      const tablet = objs('tablet')[0];
      if (!plate || !tablet) return null;
      if (plate.state !== 'on') {
        say('glyph-code.plate');
        return { action: { type: 'goto', col: plate.col, row: plate.row }, status: 'walking to the plate under the tablet' };
      }
      const sign = SIGNS.find((s) => s === tablet.state);
      if (sign) {
        const key = `glyph-code.sign.${sign}`;
        if (sign !== mem.sign || struck) {
          if (struck) say('glyph-code.wrong', { force: true });
          say(key, { force: true });
          mem.sign = sign;
        } else if (has('again')) say(key, { force: true });
        else say(key, { every: RESAY_MS });
      }
      return { action: null, hold: true, status: `on the plate, reading the tablet: ${sign ?? 'nothing yet'}` };
    }

    const glyphs = objs('glyph');
    if (!glyphs.length) return null;
    const awake = glyphs.some((g) => g.state !== undefined && !g.state.endsWith('-off'));
    if (!awake) {
      mem.target = null;
      say('glyph-code.asleep', { every: RESAY_MS });
      return { action: null, status: 'the sign stones are asleep: waiting for the partner to stand on the plate' };
    }
    const stoneOf = (s: Sign | null) => glyphs.find((g) => g.state === s);
    if (mem.target && !mem.stepOff && same(stoneOf(mem.target), pos)) {
      // Stepped on it: a strike says it was the wrong one.
      mem.pressed = struck ? null : mem.target;
      mem.target = null;
      say(struck ? 'glyph-code.oops' : 'glyph-code.next', { force: true });
    } else say('glyph-code.ready');
    const named = tokens.filter((t) => t.t === 'sign').at(-1);
    // A code never has the same sign twice in a row: the stone that was just right is a stale message.
    if (named?.t === 'sign' && named.sign === mem.pressed) say('glyph-code.next', { every: 3000 });
    else if (named?.t === 'sign' && stoneOf(named.sign)) {
      mem.target = named.sign;
      mem.stepOff = same(stoneOf(named.sign), pos); // already on it: off and on again
      say('glyph-code.going', { force: true });
    } else if (has('again')) say('glyph-code.ready', { force: true });
    const stone = stoneOf(mem.target);
    if (!stone) return { action: null, status: 'waiting for the partner to name a sign' };
    if (mem.stepOff) {
      if (!same(stone, pos)) mem.stepOff = false;
      else {
        const off = around(pos).find((n) => walkable(o, n) && !glyphs.some((g) => same(g, n)));
        return { action: off ? { type: 'goto', col: off.col, row: off.row } : null, allow: [stone], status: 'stepping off the stone to press it again' };
      }
    }
    return { action: { type: 'goto', col: stone.col, row: stone.row }, allow: [stone], status: `walking to the ${mem.target} stone` };
  },
};
