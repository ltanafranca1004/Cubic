// The biome sprites: what makes each outside face its own place. Trees that sway, snowy
// pines and a snowman, cacti and a palm, bushes and tall grass, stalagmites, and the small
// things on the floor. Plus the water of every face with a bank on each open side.
//
// Two sheets: sprites/biomes.png (cells one tile wide and two high, in the order of
// client/src/world/biomes/sheet.ts) and tiles/water.png. Our own art, drawn here.
import { C } from '../../client/src/style/tokens';
import { POKE_PX, PROP_COLS, PROP_H, PROP_LIST, PROP_SHEET, PROP_W, PROPS, SHORE, TALL, WATER_CELL, WATER_FRAMES, WATER_MASKS, WATER_SHEET, waterRow, type PropName } from '../../client/src/world/biomes/sheet';
import { Img } from './img';

const W = PROP_W;
const H = PROP_H;
/** The lowest row a standing prop is drawn on; its outline and contact shadow go below. */
const BASE = 28;
/** Dark, base, light. */
type Ramp3 = readonly [string, string, string];

const cell = () => new Img(W, H);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shaded ball lit from the top left. `leafy` breaks the tones up into foliage. */
function blob(g: Img, cx: number, cy: number, rx: number, ry: number, [dark, base, light]: Ramp3, leafy = false): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const lit = -dx * 0.55 - dy * 0.85;
      let c = lit > 0.4 ? light : lit < -0.3 ? dark : base;
      if (leafy) {
        if (c === base && (x * 7 + y * 13) % 9 === 0) c = light;
        else if (c === base && (x * 5 + y * 11) % 8 === 0) c = dark;
        else if (c === light && (x * 3 + y * 7) % 5 === 0) c = base;
      }
      g.set(x, y, c);
    }
}

/** A spike of rock: light on the left flank, dark on the right, a pale tip. */
function cone(g: Img, cx: number, base: number, half: number, height: number, [dark, mid, light]: Ramp3): void {
  for (let y = base - height + 1; y <= base; y++) {
    const t = (y - (base - height)) / height;
    const hw = Math.max(0.5, half * t);
    const x0 = Math.round(cx - hw);
    const x1 = Math.max(x0 + 1, Math.round(cx + hw));
    for (let x = x0; x < x1; x++) {
      const r = (x + 0.5 - cx) / hw;
      const band = y % 5 === 0 && r > -0.25 && r <= 0.3;
      g.set(x, y, r < -0.25 ? light : r > 0.3 ? dark : band ? C.mauveDark : mid);
    }
  }
  g.set(Math.round(cx - 0.5), base - height + 1, C.mist);
}

function line(g: Img, x0: number, y0: number, x1: number, y1: number, c: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) g.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
}

/** Ink outline, then a contact shadow under it, so the prop stands on the ground. */
function stand(s: Img, shade: string, x: number, w: number): Img {
  s.outline(C.ink);
  return cell()
    .rect(x, BASE + 2, w, 1, shade)
    .rect(x + 1, BASE + 3, w - 2, 1, shade)
    .blit(s, 0, 0);
}

/** The rows above `pivot` pushed sideways, more towards `top`: a tree leaning in the wind. */
function lean(img: Img, k: number, top: number, pivot: number): Img {
  const out = cell();
  for (let y = 0; y < H; y++) {
    const f = y < pivot ? (pivot - y) / (pivot - top) : 0;
    let s = 0;
    if (k === 1 && f > 0.55) s = 1;
    if (k === 2) s = f > 0.8 ? 2 : f > 0.25 ? 1 : 0;
    if (k === -1 && f > 0.55) s = -1;
    for (let x = 0; x < W; x++) {
      const c = img.get(x, y);
      if (c) out.set(x + s, y, c);
    }
  }
  return out;
}
/** Rest, leaning a little, leaning more, swinging back. */
const sway = (img: Img, top: number, pivot: number): Img[] => [0, 1, 2, -1].map((k) => lean(img, k, top, pivot));

// ---------- trees ----------

function trunk(s: Img, top: number): void {
  s.rect(7, top, 2, BASE - top + 1, C.copper).rect(8, top, 1, BASE - top + 1, C.mud);
  s.set(6, BASE, C.copper).set(9, BASE, C.mud);
}

