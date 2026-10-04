# Puzzle scripts: teaching the AI partner one puzzle

One file per puzzle module id. The partner core (`../partner.ts`) knows no puzzle: it
finds the human, stays on their wall, walks safely, handles "wait" / "go" and the portal.
When the bot stands on a puzzle's face, the puzzle is unsolved and the human is on the same
wall, the core asks that puzzle's script what to do.

A puzzle with no script still works: the bot says "I do not know this puzzle yet", keeps
off every object and item it can see on that face, and follows the human. A script whose
puzzle id is not in the game is never asked.

## Add one (three steps)

1. `shared/src/bot/scripts/<id>.ts`: export a `PuzzleScript` (interface in `types.ts`).
2. Register it in `index.ts` (`PUZZLE_SCRIPTS`).
3. Give every key in its `lines` its words in `server/src/ai/scripted.ts` (`PUZZLE`).
   A server test fails until each key has words of 80 characters or less.

Nothing in the core, the server or the client changes.

## The interface

```ts
interface PuzzleScript<M> {
  id: string;                 // the puzzle module's id, e.g. "glyph-code"
  lines: readonly string[];   // every line key it can say, each starting with "<id>."
  init(): M;                  // fresh memory (JSON). Reset each time the bot enters the face.
  hazards?(o: Observation): Cell[];        // tiles no walk may enter while unsolved
  play(ctx: ScriptCtx<M>): Play | null;    // on the face, unsolved, human on the same wall
  errand?(ctx: ScriptCtx<M>): Play | null; // work away from the face (carry something)
}
```

**What it reads** (`ScriptCtx`), and nothing else:

- `ctx.o`: `observe()` for its own side: `you` (out | in), `position`, `grid`, `objects`
  (type, state, col, row: exactly what the puzzle's `visible(side)` returns), `items`,
  `carrying`, `solvedFaces`, `strikes`, `puzzleList`. All in the bot's own screen
  coordinates. Never `GameState`, never the puzzle's state, never the other side.
- `ctx.heard` / `ctx.tokens` / `ctx.has('go', 'no')`: what the human typed since the last
  decision, parsed by `../talk.ts` (sign, dir with a count, go, yes, no, wait, again, face).
- `ctx.struck`: the strike counter went up since the last decision.
- `ctx.mem`: its own memory. `ctx.now`: game time in ms. No other clock, no randomness.

**What it proposes** (`Play`), asked again before every step (every 200 ms):

- `action`: `goto` (col, row), `move` (dir, steps), `step_on`, `go_face`, `pick_up`,
  `drop`, or `null` to stand still. The core walks it with the real blockers and never
  through a hazard tile.
- `allow`: hazard tiles this action may enter (its own target, e.g. the named stone).
- `hold: true`: the human depends on the body staying here (a plate, a pane). Nothing
  else, including a move suggested by Gemini, may move it.
- `status`: one line for the logs and the model.
- `ctx.say(key, { every?, force? })`: say one of its `lines`. Once per visit by default.
  Lines that carry protocol words are said exactly as written.
- Return `null` when this side has nothing to do: the core waits with the human.

**When it is done:** when the face is solved. The core stops asking, and drops its hazards.

## Rules

1. Tell the human what to type in the bot's own lines, and accept quick chat (1 Here! = yes,
   2 Wait, 3 Yes, 4 No) where it makes sense.
2. Whatever must cross the wall is said or heard. If the two views are mirrored or turned,
   agree on a landmark first (`agreeTurn` / `throughWall` in `grid.ts`).
3. Declare every tile that can cause a strike in `hazards`, and only `allow` a tile the
   human (or the rules) said is safe.
4. Do not assume where the bot stands or which way its view is turned.
5. Test it against a simulated human who only follows the bot's lines:
   `shared/test/partnerSim.ts` and `shared/test/partnerScripts.test.ts`.

Helpers on the observation grid (`grid.ts`): `same`, `around`, `walkable`, `route`,
`flood`, `far`, `throughWall`, `agreeTurn`, `dirOf`.

Examples: `plateDoor.ts` (hold a place / wait for a state), `glyphCode.ts` (read out and
listen for a word), `mirrorMaze.ts` (landmark, one step per message), `skylight.ts`
(hold until told), `rosePot.ts` (an errand across the cube).
