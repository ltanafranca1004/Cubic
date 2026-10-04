import { BATTERY_ID, BATTERY_KIND } from './chain';
import { keyAt, keypadLock, keypadUse, keypadVisible, newKeypad, type KeypadState } from './lib/keypad';
import type { PuzzleModule, VisibleObject } from './types';
import { around, at, keyOf, mix, type XY } from './util';

// EQUATION SAFE (face 2: Desert outside, Vault inside). The start of the chain 2 -> 5 -> 6 -> 4.
//
// Outside: berry bushes, round rocks and birds, 1 to 4 of each, different every game. The
// bushes and rocks stand still; the birds hop about but never leave the face and their
// number never changes. Only the outside player sees them.
// Inside: a locked safe, a row carved above it, [|||] x [bush] x [||] x [bird] x [rock], and
// a floor keypad with a 3 cell display. Only the inside player sees those. The outside
// player counts, the inside player multiplies: 3 x bushes x 2 x birds x rocks (at most 384),
// typed without leading zeros (E on a key), then ENTER. Wrong: a strike and the display
// clears. Right: the keypad locks green, the safe opens and the BATTERY lies in front of it
// for the inside player to carry to face 5.
//
// Nothing is on the map: every tile of the puzzle is in the two grids below, canonical like
// the maps (same rows, same columns). The inside player sees their face mirrored left to
// right, so the vault is written right to left: on their screen the keys read 1 2 3 and the
// display fills from the left.
//
// The safe is the only tile that blocks (inside, never on the ring): nobody can be shut in.

const FACE = 2;

/**
 * Outside. b / r: where a bush / a rock may stand. o: where a bird may be: two patches, each
 * with more tiles than there can be birds, so there is always somewhere to hop. All free
 * floor, off the ring, clear of the biome's decor and of its tall cacti and palms.
 */
const DESERT = [
  '............',
  '...b........',
  '..oo...r....',
  '.oboo.....r.',
  '.ooo.....ro.',
  '.bo.......o.',
  '..oo.....ro.',
  '..boo....ro.',
  '..ooboo...o.',
  '...o.ooor...',
  '..booo.oo...',
  '............',
];

/**
 * Inside. S safe, * where the battery appears, d display, 0-9 and E the keys, and the carved
 * row: a = |||, c = ||, x = times, B bush, V bird, R rock.
 */
const VAULT = [
  '............',
  '.RxVxcxBxa..',
  '............',
  '.....S......',
  '.....*......',
  '....ddd.....',
  '....321.....',
  '....654.....',
  '....987.....',
  '....E0......',
  '............',
  '............',
];

const tilesOf = (grid: readonly string[], chars: string): (XY & { ch: string })[] => grid.flatMap((row, y) => [...row].flatMap((ch, x) => (chars.includes(ch) ? [{ x, y, ch }] : [])));

const BUSH_SPOTS: readonly XY[] = tilesOf(DESERT, 'b');
const ROCK_SPOTS: readonly XY[] = tilesOf(DESERT, 'r');
const BIRD_SPOTS: readonly XY[] = tilesOf(DESERT, 'o');
const ROAM = new Set(BIRD_SPOTS.map(keyOf));

const SAFE: XY = tilesOf(VAULT, 'S')[0]!;
const BATTERY_AT: XY = tilesOf(VAULT, '*')[0]!;
const KEYS: readonly (XY & { name: string })[] = tilesOf(VAULT, '0123456789E').map((k) => ({ x: k.x, y: k.y, name: k.ch === 'E' ? 'enter' : k.ch }));
const DISPLAY: readonly XY[] = tilesOf(VAULT, 'd');
const CLUE_STATE: Record<string, string> = { a: 'three', c: 'two', x: 'times', B: 'bush', V: 'bird', R: 'rock' };
const CLUE: readonly VisibleObject[] = tilesOf(VAULT, 'acxBVR').map((t) => ({ type: 'f2-clue', x: t.x, y: t.y, state: CLUE_STATE[t.ch]! }));

/** Most of one kind, and the least is 1. */
export const EQUATION_MAX = 4;
/** A bird hops once every HOP_TICKS server ticks (750 ms), each bird on its own beat. */
const HOP_TICKS = 3;

// Keys for mix(seed, FACE, ...): one per thing that is random here.
const K_BUSH = 1;
const K_ROCK = 2;
const K_BIRD = 3;
const K_HOP = 4;

export interface EquationCounts {
  bushes: number;
  rocks: number;
  birds: number;
}

const count = (seed: number, kind: number): number => 1 + (mix(seed, FACE, kind) % EQUATION_MAX);

/** How many of each kind this game has (1 to 4 each), from the game seed. */
export const equationCounts = (seed: number): EquationCounts => ({ bushes: count(seed, K_BUSH), rocks: count(seed, K_ROCK), birds: count(seed, K_BIRD) });

/** What opens the safe: 3 x bushes x 2 x birds x rocks. */
export function equationAnswer(seed: number): number {
  const c = equationCounts(seed);
  return 3 * c.bushes * 2 * c.birds * c.rocks;
}