function oak(ramp: Ramp3, tall: boolean): Img[] {
  const s = cell();
  trunk(s, 18);
  if (tall) {
    blob(s, 8, 16, 5.5, 5, ramp, true);
    blob(s, 8, 10.5, 5, 5, ramp, true);
    blob(s, 8, 5.5, 3.8, 4, ramp, true);
  } else {
    blob(s, 5, 14.5, 4.5, 4.5, ramp, true);
    blob(s, 11, 15, 4.5, 4.5, ramp, true);
    blob(s, 8, 9.5, 6.5, 6.5, ramp, true);
  }
  return sway(stand(s, C.pine, 4, 8), 2, 22);
}

function pine(big: boolean): Img[] {
  const s = cell();
  s.rect(7, 23, 2, BASE - 22, C.copper).rect(8, 23, 1, BASE - 22, C.mud);
  const tiers: [number, number, number][] = big
    ? [
        [1, 9, 3.5],
        [7, 17, 5.5],
        [14, 25, 7],
      ]
    : [
        [8, 16, 4.5],
        [14, 25, 6.5],
      ];
  for (const [top, bottom, half] of [...tiers].reverse())
    for (let y = top; y <= bottom; y++) {
      const t = (y - top + 1) / (bottom - top + 1);
      const hw = Math.max(1, half * t);
      for (let x = Math.round(8 - hw); x < Math.round(8 + hw); x++) {
        const snow = t < 0.5 + (x % 2 ? 0.14 : 0);
        const right = x >= 9;
        s.set(x, y, y === bottom ? C.pine : snow ? (right ? C.mist : C.white) : right ? C.pine : C.greenDark);
      }
    }
  return sway(stand(s, C.skyLight, 3, 10), big ? 1 : 8, 24);
}

function palm(): Img[] {
  const s = cell();
  let tx = 6;
  for (let y = BASE; y >= 11; y--) {
    tx = 6 + Math.round(1.4 * Math.sin((((BASE - y) / 17) * Math.PI) / 2));
    const ring = y % 3 === 0;
    s.set(tx, y, ring ? C.rust : C.sandDark).set(tx + 1, y, ring ? C.mud : C.copper);
  }
  s.set(5, BASE, C.copper).set(8, BASE, C.mud);
  const cx = tx + 1;
  const cy = 10;
  const fronds: [number, number][] = [
    [-1, 0.1],
    [1, 0.15],
    [-0.8, -0.6],
    [0.85, -0.55],
    [-0.3, -1],
    [0.4, -1],
  ];
  for (const [dx, dy] of fronds)
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = Math.round(cx + dx * 6.4 * t);
      const y = Math.round(cy + dy * 6 * t + 5.5 * t * t);
      s.set(x, y + 1, C.greenDark).set(x, y, t > 0.8 ? C.grass : C.green);
    }
  s.rect(cx - 1, cy, 3, 2, C.greenDark).set(cx - 1, cy + 2, C.mud).set(cx + 1, cy + 2, C.mud);
  return sway(stand(s, C.sandDark, 4, 8), 3, 20);
}

function bush(berries: boolean): Img[] {
  const s = cell();
  const r: Ramp3 = [C.greenDark, C.green, C.grassLight];
  blob(s, 4.5, 25, 4, 3.8, r, true);
  blob(s, 11.5, 25, 4, 3.8, r, true);
  blob(s, 8, 22.5, 5.5, 5, r, true);
  if (berries)
    for (const [x, y] of [
      [5, 23],
      [9, 20],
      [11, 25],
      [7, 26],
      [3, 26],
    ])
      s.set(x!, y!, C.red);
  return sway(stand(s, C.green, 1, 14), 17, 26);
}

