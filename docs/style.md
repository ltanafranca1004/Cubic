# Cubic style guide

Two players, one cube. One is outside in bright biomes, one is trapped inside in dark
rooms. Every visual decision serves that sentence. The tokens live in
`client/src/style/tokens.ts`; this file is the reasoning.

## 1. Principles

1. **Whole pixels.** Every menu is drawn at one whole-number scale `u`
   (`client/src/style/scale.ts`): the largest that still leaves a 480x270 logical screen.
   A pixel of the logo and of a button are the same size. In game there are two
   whole-number scales: the game view takes the largest zoom that fits (`viewZoom`, x5 at
   1920x1080, x3 at 1280x720) and the HUD column beside it its own (`hudScale`). No
   fractional scaling, no smoothing, positions rounded to whole pixels
   (`pixelArt: true`, `roundPixels: true`, `image-rendering: pixelated`).
   On a phone or tablet the grid is the device pixel instead of the CSS pixel
   (`client/src/style/fit.ts`): an art pixel is still a whole number of real pixels (five
   of them on an iPhone 14, which CSS calls 1.667), so the view can fill a 340px high
   screen instead of stopping at x1.
2. **One palette.** Every pixel we ship is a Resurrect 64 colour. The art generator fails
   the build if a PNG has any other colour.
3. **Two worlds, one kit.** The outside player's screen is a sky with light panels. The
   inside player's screen is the dark with dark panels. Same layout, same components, so
   the two players can describe their screens to each other, but neither can mistake whose
   screen it is.
4. **Colour means something.** Green is always the outside. Amber is always the inside.
   Blue is P1 (the host), pink is P2. Violet is the portal and the AI. Red is a problem.
   A colour is never reused for a second meaning.
5. **Art from code.** Every PNG is written by `tools/art` from the tokens. It is
   reviewable in a diff and it cannot drift off-palette.

## 2. Palette: Resurrect 64

