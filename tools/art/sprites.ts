// The two playable characters, the puzzle objects and the items. 16x16 frames.
import { C, ROLE } from '../../client/src/style/tokens';
import { existsSync } from 'node:fs';
import { Img, strip, type Color } from './img';
import { cut } from './tiles';

const T = 16;

function check(rows: string[], what: string): string[] {
  if (rows.length !== T || rows.some((r) => r.length !== T)) throw new Error(`${what}: every sprite is 16 rows of 16 characters`);
  return rows;
}

// ---------- characters ----------
// Both face right (the game mirrors them to face left). Big head, small body: at 16px the
// face is the character. The OUTSIDE one is an explorer in a green cap; the INSIDE one is
// wrapped in an amber cloak and carries a lantern, the only warm light in the dark rooms.

const OUT_KEY: Record<string, Color> = { o: C.ink, C: ROLE.out.light, c: ROLE.out.base, d: ROLE.out.dark, s: C.skin, S: C.peach, e: C.ink, w: C.white, m: C.mist, p: C.blue, b: C.indigo };
const OUT_TOP = [
  '................',
  '....oooooooo....',
  '...oCCCCCCCCo...',
  '..oCccccccccdo..',
  '..occccccccccdo.',
  '..oddddddddddddo',
  '..osssssssssoooo',
  '..ossseosseoso..',
  '..oSssssssssSo..',
  '...oooooooooo...',
  '...owwwwwwwwo...',
  '..oswwwwwwwwso..',
  '..oommmmmmmmoo..',
];
const OUT_LEGS = {
  stand: ['...oppppppppo...', '...opbo..opbo...', '...ooo....ooo...'],
  stepA: ['...oppppppppo...', '...opbo...ooo...', '...ooo..........'],
  stepB: ['...oppppppppo...', '...ooo...opbo...', '.........ooo....'],
};

const IN_KEY: Record<string, Color> = { o: C.ink, H: ROLE.in.light, h: ROLE.in.base, d: ROLE.in.dark, D: ROLE.in.deep, s: C.skin, S: C.peach, e: C.ink, L: C.lemon, l: C.white, r: C.wine };
const IN_TOP = [
  '................',
  '......oooo......',
  '.....oHHHHo.....',
  '....oHhhhhho....',
  '...oHhhhhhhdo...',
  '..oHhooooooddo..',
  '..ohosssssssdo..',
  '..ohsseosseodo..',
  '..ohSsssssssdo..',
  '...ohoooooodo...',
  '...ohhhhhhhdo.o.',
  '..ohhhhhhhhhdoLo',
  '..ohdhhhhhhddolo',
];
const IN_LEGS = {
  stand: ['...oDDDDDDDDo.o.', '...orro..orro...', '...ooo....ooo...'],
  stepA: ['...oDDDDDDDDo.o.', '...orro...ooo...', '...ooo..........'],
  stepB: ['...oDDDDDDDDo.o.', '...ooo...orro...', '.........ooo....'],
};

function character(top: string[], legs: typeof OUT_LEGS, key: Record<string, Color>, who: string): Img[] {
  const frame = (rows: string[]) => new Img(T, T).art(0, 0, check(rows, who), key);
  const idle0 = frame([...top, ...legs.stand]);
  // breathing: everything above the legs sinks one pixel and the chest row is covered
  const idle1 = frame(['................', ...top.slice(0, 12), ...legs.stand]);
  return [idle0, idle1, frame([...top, ...legs.stepA]), frame([...top, ...legs.stepB])];
}

// ---------- objects ----------

function door(open: boolean): Img {
  const g = new Img(T, T);
  if (open) {
    // the frame stays, the leaf is swung away: you see the threshold
    g.rect(0, 0, 3, T, C.ink).rect(1, 0, 1, T, C.rust).rect(13, 0, 3, T, C.ink).rect(14, 0, 1, T, C.rust);
    g.rect(3, 0, 10, 2, C.ink).rect(3, 0, 10, 1, C.rust);
    return g;
  }
  g.rect(0, 0, T, T, C.ink).rect(1, 1, 14, 14, C.copper);
  for (const x of [4, 8, 12]) g.rect(x, 1, 1, 14, C.rust);
  g.rect(1, 1, 14, 1, C.sandDark);
  for (const y of [3, 11]) g.rect(1, y, 14, 2, C.slate).rect(1, y, 14, 1, C.mauve).set(3, y, C.white).set(12, y, C.white);
  g.rect(10, 7, 2, 2, C.amber).set(10, 7, C.lemon);
  return g;
}

function crystal(sparkle: boolean): Img {
  const g = cut('N', 2, 15).quantize();
  if (sparkle) g.set(12, 2, C.white).set(11, 3, C.white).set(13, 3, C.white).set(12, 4, C.white).set(3, 11, C.white);
  return g;
}

function crystalTaken(): Img {
  return new Img(T, T).art(0, 0, check([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....oddddddo....',
    '....odooooddo...',
    '....oddddddo....',
    '.....oooooo.....',
    '................',
  ], 'crystal'), { o: C.ink, d: C.mauve });
}

/** A portal tile. The portal is 2x2 of these; shut it is cold stone, open it turns. */
function portal(frame: number | null): Img {
  const g = new Img(T, T, frame === null ? C.shadow : C.purpleDark);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const r = Math.hypot(dx, dy);
      if (frame === null) {
        if (r > 4 && r < 6) g.set(x, y, C.slate);
        if (r < 2) g.set(x, y, C.ink);
        continue;
      }
      const arm = (((Math.atan2(dy, dx) + r * 0.45 - (frame * Math.PI) / 4) / (Math.PI / 2)) % 1 + 1) % 1;
      if (r < 8.5) g.set(x, y, arm < 0.22 ? C.pinkLight : arm < 0.5 ? ROLE.portal : ROLE.portalDark);
      if (r < 1.5) g.set(x, y, C.white);
    }
  return g;
}