function planter(flowers: boolean): Img[] {
  const s = cell();
  if (flowers) {
    blob(s, 8, 17, 5.5, 5, [C.greenDark, C.green, C.grass], true);
    for (const [x, y] of [
      [5, 15],
      [9, 13],
      [11, 17],
      [7, 18],
      [3, 18],
      [10, 20],
    ])
      s.set(x!, y!, C.hotPink).set(x! + 1, y!, C.pinkLight);
  } else {
    s.rect(7, 18, 2, 5, C.mud);
    blob(s, 8, 13, 5, 7, [C.pine, C.greenDark, C.green], true);
  }
  s.rect(4, 22, 8, 2, C.sandDark).rect(11, 22, 1, 2, C.copper);
  s.rect(5, 24, 6, 5, C.copper).rect(10, 24, 1, 5, C.rust).rect(5, BASE, 6, 1, C.rust);
  return sway(stand(s, C.salmon, 3, 10), 6, 21);
}

// ---------- the desert ----------

const CACTUS: Ramp3 = [C.greenDark, C.green, C.grass];

function cactusTall(): Img {
  const s = cell();
  const [d, b, l] = CACTUS;
  s.rect(6, 8, 4, 21, b).rect(7, 7, 2, 1, b).rect(6, 8, 1, 21, l).rect(9, 8, 1, 21, d);
  for (let y = 10; y < BASE; y += 3) s.set(8, y, d);
  // left arm, then the right one a little higher
  s.rect(2, 14, 2, 6, b).rect(2, 20, 4, 1, b).rect(3, 19, 3, 1, b).set(2, 14, l).rect(2, 15, 1, 4, l).rect(3, 20, 3, 1, d);
  s.rect(12, 11, 2, 6, b).rect(10, 16, 3, 2, b).rect(13, 11, 1, 6, d).rect(10, 17, 4, 1, d).set(12, 11, l);
  s.set(7, 6, C.pinkLight).set(8, 6, C.hotPink).set(12, 10, C.pinkLight);
  return stand(s, C.sandDark, 4, 8);
}

function cactusBarrel(): Img {
  const s = cell();
  blob(s, 8, 23.5, 5, 5.2, CACTUS);
  for (const x of [5, 8, 11]) for (let y = 20; y <= 27; y++) if (s.get(x, y)) s.set(x, y, C.greenDark);
  for (const [x, y] of [
    [6, 21],
    [9, 22],
    [7, 25],
    [10, 26],
    [4, 24],
  ])
    s.set(x!, y!, C.lemon);
  s.rect(7, 17, 2, 2, C.amber).set(6, 18, C.orange).set(9, 18, C.orange);
  return stand(s, C.sandDark, 3, 10);
}

function cactusPear(): Img {
  const s = cell();
  blob(s, 6, 24.5, 3.6, 4.2, CACTUS);
  blob(s, 11, 20.5, 3, 3.8, CACTUS);
  blob(s, 11.5, 26.5, 2.6, 2.4, CACTUS);
  for (const [x, y] of [
    [5, 23],
    [7, 26],
    [11, 20],
    [12, 22],
  ])
    s.set(x!, y!, C.lemon);
  s.set(5, 19, C.hotPink).set(6, 19, C.hotPink).set(11, 15, C.hotPink).set(12, 16, C.hotPink).set(11, 16, C.hotPink);
  return stand(s, C.sandDark, 2, 12);
}

function bones(): Img {
  const s = cell();
  s.rect(3, 22, 5, 4, C.white).rect(7, 22, 1, 4, C.mist).rect(4, 26, 3, 1, C.mist);
  s.set(4, 23, C.ink).set(6, 23, C.ink).set(5, 25, C.ink);
  s.rect(10, 26, 4, 1, C.white).set(9, 25, C.white).set(9, 27, C.white).set(14, 25, C.white).set(14, 27, C.white);
  for (const y of [21, 23]) s.set(10, y, C.white).set(11, y - 1, C.white).set(12, y - 1, C.white).set(13, y, C.mist);
  return s.outline(C.ink);
}

function dryBush(frame: number): Img {
  const s = cell();
  const tips: [number, number][] = [
    [3, 22],
    [5, 19],
    [9, 18],
    [12, 20],
    [13, 24],
  ];
  for (const [x, y] of tips) {
    line(s, 8, BASE, x + frame, y, C.mud);
    s.set(x + frame, y, C.copper);
  }
  line(s, 6, 23, 4 + frame, 21, C.mud);
  line(s, 10, 22, 11 + frame, 19, C.mud);
  return s;
}

