# /maps (owner: friend 3)

The cube has 6 faces, and every face has two maps: the OUTSIDE surface and the INSIDE
surface of the same wall. 12 maps total, each 10x10 tiles of 16px.

| Face | Outside | Inside |
| --- | --- | --- |
| 1 | Grass | Plate room |
| 2 | Desert | Crate room |
| 3 | Snow | Frost room |
| 4 | Forest | Echo room |
| 5 | Rooftop | Pillars |
| 6 | Cave (portal) | Core (portal) |

## Two ways to author a map

**A. String maps (what the game uses now).** `shared/src/maps/default.ts`, 10 strings of
10 characters per map:

| Char | Meaning | Kind |
| --- | --- | --- |
| `.` | floor | terrain |
| `#` | wall / rock / pillar (solid) | terrain |
| `T` | tree (solid) | terrain |
| `~` | water (solid) | terrain |
| `P` | plate | object |
| `D` | door | object |
| `C` | crystal | object |
| `O` | portal (face 6, both sides, same tiles) | object |
| `I` | carryable item | object |
| `U` | target an item can be dropped on | object |

New characters are added in `shared/src/maps/strings.ts` (`LEGEND`).

**B. Tiled maps (replace string maps face by face).** Save a map as
`/maps/<side>-<face>.tmj`, e.g. `out-1.tmj`, `in-6.tmj`, then run `npm run maps` and commit
(it regenerates `shared/src/maps/generated.ts`). A face with a `.tmj` ignores its string map.
Start from `template.tmj`.

Tiled rules:
- Orthogonal, 10x10 tiles, 16x16 px. Tile layer format: CSV (not compressed).
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
- Players start on face 1: outside at (4, 8), inside at (2, 8). Keep those floor.
- Face 6 needs `portal` objects on the same tiles on both sides.
- Voice fades with distance on the cube, so spreading a puzzle across faces is a design
  tool: same face = loud, next face = quiet, opposite face = silent.

`npm test` validates every map (size, legend, spawn tiles, portals).
