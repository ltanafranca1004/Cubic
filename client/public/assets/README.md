# /client/public/assets (owner: friend 3)

Real art and sound. **The PNGs in `tiles/`, `sprites/`, `ui/` and `fonts/` and
`manifest.json` are generated**: edit `/tools/art` and run `npm run art` there (see
`/tools/README.md`), do not edit them by hand. Anything `manifest.json` does not list is
drawn with the placeholder art in code, so assets can still land one at a time.

## Style

The full guide is [docs/style.md](../../../docs/style.md). In short:

- **16x16 px tiles**, pixel art, no anti-aliasing, no sub-pixel detail. The game view is
  160x160 and everything is scaled by whole numbers.
- **Palette: Resurrect 64** (lospec.com/palette-list/resurrect-64), named in
  `client/src/style/tokens.ts`. The generator refuses any other colour.
- Sources: our own art, plus the **Ninja Adventure** pack and the **m5x7** font (both
  CC0). Anything else must be CC0 or made by us; list it in `/CREDITS.md`.
- Outside faces are bright, one biome each (1 grass, 2 desert, 3 snow, 4 forest,
  5 rooftop, 6 cave). Inside faces are dark rooms with the biome's hue as an accent.

## Layout

```
assets/
  manifest.json        what exists (the game reads this first)
  tiles/               one tileset PNG per map: out-1.png ... out-6.png, in-1.png ... in-6.png
                       (template.png is the Tiled placeholder tileset for /maps)
  sprites/             players, objects, items (16x16 frames)
  ui/                  the UI kit, logo, clouds, sky, icons
  fonts/               m5x7.ttf, and the bitmap font made from it
  audio/               .ogg or .mp3 (not generated; owned by audio)
```

## manifest.json

```json
{
  "tileSize": 16,
  "tilesets": {
    "out-1": {
      "image": "tiles/out-1.png",
      "tiles": { "floor": [0, 0, 0, 1, 2], "wall": [5, 6, 7], "tree": [8, 9, 10], "water": [11, 12, 13, 14] }
    }
  },
  "objects": {
    "door": { "image": "sprites/objects.png", "frames": { "closed": 0, "open": 1, "default": 0 } },
    "plate": { "image": "sprites/objects.png", "frames": { "off": 2, "on": 3 }, "sides": { "in": { "off": 4, "on": 5 } } },
    "portal": { "image": "sprites/objects.png", "frames": { "closed": 9, "open": [10, 11, 12, 13] } }
  },
  "items": {
    "rose": { "image": "sprites/items.png", "frame": 0 },
    "default": { "image": "sprites/items.png", "frame": 2 }
  },
  "players": {
    "out": { "image": "sprites/player-out.png", "idle": [0, 1], "walk": [2, 3] },
    "in": { "image": "sprites/player-in.png", "idle": [0, 1], "walk": [2, 3] }
  },
  "audio": {
    "step": "audio/step.ogg"
  }
}
```

- `tilesets`: key is `<side>-<face>`. `tiles` maps each terrain kind to frame indexes in
  the PNG (left to right, top to bottom, 16x16). Several indexes = variation per tile
  (repeat an index to make it more common). `water` with several indexes animates.
- `objects`: key is the map object `type`; `frames` maps the `state` a puzzle reports
  (see `visible()` in `/shared/src/puzzles`) to a frame, or to a list of frames to
  animate. `default` is used when there is no state. `sides.in` / `sides.out` replace
  `frames` for that side. The `unknown` entry is drawn for a type with no art.
- `items`: key is the item `kind`; `default` is used for a kind with no art.
- `players`: frames face right; the game flips them for left. `idle` plays while the
  player stands still.
- `audio`: keys are `step`, `bump`, `flip`, `push`, `solve`, `strike`, `win`, `pickup`,
  `drop`, `place`, or a puzzle event name such as `door-open`.

Paths are relative to this folder. Missing keys fall back to the placeholder art/sound.
The reader is `client/src/style/art.ts`.