function dune(): Img {
  const s = cell();
  for (let x = 2; x <= 12; x++) {
    const y = 23 + Math.round(Math.sin(x * 0.9));
    s.set(x, y, C.sandDark).set(x, y + 1, C.lemon);
  }
  for (let x = 5; x <= 14; x++) {
    const y = 27 + Math.round(Math.sin(x * 0.9 + 1.3));
    s.set(x, y, C.sandDark).set(x, y + 1, C.lemon);
  }
  return s;
}

// ---------- the snow ----------

function snowman(): Img {
  const s = cell();
  const snow: Ramp3 = [C.mist, C.white, C.white];
  blob(s, 8, 24.5, 5.5, 4.5, snow);
  blob(s, 8, 18, 4, 3.6, snow);
  blob(s, 8, 12.5, 3.2, 3.2, snow);
  // the deepest shade under each ball
  s.rect(6, BASE, 5, 1, C.skyLight).rect(8, 21, 3, 1, C.skyLight);
  // twig arms
  line(s, 3, 18, 1, 15, C.mud);
  s.set(2, 15, C.mud);
  line(s, 12, 18, 14, 15, C.mud);
  s.set(13, 15, C.mud);
  // hat, face, scarf, buttons
  s.rect(4, 9, 8, 1, C.shadow).rect(6, 5, 4, 4, C.shadow).rect(6, 5, 1, 3, C.slate).rect(6, 8, 4, 1, C.vermilion);
  s.set(7, 12, C.ink).set(9, 12, C.ink).set(9, 13, C.orange).set(10, 13, C.orange).set(11, 13, C.amberDark);
  s.rect(5, 15, 6, 1, C.vermilion).rect(10, 16, 1, 2, C.vermilion).set(5, 15, C.brick);
  s.set(8, 18, C.ink).set(8, 20, C.ink);
  return stand(s, C.skyLight, 2, 12);
}

function drift(twigs: boolean): Img {
  const s = cell();
  const x0 = twigs ? 1 : 2;
  const w = twigs ? 8 : 11;
  for (let i = 0; i <= w; i++) {
    const x = x0 + i;
    const top = 27 - Math.round((twigs ? 2 : 3) * Math.sin((i / w) * Math.PI));
    s.rect(x, top, 1, 29 - top, C.white).set(x, top, C.mist).set(x, 28, i > w * 0.3 ? C.skyLight : C.mist);
  }
  s.rect(x0 + 2, 29, w - 2, 1, C.skyLight);
  if (twigs) {
    line(s, 11, 28, 10, 22, C.tan);
    line(s, 12, 28, 13, 23, C.mud);
    line(s, 13, 28, 14, 25, C.tan);
    s.set(9, 24, C.mud).set(14, 22, C.tan);
  }
  return s;
}

// ---------- the cave ----------

const ROCK: Ramp3 = [C.shadow, C.slate, C.silver];

function stalagmites(spikes: [number, number, number, number][]): Img {
  const s = cell();
  for (const [cx, base, half, height] of spikes) cone(s, cx, base, half, height, ROCK);
  return stand(s, C.slate, 2, 12);
}

function glowShroom(bright: boolean): Img {
  const s = cell();
  const [d, b, l] = bright ? [C.turquoise, C.aqua, C.white] : [C.teal, C.turquoise, C.aqua];
  const cap = (x: number, y: number, w: number) => {
    s.rect(x + 1, y, w - 2, 1, l).rect(x, y + 1, w, 1, b).rect(x, y + 2, w, 1, d);
    s.rect(x + Math.floor(w / 2) - 1, y + 3, 2, 2, C.mist);
  };
  cap(3, 22, 6);
  cap(9, 25, 4);
  s.outline(C.ink);
  if (bright) s.set(2, 20, C.mint).set(10, 21, C.mint).set(13, 23, C.mint);
  return s;
}

// ---------- small things ----------

function stones(list: [number, number, number, number][], [dark, base, light]: Ramp3): Img {
  const s = cell();
  for (const [x, y, w, h] of list) {
    s.rect(x, y, w, h, base).rect(x, y, w, 1, light).rect(x, y + h - 1, w, 1, dark);
    if (w > 2) s.set(x, y, null).set(x + w - 1, y, null).set(x + w - 1, y + 1, dark);
  }
  return s;
}