/** `n` of `spots`, picked by the seed (each spot gets a number, the lowest n win). */
function pick(seed: number, kind: number, spots: readonly XY[], n: number): XY[] {
  return spots
    .map((t, i) => ({ t, rank: mix(seed, FACE, kind, i), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, n)
    .map((p) => ({ x: p.t.x, y: p.t.y }));
}

const bushes = (seed: number): XY[] => pick(seed, K_BUSH, BUSH_SPOTS, count(seed, K_BUSH));
const rocks = (seed: number): XY[] => pick(seed, K_ROCK, ROCK_SPOTS, count(seed, K_ROCK));

interface State {
  pad: KeypadState;
  /** Where each bird is now. The length never changes. */
  birds: XY[];
  /** Server ticks so far: the birds' clock, and what their hops are seeded from. */
  ticks: number;
  /** The right answer is in: the safe is open and the battery is out. */
  open: boolean;
}

export const equationSafe: PuzzleModule<State> = {
  id: 'equation-safe',
  face: FACE,
  bright: true,

  init: (ctx) => ({ pad: newKeypad(), birds: pick(ctx.seed, K_BIRD, BIRD_SPOTS, count(ctx.seed, K_BIRD)), ticks: 0, open: false }),

  isBlocked: (_s, _ctx, side, tile) => side === 'in' && at(SAFE, tile),

  onUse(s, ctx, side, tile) {
    const name = side === 'in' ? keyAt(KEYS, tile) : null;
    if (name === null) return;
    const res = keypadUse(s.pad, name);
    if (res.kind === 'typed') ctx.emit('key');
    if (res.kind !== 'submit') return;
    if (Number(res.code) !== equationAnswer(ctx.seed)) {
      ctx.strike(side); // the display is already cleared
      return;
    }
    keypadLock(s.pad, res.code);
    s.open = true;
    ctx.emit('chime');
    ctx.spawnItem({ id: BATTERY_ID, kind: BATTERY_KIND, side: 'in', face: FACE, x: BATTERY_AT.x, y: BATTERY_AT.y });
  },

  // The dev tools' "Solve puzzle": the safe opens and the battery is out, as after the right answer.
  devSolve(s, ctx) {
    if (s.open) return;
    keypadLock(s.pad, String(equationAnswer(ctx.seed)));
    s.open = true;
    if (!ctx.item(BATTERY_ID)) ctx.spawnItem({ id: BATTERY_ID, kind: BATTERY_KIND, side: 'in', face: FACE, x: BATTERY_AT.x, y: BATTERY_AT.y });
  },

  onTick(s, ctx) {
    s.ticks++;
    s.birds.forEach((bird, i) => {
      if ((s.ticks + i) % HOP_TICKS !== 0) return;
      // A neighbouring bird tile nobody else is on. Bushes and rocks stand on tiles of their own.
      const free = around(bird).filter((n) => ROAM.has(keyOf(n)) && !s.birds.some((b) => at(b, n)));
      if (free.length === 0) return;
      const to = free[ctx.rand(FACE, K_HOP, s.ticks, i) % free.length]!;
      bird.x = to.x;
      bird.y = to.y;
    });
  },

  isSolved: (s) => s.open,

  visible(s, ctx, side) {
    if (side === 'out') {
      // A bird's wings are up or down, changing with every hop.
      const beat = Math.floor(s.ticks / HOP_TICKS);
      return [
        ...bushes(ctx.seed).map((t) => ({ type: 'f2-bush', x: t.x, y: t.y })),
        ...rocks(ctx.seed).map((t) => ({ type: 'f2-rock', x: t.x, y: t.y })),
        ...s.birds.map((t, i) => ({ type: 'f2-bird', x: t.x, y: t.y, state: (beat + i) % 2 === 0 ? 'up' : 'down' })),
      ];
    }
    // Mirrored like the keys: the first digit typed is on the left of the inside player's screen.
    const flip = Math.min(...DISPLAY.map((d) => d.x)) + Math.max(...DISPLAY.map((d) => d.x));
    return [
      ...CLUE,
      { type: 'f2-safe', x: SAFE.x, y: SAFE.y, state: s.open ? 'open' : 'locked' },
      ...keypadVisible(s.pad, KEYS, DISPLAY).map((v) => (v.type === 'display' ? { ...v, x: flip - v.x } : v)),
    ];
  },

  objective(_s, _ctx, side) {
    if (side === 'out') return 'Count the berry bushes, the round rocks and the birds. Tell your partner all three.';
    return 'A safe. Carved above it: 3 x bushes x 2 x birds x rocks. Type the answer (E on a key), then ENTER.';
  },
};

/** The tiles of the puzzle, for the tests. */
export const EQUATION_TILES = { bushSpots: BUSH_SPOTS, rockSpots: ROCK_SPOTS, birdSpots: BIRD_SPOTS, safe: SAFE, battery: BATTERY_AT, keys: KEYS, display: DISPLAY };
