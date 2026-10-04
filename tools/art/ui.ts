// The UI kit: 9-slice panels and buttons, fields, sliders, toggles, icons, the cursor,
// the player markers and the ready badge. All ours, all drawn here.
import { ICONS as ICON_ORDER } from '../../client/src/style/assets';
import { C, ROLE, type Ramp } from '../../client/src/style/tokens';
import { drawText, textWidth } from './font';
import { Img, strip, type Color } from './img';

/** Clip the four corners of a box into 2px pixel-rounded corners. */
function round(g: Img, x: number, y: number, w: number, h: number): void {
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]] as const) g.set(cx, cy, null);
}

/**
 * A raised 9-slice box, 24x24 with 6px corners: 1px outline, a lit top edge, a face and a
 * lip under it. `sink` pushes the face down into the lip (a pressed button).
 */
function box(face: string, lit: string, lip: string, outline: string, lipH: number, sink = 0): Img {
  const g = new Img(24, 24);
  const top = sink;
  g.rect(0, top, 24, 24 - top, outline);
  g.rect(1, top + 1, 22, 22 - top, lip);
  g.rect(1, top + 1, 22, 22 - top - lipH, face);
  g.rect(1, top + 1, 22, 1, lit);
  g.set(1, top + 1, face).set(22, top + 1, face);
  round(g, 0, top, 24, 24 - top);
  // inner corner pixels keep the outline continuous after rounding
  g.set(1, top + 1, outline).set(22, top + 1, outline).set(1, 22, outline).set(22, 22, outline);
  return g;
}

type Variant = { face: string; lit: string; lip: string; hoverFace: string; hoverLit: string; pressFace: string };
const fromRamp = (r: Ramp): Variant => ({ face: r.base, lit: r.light, lip: r.dark, hoverFace: r.light, hoverLit: C.white, pressFace: r.dark });
export const BUTTONS: Record<string, Variant> = {
  /** On light surfaces: the default action. */
  dark: { face: C.shadow, lit: C.slate, lip: C.ink, hoverFace: C.slate, hoverLit: C.mauve, pressFace: C.ink },
  /** On dark surfaces, and secondary actions on light ones. */
  light: { face: C.white, lit: C.white, lip: C.silver, hoverFace: C.mist, hoverLit: C.white, pressFace: C.silver },
  out: fromRamp(ROLE.out),
  in: fromRamp(ROLE.in),
  danger: { face: C.red, lit: C.salmon, lip: C.crimson, hoverFace: C.salmon, hoverLit: C.peach, pressFace: C.crimson },
};

function buttons(dir: string): void {
  for (const [name, v] of Object.entries(BUTTONS)) {
    box(v.face, v.lit, v.lip, C.ink, 3).save(`${dir}/ui/btn-${name}-idle.png`);
    box(v.hoverFace, v.hoverLit, v.lip, C.ink, 3).save(`${dir}/ui/btn-${name}-hover.png`);
    box(v.pressFace, v.pressFace, v.lip, C.ink, 1, 2).save(`${dir}/ui/btn-${name}-pressed.png`);
  }
  // one disabled look for every variant: flat, no lip to press
  box(C.mist, C.mist, C.silver, C.silver, 3).save(`${dir}/ui/btn-disabled.png`);
}

