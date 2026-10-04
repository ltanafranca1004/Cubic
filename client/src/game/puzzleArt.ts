import { C } from '../style/tokens';

// THE CO-OP PUZZLE OBJECTS, drawn once, in code, as 16x16 pixel art in palette colours.
// One source for both places that need them: /tools/art puts every sprite listed here on
// sprites/objects.png (and into manifest.json), and CodeArt (./art.ts) draws the same
// pixels as its placeholder, so a puzzle object never shows up as the "unknown" marker.
// Pure: no DOM, no Phaser. It only calls the `rect` it is given.

/** Fill w x h pixels at x,y with a palette colour. */
export type Rect = (x: number, y: number, w: number, h: number, colour: string) => void;

/** The six signs of the code relay (face 3), 8x8 each. Names match the map legend. */
export const SIGNS: Record<string, { colour: string; rows: string[] }> = {
  sun: { colour: C.amber, rows: ['#..##..#', '.#....#.', '..####..', '#.####.#', '#.####.#', '..####..', '.#....#.', '#..##..#'] },
  moon: { colour: C.skyLight, rows: ['..####..', '.####...', '####....', '###.....', '###.....', '####....', '.####...', '..####..'] },
  star: { colour: C.pink, rows: ['...##...', '...##...', '########', '.######.', '..####..', '.######.', '.##..##.', '##....##'] },
  drop: { colour: C.aqua, rows: ['...##...', '...##...', '..####..', '..####..', '.######.', '.######.', '.######.', '..####..'] },
  bolt: { colour: C.white, rows: ['....###.', '...###..', '..###...', '.######.', '...###..', '..###...', '.###....', '.#......'] },
  ring: { colour: C.grass, rows: ['..####..', '.#....#.', '#......#', '#......#', '#......#', '#......#', '.#....#.', '..####..'] },
};
const SIGN_NAMES = Object.keys(SIGNS);

function bitmap(rect: Rect, x: number, y: number, rows: readonly string[], colour: string): void {
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch === '#' && rect(x + c, y + r, 1, 1, colour)));
}

/** Outside, face 3: a stone slab with a sign cut into it. Asleep it is dull, awake the sign glows. */
function glyph(rect: Rect, state: string): void {
  const asleep = state.endsWith('-off');
  const sign = SIGNS[asleep ? state.slice(0, -4) : state];
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, asleep ? C.slate : C.shadow);
  rect(2, 2, 12, 1, asleep ? C.mauveDark : C.slate);
  if (sign) bitmap(rect, 4, 4, sign.rows, asleep ? C.silver : sign.colour);
  if (!asleep) for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]] as const) rect(x, y, 1, 1, C.lemon);
}