[Resurrect 64](https://lospec.com/palette-list/resurrect-64) by Kerrie Lake. 64 colours,
wide hue coverage with dark plum instead of black, which keeps dark rooms warm and lets
one ink colour outline everything. In `tokens.ts`: `R64` (the list), `C` (every colour by
name) and `ROLE` (what a colour means here).

| Role | Colour | Hex | Used for |
| --- | --- | --- | --- |
| `ink` | plum black | `#2e222f` | outlines, text on light, the void. There is no pure black. |
| `paper` | white | `#ffffff` | light surfaces, text on dark |
| `surfaceShade` / `surfaceEdge` | mist / silver | `#c7dcd0` / `#9babb2` | the lip under light panels and buttons |
| `surfaceDark` / `surfaceDarkLit` | shadow / slate | `#3e3546` / `#625565` | dark panels, inside floors |
| `dimOnLight` / `dimOnDark` | mauve / silver | `#7f708a` / `#9babb2` | secondary text |
| `skyTop` / `sky` / `skyLow` | blue / sky / sky light | `#4d65b4` / `#4d9be6` / `#8fd3ff` | the sky, top to horizon |
| `out` ramp | grass, green, green dark, pine | `#91db69` `#1ebc73` `#239063` `#165a4c` | the OUTSIDE: logo "CUB", its buttons, its labels |
| `in` ramp | lemon, amber, amber dark, rust | `#fbff86` `#f9c22b` `#f79617` `#9e4539` | the INSIDE: logo "IC", the lantern, its buttons |
| `p1` ramp | sky blues | `#8fd3ff` `#4d9be6` `#4d65b4` `#484a77` | P1 / host marker and cube frame |
| `p2` ramp | pinks | `#ed8099` `#f04f78` `#c32454` `#831c5d` | P2 marker and cube frame |
| `ok` | green | `#1ebc73` | ready, solved, slider fill |
| `danger` | red | `#e83b3b` | errors, strikes |
| `signal` | mint | `#30e1b9` | voice signal bars, speaking dots |
| `portal` | violet | `#a884f3` | the portal, the AI partner, the win title |
| `focus` | amber | `#f9c22b` | keyboard focus, the current face |

Transparency is for light and motion only: the veil behind a popup, fades between
screens, the cube net "in the distance" on the mode screen, and the inside player's
darkness (which the game already draws). It is never used to invent a colour for a piece
of art.

### Biomes

One biome per outer face. The inside of the same wall is a dark room whose pillars and
floor runes keep the biome's hue, so "the orange one" means the same wall to both players.

| Face | Biome | Shown as | Floor | Inside accent |
| --- | --- | --- | --- | --- |
| 1 | grass | Grass | `#91db69` | grass green |
| 2 | desert | Desert | `#fbb954` | sand |
| 3 | snow | Snow | `#ffffff` | ice white and sky blue |
| 4 | forest | Forest | `#239063` | deep green |
| 5 | rooftop | Rooftop | `#fdcbb0` | peach terracotta |
| 6 | cave | Cave | `#7f708a` | grey mauve |

The HUD does not use the floor colours: two of them are near twins (grass and sand under
a red-green deficiency), and all six rooms inside are the same dark stone. `FACE_HUD` in
`tokens.ts` has one colour per face and side for the cube's chips, the progress pips and the
labels on the edges of the view, picked from the palette so that no two are closer than 25
(outside) or 18 (inside) in CIELAB under normal vision, deuteranopia, protanopia and
tritanopia. Each chip also carries the face number.

| Face | Outside | Inside (the room's tint, also mixed into that face of the HUD cube) |
| --- | --- | --- |
| 1 | grass `#91db69` | sage `#547e64` |
| 2 | orange `#fb6b1d` | copper `#cd683d` |
| 3 | white `#ffffff` | blue `#4d65b4` |
| 4 | pine `#165a4c` | teal grey `#374e4a` |
| 5 | pink `#ed8099` | pink `#ed8099` (a darker pink reads as the room 1 green with a red-green deficiency) |
| 6 | purple `#905ea9` | dark purple `#6b3e75` |

The names come from `FACE_NAMES` in `shared/src/maps` (outside: Grass, Desert, Snow, Forest,
Rooftop, Cave; the room behind the snow face is the "Frost room"). The HUD, the AI
partner and the docs all use that one table.

## 3. Type

**m5x7** by Daniel Linssen (CC0). A 5x7 pixel font with a 16px cell: small enough for a
270px-high screen, with real lower case for chat and objectives.

- Sizes are whole multiples of 16px: x1 for everything, x2 only for big words (OUTSIDE,
  INSIDE, the join code, the win title). Never a fraction.
- Labels, buttons and titles are upper case. Sentences a person reads (objective, chat,
  help) are mixed case.
- In the Phaser scenes the font is a bitmap font (`fonts/m5x7.png` + `.xml`, made from the
  TTF by `tools/art/font.ts` by sampling the outline at every pixel centre), so there is no
  anti-aliasing at all. In the DOM it is the TTF at `16px x u` with font smoothing off.
- White text on the sky gets a 1px ink drop shadow, because clouds are also white.

## 4. UI kit

All in `client/public/assets/ui`, drawn by `tools/art/ui.ts`. The same PNGs are used by
the Phaser scenes (`scenes/kit.ts`) and by the DOM (`ui/css.ts`, as `border-image`).

| Piece | File | Notes |
| --- | --- | --- |
| Panel | `panel.png`, `panel-dark.png` | 24x24, 9-slice, 6px corners. 1px outline, clipped corners, a 2px lip at the bottom. |
| Button | `btn-<variant>-<state>.png` | Variants `dark`, `light`, `out`, `in`, `danger`. States `idle`, `hover`, `pressed`, plus one `btn-disabled.png`. 22px high with a 3px lip; pressed sinks 2px into the lip. |
| Field | `field*.png` | 12x12, 4px corners. `-active` has the amber focus edge, `-error` is red. |
| Tag | `tag*.png` | Solid pill for labels: the room code, banners. |
| Slider | `slider-track.png`, `slider-fill.png`, `slider-knob.png` | The knob moves in whole art pixels. |
| Toggle | `toggle.png` | 2 frames: off, on. |
| Icons | `icons.png` | 16x16 frames, order in `style/assets.ts` `ICONS`. White with an ink outline so they work on light and dark. |
| Gear | `gear.png` | 2 frames: idle, lit (hover or open). Always top right. |
| Signal | `signal.png` | 4 frames: 0 to 3 bars. |
| Compass | `compass.png` | Not used by the HUD any more (the cube shows the drift). |
| Cursor | `cursor-1..4.png` | One file per UI scale (CSS cursors cannot be scaled). |
| Player markers | `marker-p1.png`, `marker-p2.png` | The arrow over a picked character. |
| Ready badge | `ready.png`, `not-ready.png` | Under P2's cube. |
| Logo | `logo.png` | "CUB" green, "IC" amber: outside and inside in one word. Slab letters with a lit top edge. |
| Clouds | `cloud-1..4.png` | Far and small to near and large. White body, mist underside, no outline. |
| Sky | `sky.png` | 8px wide strip, tiled sideways. Palette steps joined by ordered dither, so there is no gradient the palette cannot hold. |
| Cubes | `cube-out.png`, `cube-in.png` | The same cube whole and cut open, for the side select. |

Rules:
- Spacing is a multiple of 4px. Panels are 6px from the screen edge and from each other.
- A raised thing (button, panel) has a lip. A sunk thing (field, track) has an inner shade.
- Button choice: `dark` is the default action on light surfaces, `light` is secondary and
  the default on dark surfaces, `out` and `in` are for things that belong to a side, `in`
  (amber) also marks the one action that moves you forward (Play, Start, Play again).
- Keyboard focus looks like hover. Disabled is flat mist with no lip: nothing to press.

## 5. Characters and world

- **Outside player**: an explorer in a green cap. **Inside player**: an amber cloak with a
  lantern, the only warm light in the dark rooms. 16x16, big head, facing right (the game
  mirrors them). Frames: idle 0-1 (a one pixel breath), walk 2-3.
- **Tiles**: 16x16. Outside faces are cut from the Ninja Adventure pack (CC0) and
  recoloured onto the palette by brightness rank (`tools/art/tiles.ts`). Inside faces are
  our own flagstones and pillars. Props get a one pixel contact shadow in the biome's
  deep colour so they sit on the ground.
- **Objects**: door, plates (red outside, amber inside), crystal, portal (cold stone when
  shut, a turning violet vortex when open), the pot, the rose, a key.

## 6. Where things are

```
client/src/style/     tokens.ts (palette, roles, sizes, timings), scale.ts (the pixel grid),
                      assets.ts (file names), art.ts (the game's ArtProvider),
                      settings.ts (session settings), audioApi.ts (the AudioManager interface)
client/src/scenes/    the menu scenes and their Phaser kit
client/src/ui/        the DOM UI: HUD, chat, voice, settings, win
client/public/assets/ fonts/ tiles/ sprites/ ui/ manifest.json  (all written by tools/art)
tools/art/            the generator; tools/screens/ the Playwright screenshot script
docs/screens/         screenshots of every screen and face, and the dive GIF
```

To change a colour: edit `tokens.ts`, run `npm run art` in `/tools`, reload.
