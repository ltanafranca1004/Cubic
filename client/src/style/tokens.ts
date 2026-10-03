// DESIGN TOKENS. The one place colours, sizes and timings are defined.
// Pure data (no DOM, no Phaser): the client, the CSS and the art generator in /tools/art
// all import this file, so a pixel in a PNG and a pixel drawn at runtime share one palette.
// The reasoning is in docs/style.md.

/** Resurrect 64 by Kerrie Lake (lospec.com/palette-list/resurrect-64), in palette order. */
export const R64 = [
  '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a', '#694f62', '#7f708a', '#9babb2',
  '#c7dcd0', '#ffffff', '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
  '#fb6b1d', '#f79617', '#f9c22b', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
  '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86', '#165a4c', '#239063', '#1ebc73',
  '#91db69', '#cddf6c', '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90', '#0b5e65',
  '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2', '#323353', '#484a77', '#4d65b4', '#4d9be6',
  '#8fd3ff', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded', '#753c54', '#a24b6f',
  '#cf657f', '#ed8099', '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
] as const;

/** Every palette colour by name. Use a ROLE below when one fits; reach for these in art. */
export const C = {
  ink: R64[0], shadow: R64[1], slate: R64[2], dustyRose: R64[3], tan: R64[4], mauveDark: R64[5], mauve: R64[6], silver: R64[7],
  mist: R64[8], white: R64[9], maroon: R64[10], brick: R64[11], vermilion: R64[12], coral: R64[13], crimson: R64[14], red: R64[15],
  orange: R64[16], amberDark: R64[17], amber: R64[18], wine: R64[19], rust: R64[20], copper: R64[21], sandDark: R64[22], sand: R64[23],
  mud: R64[24], olive: R64[25], moss: R64[26], lime: R64[27], lemon: R64[28], pine: R64[29], greenDark: R64[30], green: R64[31],
  grass: R64[32], grassLight: R64[33], charcoal: R64[34], tealGrey: R64[35], sageDark: R64[36], sage: R64[37], sageLight: R64[38], tealDark: R64[39],
  teal: R64[40], turquoise: R64[41], mint: R64[42], aqua: R64[43], navy: R64[44], indigo: R64[45], blue: R64[46], sky: R64[47],
  skyLight: R64[48], plum: R64[49], purpleDark: R64[50], purple: R64[51], violet: R64[52], pinkLight: R64[53], berryDark: R64[54], berry: R64[55],
  rose: R64[56], pink: R64[57], magentaDark: R64[58], magenta: R64[59], hotPink: R64[60], salmon: R64[61], peach: R64[62], skin: R64[63],
} as const;

/** A 4-step ramp, lightest first. */
export interface Ramp {
  light: string;
  base: string;
  dark: string;
  deep: string;
}

/**
 * ROLES. What a colour means in Cubic.
 * The two sides own one hue each, everywhere: OUTSIDE is green, INSIDE is amber. The two
 * players own one hue each too, and never a side hue: P1 (host) is blue, P2 is pink.
 */
export const ROLE = {
  /** Outlines, text on light surfaces, the darkest shadow. Never pure black. */
  ink: C.ink,
  /** Text and icons on dark surfaces. */
  paper: C.white,
  /** Secondary text on light / on dark. */
  dimOnLight: C.mauve,
  dimOnDark: C.silver,

  /** Light surfaces: menus, the outside player's HUD. */
  surface: C.white,
  surfaceShade: C.mist,
  surfaceEdge: C.silver,
  /** Dark surfaces: popups over the game, the inside player's HUD. */
  surfaceDark: C.shadow,
  surfaceDarkLit: C.slate,
  surfaceDarkDeep: C.ink,

  /** The sky behind the title, top to horizon. */
  skyTop: C.blue,
  sky: C.sky,
  skyLow: C.skyLight,
  cloud: C.white,
  cloudShade: C.mist,
  /** The void around the inside player's room. */
  void: C.ink,

  out: { light: C.grass, base: C.green, dark: C.greenDark, deep: C.pine } as Ramp,
  in: { light: C.lemon, base: C.amber, dark: C.amberDark, deep: C.rust } as Ramp,
  p1: { light: C.skyLight, base: C.sky, dark: C.blue, deep: C.indigo } as Ramp,
  p2: { light: C.pink, base: C.hotPink, dark: C.magenta, deep: C.magentaDark } as Ramp,

  ok: C.green,
  danger: C.red,
  dangerDark: C.crimson,
  /** Voice signal, speaking dots. */
  signal: C.mint,
  /** The portal and the AI partner. */
  portal: C.violet,
  portalDark: C.purple,
  focus: C.amber,
} as const;

