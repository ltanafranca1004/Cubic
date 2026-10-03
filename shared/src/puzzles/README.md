# /shared/src/puzzles (owner: friend 1)

One file per puzzle. A puzzle is a `PuzzleModule` (see `types.ts`): pure logic that the
engine calls. The same code runs on the server (the truth) and in the browser (prediction),
so a module must be deterministic and must never touch sockets, the DOM, timers,
`Math.random` or `Date.now` (use `ctx.now`).

## Start here

1. Copy `_template.ts` to `myPuzzle.ts`. `plateDoor.ts` is a complete working example.
2. Pick the `face` (1-6) the puzzle owns and a unique `id`.
3. Put the things it needs on the map (see `/maps/README.md`): objects such as `plate`,
   `door`, `crystal`, `item`, `target`, or new types of your own.
4. Register it in `index.ts` (`PUZZLES`). The portal on face 6 opens when every registered
   puzzle is solved.
5. Add a test in `/shared/test` that solves it with `applyMove` (copy `puzzles.test.ts`).

## The hooks

| Hook | When | Use it for |
| --- | --- | --- |
| `init(ctx)` | game start | initial state (plain JSON) |
| `isBlocked(s, ctx, side, tile)` | before a step onto your face | doors, crates, one-way tiles |
| `onEnter(s, ctx, side, tile)` | after a step onto a tile of your face | plates, triggers, hazards |
| `onLeave(s, ctx, side, tile)` | after stepping off a tile of your face | releasing plates |
| `onItem(s, ctx, ev)` | an item was picked / dropped / placed, on ANY face | carry puzzles |
| `onTick(s, ctx, dtMs)` | every 250 ms on the server | timers, moving things |
| `isSolved(s, ctx)` | after every move and tick | first `true` latches the face solved |
| `visible(s, ctx, side)` | when drawing / describing the face | what each side can see |
| `objective(s, ctx, side)` | HUD text | one line per side |

`ctx` gives you: `objects(side, face, type?)`, `player(side)`, `isOn(side, tile)`,
`item(id)`, `state` (read only), `solved`, `now`, and the only ways to affect the rest of
the game: `emit(name, data?)` (custom event for sound/effects), `strike(side)`,
`teleport(side, x, y)`.

## Coordinates

Tiles are canonical `(x, y)`, 0-9, x right and y down as drawn in the map file. Both sides
share them: inside `(x, y)` is the tile directly behind outside `(x, y)`. Players see the
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
`target` prop `accepts` = an item id or kind (empty = anything). Example: a rose on face 1
and a pot on face 6.

```ts
onItem(s, _ctx, ev) {
  if (ev.kind === 'placed' && ev.item.kind === 'rose' && ev.target?.name === 'pot') s.done = true;
}
```