function flowers(variant: number): Img {
  const s = cell();
  const flower = (x: number, y: number, petal: string, centre: string) => {
    s.rect(x, y + 2, 1, 2, C.greenDark);
    s.set(x - 1, y, petal).set(x + 1, y, petal).set(x, y - 1, petal).set(x, y + 1, petal).set(x, y, centre);
  };
  if (variant === 0) {
    flower(4, 22, C.white, C.amber);
    flower(10, 20, C.pinkLight, C.amber);
    flower(12, 26, C.white, C.amber);
  } else {
    flower(5, 25, C.pinkLight, C.lemon);
    flower(11, 22, C.lemon, C.orange);
    flower(3, 20, C.white, C.amber);
  }
  return s;
}

function mushrooms(ramp: Ramp3, dots: boolean, flip: boolean): Img {
  const s = cell();
  const [d, b, l] = ramp;
  // the big one
  s.rect(6, 20, 4, 1, l).rect(5, 21, 6, 1, b).rect(4, 22, 8, 1, b).rect(4, 23, 8, 1, d);
  s.rect(7, 24, 2, 4, C.white).rect(8, 24, 1, 4, C.mist);
  if (dots) s.set(6, 21, C.white).set(9, 22, C.white).set(5, 22, C.white);
  // the small one beside it
  s.rect(12, 24, 2, 1, l).rect(11, 25, 4, 1, b).rect(11, 26, 4, 1, d).rect(12, 27, 2, 2, C.white);
  if (dots) s.set(13, 25, C.white);
  s.outline(C.ink);
  return flip ? cell().blit(s, 0, 0, 0, 0, W, H, true) : s;
}

function puddle([edge, body, glint]: Ramp3, frame: number): Img {
  const s = cell();
  s.ellipse(3, 23, 10, 5, edge).ellipse(3, 23, 10, 4, body);
  s.rect(5 + frame * 3, 24, 2, 1, glint).set(11 - frame * 3, 26, glint);
  return s;
}

function moss(): Img {
  const s = cell();
  for (const [x, y] of [
    [4, 25],
    [5, 25],
    [5, 26],
    [6, 26],
    [7, 27],
    [8, 27],
    [9, 26],
    [10, 26],
    [10, 25],
    [11, 24],
    [6, 24],
  ])
    s.set(x!, y!, C.sageDark);
  for (const [x, y] of [
    [5, 24],
    [7, 26],
    [9, 25],
    [11, 25],
  ])
    s.set(x!, y!, C.sage);
  s.rect(8, 23, 1, 3, C.greenDark).set(7, 22, C.green).set(9, 22, C.green).set(8, 22, C.greenDark);
  return s;
}

function lily(flower: boolean): Img {
  const s = cell();
  s.ellipse(4, 21, 8, 6, C.greenDark).ellipse(4, 21, 8, 5, C.green);
  s.rect(6, 22, 2, 1, C.grass);
  s.set(8, 25, null).set(8, 26, null).set(7, 26, null).set(9, 26, null);
  if (flower) s.set(9, 22, C.pinkLight).set(10, 23, C.pinkLight).set(8, 23, C.pinkLight).set(9, 24, C.pinkLight).set(9, 23, C.lemon);
  return s;
}

/** A ring spreading on water, drawn over the game by the ambience layer. */
function ripple(frame: number): Img {
  const s = cell();
  if (frame === 0) return s.rect(7, 26, 2, 1, C.skyLight);
  const rx = frame === 1 ? 3 : 5.5;
  const ry = rx / 2;
  for (let a = 0; a < 48; a++) {
    if (frame === 2 && a % 4 === 0) continue; // the widest ring breaks up
    const t = (a / 48) * Math.PI * 2;
    s.set(Math.round(7.5 + Math.cos(t) * rx), Math.round(26 + Math.sin(t) * ry), C.skyLight);
  }
  return s;
}

// ---------- blades: tall grass, ferns, reeds ----------

interface Blades {
  back: string[];
  front: string[];
  tip: string;
  /** A blade every `step` pixels. */
  step: number;
  /** Shortest and tallest back blade. */
  min: number;
  max: number;
}

