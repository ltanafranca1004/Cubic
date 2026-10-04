# /maps (owner: friend 3)

The cube has 6 faces, and every face has two maps: the OUTSIDE surface and the INSIDE
surface of the same wall. 12 maps total, each 12x12 tiles of 16px (`FACE_SIZE` in
`shared/src/types.ts`).

| Face | Outside | Inside |
| --- | --- | --- |
| 1 | Grass | Keypad room |
| 2 | Desert | Vault |
| 3 | Snow | Tile room |
| 4 | Forest | Greenhouse |
| 5 | Rooftop | Laser room |
| 6 | Cave | Lava room |

The names are `FACE_NAMES` in `shared/src/maps/index.ts`. Each face has one puzzle
(`shared/src/puzzles/README.md`), and each puzzle owns the two banner sections of its face
in `default.ts`.

## Two ways to author a map

**A. String maps (what the game uses now).** `shared/src/maps/default.ts`, 12 strings of
12 characters per map:

| Char | Meaning | Kind |
| --- | --- | --- |
| `.` | floor | terrain |
| `#` | wall / rock / pillar (solid) | terrain |
| `T` | tree (solid). Outside it is drawn per biome: bush, cactus (a palm beside water), snowy pine, oak, planter, stalagmite | terrain |
| `~` | water (solid). Outside it gets a bank on every side that touches land | terrain |
| `I` | carryable `item` (id `<side><face>-<x>-<y>`; on no map today) | object |
| `U` | `target` an item can be dropped on, takes anything (on no map today) | object |
| `0` to `9`, `e` | face 1 inside: a `key` of the floor keypad, named `0` to `9` and `enter` | object |
| `d` | face 1 inside: a `display` cell (three) | object |
| `p` | face 4 outside: a pot, a `target` that takes anything (five) | object |
| `u` | face 5, both sides, same tiles: `f5-symbol` (seven; the i-th in map order is the i-th symbol) | object |
| `v` | face 5 outside: `f5-replay` | object |
| `w` | face 5 inside: the emitter, a `target` named `f5-emitter` | object |
| `x` | face 6 outside: `f6-rock` (stops the beam, the mirrors and the player) | object |
| `y` | face 6 outside: `f6-crate`, on the ring (does not block) | object |
| `z` | face 6 outside: `reset` | object |
| `Y` | face 6 outside: `f6-source`, where the beam comes up | object |
| `X` | face 6 inside: `button` | object |
| `C` | `crystal` of the old stub puzzles: still in the legend, on no map | object |

The legend is `LEGEND` in `shared/src/maps/strings.ts`, one section per face. A character
means one thing on every face: add yours to your face's section and nowhere else.

Not everything is a map object. Some puzzles draw their own tiles through `visible()`, and
the map only has to keep those tiles free:

- Face 1 outside: the number, rows 2 to 6, columns 0 to 10 (keep that block floor).
- Face 2: everything (bushes, rocks, birds outside; safe, clue row and keypad inside) is
  laid out in `shared/src/puzzles/equationSafe.ts`. The inside map only has the two wall
  tiles beside the safe.
- Face 3: the symbol outside (`GLYPH` in `mirroredGlyph.ts`), a flip tile on every tile
  inside.
- Face 4 inside: the five flowerpots, on the outside pots' tiles.
- Face 6: the two mirrors (they move; their start tiles are in `laserPath.ts`), the path,
  and the lava on every inside tile off the ring.

The outside faces also have a **biome layer** that only looks and never blocks (tall
grass, mushrooms, drifts, puddles, the snowman skin): `client/src/world/biomes/decor.ts`,
one 12x12 string map per face. After moving anything on a map run `npm test`: the biome
test says if a decoration, a tree crown or a landmark now covers a puzzle tile.

**B. Tiled maps (replace string maps face by face).** Save a map as
`/maps/<side>-<face>.tmj`, e.g. `out-1.tmj`, `in-6.tmj`, then run `npm run maps` and commit
(it regenerates `shared/src/maps/generated.ts`). A face with a `.tmj` ignores its string map.
Start from `template.tmj`.

Tiled rules:
- Orthogonal, 12x12 tiles, 16x16 px. Tile layer format: CSV (not compressed).
- A tile layer named **`tiles`**. Terrain comes from the tile's custom property
  `kind` = `floor` | `wall` | `tree` | `water` (set it in the tileset editor). Tiles with
  no `kind` and empty cells are floor. Extra purely visual layers are ignored by the game
  logic.
- An object layer named **`objects`**. Each object needs a **`type`** (the Class/Type field,
  or a custom string property called `type`): `item`, `target`, `key`, `button`, or
  whatever a puzzle module looks for. The object's top-left corner picks the
  tile. `name` and other custom properties are passed to the puzzle.
  - `item`: `name` = unique item id, property `kind` (e.g. `rose`).
  - `target`: `name` = target id, property `accepts` = item id or kind (empty = anything).

## Rules that keep the cube walkable

- **Edge rule: no solid terrain (`#`, `T`, `~`) on the outer ring of any map** (row 0, row
  11, column 0, column 11). Players walk off any edge onto the neighbouring face, and a
  solid tile on the far side of an edge just blocks them. Objects may stand on the ring;
  a puzzle never blocks a ring tile. `shared/test/maps.test.ts` fails if a map breaks it.
- Coordinates are canonical: x right, y down, exactly as drawn. Inside tile (x, y) is
  directly behind outside tile (x, y). The inside player sees the map MIRRORED left-right
  (they look at the wall from behind), and both players see it rotated by their compass
  drift. That is intended; do not pre-mirror inside maps.
- Players start on face 1: outside at (5, 9), inside at (3, 9). Keep those floor.
- Voice fades with distance on the cube, so spreading a puzzle across faces is a design
  tool: same face = loud, next face = quiet, opposite face = silent.

`npm test` validates every map (size, legend, spawn tiles, the edge rule).