export type Biome = 'grass' | 'desert' | 'snow' | 'forest' | 'sky' | 'cave';

/**
 * One biome per outer face. The inside of the same wall is a dark room that keeps the
 * biome's hue as its accent, so both players can talk about "the orange one".
 * NOTE: shared/src/maps FACE_NAMES still says 3 Ember, 4 Snow, 5 Peaks, 6 Ruins. The art
 * and the HUD follow this table; see docs/style.md.
 */
export const FACE_STYLE: Record<1 | 2 | 3 | 4 | 5 | 6, { biome: Biome; name: string; base: string; ramp: Ramp }> = {
  1: { biome: 'grass', name: 'Meadow', base: C.grass, ramp: { light: C.grassLight, base: C.grass, dark: C.green, deep: C.greenDark } },
  2: { biome: 'desert', name: 'Desert', base: C.sand, ramp: { light: C.lemon, base: C.sand, dark: C.sandDark, deep: C.copper } },
  3: { biome: 'snow', name: 'Snow', base: C.white, ramp: { light: C.white, base: C.mist, dark: C.skyLight, deep: C.sky } },
  4: { biome: 'forest', name: 'Forest', base: C.greenDark, ramp: { light: C.green, base: C.greenDark, dark: C.pine, deep: C.tealGrey } },
  5: { biome: 'sky', name: 'Rooftop', base: C.peach, ramp: { light: C.skin, base: C.peach, dark: C.salmon, deep: C.rose } },
  6: { biome: 'cave', name: 'Cave', base: C.mauve, ramp: { light: C.silver, base: C.mauve, dark: C.slate, deep: C.shadow } },
};

/** Pixel sizes, in art pixels (multiply by the UI scale for screen pixels). */
export const SIZE = {
  tile: 16,
  /** One line of m5x7. Use multiples of this for text; never scale the font by fractions. */
  font: 16,
  /** The smallest logical screen the layouts are designed for. */
  minWidth: 480,
  minHeight: 270,
  /** Gap unit. Spacing is a multiple of this. */
  unit: 4,
  /** Corner size of the 9-slice panels and buttons. */
  slice: 6,
  buttonHeight: 20,
} as const;

/** Animation timings in ms. Easing names are Phaser's. See docs/menu-design.md. */
export const TIME = {
  /** Buttons: pressed frame holds this long before the action fires. */
  press: 90,
  /** Hover lift, marker slides, small UI moves. */
  quick: 140,
  /** Panels and popups opening or closing. */
  panel: 200,
  /** An error shake (3 swings). */
  shake: 280,
  /** The dive through the clouds, Start to Mode. */
  dive: 1200,
  /** Menu to menu cross moves. */
  scene: 360,
  /** Menu to game. */
  enterGame: 480,
  /** Idle animation frame (characters, cube net bob). */
  idleFrame: 420,
  /** Cloud layers, logical pixels per second, far to near. */
  cloudSpeed: [3, 6, 10, 16],
} as const;

export const EASE = {
  out: 'Cubic.easeOut',
  in: 'Cubic.easeIn',
  inOut: 'Cubic.easeInOut',
  back: 'Back.easeOut',
} as const;

/** '#rrggbb' to 0xrrggbb for Phaser. */
export const hex = (color: string): number => parseInt(color.slice(1), 16);
