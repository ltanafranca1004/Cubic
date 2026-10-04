# /shared/src/puzzles (owner: friend 1)

One file per puzzle. A puzzle is a `PuzzleModule` (see `types.ts`): pure logic that the
engine calls. The same code runs on the server (the truth) and in the browser (prediction),
so a module must be deterministic and must never touch sockets, the DOM, timers,
`Math.random` or `Date.now` (use `ctx.now`).

## Start here

The six puzzles are registered in `index.ts` with fixed ids, faces and export names. Each
file starts as a stub (press E on the crystal). To build one, replace its file, keeping
`id`, `face` and the export name; do not edit `index.ts`. `_template.ts` shows every hook.

1. Put what it needs on the map: your two banner sections in `shared/src/maps/default.ts`
   (outside and inside of your face) and your legend characters in your section of
   `shared/src/maps/strings.ts`. Same canonical tile on both sides, never a mirrored copy.
2. Replace your block in `shared/test/solutions.ts`: a few lines that solve it with real
   moves. Add `shared/test/<id>.test.ts` for the rest (wrong answer = strike, what each
   side sees, two seeds differ).

## The puzzles in the game

| Face | File | id | Needs |
| --- | --- | --- | --- |
| 1 | `hiddenCode.ts` | `hidden-code` | nothing |
| 2 | `equationSafe.ts` | `equation-safe` | nothing |
| 3 | `mirroredGlyph.ts` | `mirrored-glyph` | nothing |
| 4 | `botanicalMirror.ts` | `botanical-mirror` | face 6 |
| 5 | `sequenceLaser.ts` | `sequence-laser` | face 2 (the battery) |
| 6 | `laserPath.ts` | `laser-path` | face 5 |

The game is won the moment all six are solved (the world has no portal).

**Randomness.** A module may not call `Math.random` or `Date.now`. Everything random comes
from the game's seed: `ctx.rand(...keys)` in a hook (`mix(ctx.seed, ...keys)`), `ctx.seed`
in `init`. Same keys, same number, on the server and on both clients. Derive content from
the seed when you need it instead of storing it, and test that two seeds differ.

**Edge rule.** The outer ring of every face (`onRing(x, y)` from `shared/src/maps`) is never
solid terrain, and your `isBlocked` must never block a ring tile, for either side: a
player crossing in from a neighbouring face can always step in. Keep boxes, doors and
hazards off the ring, and test it.

**A puzzle that can trap or block someone** says in its header comment how the player gets
out again, and has a test for it.

## Building blocks (`lib/`)

Pure helpers, each with a usage example in its header comment: `keypad.ts` (digit keys,
ENTER, display), `flip.ts` (a set of flipped tiles), `sequence.ts` (a light sequence on the
tick, and checking the presses), `push.ts` (sokoban boxes), `hazard.ts` (lava: back to the
start with a strike), `path.ts` (`safeLine`, a seeded winding path), `deps.ts`
(`lockedUntil(ctx, face)`). `util.ts` has `at`, `keyOf`, `around`, `flood`, `mix`.

## The hooks

| Hook | When | Use it for |
| --- | --- | --- |
| `init(ctx)` | game start | initial state (plain JSON) |
| `isBlocked(s, ctx, side, tile)` | before a step onto your face | doors, crates, one-way tiles |
| `onEnter(s, ctx, side, tile)` | after a step onto a tile of your face | plates, triggers, hazards |
| `onLeave(s, ctx, side, tile)` | after stepping off a tile of your face | releasing plates |
| `onUse(s, ctx, side, tile)` | E on a tile of your face, hands empty, no item to pick up | keys, buttons, flip tiles |
| `onPush(s, ctx, side, tile, dx, dy)` | before the block check of a step within your face | move a box, return `true` if it moved |
| `onItem(s, ctx, ev)` | an item was picked / dropped / placed, on ANY face | carry puzzles |
| `onTick(s, ctx, dtMs)` | every 250 ms on the server | timers, moving things |
| `isSolved(s, ctx)` | after every move and tick | first `true` latches the face solved |
| `visible(s, ctx, side)` | when drawing / describing the face | what each side can see |
| `objective(s, ctx, side)` | HUD text | one line per side |
| `lines(s, ctx, side)` | when drawing the face | beams: `{ from: [x, y], to: [x, y], colour }` between tile centres |
| `bright` (a flag) | | the inside of your face is drawn without darkness |

E does, in this order: drop the carried item, pick up the item on the tile, else `onUse`.

`ctx` gives you: `objects(side, face, type?)`, `player(side)`, `isOn(side, tile)`,
`item(id)`, `state` (read only), `solved`, `now`, `seed`, `rand(...keys)`,
`faceSolved(face)`, and the only ways to affect the rest of the game: `emit(name, data?)`
(custom event for sound/effects; the way a tick tells the clients something), `strike(side)`,
`teleport(side, x, y)`, `spawnItem({ id, kind, side, face, x, y, props? })` (throws on a
used id), `giveItem(side, id)` (into that player's hands, even right after it was placed)
and `removeItem(id)`.

## Coordinates

Tiles are canonical `(x, y)`, 0-11 (`FACE_SIZE` = 12), x right and y down as drawn in the
map file. Both sides share them: inside `(x, y)` is the tile directly behind outside `(x, y)`. Players see the
face rotated by their compass drift, and the inside player sees it mirrored, so never
reason in "screen left/right" inside a puzzle. Compare tiles, not directions.

## Visibility

Each side only sees its own map plus what your `visible(s, ctx, side)` returns for it.
That is the whole game: one side sees the lock, the other sees the key, and they have to
talk. Return `{ type, x, y, state }`; the client picks art by `type` and `state`. An entry
at the same tile as a map object replaces it. What you do not return stays hidden, also
from the AI partner.

## Items

A map object of type `item` is carryable (E to pick up / drop, one at a time, it travels
across faces with the player). A map object of type `target` receives items: dropping an
accepted item on it fires `onItem` with `kind: 'placed'` and the item stays there.
`target` prop `accepts` = an item id or kind (empty = anything). A puzzle can also make an item
(`ctx.spawnItem`), hand one back (`ctx.giveItem`) or delete one (`ctx.removeItem`).

```ts
onItem(s, _ctx, ev) {
  if (ev.kind === 'placed' && ev.item.kind === 'rose' && ev.target?.name === 'pot') s.done = true;
}
```