/** Leaning left (-1), upright (0) or right (1). `frontOnly` is the row drawn over the feet. */
function blades(seed: number, leanBy: number, o: Blades, frontOnly = false): Img {
  const rnd = mulberry(seed);
  const g = cell();
  const draw = (x0: number, h: number, base: number, colour: string, own: number, tip: string) => {
    for (let i = 0; i < h; i++) {
      const t = i / h;
      const off = (t > 0.55 ? own : 0) + (t > 0.4 ? leanBy : 0);
      g.set(x0 + off, base - i, i === h - 1 ? tip : colour);
    }
  };
  for (let x = 0; x < W; x += o.step) {
    const h = o.min + Math.floor(rnd() * (o.max - o.min + 1));
    const own = Math.floor(rnd() * 3) - 1;
    const colour = o.back[Math.floor(rnd() * o.back.length)]!;
    const tip = rnd() < 0.35 ? o.tip : colour;
    if (!frontOnly) draw(x, h, 29, colour, own, tip);
  }
  for (let x = o.step > 1 ? 1 : 0; x < W; x += o.step) {
    const h = 3 + Math.floor(rnd() * 4);
    const own = Math.floor(rnd() * 3) - 1;
    const colour = o.front[Math.floor(rnd() * o.front.length)]!;
    const tip = rnd() < 0.3 ? o.tip : colour;
    // gaps in the front row let the ground show, so a lone tuft is not a block
    if (rnd() < 0.7) draw(x, h, 30, colour, own, tip);
  }
  return g;
}

const GRASS: Blades = { back: [C.greenDark, C.greenDark, C.green], front: [C.green], tip: C.lime, step: 1, min: 8, max: 13 };
const FERN: Blades = { back: [C.green, C.grass], front: [C.grass], tip: C.grassLight, step: 2, min: 5, max: 9 };
const three = (seed: number, o: Blades, frontOnly = false) => [-1, 0, 1].map((k) => blades(seed, k, o, frontOnly));

function reeds(leanBy: number): Img {
  const g = cell();
  for (const [x, h] of [
    [4, 15],
    [8, 19],
    [11, 13],
  ] as const) {
    for (let i = 0; i < h; i++) {
      const off = i > h * 0.5 ? leanBy : 0;
      g.set(x + off, 29 - i, i >= h - 5 && i < h - 1 ? C.mud : C.olive);
    }
    for (let i = 0; i < 6; i++) g.set(x + 1 + (i > 3 ? 1 + leanBy : 0), 29 - i, C.moss);
  }
  return g;
}

// ---------- the sheets ----------

