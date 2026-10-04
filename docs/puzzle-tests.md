# Puzzle tests: add a solution script for your puzzle

For friend 1 (puzzles). Every puzzle registered in `shared/src/puzzles/index.ts` needs a
**solution script**: a few lines that play the puzzle with real moves. `npm test` fails
until it exists, and from then on it proves on every commit that your puzzle can still be
solved and that the whole game can still be won.

You edit one file: `shared/test/solutions.ts`. You do not write a test.

## The puzzles, and how each one is solved

Five puzzles, one per face; face 2 has none. The portal on face 6 wakes when all five are
solved, then both players step on it and the win screen comes up. Any order works.

| Puzzle (id) | Face | The outside player | The inside player | Why it cannot be done alone |
| --- | --- | --- | --- | --- |
| Plate and door (`plate-door`) | 1 Grass / Plate room | walks through the door to the crystal | stands on the plate, which holds the door open | the door only opens while the inside player's body is on the plate, and the crystal is outside |
| Code relay (`glyph-code`) | 3 Snow / Frost room | steps on the sign stone the partner names, four times | stands on the plate and reads the tablet: one sign at a time | the wanted sign is drawn only for the inside player, the stones only listen while the inside player is on the plate, and the code is different every game |
| Mirror maze (`mirror-maze`) | 4 Forest / Echo room | reads the pale stepping stones and talks the partner along them | walks the trap floor from the doorway to the crystal, one called step at a time | the safe tiles are drawn only for the outside player, they are different every game, and every fall draws a new line; only the inside player can enter the room |
| Skylight (`skylight`) | 5 Rooftop / Pillars | stands on glass pane a, then on pane b when told | crosses bridge a to the dry ring, waits, then crosses bridge b to the crystal | a bridge only exists while the outside player's body is on its pane, one pane lights one bridge, and the crystal is inside |
| Rose and pot (`rose-pot`) | 6 Cave / Core | carries the rose from face 1 to the pot | nothing (the one solo puzzle: it pulls the two apart, out of earshot) | it can |

All three new puzzles put both players on the same wall, so they hear each other at full
volume while they work; the walk between faces is where the voice fades.

### Exact solve steps

Tiles are canonical `x,y` (as drawn in `shared/src/maps/default.ts`).

**Code relay, face 3.**
1. Inside walks onto the plate at `5,6`. The tablet at `5,5` shows a sign and the six stones
   outside light up.
2. Inside says the sign (sun, moon, star, drop, bolt or ring). Outside walks onto that
   stone: sun `3,2`, moon `8,2`, star `1,5`, drop `10,6`, bolt `3,9`, ring `8,9`. Each
   stone is in its own niche, so no walk crosses another stone.
3. A lamp lights inside and the tablet shows the next sign. Repeat until four are in.
4. A wrong stone: one strike, the lamps go out and the code changes. Stepping off the
   plate keeps the progress but puts the stones to sleep.

**Mirror maze, face 4.**
1. Outside stands anywhere on the Forest face and sees a line of pale stones in the
   clearing: the first has an amber dot (it is the tile just inside the doorway), the last
   a pink crystal.
2. Inside walks to the doorway at `3,10` and steps in onto `3,9`.
3. Outside calls the line one step at a time. The inside player sees the wall from behind,
   so the outside player's left is the inside player's right (and either view may be
   turned by compass drift): agree on a landmark first. Tiles that held are marked inside.
4. Inside reaches the crystal at `8,2`. A wrong tile: one strike, back to the doorway, and
   the stones move to a new line.

**Skylight, face 5.**
1. Inside waits at the outer water. Outside stands on pane a at `10,2`: bridge a appears at
   `2,6` and the room lights up.
2. Inside crosses bridge a and walks round the dry ring to `8,5`, next to bridge b.
3. Inside says so. Outside walks to pane b at `1,9`: bridge a goes dark, bridge b appears at `7,5`.
4. Inside crosses bridge b to the crystal at `5,6`. Both bridges stay from then on.
5. If the outside player steps off while the inside player is ON a bridge: one strike and
   the inside player is put back on the last dry tile. If the inside player is left in the
   dark on the ring or the island, a dark bridge can still be walked outwards (never
   inwards), so they can always leave.

### What the tests prove

`shared/test/coop.test.ts` (25 tests, real moves through the engine):

- per-side visibility: the outside list never has the tablet, the inside list never has the
  stepping stones or the panes;
- **cannot be solved alone**: with nobody on the plate no stone changes the puzzle state
  (so no sequence can); the outside view is identical in 40 games whose codes differ; the
  inside view of the maze is identical in 40 games whose safe lines differ, and walking
  another game's line always falls; the crystal of the skylight room is unreachable with
  the outside player parked on any single tile of the roof, panes included;
- wrong input: strike, reset, new code / new line;
- never stuck: every face stays reachable for both players after a fall, in the dark on
  the ring, in the dark on the island, and after every puzzle of a whole game.

`server/test/twoClient.test.ts` plays all five over real sockets to the win.
`tools/screens/puzzles.ts` plays all five in two real browsers with real key presses, in
WebGL and in Canvas, to the win screen (screenshots in `docs/screens/puzzles/`).

### Seeing what a player sees in a script

The new scripts need what a player SEES (the sign on the tablet, the stones). They read
`visibleObjects(t.state, side, face, t.env)`, the same list the screen is drawn from, and
never the puzzle's state:

```ts
const sign = sees(t, 'in', 3, 'tablet')[0]!.state; // inside: "it shows a moon"
const stone = sees(t, 'out', 3, 'glyph').find((g) => g.state === sign)!; // outside finds the moon stone
t.go('out', { face: 3, x: stone.x, y: stone.y });
```

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
- `shared/test/coop.test.ts`: the rules of the three co-op puzzles, and that none can be solved alone.
- `shared/test/puzzles.test.ts`: one test per registered puzzle, plus the registry checks.
- `shared/test/smoke.test.ts`: all 12 maps load, spawn tiles are free, required objects
  exist, every face is reachable, the game is winnable.
- `shared/test/harness.ts`: `t` (the `Solver`) and the lookup recorder.
