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
