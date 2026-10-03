# /client/public/assets (owner: friend 3)

Real art and sound. Until a file is listed in `manifest.json` the game draws that thing
with placeholder art generated in code, so assets can land one at a time.

## Style

- **16x16 px tiles**, pixel art, no anti-aliasing, no sub-pixel detail. The canvas is
  160x160 and scaled by whole numbers.
- **Palette: Resurrect 64** (lospec.com/palette-list/resurrect-64). Recolour anything
  imported to it so the six faces read as one game.
- Sources: **Ninja Adventure** asset pack and **Kenney** packs, both CC0. Anything else
  must be CC0 or made by us; list it in `CREDITS.md` in this folder.
- Outside faces are bright, each with its own base colour (1 meadow green, 2 desert sand,
  3 ember rock, 4 snow, 5 peaks green, 6 ruins grey). Inside faces are dark rooms lit
  around the player.

## Layout

```
assets/
  manifest.json        what exists (the only file the game reads first)
  tiles/               one tileset PNG per map: out-1.png ... out-6.png, in-1.png ... in-6.png
  sprites/             players, objects, items (PNG strips of 16x16 frames)
  ui/                  HUD and lobby images
  audio/               .ogg or .mp3 sound effects
  CREDITS.md
```

## manifest.json

```json
{
  "tileSize": 16,
  "tilesets": {
    "out-1": {
      "image": "tiles/out-1.png",
      "tiles": { "floor": [0, 1, 2], "wall": [8], "tree": [9], "water": [10, 11] }
    }
  },
  "objects": {
    "door": { "image": "sprites/door.png", "frames": { "closed": 0, "open": 1 } },
    "plate": { "image": "sprites/plate.png", "frames": { "off": 0, "on": 1 } }
  },
  "items": {
    "rose": { "image": "sprites/rose.png", "frame": 0 }
  },
  "players": {
    "out": { "image": "sprites/player-out.png", "walk": [0, 1] },
    "in": { "image": "sprites/player-in.png", "walk": [0, 1] }
  },
  "audio": {
    "step": "audio/step.ogg"
  }
}
```

- `tilesets`: key is `<side>-<face>`. `tiles` maps each terrain kind to frame indexes in
  the PNG (left to right, top to bottom, 16x16). Several indexes = random variation per
  tile. `water` with several indexes animates.
- `objects`: key is the map object `type`; `frames` maps the `state` a puzzle reports
  (see `visible()` in `/shared/src/puzzles`) to a frame. `default` is used when there is
  no state.
- `items`: key is the item `kind`.
- `players`: frames face right; the game flips them for left.
- `audio`: keys are `step`, `bump`, `flip`, `push`, `solve`, `strike`, `win`, `pickup`,
  `drop`, `place`, or a puzzle event name such as `door-open`.

Paths are relative to this folder. Missing keys fall back to the placeholder art/sound.