function panels(dir: string): void {
  box(ROLE.surface, C.white, ROLE.surfaceShade, C.ink, 2).save(`${dir}/ui/panel.png`);
  box(ROLE.surfaceDark, ROLE.surfaceDarkLit, ROLE.surfaceDarkDeep, C.slate, 2).save(`${dir}/ui/panel-dark.png`);
  // a quiet frame for the game view and for lists: outline only, see-through middle
  const frame = new Img(24, 24);
  frame.rect(0, 0, 24, 24, C.ink).rect(2, 2, 20, 20, null);
  round(frame, 0, 0, 24, 24);
  frame.save(`${dir}/ui/frame.png`);

  // inset fields (code letters, chat input): 12x12, 4px corners
  const field = (fill: string, edge: string, shade: string) => {
    const g = new Img(12, 12, edge);
    g.rect(1, 1, 10, 10, fill).rect(1, 1, 10, 1, shade);
    round(g, 0, 0, 12, 12);
    return g;
  };
  field(C.white, C.ink, C.mist).save(`${dir}/ui/field.png`);
  field(C.white, ROLE.focus, C.lemon).save(`${dir}/ui/field-active.png`);
  field(C.ink, C.ink, C.ink).save(`${dir}/ui/field-dark.png`);
  field(C.ink, ROLE.focus, C.ink).save(`${dir}/ui/field-dark-active.png`);
  field(C.peach, ROLE.danger, C.salmon).save(`${dir}/ui/field-error.png`);

  // tags: small solid pills for labels (room code, P1 / P2)
  const tag = (fill: string, edge: string) => {
    const g = new Img(12, 12, edge);
    g.rect(1, 1, 10, 10, fill);
    round(g, 0, 0, 12, 12);
    return g;
  };
  tag(C.ink, C.ink).save(`${dir}/ui/tag.png`);
  tag(C.white, C.ink).save(`${dir}/ui/tag-light.png`);
  tag(ROLE.p1.base, C.ink).save(`${dir}/ui/tag-p1.png`);
  tag(ROLE.p2.base, C.ink).save(`${dir}/ui/tag-p2.png`);
}

function controls(dir: string): void {
  // slider: 12x6 track (3-slice, 4px caps) in an empty and a filled colour, and a knob
  const track = (fill: string) => {
    const g = new Img(12, 6, C.ink);
    g.rect(1, 1, 10, 4, fill);
    round(g, 0, 0, 12, 6);
    return g;
  };
  track(C.mauve).save(`${dir}/ui/slider-track.png`);
  track(ROLE.out.base).save(`${dir}/ui/slider-fill.png`);
  const knob = new Img(8, 12, C.ink);
  knob.rect(1, 1, 6, 10, C.white).rect(1, 9, 6, 2, C.silver).rect(3, 3, 2, 5, C.mist);
  round(knob, 0, 0, 8, 12);
  knob.save(`${dir}/ui/slider-knob.png`);

  // toggle: 22x12, off then on
  const toggle = (on: boolean) => {
    const g = new Img(22, 12, C.ink);
    g.rect(1, 1, 20, 10, on ? ROLE.out.base : C.mauve);
    g.rect(1, 1, 20, 1, on ? ROLE.out.dark : C.slate);
    round(g, 0, 0, 22, 12);
    const kx = on ? 11 : 1;
    g.rect(kx, 1, 10, 10, C.ink).rect(kx + 1, 2, 8, 8, C.white).rect(kx + 1, 8, 8, 2, C.silver);
    return g;
  };
  strip([toggle(false), toggle(true)]).save(`${dir}/ui/toggle.png`);
}

const K: Record<string, Color> = { o: C.ink, w: C.white, m: C.mist, s: C.silver, g: C.mauve, r: C.red, a: C.amber, A: C.amberDark, G: C.green, t: C.mint, b: C.sky, v: C.violet, k: C.slate };
const icon = (rows: string[]): Img => {
  if (!rows || rows.length !== 16 || rows.some((r) => r.length !== 16)) throw new Error('an icon is 16 rows of 16 characters');
  return new Img(16, 16).art(0, 0, rows, K);
};

