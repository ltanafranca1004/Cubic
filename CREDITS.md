# Credits

## Audio

All music and the puzzle-solved jingle come from the **Ninja Adventure Asset Pack** by
**Pixel-Boy and AAA**, released under **CC0 1.0 Universal** (public domain; attribution
not required, given with thanks).

- Pack: https://pixel-boy.itch.io/ninja-adventure-asset-pack (downloaded 2026-10-03; the
  page states the assets "are released under the Creative Commons Zero (CC0) license" and
  the zip ships a CC0 1.0 `LICENSE.txt`)
- License: https://creativecommons.org/publicdomain/zero/1.0/

| File in `client/public/assets/audio` | Used for | Source file in the pack | Changes |
| --- | --- | --- | --- |
| `music-menu.ogg` | menu (start and mode screens) | `Audio/Musics/13 - Mystical.ogg` | none (renamed) |
| `music-lobby.ogg` | lobby / side select | `Audio/Musics/5 - Peaceful.ogg` | none (renamed) |
| `music-outside.ogg` | in game, outside player | `Audio/Musics/1 - Adventure Begin.ogg` | none (renamed) |
| `music-inside.ogg` | in game, inside player | `Audio/Musics/21 - Dungeon.ogg` | none (renamed) |
| `sting-solved.mp3` | puzzle solved | `Audio/Jingles/Success2.wav` | encoded to mp3 |

The loops are the pack's own Ogg Vorbis files, byte for byte, so they loop exactly as
authored. Their levels are matched in code (`client/src/audio/tracks.ts`).

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

Only CC0 (public domain) art and fonts are used, so nothing here is legally required, but
credit is owed.

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
