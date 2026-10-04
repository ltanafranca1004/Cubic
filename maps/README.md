# /maps (owner: friend 3)

The cube has 6 faces, and every face has two maps: the OUTSIDE surface and the INSIDE
surface of the same wall. 12 maps total, each 12x12 tiles of 16px (`FACE_SIZE` in
`shared/src/types.ts`).

| Face | Outside | Inside |
| --- | --- | --- |
| 1 | Grass | Plate room |
| 2 | Desert | Crate room |
| 3 | Snow | Frost room |
| 4 | Forest | Echo room |
| 5 | Rooftop | Moat room |
| 6 | Cave (portal) | Core (portal) |

## Two ways to author a map

**A. String maps (what the game uses now).** `shared/src/maps/default.ts`, 12 strings of
12 characters per map:

| Char | Meaning | Kind |
| --- | --- | --- |
| `.` | floor | terrain |
| `#` | wall / rock / pillar (solid) | terrain |
| `T` | tree (solid). Outside it is drawn per biome: bush, cactus (a palm beside water), snowy pine, oak, planter, stalagmite | terrain |
| `~` | water (solid). Outside it gets a bank on every side that touches land | terrain |
| `P` | plate | object |
| `D` | door | object |
| `C` | crystal | object |
| `O` | portal (face 6, both sides, same tiles) | object |
| `I` | carryable item | object |
| `R` | rose (a carryable item, id and kind `rose`) | object |
| `U` | target an item can be dropped on | object |
| `1` to `6` | sign stone of the code relay (`glyph`, name sun, moon, star, drop, bolt, ring) | object |
| `G` / `L` | the code relay's `tablet` and a progress `lamp` (one per sign) | object |
| `S` / `s` | `skylight` pane a / b (outside): lights the bridge with the same name | object |
| `B` / `b` | `bridge` a / b (inside), over water; only walkable while lit | object |
| `E` | `entry`: the doorway of the mirror maze's trap room | object |

New characters are added in `shared/src/maps/strings.ts` (`LEGEND`).

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
  or a custom string property called `type`): `plate`, `door`, `crystal`, `portal`, `item`,
  `target`, or whatever a puzzle module looks for. The object's top-left corner picks the
  tile. `name` and other custom properties are passed to the puzzle.
  - `item`: `name` = unique item id, property `kind` (e.g. `rose`).
  - `target`: `name` = target id, property `accepts` = item id or kind (empty = anything).

## Rules that keep the cube walkable

- Keep the outer ring of every map mostly floor: players walk off any edge onto the
  neighbouring face, and a wall on the far side of an edge just blocks them.
- Coordinates are canonical: x right, y down, exactly as drawn. Inside tile (x, y) is
  directly behind outside tile (x, y). The inside player sees the map MIRRORED left-right
  (they look at the wall from behind), and both players see it rotated by their compass
  drift. That is intended; do not pre-mirror inside maps.
- Players start on face 1: outside at (5, 9), inside at (3, 9). Keep those floor.
- Face 6 needs `portal` objects on the same tiles on both sides.
- Voice fades with distance on the cube, so spreading a puzzle across faces is a design
  tool: same face = loud, next face = quiet, opposite face = silent.

`npm test` validates every map (size, legend, spawn tiles, portals).