const DRAW: Record<PropName, () => Img[]> = {
  oakA: () => oak([C.greenDark, C.green, C.grass], false),
  oakB: () => oak([C.olive, C.moss, C.lime], true),
  oakC: () => oak([C.rust, C.orange, C.amber], false),
  pineA: () => pine(true),
  pineB: () => pine(false),
  palm,
  bushA: () => bush(false),
  bushB: () => bush(true),
  planterA: () => planter(false),
  planterB: () => planter(true),
  cactusA: () => [cactusTall()],
  cactusB: () => [cactusBarrel()],
  cactusC: () => [cactusPear()],
  snowman: () => [snowman()],
  stalagA: () => [
    stalagmites([
      [3.5, 27, 2.5, 8],
      [12.5, 27, 2.5, 11],
      [8, BASE, 4.5, 23],
    ]),
  ],
  stalagB: () => [
    stalagmites([
      [11, 27, 3.5, 17],
      [5, BASE, 3.5, 13],
    ]),
  ],
  stalagC: () => [
    stalagmites([
      [8, 27, 3, 11],
      [3.5, BASE, 2.5, 6],
      [12.5, BASE, 2.5, 7],
    ]),
  ],
  tallGrassA: () => three(7, GRASS),
  tallGrassB: () => three(23, GRASS),
  grassFront: () => three(7, GRASS, true),
  fern: () => three(41, FERN),
  reeds: () => [-1, 0, 1].map(reeds),
  flowersA: () => [flowers(0)],
  flowersB: () => [flowers(1)],
  shroomRed: () => [mushrooms([C.brick, C.red, C.vermilion], true, false)],
  shroomRedB: () => [mushrooms([C.brick, C.red, C.vermilion], true, true)],
  shroomBrown: () => [mushrooms([C.rust, C.copper, C.sandDark], false, false)],
  glowShroom: () => [glowShroom(false), glowShroom(true)],
  pebblesA: () => [
    stones(
      [
        [3, 25, 4, 3],
        [9, 22, 3, 2],
        [10, 27, 4, 3],
      ],
      [C.dustyRose, C.tan, C.skin],
    ),
  ],
  pebblesB: () => [
    stones(
      [
        [5, 23, 5, 3],
        [11, 26, 3, 2],
        [2, 28, 2, 2],
      ],
      [C.dustyRose, C.tan, C.skin],
    ),
  ],
  rubbleA: () => [
    stones(
      [
        [3, 25, 4, 3],
        [9, 22, 3, 2],
        [10, 27, 4, 3],
      ],
      ROCK,
    ),
  ],
  rubbleB: () => [
    stones(
      [
        [5, 23, 5, 3],
        [11, 26, 3, 2],
        [2, 28, 2, 2],
      ],
      ROCK,
    ),
  ],
  bones: () => [bones()],
  dryBush: () => [dryBush(0), dryBush(1)],
  dune: () => [dune()],
  driftA: () => [drift(false)],
  driftB: () => [drift(true)],
  puddleCave: () => [0, 1].map((f) => puddle([C.navy, C.indigo, C.skyLight], f)),
  puddleRoof: () => [0, 1].map((f) => puddle([C.blue, C.sky, C.white], f)),
  moss: () => [moss()],
  lilyA: () => [lily(false)],
  lilyB: () => [lily(true)],
  ripple: () => [0, 1, 2].map(ripple),
};

interface WaterSpec {
  deep: string;
  body: string;
  shine: string;
  /** The line where the bank meets the water, and the bank itself. */
  edge: string;
  shore: string;
  /** Ice: nothing drifts. */
  still?: boolean;
}

const WATER: Record<1 | 2 | 3 | 4 | 5 | 6, WaterSpec> = {
  1: { deep: C.blue, body: C.sky, shine: C.skyLight, edge: C.greenDark, shore: C.green },
  2: { deep: C.teal, body: C.turquoise, shine: C.aqua, edge: C.copper, shore: C.sandDark },
  3: { deep: C.sky, body: C.skyLight, shine: C.white, edge: C.sky, shore: C.mist, still: true },
  4: { deep: C.tealDark, body: C.teal, shine: C.turquoise, edge: C.tealGrey, shore: C.pine },
  5: { deep: C.blue, body: C.sky, shine: C.skyLight, edge: C.silver, shore: C.white },
  6: { deep: C.navy, body: C.indigo, shine: C.sky, edge: C.shadow, shore: C.slate },
};

const BANK = 2;
const ROUND = 4;