/** Inside, face 3: the tablet on the wall. Blank, one sign, or a tick once the code is in. */
function tablet(rect: Rect, state: string): void {
  rect(1, 0, 14, 15, C.rust);
  rect(2, 1, 12, 13, C.ink);
  rect(3, 15, 3, 1, C.amberDark);
  rect(10, 15, 3, 1, C.amberDark);
  const sign = SIGNS[state];
  if (sign) {
    rect(1, 0, 14, 1, C.amber);
    bitmap(rect, 4, 3, sign.rows, sign.colour);
  } else if (state === 'done') {
    rect(1, 0, 14, 1, C.green);
    bitmap(rect, 4, 3, ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'], C.green);
  } else {
    for (const x of [5, 8, 11]) rect(x - 1, 7, 2, 2, C.mauveDark);
  }
}

/** Inside, face 3: one lamp per sign entered. */
function lamp(rect: Rect, state: string): void {
  rect(5, 5, 6, 6, C.ink);
  if (state === 'on') {
    rect(6, 6, 4, 4, C.amber);
    rect(7, 7, 2, 2, C.lemon);
    for (const [x, y] of [[7, 3], [7, 12], [3, 7], [12, 7]] as const) rect(x, y, x === 7 ? 2 : 1, x === 7 ? 1 : 2, C.amberDark);
  } else rect(6, 6, 4, 4, C.slate);
}

/** Outside, face 5: a pane of glass set in the roof. Held, the daylight pours through it. */
function skylight(rect: Rect, state: string): void {
  const on = state === 'on';
  rect(1, 1, 14, 14, C.ink);
  rect(2, 2, 12, 12, on ? C.white : C.silver);
  rect(3, 3, 10, 10, on ? C.lemon : C.sky);
  // the cross bar of the frame, and a glint on the glass
  rect(7, 3, 2, 10, on ? C.white : C.silver);
  rect(3, 7, 10, 2, on ? C.white : C.silver);
  rect(4, 4, 2, 1, on ? C.white : C.skyLight);
  rect(4, 5, 1, 1, on ? C.white : C.skyLight);
  rect(10, 10, 2, 1, on ? C.amber : C.blue);
}

/** Inside, face 5: where a pane's light lands. Dark, only the marks on the floor show. */
function beam(rect: Rect, state: string): void {
  if (state === 'on') {
    rect(2, 2, 12, 12, C.amber);
    rect(3, 3, 10, 10, C.lemon);
    rect(5, 5, 6, 6, C.white);
    return;
  }
  for (const [x, y] of [[2, 2], [11, 2], [2, 11], [11, 11]] as const) {
    rect(x, y, 3, 1, C.slate);
    rect(x === 2 ? 2 : 13, y === 2 ? 2 : 11, 1, 3, C.slate);
  }
}

/** Inside, face 5: a bridge over the black water. It is only solid in the light. */
function bridge(rect: Rect, state: string): void {
  if (state === 'lit') {
    rect(0, 1, 16, 14, C.ink);
    rect(0, 2, 16, 12, C.amber);
    for (const y of [2, 6, 10]) rect(0, y, 16, 3, C.lemon);
    for (const y of [5, 9, 13]) rect(0, y, 16, 1, C.amberDark);
    for (const x of [3, 12]) rect(x, 2, 1, 12, C.amberDark);
    return;
  }
  // gone: black water, four posts and the ghost of the planks
  rect(0, 0, 16, 16, C.ink);
  for (const [x, y] of [[1, 2], [13, 2], [1, 12], [13, 12]] as const) {
    rect(x, y, 2, 2, C.slate);
    rect(x, y, 2, 1, C.mauveDark);
  }
  for (const x of [4, 7, 10]) for (const y of [4, 8, 12]) rect(x, y, 2, 1, C.shadow);
}

/** Outside, face 4: a pale stepping stone. The first one wears the inside's amber, the last the crystal's pink. */
function trail(rect: Rect, state: string): void {
  rect(4, 4, 8, 9, C.ink);
  rect(3, 5, 10, 7, C.ink);
  rect(4, 5, 8, 7, C.mist);
  rect(5, 4, 6, 1, C.white);
  rect(4, 5, 8, 2, C.white);
  rect(4, 11, 8, 1, C.silver);
  if (state === 'start') rect(6, 7, 4, 3, C.amber);
  if (state === 'end') {
    rect(7, 6, 2, 5, C.hotPink);
    rect(6, 7, 4, 3, C.hotPink);
    rect(7, 7, 1, 1, C.white);
  }
}

/** Inside, face 4: a tile of the trap floor that held. */
function step(rect: Rect): void {
  rect(2, 2, 12, 12, C.amberDark);
  rect(3, 3, 10, 10, C.rust);
  rect(5, 5, 2, 3, C.lemon);
  rect(9, 8, 2, 3, C.lemon);
}

/** Inside, face 4: the doorway of the trap room. */
function entry(rect: Rect): void {
  rect(0, 0, 2, 16, C.rust);
  rect(14, 0, 2, 16, C.rust);
  rect(0, 0, 1, 16, C.amberDark);
  rect(15, 0, 1, 16, C.amberDark);
  // chevrons: this is the way in
  for (const y of [4, 9]) bitmap(rect, 4, y, ['...##...', '..####..', '.##..##.', '##....##'], C.amber);
}

const DRAW: Record<string, (rect: Rect, state: string) => void> = { glyph, tablet, lamp, skylight, beam, bridge, trail, step, entry };

/** Every sprite the sheet gets, in sheet order (after the older objects). */
export const PUZZLE_SPRITES: readonly { type: string; state: string }[] = [
  ...SIGN_NAMES.map((n) => ({ type: 'glyph', state: n })),
  ...SIGN_NAMES.map((n) => ({ type: 'glyph', state: `${n}-off` })),
  { type: 'tablet', state: 'off' },
  ...SIGN_NAMES.map((n) => ({ type: 'tablet', state: n })),
  { type: 'tablet', state: 'done' },
  { type: 'lamp', state: 'off' },
  { type: 'lamp', state: 'on' },
  { type: 'skylight', state: 'off' },
  { type: 'skylight', state: 'on' },
  { type: 'beam', state: 'off' },
  { type: 'beam', state: 'on' },
  { type: 'bridge', state: 'dark' },
  { type: 'bridge', state: 'lit' },
  { type: 'trail', state: 'stone' },
  { type: 'trail', state: 'start' },
  { type: 'trail', state: 'end' },
  { type: 'step', state: 'default' },
  { type: 'entry', state: 'default' },
];

/** Draw a co-op puzzle object. False if `type` is not one of them (nothing was drawn). */
export function drawPuzzleObject(rect: Rect, type: string, state: string | undefined): boolean {
  const draw = DRAW[type];
  if (!draw) return false;
  draw(rect, state ?? 'default');
  return true;
}
