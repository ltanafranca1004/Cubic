# Puzzle tests

For friend 1 (puzzles). Every puzzle registered in `shared/src/puzzles/index.ts` has:

- a **solution script** in `shared/test/solutions.ts`: a few lines that play the puzzle
  with real moves. `npm test` fails if one is missing, and proves on every commit that the
  puzzle can still be solved and the whole game can still be won;
- a **unit test file** `shared/test/<id>.test.ts` for the rest: wrong answers, what each
  side sees, seeds, the edge rule, never stuck;
- an entry in `PUZZLE_SCRIPTS` in `tools/screens/playtest.ts`: the same solve in two real
  browsers with real keys.

## The puzzles, and how each one is solved

Six puzzles, one per face. Chain: 2 -> 5 -> 6 -> 4; faces 1 and 3 stand alone. The game is
won the moment the sixth is solved: there is no portal.

| Puzzle (id) | Face | The outside player | The inside player | Why it cannot be done alone |
| --- | --- | --- | --- | --- |
| Hidden code (`hidden-code`) | 1 Grass / Keypad room | reads the 3-digit number laid out in the grass, at compass drift 0 | types it on the floor keypad (E on a key), then ENTER | the number is drawn outside only and differs every game; the keypad is inside only |
| Equation safe (`equation-safe`) | 2 Desert / Vault | counts the berry bushes, the round rocks and the birds (1 to 4 each) | types 3 x bushes x 2 x birds x rocks, then ENTER | the counts are outside, the formula and the keypad inside |
| Mirrored glyph (`mirrored-glyph`) | 3 Snow / Tile room | describes the symbol in the snow | flips floor tiles (E) until exactly the symbol is on | the symbol is outside only, the tiles inside only, and the inside view is mirrored |
| Botanical mirror (`botanical-mirror`) | 4 Forest / Greenhouse | plants the flower in the pot the partner names | says which of the five pots holds the flower's colour | the pots are empty outside; which colour stands where differs every game |
| Sequence laser (`sequence-laser`) | 5 Rooftop / Laser room | calls the order the seven symbols light up in | puts the battery in the emitter, presses the symbols in that order | the lights are outside only, the buttons inside only, the order differs every game |
| Laser and lava (`laser-path`) | 6 Cave / Lava room | pushes two mirrors until the beam burns the crate on the edge, then calls the beam's route | walks the tiles behind the beam over the lava to the button, E | the mirrors and the beam are outside only, the lava and the button inside; nothing marks the safe tiles |

What each face hands on: face 2 the battery (inside), face 5 the laser beam on face 6, face
6 the flower (outside), which face 4 needs.

### Exact solve steps

Tiles are canonical `x,y` (as drawn in `shared/src/maps/default.ts`).

**Hidden code, face 1.** The number covers rows 2 to 6 from column 0: three digits of 3x5
tiles, each digit made of one thing (flowers, rocks or worn ground). The inside player walks
onto a key, presses E, three times, then E on ENTER. A wrong code: one strike, the display
clears. Right: the keypad turns green for good.

**Equation safe, face 2.** The answer is at most 384 and is typed without leading zeros.
Wrong: one strike, the display clears. Right: the safe opens and the battery lies on the
tile in front of it (`5,4`), for the inside player.

**Mirrored glyph, face 3.** 47 tiles. E on the corner tile `11,11` (CLEAR) turns every tile
off. No strikes. Once the flipped tiles are exactly the symbol they lock.

**Sequence laser, face 5.**
1. Inside drops the battery on the emitter at `5,5`. Anything else comes straight back.
2. The seven outside symbols light up once each, 0.5 s apiece. E on REPLAY (`5,9`, outside)
   plays it again.
3. Inside presses E on the seven symbol tiles in that order. A wrong press: one strike and
   the presses start over. The order never changes during a game.