/** 16x16 icons, white with an ink outline so they read on light and dark surfaces. */
export const ICONS: Record<string, string[]> = {
  mic: [
    '................',
    '......oooo......',
    '.....owwwwo.....',
    '.....owmmwo.....',
    '.....owmmwo.....',
    '.....owmmwo.....',
    '...o.owwwwo.o...',
    '..owo.oooo.owo..',
    '..owwo....owwo..',
    '...owwoooowwo...',
    '....owwwwwwo....',
    '.....oowwoo.....',
    '......owwo......',
    '....oowwwwoo....',
    '....owwwwwwo....',
    '....oooooooo....',
  ],
  micOff: [
    '.oo.............',
    'orro..oooo......',
    '.orrowwwwo......',
    '..orrommwo......',
    '...orromwo......',
    '....orrowo......',
    '...o.orroo..o...',
    '..owo.orro.owo..',
    '..owwo.orrowwo..',
    '...owwoorrowo...',
    '....owwworro....',
    '.....oowworro...',
    '......owwoorro..',
    '....oowwwwoorro.',
    '....owwwwwwoorro',
    '....oooooooo.oo.',
  ],
  speaker: [
    '................',
    '........oo......',
    '.......owo......',
    '......owwo..o...',
    '..oooowwwo.owo..',
    '.owwwwwwwo..owo.',
    '.owwwwwwwo.o.owo',
    '.owwwwwwwo.wo.wo',
    '.owwwwwwwo.wo.wo',
    '.owwwwwwwo.o.owo',
    '.owwwwwwwo..owo.',
    '..oooowwwo.owo..',
    '......owwo..o...',
    '.......owo......',
    '........oo......',
    '................',
  ],
  music: [
    '................',
    '.....oooooooooo.',
    '.....owwwwwwwwo.',
    '.....owwwwwwwwo.',
    '.....owoooooowo.',
    '.....owo....owo.',
    '.....owo....owo.',
    '.....owo....owo.',
    '.....owo....owo.',
    '..oooowo.oooowo.',
    '.owwwwwooowwwwo.',
    '.owwwwwoowwwwwo.',
    '.owwwwwoowwwwwo.',
    '..ooooo..ooooo..',
    '................',
    '................',
  ],
  sfx: [
    '................',
    '.......oo.......',
    '......owwo......',
    '.....owwwwo.....',
    '....owwwwwwo....',
    '....owwwwwwo....',
    '...owwwwwwwwo...',
    '...owwwwwwwwo...',
    '...owwwwwwwwo...',
    '..owwwwwwwwwwo..',
    '.owwwwwwwwwwwwo.',
    '.oooooooooooooo.',
    '......owwo......',
    '.......oo.......',
    '................',
    '................',
  ],
  check: [
    '................',
    '................',
    '.............oo.',
    '............oGGo',
    '...........oGGGo',
    '..........oGGGo.',
    '.........oGGGo..',
    '.oo.....oGGGo...',
    'oGGo...oGGGo....',
    'oGGGo.oGGGo.....',
    '.oGGGoGGGo......',
    '..oGGGGGo.......',
    '...oGGGo........',
    '....oGo.........',
    '.....o..........',
    '................',
  ],
  cross: [
    '................',
    '..oo........oo..',
    '.orro......orro.',
    '.orrro....orrro.',
    '..orrro..orrro..',
    '...orrroorrro...',
    '....orrrrrro....',
    '.....orrrro.....',
    '.....orrrro.....',
    '....orrrrrro....',
    '...orrroorrro...',
    '..orrro..orrro..',
    '.orrro....orrro.',
    '.orro......orro.',
    '..oo........oo..',
    '................',
  ],
  clock: [
    '................',
    '.....oooooo.....',
    '...oowwwwwwoo...',
    '..owwwwoowwwwo..',
    '..owwwwoowwwwo..',
    '.owwwwwoowwwwwo.',
    '.owwwwwoowwwwwo.',
    '.owwwwwoowwwwwo.',
    '.owwwwwoooowwwo.',
    '.owwwwwwwwwwwwo.',
    '.owwwwwwwwwwwwo.',
    '..owwwwwwwwwwo..',
    '..owwwwwwwwwwo..',
    '...oowwwwwwoo...',
    '.....oooooo.....',
    '................',
  ],
  crown: [
    '................',
    '................',
    '..o....oo....o..',
    '.oao..oaao..oao.',
    '.oao..oaao..oao.',
    '.oaao.oaao.oaao.',
    '.oaaaoaaaaoaaao.',
    '.oaaaaaaaaaaaao.',
    '.oaaaaaaaaaaaao.',
    '.oaAaaaAAaaaAao.',
    '.oaaaaaaaaaaaao.',
    '.oAAAAAAAAAAAAo.',
    '.oooooooooooooo.',
    '................',
    '................',
    '................',
  ],
  lock: [
    '................',
    '.....oooooo.....',
    '....owwwwwwo....',
    '...owwooooowo...',
    '...owo....owo...',
    '...owo....owo...',
    '..oooooooooooo..',
    '.oaaaaaaaaaaaao.',
    '.oaaaaaooaaaaao.',
    '.oaaaaoooaaaaao.',
    '.oaaaaaooaaaaao.',
    '.oaaaaaooaaaaao.',
    '.oAAAAAAAAAAAAo.',
    '.oooooooooooooo.',
    '................',
    '................',
  ],
  chat: [
    '................',
    '..oooooooooooo..',
    '.owwwwwwwwwwwwo.',
    '.owwwwwwwwwwwwo.',
    '.owwoowoowoowwo.',
    '.owwoowoowoowwo.',
    '.owwwwwwwwwwwwo.',
    '.owwwwwwwwwwwwo.',
    '..oooowwwooooo..',
    '.....owwo.......',
    '.....owo........',
    '.....oo.........',
    '................',
    '................',
    '................',
    '................',
  ],
  ai: [
    '................',
    '.......oo.......',
    '......ovvo......',
    '.......oo.......',
    '..oooooooooooo..',
    '.ovvvvvvvvvvvvo.',
    '.ovwwovvvvwwovo.',
    '.ovwwovvvvwwovo.',
    '.ovvvvvvvvvvvvo.',
    '.ovvoooooooovvo.',
    '.ovvvvvvvvvvvvo.',
    '..oooooooooooo..',
    '................',
    '................',
    '................',
    '................',
  ],
  left: [
    '................',
    '.........oo.....',
    '........owo.....',
    '.......owwo.....',
    '......owwwo.....',
    '.....owwwwo.....',
    '....owwwwwo.....',
    '...owwwwwwo.....',
    '...owwwwwwo.....',
    '....owwwwwo.....',
    '.....owwwwo.....',
    '......owwwo.....',
    '.......owwo.....',
    '........owo.....',
    '.........oo.....',
    '................',
  ],
  hand: [
    '................',
    '......oo.oo.....',
    '....oowwowwoo...',
    '...owowwowwowo..',
    '...owowwowwowo..',
    '...owowwowwowo..',
    '.oo.owwwwwwwwo..',
    'owwoowwwwwwwwo..',
    'owwwowwwwwwwwo..',
    '.owwwwwwwwwwwo..',
    '..owwwwwwwwwwo..',
    '...owwwwwwwwo...',
    '....owwwwwwwo...',
    '....owwwwwwo....',
    '....oooooooo....',
    '................',
  ],
};

