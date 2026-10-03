# Puzzle tests: add a solution script for your puzzle

For friend 1 (puzzles). Every puzzle registered in `shared/src/puzzles/index.ts` needs a
**solution script**: a few lines that play the puzzle with real moves. `npm test` fails
until it exists, and from then on it proves on every commit that your puzzle can still be
solved and that the whole game can still be won.

You edit one file: `shared/test/solutions.ts`. You do not write a test.

## Add a script (copy, paste, edit)

Open `shared/test/solutions.ts` and add an entry to `SOLUTIONS`. The key is your module's
`id`, exactly as written in your puzzle file.

```ts
  // Face 2. One line on how it is solved.
  'my-puzzle': (t) => {
    // Inside walks onto the lever.
    t.go('in', t.find('in', 2, 'lever'));
    // Outside picks up the key (item id "key") and puts it on the lock.
    t.go('out', t.item('key'));
    t.interact('out'); // E: pick up
    t.go('out', t.find('out', 2, 'target', 'lock'));
    t.interact('out'); // E: place
  },
```

That is the whole job. The tests then check, for your puzzle:

- a fresh game does not start solved,
- after your script, your module's `isSolved()` returns true,
- your face is latched in `state.solved` and exactly one `solve` event fired,
- the game state is still plain JSON,
- every `ctx.objects(side, face, 'type')` and `ctx.item('id')` your module asks for finds
  something in the maps,
- the game is winnable: every script runs on one game, then both players walk into the portal.

## What `t` can do

| Call | What it does |
| --- | --- |
| `t.go(side, tile)` | Walk to a tile by the shortest legal path (crosses faces). Fails if there is no path. |
| `t.move(side, dx, dy)` | One step in that player's own screen space. Returns the events (check for `bump`). |
| `t.interact(side)` | The E key: pick up the item on the tile, or drop / place the carried one. |
| `t.wait(ms)` | Let time pass. Runs your `onTick` every 250 ms. |
| `t.find(side, face, type, name?)` | Tile of a map object, e.g. `t.find('in', 1, 'plate')`. Fails if the map has none. |
| `t.item(id)` | Tile an item is lying on right now, e.g. `t.item('rose')`. |
| `t.state` | The game state, **read only**. For example `t.state.solved`, `t.state.players.out.carrying`. |
| `t.events` | Every event so far (`solve`, `puzzle`, `bump`, ...). |

`side` is `'out'` or `'in'`. A tile is `{ face, x, y }` in canonical coordinates (as drawn
in the map), so you can also write `t.go('out', { face: 2, x: 4, y: 7 })`.

Time is real: every step and every E costs 100 ms of game time and `onTick` runs on that
clock, so a timed door has to be beaten at walking speed.

## Rules

1. **Real moves only.** Never write to `t.state` or to your puzzle state. If a script cannot
   solve the puzzle by walking, pressing E and waiting, neither can a player.
2. **Look things up, do not hardcode tiles.** Use `t.find` and `t.item`. Friend 3 moves
   things on the maps and your script should keep working.
3. **Do not assume where the players stand.** Your script runs on a fresh game (players at
   spawn) and also after the other scripts (players anywhere). `t.go` handles both.
4. **Needs another puzzle solved first?** Say so at the top of your script:

   ```ts
   'my-puzzle': (t) => {
     if (!t.state.solved.includes(1)) SOLUTIONS['plate-door']!(t);
     // ...
   },
   ```

5. One puzzle per face, unique `id`. The engine latches "solved" per face, so a second
   puzzle on the same face would never be checked. A test fails if two share a face.

## Run just these tests

From the repo root:

```sh
# the puzzle solutions and the world smoke tests only
npx tsx --test shared/test/puzzles.test.ts shared/test/smoke.test.ts

# only your puzzle (matches the test name, which contains your id)
npx tsx --test --test-name-pattern="my-puzzle" shared/test/puzzles.test.ts

# everything, as before every commit
npm test
```

## Reading a failure

| Message | Meaning |
| --- | --- |
| `no solution script for "my-puzzle"` | Add the entry to `shared/test/solutions.ts`. |
| `solutions.ts has scripts for unknown puzzle ids` | The key does not match your module's `id`, or the module is not in `PUZZLES`. |
| `no "lever" on in face 2` | `t.find` found nothing: the object is not on that map (wrong side, face or type). |
| `no path for out to face 2 4,7` | Something blocks the way at that moment: terrain, or your `isBlocked`. |
| `isSolved() is still false after the solution script` | The script finished but the puzzle is not solved: a step is missing. |
| `a puzzle looked up something the maps do not have` | Your module calls `ctx.objects(...)` or `ctx.item(...)` for something no map has. The message lists the exact call. |
| `face N is not solved after its script (run after: ...)` | Your script works alone but not after the listed faces were solved (rule 3). |

## Where things are

- `shared/test/solutions.ts`: the scripts. The only file you edit.
- `shared/test/puzzles.test.ts`: one test per registered puzzle, plus the registry checks.
- `shared/test/smoke.test.ts`: all 12 maps load, spawn tiles are free, required objects
  exist, every face is reachable, the game is winnable.
- `shared/test/harness.ts`: `t` (the `Solver`) and the lookup recorder.