**Laser and lava, face 6.** The lava inside is hot from the start of the game.
1. The beam comes up at `5,5` and runs north. The mirrors start at `4,2` ("/") and `9,4`
   ("\"). Three pushes do it: from `3,2` into `4,2`, from `9,5` into `9,4`, from `9,4` into
   `9,3`. The beam then turns east at `5,2`, south at `9,2` and hits the crate at `9,11`.
   The crate stands ON THE RING and is solid until it burns: the one exception to the edge
   rule (`maps.test.ts` and the ring check in `laser-path.test.ts` allow only it, only unburnt).
2. The crate burns: the flower lies on its tile (`9,11`) and the mirrors lock. E on RESET
   (`3,8`) puts the mirrors back before the burn and does nothing after it.
3. The beam is the safe path. The inside player walks round the ring to `9,11`, then the
   tiles behind the beam backwards: north to `9,2`, west to `5,2`, south to the button at
   `5,5` (behind the beam source), and presses E. `shownPath` in `laser-solutions.ts` reads
   those tiles off the beam the outside player sees (`linesOn`).
4. A lava tile off the beam: one strike, back to `9,11`. Before the crate burns every lava
   tile is deadly and a fall puts you on `0,5`.

**The lava is deadly from the first second until face 6 is solved**, then it crusts over
and is walkable. So every inside walk keeps to the ring of face 6: `t.go` plans with
`hazardAvoid` (it never crosses a deadly tile, and fails if the target is one), and a step
into the lava on purpose is a single `stepTo`.

**Botanical mirror, face 4.** Until face 6 is solved the pots are asleep: anything put in
one comes straight back. Then: the wrong pot is one strike and the flower is back in hand;
the right pot blooms.

## The test files

| File | What it proves |
| --- | --- |
| `shared/test/puzzles.test.ts` | every registered puzzle has a solution script and the other way round; ids are unique, one puzzle per face; per puzzle: not solved at the start, solved after its script, latched once, state still plain JSON |
| `shared/test/smoke.test.ts` | all 12 maps load, spawn tiles are free, everything a puzzle looks up exists in the world, every face is reachable for both sides, the whole game is winnable with the registered puzzles |
| `shared/test/hidden-code.test.ts`, `equation-safe.test.ts`, `mirrored-glyph.test.ts`, `botanical-mirror.test.ts`, `sequence-laser.test.ts`, `laser-path.test.ts` | one file per puzzle: the solve, wrong input = strike, each side sees only its half, seeded content (two seeds differ, one seed agrees), no ring tile is ever blocked, never stuck |
| `shared/test/lib-*.test.ts` | the building blocks in `shared/src/puzzles/lib` |
| `shared/test/maps.test.ts` | map parsing and the edge rule (no solid terrain on the outer ring) |
| `server/test/twoClient.test.ts` | a whole game over real sockets, to the win |
| `client/test/biomes.test.ts` | no decoration, tree crown or landmark covers a puzzle tile |

Not test files: `shared/test/harness.ts` (`t`, the `Solver`, and the lookup recorder),
`shared/test/solutions.ts` (the scripts), `shared/test/laser-solutions.ts` (the scripts of
faces 5 and 6 and the helpers their unit tests share: `stepTo`, `insideGo`,
`solveSequenceLaser`, `solveLaserPath`).

`tools/screens/playtest.ts puzzles` plays all six in two real browsers with real key
presses, in WebGL and in Canvas, to the win screen. Its table is `PUZZLE_SCRIPTS`: one
entry per puzzle, in chain order (1, 3, 2, 5, 6, 4), made of `goto`, `keys`, `wait`,
`expect` and `plan` steps. A `plan` step is a function of the live server state that
returns more steps, for content that is seeded per game: it reads what one player sees
(`visibleObjects`) and returns what the other has to do. Details: `tools/README.md`.

### Seeing what a player sees in a script

A script may only use what a player on that side can SEE. It reads
`visibleObjects(t.state, side, face, t.env)`, the same list the screen is drawn from, and
never the puzzle's state:

```ts
// outside counts, inside types
const seen = (type: string) => visibleObjects(t.state, 'out', 2, t.env).filter((o) => o.type === type).length;
const answer = 3 * seen('f2-bush') * 2 * seen('f2-bird') * seen('f2-rock');
const key = visibleObjects(t.state, 'in', 2, t.env).find((o) => o.type === 'key' && o.state === '7')!;
t.go('in', { face: 2, x: key.x, y: key.y });
t.interact('in'); // E on the key
```

## Add or change a script

Open `shared/test/solutions.ts`. One delimited block per puzzle, keyed by the module's
`id`; edit only yours.

```ts
  // ---------- face 2: my-puzzle ----------
  'my-puzzle': (t) => {
    // Inside walks onto the lever and pulls it.
    t.go('in', t.find('in', 2, 'lever'));
    t.interact('in'); // E with empty hands: onUse
    // Outside picks up the key (item id "key") and puts it on the lock.
    t.go('out', t.item('key'));
    t.interact('out'); // E: pick up
    t.go('out', t.find('out', 2, 'target', 'lock'));
    t.interact('out'); // E: place
  },
  // ---------- end face 2 ----------
```

The tests then check, for your puzzle:

- a fresh game does not start solved,
- after your script, your module's `isSolved()` returns true,
- your face is latched in `state.solved` and exactly one `solve` event fired,
- the game state is still plain JSON,
- every `ctx.objects(side, face, 'type')` and `ctx.item('id')` your module asks for finds
  something in the maps,
- the game is winnable: every script runs on one game, and the last solve wins it.

## What `t` can do

| Call | What it does |
| --- | --- |
| `t.go(side, tile)` | Walk to a tile by the shortest legal path that enters no deadly tile (crosses faces; round the ring of face 6 inside). Fails if there is no path. |
| `t.move(side, dx, dy)` | One step in that player's own screen space. Returns the events (check for `bump`). Walking into a box pushes it. |
| `t.interact(side)` | The E key: drop / place the carried item, else pick up the item on the tile, else use the tile (`onUse`). |
| `t.wait(ms)` | Let time pass. Runs your `onTick` every 250 ms. |
| `t.find(side, face, type, name?)` | Tile of a map object, e.g. `t.find('in', 1, 'key', 'enter')`. Fails if the map has none. |
| `t.item(id)` | Tile an item is lying on right now, e.g. `t.item('battery')`. |
| `t.state` | The game state, **read only**. For example `t.state.solved`, `t.state.players.out.carrying`. |
| `t.events` | Every event so far (`solve`, `puzzle`, `bump`, ...). |

`side` is `'out'` or `'in'`. A tile is `{ face, x, y }` in canonical coordinates (as drawn
in the map), so you can also write `t.go('out', { face: 2, x: 4, y: 7 })`.

Time is real: every step and every E costs 100 ms of game time and `onTick` runs on that
clock, so a light sequence has to be watched at walking speed.

## Rules

1. **Real moves only.** Never write to `t.state` or to your puzzle state. If a script cannot
   solve the puzzle by walking, pressing E and waiting, neither can a player.
2. **Look things up, do not hardcode tiles.** Use `t.find`, `t.item` and `visibleObjects`.
   Friend 3 moves things on the maps and your script should keep working.
3. **Do not assume where the players stand.** Your script runs on a fresh game (players at
   spawn) and also after the other scripts (players anywhere). `t.go` handles both.
4. **Needs another puzzle solved first?** Play it at the top of your script, as the chain
   does:

   ```ts
   'botanical-mirror': (t) => {
     if (!t.state.solved.includes(6)) SOLUTIONS['laser-path']!(t);
     // ...
   },
   ```

5. One puzzle per face, unique `id`. The engine latches "solved" per face, so a second
   puzzle on the same face would never be checked. A test fails if two share a face.
6. **The edge rule.** Never block a tile of the outer ring, for either side, in any state.
   Every puzzle's test file checks it.

## Run just these tests

From the repo root:

```sh
# the puzzle solutions and the world smoke tests only
npx tsx --test shared/test/puzzles.test.ts shared/test/smoke.test.ts

# one puzzle's own tests
npx tsx --test shared/test/laser-path.test.ts

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