function icons(dir: string): string[] {
  // the order is the client's (style/assets.ts); "right" is "left" mirrored
  const frames = ICON_ORDER.map((n) => (n === 'right' ? new Img(16, 16).blit(icon(ICONS.left!), 0, 0, 0, 0, 16, 16, true) : icon(ICONS[n]!)));
  strip(frames).save(`${dir}/ui/icons.png`);
  return [...ICON_ORDER];
}

function gear(dir: string): void {
  // an 8-tooth gear: square teeth on the axes, then the same gear turned 45 degrees
  const upright = icon([
    '................',
    '......oooo......',
    '..oo..owwo..oo..',
    '.owwooowwooowwo.',
    '.owwwwwwwwwwwwo.',
    '..oowwwwwwwwoo..',
    '.ooowwwoowwwooo.',
    'owwwwwo..owwwwwo',
    'owwwwwo..owwwwwo',
    '.ooowwwoowwwooo.',
    '..oowwwwwwwwoo..',
    '.owwwwwwwwwwwwo.',
    '.owwooowwooowwo.',
    '..oo..owwo..oo..',
    '......oooo......',
    '................',
  ]);
  // hover: the same gear, lit
  const turned = upright.clone().swap({ [C.white]: C.amber });
  strip([upright, turned]).save(`${dir}/ui/gear.png`);
}

/** The compass dial. The HUD turns it by the drift (always a quarter turn, so it stays crisp). */
function compass(dir: string): void {
  icon([
    '................',
    '.....oooooo.....',
    '...oowwrrwwoo...',
    '..owwwwrrwwwwo..',
    '..owwwrrrrwwwo..',
    '.owwwwrrrrwwwwo.',
    '.owwwrrrrrrwwwo.',
    '.owwwwwrrwwwwwo.',
    '.owwwwwkkwwwwwo.',
    '.owwwwwkkwwwwwo.',
    '.owwwwwkkwwwwwo.',
    '..owwwwkkwwwwo..',
    '..owwwwkkwwwwo..',
    '...oowwwwwwoo...',
    '.....oooooo.....',
    '................',
  ]).save(`${dir}/ui/compass.png`);
}