function pot(): Img {
  return new Img(T, T).art(0, 0, check([
    '................',
    '................',
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '..oLLLLLLLLLco..',
    '..oommmmmmmmoo..',
    '...occcccccro...',
    '...oLcccccrro...',
    '...oLcccccrro...',
    '....occccrro....',
    '....occccrro....',
    '.....orrrro.....',
    '.....oooooo.....',
    '................',
  ], 'pot'), { o: C.ink, L: C.sandDark, c: C.copper, r: C.rust, m: C.mud });
}

function unknown(): Img {
  return new Img(T, T).art(0, 0, check([
    '................',
    '..oooooooooooo..',
    '..oppppppppppo..',
    '..opooooooooPo..',
    '..opoppppppoPo..',
    '..opooooopooPo..',
    '..opoooppoooPo..',
    '..opoopoooooPo..',
    '..opoopoooooPo..',
    '..opooooooooPo..',
    '..opoopoooooPo..',
    '..opooooooooPo..',
    '..opPPPPPPPPPo..',
    '..oooooooooooo..',
    '................',
    '................',
  ], 'unknown'), { o: C.ink, p: C.hotPink, P: C.magenta });
}

// ---------- items ----------

function key(): Img {
  return new Img(T, T).art(0, 0, check([
    '................',
    '................',
    '................',
    '....oooo........',
    '...oaaaao.......',
    '..oaAooAao......',
    '..oao..oaooooo..',
    '..oao..oaaaaaao.',
    '..oaAooAaoAoAo..',
    '...oaaaao.o.o...',
    '....oooo........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], 'key'), { o: C.ink, a: C.amber, A: C.amberDark });
}

function bundle(): Img {
  return new Img(T, T).art(0, 0, check([
    '................',
    '................',
    '................',
    '......o..o......',
    '.....oto.oto....',
    '......otoo......',
    '....ooooooo.....',
    '...obbbtbbbo....',
    '..obbbbtbbbbo...',
    '..obbbbtbbbbo...',
    '..otttttttttto..',
    '..obbbbtbbbbo...',
    '..oddddtddddo...',
    '...ooooooooo....',
    '................',
    '................',
  ], 'bundle'), { o: C.ink, b: C.tan, d: C.dustyRose, t: C.crimson });
}

export interface SpriteManifest {
  objects: Record<string, { image: string; frames: Record<string, number | number[]>; sides?: Partial<Record<'out' | 'in', Record<string, number | number[]>>> }>;
  items: Record<string, { image: string; frame: number }>;
  players: Record<'out' | 'in', { image: string; idle: number[]; walk: number[] }>;
}

export function buildSprites(dir: string): SpriteManifest {
  // The player sheets are the team's turtle art (6 columns: rows 0-4 idle, 5-7 walk down, up, right).
  // Never overwrite them; the code-drawn characters are only a stand-in for a missing sheet.
  const stand = (file: string, frames: Img[]): void => {
    if (!existsSync(file)) strip(frames).save(file);
  };
  stand(`${dir}/sprites/player-out.png`, character(OUT_TOP, OUT_LEGS, OUT_KEY, 'player-out'));
  stand(`${dir}/sprites/player-in.png`, character(IN_TOP, IN_LEGS, IN_KEY, 'player-in'));

  const plateOut = [cut('D', 0, 1).quantize(), cut('D', 1, 1).quantize()];
  // the inside plate is the same switch in the inside's own colour
  const amber = { [C.red]: C.amber, [C.crimson]: C.amberDark, [C.brick]: C.amberDark, [C.vermilion]: C.amber, [C.maroon]: C.rust, [C.coral]: C.lemon, [C.salmon]: C.lemon };
  const plateIn = plateOut.map((p) => p.clone().swap(amber));
  const objects = [
    door(false), door(true), // 0 1
    ...plateOut, // 2 3
    ...plateIn, // 4 5
    crystal(false), crystal(true), crystalTaken(), // 6 7 8
    portal(null), portal(0), portal(1), portal(2), portal(3), // 9, 10-13
    pot(), // 14
    unknown(), // 15
  ];
  const sheet = new Img(T * 8, T * 2);
  objects.forEach((o, i) => sheet.blit(o, (i % 8) * T, Math.floor(i / 8) * T));
  sheet.save(`${dir}/sprites/objects.png`);

  strip([cut('N', 3, 11).quantize(), key(), bundle()]).save(`${dir}/sprites/items.png`);

  const image = 'sprites/objects.png';
  return {
    objects: {
      door: { image, frames: { closed: 0, open: 1, default: 0 } },
      plate: { image, frames: { off: 2, on: 3, default: 2 }, sides: { in: { off: 4, on: 5, default: 4 } } },
      crystal: { image, frames: { idle: [6, 7], taken: 8, default: [6, 7] } },
      portal: { image, frames: { closed: 9, open: [10, 11, 12, 13], default: 9 } },
      target: { image, frames: { default: 14 } },
      unknown: { image, frames: { default: 15 } },
    },
    items: {
      rose: { image: 'sprites/items.png', frame: 0 },
      key: { image: 'sprites/items.png', frame: 1 },
      default: { image: 'sprites/items.png', frame: 2 },
    },
    players: {
      out: { image: 'sprites/player-out.png', idle: [0, 1], walk: [30, 31, 32, 33] },
      in: { image: 'sprites/player-in.png', idle: [0, 1], walk: [30, 31, 32, 33] },
    },
  };
}
