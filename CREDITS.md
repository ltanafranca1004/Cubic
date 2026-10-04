# Credits

## Audio

All music and the puzzle-solved harp chord are by **Kevin MacLeod** (incompetech.com),
licensed under **Creative Commons: By Attribution 4.0**
(https://creativecommons.org/licenses/by/4.0/). This licence requires the credit below
wherever the game is shown, so keep it with any build, video or submission page.

> "Morning", "Clear Air", "Windswept", "Immersed", "Enchanted Journey"
> Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0
> https://creativecommons.org/licenses/by/4.0/

- Licence statement: https://incompetech.com/music/royalty-free/faq.html ("Licensed under
  Creative Commons: By Attribution 4.0") and https://incompetech.com/music/royalty-free/licenses/
  ("Creative Commons - Free. No charge. Requires that you credit the music."), read 2026-10-03.
- Each source mp3 was downloaded from incompetech.com on 2026-10-03 and carries the tags
  `title` and `artist: Kevin MacLeod`.

| Files in `client/public/assets/audio` | Used for | Title | Track page | Source file |
| --- | --- | --- | --- | --- |
| `music-menu.ogg`, `.mp3` | menu (start and mode screens) | "Morning" (classical guitar, harp, flutes) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2300003 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Morning.mp3 |
| `music-lobby.ogg`, `.mp3` | lobby / side select | "Clear Air" (two guitars, soft piano) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100626 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Clear%20Air.mp3 |
| `music-outside.ogg`, `.mp3` | in game, outside player | "Windswept" (guitar, strings) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100757 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Windswept.mp3 |
| `music-inside.ogg`, `.mp3` | in game, inside player | "Immersed" (piano, strings) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600010 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Immersed.mp3 |
| `sting-solved.ogg`, `.mp3` | puzzle solved | "Enchanted Journey" (harp solo), one chord | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100799 | https://incompetech.com/music/royalty-free/mp3-royaltyfree/Enchanted%20Journey.mp3 |

Changes we made (CC BY 4.0 asks that changes are stated):

- Music: each piece is used whole. It is cut where its last note has faded to about
  -40 dBFS and the rest of that fade is mixed onto the start, so it loops without a gap or
  a click. Levelled by plain gain to about -20 LUFS (no compression), then encoded as Ogg
  Opus and as mp3 (for browsers without Ogg Opus). The remaining level matching is in
  `client/src/audio/tracks.ts`.
- Sting: the single rolled C major chord at 2:59 of "Enchanted Journey" (2.7 s), with a
  short fade out, peak at -3 dBFS.

The other sound effects (steps, bumps, chimes) are synthesized in code by us
(`client/src/game/sfx.ts`).

### Ambience loops (our own work)

The quiet loop of the face you are on (`client/public/assets/audio/ambience/`) is **made by
us, not sampled**: `tools/ambience/make_audio.py` synthesizes every loop from filtered
noise and sine tones with a fixed seed (numpy), and ffmpeg encodes them. No third-party
recording or sample is used, so there is nothing to license; we release them under CC0 1.0
like the rest of our assets.

| File (`.ogg` Ogg Opus and `.mp3`, mono, 8.5 s) | Face | What it is |
| --- | --- | --- |
| `grass` | outside 1 | soft wind, grass rustle, a few bird chirps (sine sweeps) |
| `desert` | outside 2 | low dry wind, two whistling bands, sand hiss |
| `snow` | outside 3 | airy wind with a faint howl |
| `forest` | outside 4 | leaf rustle, crickets (pulsed tones), a distant hoot |
| `rooftop` | outside 5 | open wind with gusts, cloth flaps (noise bursts) |
| `cave` | outside 6 | low rumble, drips with echoes (sine blips) |
| `hum` | every inside room | a 55 Hz hum with harmonics; each room plays it at its own pitch |

The per-surface footstep sounds are noise bursts synthesized at runtime
(`client/src/world/ambience/loops.ts`).

## Art and fonts

Only CC0 (public domain) art and fonts are used, so nothing in this section is legally
required, but credit is owed.

| What | Author | License | Source | Where it is used |
| --- | --- | --- | --- | --- |
| **m5x7** font | Daniel Linssen (managore) | CC0 1.0 ("free to use but attribution appreciated") | https://managore.itch.io/m5x7 | All text. `client/public/assets/fonts/m5x7.ttf` is the original file; `m5x7.png` + `m5x7.xml` are a bitmap font made from it by `tools/art/font.ts`. |
| **Ninja Adventure Asset Pack** | Pixel-Boy and AAA | CC0 1.0 | https://pixel-boy.itch.io/ninja-adventure-asset-pack | Outside face tiles (floors, rocks, bushes), the pressure plates, the crystal and the rose. Five source sheets are kept unchanged in `tools/art/vendor/ninja-adventure/` with the pack's `LICENSE.txt`; `tools/art/tiles.ts` and `sprites.ts` cut tiles from them and recolour them to our palette. |
| **Resurrect 64** palette | Kerrie Lake | A colour list published on Lospec | https://lospec.com/palette-list/resurrect-64 | Every colour in the game (`client/src/style/tokens.ts`). |

Everything else in `client/public/assets/` outside `audio/` (the logo, clouds, sky, UI
kit, icons, cursor, player markers, both characters, the inside tiles, doors, portal, pot,
key) is our own work, drawn by the generator in `tools/art`.

The living-world effect sprites (`client/public/assets/sprites/fx/fx.png` and
`cloud-shadow.png`: grass tufts, flowers, butterflies, leaves, birds, gulls, the
tumbleweed, flags, splashes, breath, sparkles, crystal shards, wall lamps) are also our own
work, drawn pixel by pixel in the Resurrect 64 palette by `tools/ambience/make_fx.py`.