function signal(dir: string): void {
  const frame = (bars: number) => {
    const g = new Img(16, 16);
    [4, 8, 12].forEach((h, i) => {
      const x = 2 + i * 4;
      g.rect(x, 14 - h, 4, h + 1, C.ink);
      g.rect(x + 1, 15 - h, 2, h - 1, i < bars ? ROLE.signal : C.mauve);
    });
    return g;
  };
  strip([0, 1, 2, 3].map(frame)).save(`${dir}/ui/signal.png`);
}

function cursor(dir: string): void {
  const g = new Img(16, 16).art(0, 0, [
    'oo..............',
    'owo.............',
    'owwo............',
    'owwwo...........',
    'owwwwo..........',
    'owwwwwo.........',
    'owwwwwwo........',
    'owwwwwwwo.......',
    'owwwwwwwwo......',
    'owwwwwooooo.....',
    'owwowwo.........',
    'owo.owwo........',
    'oo..owwo........',
    '.....owwo.......',
    '.....owwo.......',
    '......oo........',
  ], K);
  // CSS cursors cannot be scaled, so one file per UI scale
  for (const n of [1, 2, 3, 4]) g.scale(n).save(`${dir}/ui/cursor-${n}.png`);
  // The hand, for everything that can be clicked: the same white with an ink outline, the
  // same sizes. Its hot spot is the fingertip, at (5, 0) art pixels (ui/cubicUI.ts).
  const hand = new Img(16, 16).art(0, 0, [
    '.....oo.........',
    '....owwo........',
    '....owwo........',
    '....owwo........',
    '....owwo........',
    '....owwooo......',
    '....owwowwooo...',
    '.oo.owwowwowwo..',
    'owwoowwwwwwwwwo.',
    'owwwowwwwwwwwwo.',
    '.owwwwwwwwwwwwo.',
    '..owwwwwwwwwwwo.',
    '..owwwwwwwwwwo..',
    '...owwwwwwwwwo..',
    '....owwwwwwwo...',
    '....ooooooooo...',
  ], K);
  for (const n of [1, 2, 3, 4]) hand.scale(n).save(`${dir}/ui/cursor-hand-${n}.png`);
}

function markers(dir: string): void {
  // The arrow that hangs over a character: a plate with the player's tag and a point.
  const marker = (r: Ramp, label: string) => {
    const w = Math.max(22, textWidth(label) + 8);
    const g = new Img(w, 22);
    g.rect(0, 0, w, 14, C.ink).rect(1, 1, w - 2, 12, r.base).rect(1, 1, w - 2, 1, r.light).rect(1, 11, w - 2, 2, r.dark);
    round(g, 0, 0, w, 14);
    drawText(g, Math.floor((w - textWidth(label)) / 2), 0, label, C.white);
    const cx = Math.floor(w / 2);
    for (let i = 0; i < 6; i++) {
      g.rect(cx - 6 + i, 14 + i, 12 - i * 2, 1, r.dark);
      g.set(cx - 7 + i, 14 + i, C.ink).set(cx + 5 - i, 14 + i, C.ink);
    }
    g.rect(cx - 1, 20, 2, 1, C.ink);
    return g;
  };
  marker(ROLE.p1, 'P1').save(`${dir}/ui/marker-p1.png`);
  marker(ROLE.p2, 'P2').save(`${dir}/ui/marker-p2.png`);

  // READY badge: off (waiting) and on
  const badge = (on: boolean) => {
    const text = on ? 'READY' : 'NOT READY';
    const w = 62;
    const g = new Img(w, 16);
    g.rect(0, 0, w, 16, C.ink).rect(1, 1, w - 2, 14, on ? ROLE.ok : C.mauve).rect(1, 1, w - 2, 1, on ? C.grass : C.silver).rect(1, 13, w - 2, 2, on ? C.greenDark : C.slate);
    round(g, 0, 0, w, 16);
    drawText(g, Math.floor((w - textWidth(text)) / 2), 1, text, on ? C.white : C.mist);
    return g;
  };
  badge(true).save(`${dir}/ui/ready.png`);
  badge(false).save(`${dir}/ui/not-ready.png`);
}

export function buildUi(dir: string): { icons: string[] } {
  buttons(dir);
  panels(dir);
  controls(dir);
  gear(dir);
  signal(dir);
  compass(dir);
  cursor(dir);
  markers(dir);
  return { icons: icons(dir) };
}