/** One water tile. `mask` says which sides are not water: those get a bank, and two banks meeting get a round corner. */
function waterCell(spec: WaterSpec, frame: number, mask: number): Img {
  const T = WATER_CELL;
  const open = { n: !!(mask & SHORE.n), e: !!(mask & SHORE.e), s: !!(mask & SHORE.s), w: !!(mask & SHORE.w) };
  const l = open.w ? BANK : 0;
  const r = T - (open.e ? BANK : 0);
  const t = open.n ? BANK : 0;
  const b = T - (open.s ? BANK : 0);
  const wet = (x: number, y: number): boolean => {
    // beyond the tile: the neighbour's water
    if (x < 0) return !open.w && y >= t && y < b;
    if (x >= T) return !open.e && y >= t && y < b;
    if (y < 0) return !open.n && x >= l && x < r;
    if (y >= T) return !open.s && x >= l && x < r;
    if (x < l || x >= r || y < t || y >= b) return false;
    const corner = (on: boolean, cx: number, cy: number, inX: boolean, inY: boolean) => on && inX && inY && (cx - x - 0.5) ** 2 + (cy - y - 0.5) ** 2 > ROUND * ROUND;
    if (corner(open.n && open.w, l + ROUND, t + ROUND, x < l + ROUND, y < t + ROUND)) return false;
    if (corner(open.n && open.e, r - ROUND, t + ROUND, x >= r - ROUND, y < t + ROUND)) return false;
    if (corner(open.s && open.w, l + ROUND, b - ROUND, x < l + ROUND, y >= b - ROUND)) return false;
    if (corner(open.s && open.e, r - ROUND, b - ROUND, x >= r - ROUND, y >= b - ROUND)) return false;
    return true;
  };
  const shift = spec.still ? 0 : frame * 4;
  const bands = new Map<string, string>();
  const band = (y: number, x: number, w: number, c: string) => {
    for (let i = 0; i < w; i++) bands.set(`${(x + i + shift) % T},${y}`, c);
  };
  band(3, 2, 5, spec.shine);
  band(4, 4, 2, spec.shine);
  band(10, 9, 5, spec.shine);
  band(11, 11, 2, spec.shine);
  band(7, 13, 3, spec.deep);
  band(14, 4, 3, spec.deep);
  if (spec.still) {
    // ice: a crack and a glint that moves with the frame
    for (let i = 0; i < 5; i++) bands.set(`${5 + i},${12 - i}`, spec.deep);
    bands.set(`${3 + frame * 3},${6}`, spec.shine);
  }
  const g = new Img(T, T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (!wet(x, y)) {
        // the bank: only close to the water, so a round corner leaves the ground showing
        let near = false;
        for (let dy = -BANK; dy <= BANK && !near; dy++) for (let dx = -BANK; dx <= BANK && !near; dx++) near = Math.abs(dx) + Math.abs(dy) <= BANK + 1 && wet(x + dx, y + dy);
        if (near) g.set(x, y, spec.shore);
        continue;
      }
      const atEdge = !wet(x - 1, y) || !wet(x + 1, y) || !wet(x, y - 1) || !wet(x, y + 1);
      if (atEdge) g.set(x, y, spec.edge);
      else if (!wet(x, y - 2)) g.set(x, y, spec.deep); // the bank's shadow on the water
      else g.set(x, y, bands.get(`${x},${y}`) ?? spec.body);
    }
  return g;
}

export interface BiomeManifest {
  props: { image: string; cellWidth: number; cellHeight: number; columns: number; frames: Record<string, number[]> };
  water: { image: string; cell: number; frames: number; masks: number };
}

export function buildBiomes(dir: string): BiomeManifest {
  const rows = Math.ceil(PROP_LIST.reduce((n, [, count]) => n + count, 0) / PROP_COLS);
  const sheet = new Img(PROP_COLS * W, rows * H);
  for (const [name, count] of PROP_LIST) {
    const frames = DRAW[name]();
    if (frames.length !== count) throw new Error(`biomes: ${name} drew ${frames.length} frames, the sheet table says ${count}`);
    frames.forEach((f, i) => {
      // only a TALL prop may reach into the tile above: the game keeps those tiles clear
      const limit = TALL.includes(name) ? 0 : H / 2 - POKE_PX;
      for (let y = 0; y < limit; y++) for (let x = 0; x < W; x++) if (f.get(x, y)) throw new Error(`biomes: ${name} is drawn above its tile but is not in TALL`);
      const index = PROPS[name][i]!;
      sheet.blit(f, (index % PROP_COLS) * W, Math.floor(index / PROP_COLS) * H);
    });
  }
  sheet.save(`${dir}/${PROP_SHEET}`);

  const water = new Img(WATER_MASKS * WATER_CELL, 6 * WATER_FRAMES * WATER_CELL);
  for (const face of [1, 2, 3, 4, 5, 6] as const)
    for (let frame = 0; frame < WATER_FRAMES; frame++)
      for (let mask = 0; mask < WATER_MASKS; mask++) water.blit(waterCell(WATER[face], frame, mask), mask * WATER_CELL, waterRow(face, frame) * WATER_CELL);
  water.save(`${dir}/${WATER_SHEET}`);

  return {
    props: { image: PROP_SHEET, cellWidth: W, cellHeight: H, columns: PROP_COLS, frames: PROPS },
    water: { image: WATER_SHEET, cell: WATER_CELL, frames: WATER_FRAMES, masks: WATER_MASKS },
  };
}
