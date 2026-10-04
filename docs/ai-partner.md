# The AI partner: interfaces

The briefing for anyone who adds a puzzle script, changes the Gemini or voice budgets, or
builds the solo mode UI. Everything here is in the code as written; paths are from the repo
root.

## The parts

| Part | File | What it is |
| --- | --- | --- |
| Eyes | `shared/src/bot/observe.ts` | `observe(state, side, env?) -> Observation`: only what that side sees, in its own screen coords (col 0 = its left, row 0 = its top) |
| Ears | `shared/src/bot/talk.ts` | `parseHuman(text) -> Heard`: one chat line as protocol tokens, plus the raw text |
| Brain (core) | `shared/src/bot/partner.ts` | `decide(mind, o, heard, now, scripts?) -> Decision`. Knows no puzzle |
| Brain (per puzzle) | `shared/src/bot/scripts/<id>.ts` | one `PuzzleScript` per puzzle module id, registered in `scripts/index.ts` |
| Body | `shared/src/bot/actions.ts`, `path.ts` | `planAction` turns a `BotAction` into steps; `findPath` is the BFS; `nextStep` (in `partner.ts`) takes the first step |
| Runner | `server/src/ai/aiPlayer.ts` | `AiPlayer`: one `decide` + one step per 200 ms on a real `Room` |
| Words | `server/src/ai/scripted.ts` | the text of every line key, per persona |
| Advisor | `server/src/ai/gemini.ts`, `prompt.ts` | Gemini: optional, never drives |
| Voice | `server/src/ai/tts.ts`, `server/tts/bank/` | bank, disk cache, ElevenLabs, else the browser voice |

`shared/src/bot` is pure: no clock (the caller passes `now`), no randomness, no networking.
The game is won the moment the last puzzle is solved: there is no portal in the partner
code. (`Observation.portalOpen` / `portalFace` and `objective.ts` still exist for the test
fixture world; `decide` does not read them.)

## State of the registry

`PUZZLE_SCRIPTS` in `shared/src/bot/scripts/index.ts` is EMPTY. With no script for a
puzzle the partner still runs: it greets (`hello.out` / `hello.in`), finds the human by
voice or "face N", stays on their wall, says `unknown` once per visit, obeys "wait" /
"go", says `solved` / `win`, and keeps off hot lava. It never presses or picks up anything.

The six puzzle ids and faces (`shared/src/puzzles/index.ts`): 1 `hidden-code`, 2
`equation-safe`, 3 `mirrored-glyph`, 4 `botanical-mirror`, 5 `sequence-laser`, 6
`laser-path`. Chain: 2 -> 5 -> 6 -> 4.

## The script plug-in interface (`shared/src/bot/scripts/types.ts`, verbatim)

```ts
export interface ScriptCtx<M> {
  /** What this side sees right now. */
  o: Observation;
  /** The script's own memory. Mutate it. Starts as init() and is reset whenever the bot enters the face. */
  mem: M;
  /** What the human said since the last decision, one entry per chat line, oldest first. */
  heard: readonly Heard[];
  /** All tokens of `heard`, flattened. */
  tokens: readonly Token[];
  /** Did the human say any of these kinds of word? */
  has(...kinds: Token['t'][]): boolean;
  /** Game time in ms. */
  now: number;
  /** The strike counter went up since the last decision. */
  struck: boolean;
  /** Objects of one type that this side sees on this face. */
  objs(type: string): Observation['objects'];
  say(key: string, opts?: { every?: number; force?: boolean; args?: LineArgs }): boolean;
}

export interface Play {
  /** Where to walk next (re-asked before every step), or null to stand still. */
  action: BotAction | null;
  /** The human depends on the body staying exactly here: nothing else may move it. */
  hold?: boolean;
  /** Tiles this action may enter although they are off limits (own hazards, deadly tiles on a told path). */
  allow?: (Cell | undefined)[];
  /** One line on what it is doing, for the logs and the model. */
  status: string;
}

export interface PuzzleScript<M = unknown> {
  id: string;                               // the puzzle module's id, e.g. "hidden-code"
  lines: readonly string[];                 // every line key it can say, each starting with "<id>."
  init(): M;                                // fresh memory, JSON-serializable
  hazards?(o: Observation): Cell[];         // tiles of this face no walk may enter while unsolved
  play(ctx: ScriptCtx<M>): Play | null;     // on the face, unsolved, human on the same wall
  errand?(ctx: ScriptCtx<M>): Play | null;  // work away from the face (carrying), asked on any face
}
```

`Cell` is `{ col: number; row: number }` in the bot's own screen coords (`scripts/grid.ts`,
which also has `same`, `around`, `walkable`, `route`, `flood`, `far`, `throughWall`,
`agreeTurn`, `dirOf`). `LineArgs` is `Record<string, string | number>` (`partner.ts`).

### What a script receives each turn

`decide` runs before every body step (every 200 ms). In order:

1. Won: says `win`, returns. Otherwise greets once; says `solved` on a new solve.
2. "wait" pauses 10 s (`wait.ok`); "go" / "yes" ends the pause.
3. `errand(ctx)` of every script whose puzzle is in the game and unsolved, on ANY face. The
   first non-null `Play` wins. Use it to carry the battery (2 -> 5) or the flower (6 -> 4).
4. Paused: stands still (`hold`).
5. Human not on this wall (`o.voiceSignal < 3`): walks towards them (`go_face`). No script
   is asked.
6. Same wall, `o.puzzleHere`: `play(ctx)` of the script whose `id === o.puzzleId`. `null`
   = nothing to do for this side: the core waits with the human.

`ctx.o` is the `Observation` (`shared/src/bot/observe.ts`): `you`, `face`, `faceName`,
`compassDrift`, `position {col,row}`, `grid` (12 strings; `.` `#` `T` `~` `@` `*`),
`objects [{type, state?, col, row}]` (exactly what the puzzle's `visible(side)` returns),
`items [{kind, col, row}]`, `carrying` (item kind or null), `edges`, `objective`,
`puzzleHere`, `puzzleId`, `puzzleList [{id, face}]`, `solvedFaces`, `strikes`,
`voiceSignal` (3 same wall, 1 next face, 0 opposite), `won`. A script never reads
`GameState`, the puzzle's state or the other side.

`mem` is reset to `init()` each time the bot enters the face; lines said by the script may
be said again on the next visit.

### What it may return

- `action`: any `BotAction` (below) or `null`. It is planned again before every step, so
  return the same action until what you SEE says it is done.
- `ctx.say(key, opts)`: `key` must be in the script's `lines`, else it is dropped. Default:
  once per visit to the face. `every: ms` = again after that long. `force` = now. Returns
  whether it was said. Lines go out one at a time, each given its speaking time before the
  next (see Pacing), through the room's chat rate limit.
- `ctx.cancel(...keys)`: a question the human has just answered. If it still waits to be
  said it is dropped (`Decision.cancel`), so a question never comes after its answer.
- Wait: `{ action: null, status }`, or `{ action: null, hold: true, status }` when the
  human needs the body to stay exactly there (a Gemini suggestion cannot move it).
- `null`: nothing to do here.

### Relay lines

A relay line carries what the bot sees. The words have `{placeholders}`:

```ts
// shared/src/bot/scripts/hiddenCode.ts
ctx.say('hidden-code.read', { args: { code: '4 7 2' } });
// server/src/ai/scripted.ts, in PUZZLE
'hidden-code.read': 'The number is {code}.',
```

`lineText(persona, key, args?)` fills them (`fillLine`). The same key with other args is
another line: it is said again when the value changes. The filled text must stay within 80
characters (`MAX_SAY_CHARS`; `room.say` cuts at `CHAT_MAX_LEN`). A relay line is said
exactly as written (never reworded by Gemini) and is never in the voice bank, so the
browser voice reads it (see Voice). `Say` is `{ key, args?, flavor? }`; only core small
talk is `flavor` (may be reworded).

### How chat from the human reaches a script

`AiPlayer.act` reads new `room.chat` lines from the human and runs `parseHuman`:

```ts
export interface Heard {
  text: string;     // the line as typed, trimmed
  tokens: Token[];  // sign | dir (+n) | face | yes | no | go | wait | again
  plain: boolean;   // every word was a protocol word, a number or a filler
}
```

- `plain` (protocol words, numbers, fillers): straight to the next `decide` as `heard`.
  "4 7 2" is plain: it arrives with no tokens and `text: '4 7 2'`.
- Anything else: to Gemini if it is free. Its answer's `heard` (protocol words) becomes the
  tokens; the script still gets the line as typed in `text`.
- Gemini busy, absent or failing: the line is passed on as it is. A line with no token
  that is not plain also gets the `huh` line (at most every 8 s), or, with a working
  Gemini, waits for the next free call (only the latest waits).

So every human line reaches `ctx.heard` with its raw `text`, with or without Gemini: a
script reads its own words (digits, colours) from `heard[i].text`. CAUTION: a word that is
not in `talk.ts` ("red") still triggers `huh` without Gemini even if a script understood
it; add such words to `talk.ts` (`Token`, `parseHuman`, `FILLER`, and the list in
`prompt.ts`) if that matters. Quick chat is 1 Here! (yes), 2 Wait, 3 Yes, 4 No.

### Registering a script

1. `shared/src/bot/scripts/<id>.ts`: export the `PuzzleScript`.
2. Add it to `PUZZLE_SCRIPTS` in `shared/src/bot/scripts/index.ts`.
3. Give every key of `lines` its words in `PUZZLE` in `server/src/ai/scripted.ts` (same
   words in both personas; `server/test/ai.test.ts` fails on a key with no words, a line
   over 80 characters or an em dash).
4. Add its `HumanScript` to `HUMAN_SCRIPTS` in `shared/test/partnerSim.ts`.
5. If Gemini should know the rule, add a line to `PUZZLE_RULES` in `server/src/ai/prompt.ts`
   (between the `PUZZLES V2 PLACEHOLDER` markers).

### Pacing (`server/src/ai/aiPlayer.ts`)

One caption shows at a time and a new line replaces it, so the next line is not sent before
the last one has had `lineHoldMs(text) = max(LINE_GAP_MS 1500, text.length * LINE_MS_PER_CHAR
65)` ms: a relay answer is never followed by another line sooner than that. The queue never
stalls: over 6 waiting lines (`OUTBOX_MAX`) the oldest small talk gives way, and small talk
(core lines, event lines, Gemini's lines) that has waited more than `STALE_MS` (10 s) is
skipped. A puzzle script's line (a relay answer, a question the script waits on) is never
dropped. Every AI chat message said as written carries its line key (`ChatMessage.key`,
e.g. `laser-path.in.tile`, `huh`, `event.strike`): tools match on the key, never on the
words (`tools/screens/solo-game.ts`).

Said less: `next` once per solve (not on every solved face it crosses), `follow.where` only
after `LOST_MS` (8 s) of hearing the human faintly with more than one face to try,
`mirrored-glyph.in.next` not after an empty row unless the human waits
`EMPTY_ROW_WAIT_MS` (5 s).

## The body

### Actions (`shared/src/bot/actions.ts`)

```ts
export type BotAction =
  | { type: 'goto'; col: number; row: number }
  | { type: 'go_face'; face: number }
  | { type: 'step_on'; object: string }          // nearest visible object type or item kind
  | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; steps?: number }
  | { type: 'pick_up' }                          // the item on this tile
  | { type: 'drop' }                             // on a target it gets placed
  | { type: 'place'; col: number; row: number }  // into a solid target (a pot): walk next to it, face it, E
  | { type: 'use'; col?: number; row?: number; object?: string; state?: string }
  | { type: 'wait' };

export function planAction(
  state: GameState, side: Side, action: BotAction, env: GameEnv = defaultEnv,
  leash?: (face: FaceId) => boolean,
  avoidTiles: readonly { col: number; row: number }[] = [],  // current face, screen coords
  avoidPose?: (pose: Pose) => boolean,                       // any face
): { steps: BotStep[] } | { error: string };                 // BotStep = Move | 'interact'
```

### The `use` action

Presses E with empty hands: the engine's "use" branch of `applyInteract`, which calls the
puzzle's `onUse` (keypad keys, flip tiles, symbol buttons, REPLAY, RESET, the lava button).

- Target: `col` + `row` (a tile), or `object` (+ `state`): the nearest visible object of
  that type on the bot's face, e.g. `{ type: 'use', object: 'key', state: '7' }`, `{ type:
  'use', object: 'key', state: 'enter' }`. Neither: where it stands.
- Plan: the walk to the target, then one `'interact'`.
- Refused (`error`): carrying something (E would drop it), a loose item on the target tile
  (E would pick it up), no such object in sight, no way there.
- ONE press per plan. `nextStep` takes one step of a fresh plan each time, so once the body
  stands on the target the same action presses again every 200 ms. Decide from the
  observation whether a press is still needed (count the filled `display` cells, read the
  tile's `state`) and return another action or `null` once it is not.
- `parseAction` accepts it from a model, but `ADVICE_TYPES` in `aiPlayer.ts` does not:
  Gemini may not press anything.

### The avoid predicate (`shared/src/bot/path.ts`)

```ts
export function findPath(state, side, goal: (pose: Pose) => boolean, env = defaultEnv,
  allow?: (face: FaceId) => boolean,     // faces the path may enter (leash)
  avoid?: (pose: Pose) => boolean,       // poses the path may never enter, goal included
): Move[] | null;

export const HAZARD_OBJECTS = [{ type: 'f6-lava', state: 'hot' }];
export const HAZARD_ISLANDS = ['button'];   // as deadly as the hazard around it
export function hazardTiles(state, side, face, env = defaultEnv): TileRef[];
export function hazardAvoid(state, side, env = defaultEnv, except: readonly TileRef[] = []): (pose: Pose) => boolean;
```

`hazardTiles` is built from what that side's own `visibleObjects` shows: on face 6 inside,
from the start of the game until face 6 is solved, every lava tile is `hot`: all 100 inner
tiles, the button included. Cold lava is plain floor. Nothing in `shared/src/game.ts` changed.

`nextStep(state, side, decision, env?)` always plans with `hazardAvoid`, on every face, so
`go_face` routes around the inside of face 6 and a `goto` / `use` into the lava returns
null (the body stands still). Exceptions:

- `Play.allow`: cells of the current face the walk may enter anyway. A face 6 script lists
  the path tiles the human read out; the body then walks only those lava tiles.
- If the body already stands on a deadly tile, the predicate is dropped for that step.
- `Decision.soft`: on a face with no script the core avoids every visible object and item.
  That is caution only: if it leaves no walk, the step is planned again without it. Deadly
  tiles never give way.

Gemini's suggested moves are checked against the same predicate (`AiPlayer.take`,
`adviceStep`).

## The simulation harness (`shared/test/partnerSim.ts`)

```ts
export interface HumanScript<M = unknown> {
  id: string;                         // the puzzle module's id
  init(): M;
  play(ctx: HumanCtx<M>): void;       // once per tick: on the face, unsolved, AI on the same wall
  errand?(ctx: HumanCtx<M>): boolean; // any face, first; true = it acted this tick
}
export interface HumanCtx<M> {
  side: Side; o: Observation; mem: M;
  inbox: readonly HeardLine[];        // AI lines not yet acted on: { key, args? }
  next(): HeardLine | undefined;      // take the oldest
  seen(type: string): VisibleObject[];          // canonical tiles, own side only
  at(t: { x; y }): boolean;
  walk(to: { x; y; face? }): boolean; // one careful step; true = already there
  move(dx, dy): void;                 // one raw step (a mistake)
  interact(): void;                   // E
  say(text: string): void;            // type a chat line
  errand(to: TileRef, then?: () => void): void; // walk there over the next ticks, then run
}
export const HUMAN_SCRIPTS: HumanScript<any>[] = [];   // the registry, empty

export function play(aiSide: Side, opts: PlayOptions = {}, env = defaultEnv): Played;
// PlayOptions: scripts? (default PUZZLE_SCRIPTS), humans? (default HUMAN_SCRIPTS), order?,
//   announce?, maxMs? (default 30 min of game time), until?(state), state?, startAt?
// Played: { state, mind, lines: LineKey[], human: SimHuman (human.said: string[]), ms,
//   trodden: Set<"face:x,y">, decisions: Decision[] }
```

`play()` is the pure loop, no server. Each 200 ms step: `decide` for the AI, one
`nextStep`, the AI's lines go to `human.hear(key, args)`, then `human.tick()`, then the
engine `tick`. What the human `say`s is parsed with `parseHuman` and reaches the next
`decide`. The human core walks to the next unsolved face of `order` that it has a
`HumanScript` for, waits there for the AI (`voiceSignal 3`), then calls `play`. A mocked
human is just a `HumanScript` (or none: the AI then plays alone). To start mid-game, pass
`state` (e.g. after `devSolve(state, 5)`).

Example with a test-only script, a relay line, the raw chat line and `use`: the last test
of `shared/test/partner.test.ts`. The same `SimHuman` drives the real `AiPlayer` on a
`Room` in `server/test/ai.test.ts` (`humanOn(room, side, lines)`); its three whole-game
tests are skipped until every puzzle has a `PuzzleScript` and a `HumanScript`.

## Gemini (`server/src/ai/gemini.ts`, `prompt.ts`, `aiPlayer.ts`)

Called from exactly one place: `AiPlayer.ask` -> `Brain.think(turn, signal)` ->
`ai.models.generateContent` in `geminiBrain`. An `AiPlayer` only exists in an AI room.

- Created in `server/src/index.ts`: `advisor = !AI_FAKE && GEMINI_API_KEY ? geminiBrain(key,
  model, persona) : null`. `null` = the script plays alone and nothing is ever called.
- Triggers (`AiPlayer.act`), each only if `free(now)` (an advisor, no call in flight, past
  `nextThinkAt`):
  1. a `flavor` line of the core (`hello.*`, `solved`, `win`): reworded;
  2. a human chat line that is not plain protocol words: answered and turned into `heard`.
     If not free and the line has no token, the latest such line waits in `pending`.
- Sent: `systemPrompt(persona)` (rules + persona) and `turnPrompt`: `{ youAre,
  observation (without puzzleId / puzzleList), planner (Decision.status), scriptLine,
  partnerSaid, chat (last 12 lines) }`. Reply JSON `{ say, heard, action }`
  (`REPLY_SCHEMA`). `action` is limited to `goto`, `step_on`, `move`, `wait` on the
  current face, and only walked while the script is idle and not holding.
- Limits: one call per 6 s per room (`MIN_THINK_MS`), no backlog; 3 s deadline
  (`TIMEOUT_MS`); on error / timeout / 429 back off 6 s doubling to 60 s; `maxOutputTokens`
  1024, `thinkingBudget` 0, temperature 0.8. There is NO cap per game, per room lifetime or
  across rooms, and no daily budget: a chatty human costs up to 10 calls a minute for as
  long as the room lives. Token counts are logged per call and on stop.
- While the human is disconnected (seat held 60 s, `LIMITS.seatHoldMs`) `act` returns
  early: no decisions, no calls.

## Voice (`server/src/ai/tts.ts`, wired in `server/src/index.ts` `onSay`)

For each line the AI says: `tts.speak(msg.text, room.code, { cacheOnly: scripted ||
ttsMode === 'browser' })`. A clip goes out as socket event `tts` `{ chatId, mime, data }`;
no clip = event `speak` `{ chatId, text }` and the client's `speechSynthesis` reads it.
Every line is also a caption (`client/src/ui/captions.ts`).

`speak` resolves in this order:

1. Bank: `server/tts/bank/<bankFileName(text)>`, where `bankFileName = sha256(normalizeLine(
   text)).hex.slice(0, 24) + '.mp3'` and `normalizeLine` lowercases, strips punctuation and
   collapses spaces. So a line maps to a clip by its normalized TEXT only, not by key,
   voice or model.
2. Disk cache: `server/.tts-cache/<sha256(voiceId \n modelId \n text)>.mp3` (not committed).
3. ElevenLabs (`POST /v1/text-to-speech/{voice}`), only when not `cacheOnly`, with a key,
   and under `TTS_SESSION_LINES` generated lines for that room (default 15).
4. `null`: browser voice.

So scripted lines (core, puzzle and relay) never reach ElevenLabs; only Gemini's own lines
can, and only with `TTS_MODE=elevenlabs` and a key.

The bank: `bankLines()` = `bankedScriptLines()` (the CORE lines, both personas) + the
generic lines in `server/tts/bank-lines.txt`. Puzzle lines are not banked. `npm run
tts:bank -w server` (`server/scripts/ttsBank.ts`, calls ElevenLabs: do not run it without
being asked) adds missing clips and rewrites `server/tts/bank/index.json`:

```json
{ "voiceId": "...", "modelId": "eleven_flash_v2_5",
  "lines": [ { "file": "5789cac39d2333dfcf5a0c9a.mp3", "chars": 77, "text": "Hi! I am outside the cube. ..." } ] }
```

The index is a record only; the server looks clips up by file name. Clips are never
deleted: the four portal clips are still there and in the index, used by no line
(`server/test/tts.test.ts` allows a clip without a line only if the index lists it).

## Env vars (`server/.env.example`; keys never reach the client)

| Var | Default | Effect |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | with it, Gemini advises; without it, script only |
| `GEMINI_MODEL` | `gemini-3.5-flash` | model id |
| `AI_FAKE` | unset | `1` = never create the advisor, even with a key |
| `AI_PERSONA` | `default` | `default` or `tsundere`: tone only |
| `TTS_MODE` | `browser`, or `elevenlabs` when `NODE_ENV=production` | falls back to `browser` without a key |
| `TTS_SESSION_LINES` | 15 | ElevenLabs lines one room may buy |
| `ELEVENLABS_API_KEY` | none | |
| `ELEVENLABS_VOICE_ID` | `r1KmysJdVYZjJCm4mL3b` | the one voice, banked and live |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | live lines (older name: `ELEVENLABS_MODEL_ID`) |
| `ELEVENLABS_BANK_MODEL` | `eleven_v4` | banked clips |

Client: `ENABLE_AI` in `client/src/config.ts` (a constant, not an env var) shows or hides
PLAY WITH AI. Tests and local runs: `AI_FAKE=1 TTS_MODE=browser`.

## The solo flow today

Mode screen (`client/src/scenes/ModeScene.ts`) -> PLAY WITH AI opens `AiPopup.ts` (pick
outside or inside) -> `actions.onPlayWithAI(side)` -> `net.playWithAI(side)`
(`client/src/net/client.ts`) emits `room:createAI { side }` -> `server/src/app.ts` creates
`rooms.create('ai')` (phase `playing` at once, no lobby), seats the human, calls
`onAiRoom(room, humanSide)` -> `server/src/index.ts` constructs `new AiPlayer(room,
otherSide, advisor, { persona, onSay })`, which takes the other seat (`room.sit(side,
true)`, `isAI`) and starts its 200 ms timer. The AI stops when the room closes (60 s after
the human leaves). A two-player room never creates an `AiPlayer`, so it never calls Gemini
or ElevenLabs.

<!-- ---- faces 1-3 (scripts-a) ---- -->
## Scripts for faces 1 to 3

`shared/src/bot/scripts/hiddenCode.ts`, `equationSafe.ts`, `mirroredGlyph.ts`; their
simulated humans are in `shared/test/humans/` (the `HumanScript` type lives in the test
harness, so they cannot sit beside the script in `src`). Each plays either side.

- **Relay lines.** Each script has one key `<id>.relay` whose words are `{words}`.
  `relay(ctx, key, pieces)` (`scripts/relayKit.ts`) fills it with `relayText(pieces)`: the
  pieces are vocabulary only (`vocab.ts`) and joined with spaces, so the caption is e.g.
  `the code is four seven two`. To chain banked clips, split `args.words` back into pieces
  by matching the vocabulary greedily (the phrases have spaces in them).
- **The doing side** says nothing and presses nothing until the human speaks. After 15 s
  with nothing it can use (`ASK_MS`) it asks, then every 20 s (`REASK_MS`). It says back
  what it understood before typing (`press four seven two`). After a strike it forgets
  what it was told and asks again.
- **hidden-code.** Relay: `the code is <d> <d> <d>`. Heard: `4 7 2`, `472`, `four seven
  two`, or one digit per line (`digitsIn`).
- **equation-safe.** Relay: `<n> bushes <n> birds <n> rocks`. Heard: counts beside their
  kind in any order, or bare numbers (three = bushes, birds, rocks; one = the kind it asked
  for last) (`countsIn`). The product is read off the row on the inside wall.
- **mirrored-glyph.** The row convention, both directions: `row <n> skip <a> flip <b> skip
  <c> ...`. Rows one to twelve from the top; inside a row the count runs over the canonical
  tiles from x = 0: the outside player's LEFT and the inside player's RIGHT, compass
  upright. A row that starts on a symbol tile starts with `flip`; what is left after the
  last piece is off; an empty row is `row <n> skip`. Relay side: one row per line, on with
  "next" / "ok", "again" repeats, "row 5" jumps. Doing side: makes each told row look
  exactly like that, asks for the next, presses CLEAR only on "clear" / "reset".
- **The battery.** An errand is only asked of a script whose puzzle is unsolved, so the
  carry from face 2 to face 5 cannot be the equation-safe script's own. `carryBattery(o)`
  (`equationSafe.ts`, built on `carryTo(o, job)` in `scripts/carry.ts`) is the whole errand:
  the sequence-laser script returns it from `errand()`.
- `canonOf(o, cell)` / `cellOf(o, tile)` (`relayKit.ts`) turn the bot's screen tiles into
  canonical tiles and back from `o.you` and `o.compassDrift`.
- `talk.ts`: bare numbers of up to four digits and the words these scripts read are plain,
  so they never earn a `huh`.
<!-- ---- end faces 1-3 ---- -->

<!-- BUDGET SECTION: START (ai/budget). Where this section and the text above disagree, this section is right. -->

## Budget, safety and logging (`server/src/ai/budget.ts`, `wire.ts`, `relay.ts`, `bank.ts`)

Both APIs are on small plans shared by every solo room. `createAiPartner(env)` in
`server/src/ai/wire.ts` builds the one advisor, the one voice and the one `Budget`;
`server/src/index.ts` only calls `ai.join(room, humanSide, send)` from `onAiRoom`. A
two-player room never reaches any of it (`server/test/soloOnly.test.ts` plays one over
sockets with both API clients replaced by throwing spies).

### Gemini

- ONE model (`GEMINI_MODEL`, default `gemini-3.5-flash`), never switched, never retried.
  Thinking at the minimum (`thinkingLevel: MINIMAL`; `thinkingBudget: 0` for a `gemini-2*`
  id), `maxOutputTokens` 512 so text comes back after the thought tokens. An empty reply or
  `finishReason: MAX_TOKENS` logs `[gemini] warning ...`.
- Called ONLY on four events (`AiPlayer`), never on a timer and never per move:
  `chat` (a human line that is not plain protocol words), `solved` (rewords `solved` /
  `win`), `strike` (the strike counter went up and no puzzle script spoke on it: a script's own
  strike line replaces the generic one), `stuck` (no solve, no strike and no human
  chat line for 60 s while the human is connected and the game is not won; once per quiet
  period, and the time the human is disconnected does not count). The greeting is scripted.
- Refused = the scripted line, at once. No queue (the old "pending" message is gone), no retry.
  Fallback lines for `strike` / `stuck` are `eventLine()` in `scripted.ts` (banked).
- Caps: 8 calls a minute and `GEMINI_DAILY_CAP` a day over all rooms, 25 per game (a restart
  in the same room is a new game), one at a time and one per 6 s per room. A 429 stops every
  room's calls for 10 minutes.
- The prompt is a summary (`turnPrompt`): side, event, face, face name, objective, solved
  faces, strikes, where the partner is, what the body is doing, the script's line or what the
  human said, the last 3 chat lines. No grid, no objects. System + turn + schema stay under
  800 tokens at chars / 3 (`server/test/budget.test.ts`). The reply is `{ say, heard }`: one or
  two sentences within 80 characters.
- Gemini never moves the body and never presses anything: the reply has no `action`, the
  suggested-move code (`ADVICE_TYPES`, `adviceStep`) is gone, and an `action` sent anyway is
  not read. `heard` still becomes protocol tokens for the scripts.

### Voice

- Relay lines: a script says `relay(ctx, '<id>.relay', pieces)` (`relayKit.ts`; words
  `'{words}'`, `args.words = relayText(pieces)`). The server takes the said text apart again
  (`relayPieces`, greedy longest match against `VOCAB`) and sends socket event `tts:chain`
  `{ chatId, mime, pieces, clips, gapMs }` (`TtsChain` in `shared/src/types.ts`): one banked
  clip per piece. The client (`Voice.playChain`) plays them in order through the voice gain,
  90 ms apart; the caption is `relayText(pieces)`. If any piece has no clip the whole line
  goes out as `speak` (browser voice). A relay line never reaches ElevenLabs or Gemini.
- Live ElevenLabs only for Gemini's own lines, only with `TTS_MODE=elevenlabs`: 20 per game
  and `ELEVENLABS_DAILY_CHARS` a day over all rooms; over a cap = browser voice. Every bought
  clip is cached on disk by voice + model + text, so no text is bought twice.
  `TTS_SESSION_LINES` is gone.
- Bank clips bought from now on are named `sha256(voice \n model \n exact text)[:24].mp3`.
  The clips already committed (named by normalized text) keep resolving and are never
  bought again.
- `npm run tts:bank -w server` is a DRY RUN: it lists every missing clip and the exact
  characters, makes no network call, writes nothing, exits 0. `-- --buy` buys them and
  refuses (exit 1) over 4000 characters in one run. The list is read at run time:
  `fixedLines()` (core, event and puzzle lines without a placeholder) + `bank-lines.txt` +
  `VOCAB`.

### Counters and logs

Daily counters live in `server/.data/usage.json` (gitignored), reset at UTC midnight, and
fall back to memory on a disk that cannot be written. Render's free plan wipes the disk on
every restart and spin-down, so there the daily caps hold per process, not per day.

```
[gemini] room=ABCD reason=chat in=312 out=41 day=17/200 min=3/8 game=4/25
[gemini] room=ABCD reason=stuck in=0 out=0 day=18/200 min=4/8 game=5/25 error=timeout
[gemini] 429 room=ABCD: no Gemini calls for 10 minutes, on the whole server
[gemini] fallback room=ABCD reason=chat why=day_cap more=12
[eleven] room=ABCD chars=64 day=380/20000 game=2/20
[eleven] fallback room=ABCD chars=64 why=game_cap
[usage] day=2026-10-04 gemini_calls=17/200 tokens_in=5300 tokens_out=700 eleven_calls=6 eleven_chars=380/20000
```

`why` is `disabled` | `paused_429` | `minute_cap` | `day_cap` | `game_cap`; the same reason is
logged at most once a minute (`more=` counts the ones in between). `[usage]` is
`budget.summaryLine()`: logged at start, every hour if something changed, and on SIGTERM /
SIGINT. There is no HTTP endpoint for it.

### Env vars added (all optional)

| Var | Default | Effect |
| --- | --- | --- |
| `GEMINI_ENABLED` | on | `false` = every line scripted, zero Gemini calls |
| `GEMINI_DAILY_CAP` | 200 | Gemini calls per UTC day, all solo rooms |
| `ELEVENLABS_ENABLED` | on | `false` = banked clips + browser voice, zero ElevenLabs calls |
| `ELEVENLABS_DAILY_CHARS` | 20000 | characters per UTC day, all solo rooms |
| `ELEVENLABS_BANK_MODEL` | `eleven_v4` | model of the banked clips |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | model of the live lines (was `ELEVENLABS_MODEL_ID`, still read) |

Removed: `TTS_SESSION_LINES`.

### One voice, two models (later than the text above; where they disagree this is right)

- Voice: `ELEVENLABS_VOICE_ID`, default `r1KmysJdVYZjJCm4mL3b` (`DEFAULT_VOICE_ID`), for every
  banked clip and every live line.
- Banked clips are made with `ELEVENLABS_BANK_MODEL` (default `eleven_v4`); live lines
  (Gemini's own) with `ELEVENLABS_MODEL` (default `eleven_flash_v2_5`; the older name
  `ELEVENLABS_MODEL_ID` is still read).
- A banked clip resolves ONLY as `sha256(voice \n bank model \n exact text)[:24].mp3`. The
  82 clips of the first voice (named by normalized text) no longer resolve; until the new
  bank is bought every scripted line is read by the browser voice.
- The bank list is `fixedLines(persona)` of the ACTIVE persona (`AI_PERSONA`, default
  `default`) + `VOCAB`. The other persona and `server/tts/bank-lines.txt` are not bought.
  The list by key: `docs/status/puzzles/ai-lines.md`.
- The dry run prints the characters of every missing clip and the total for the bank model.
  `-- --buy` with `ffmpeg` on PATH then cuts the silence off both ends of each bought clip
  (`trimCommand` in `bank.ts`); without ffmpeg the step is skipped.
- Live caps: 20 lines per game (`ELEVEN_PER_GAME`) and `ELEVENLABS_DAILY_CHARS` (default
  20000) a day. The Gemini caps are unchanged.
- Gemini's turn also carries `partnerSays`: what the script expects the human to say on
  this puzzle (`humanSays(puzzleId, side)` in `scripted.ts`, at most 100 characters).

### Voice picker (later than "One voice" above; where they disagree this is right)

- Settings > SOUND > "Partner voice": Jessica (default) or Wizard, with a Play button (one
  banked greeting). The list is `AI_VOICES` in `shared/src/aiVoices.ts` (key, label, id).
- The client sends the KEY: `ai:voice { voice }` on every connect and on every change;
  `ai:preview { voice }` for the Play button. `app.ts` checks it with `parseAiVoice` (an id
  or anything else is ignored), keeps it per socket and hands it to a solo room
  (`onAiVoice` -> `AiPartner.setVoice`). `wire.ts` reads the room's voice when a line is
  said, so a change counts from the next line. A two-player room never hears of it.
- One bank folder per voice: `server/tts/bank` (Jessica, unchanged) and
  `server/tts/bank-<key>` (`bankDirFor`). A voice's clips are read from disk when first
  asked for (`Tts.loaded(voice)`); a missing clip or folder falls through: cache, live
  (Gemini's lines, the same caps), browser voice.
- `ELEVENLABS_VOICE_ID` is the id behind the default voice only.
- Build: `npm run tts:bank -w server -- --voice wizard` (dry run: clips, characters,
  estimated credits), then the same with `--buy`. Details: `server/tts/README.md`.

<!-- BUDGET SECTION: END -->
<!-- ---- faces 4-6 (scripts-b) ---- -->
## Scripts for faces 4 to 6

`shared/src/bot/scripts/botanicalMirror.ts`, `sequenceLaser.ts`, `laserPath.ts` (helpers
in `kit456.ts`); their simulated humans are in `shared/test/humans/`. Each plays either
side. Relay lines use the key `<id>.relay` with the words `'{words}'`, vocabulary pieces
only. The observation has no partner position, so nothing here needs one: the two screens
are tied together by things both players can name (the faces next door, the lava).

- **sequence-laser (5).** Inside: `errand` is `carryBattery` (face 2 inside to the
  emitter). Then it presses only what the human names (`sun moon star`, one or several per
  line; a lit button is skipped, so the whole order may be repeated). 15 s of silence:
  `in.first` / `in.next`. A strike: it drops what it was told and says `in.strike`.
  Outside: presses REPLAY, watches which symbol is lit on each look, then says
  `the order is A then B then C` and `next D then E then F then G`. "again" or a strike
  says both parts again.
- **laser-path (6).** Outside: solves the mirrors from its own view (`mirrorPush`: "/" into
  the source's column, "\" up to the row of "/"; RESET if stuck). The burn locks the
  mirrors and the beam is the safe path: `beamRoute` reads it off what the bot sees (burnt
  crate on the edge, "\", "/", source), backwards from the crate's ring tile to the source,
  where the button is. It picks up the flower from the crate's tile, then guides.
  Directions are always ON THE WALKER'S OWN SCREEN:
  1. `out.side.N`: the side of the ring the path starts on, named by the face beyond it.
  2. `out.lava`: the walker says which way the lava is from there (`right`). The guide sees
     that same step on its own screen: that fixes the turn between the two screens.
  3. `out.tile` + `row six` (or `column six`): the start tile, counted on the walker's
     screen from their top / their left. The walker says `yes`.
  4. `step right two then up one`: at most two runs per line, `yes` after each, `again`
     repeats; the last line ends `then press`.
  5. A strike (a fall): `out.fell`, the lava question again, and the path from its start.
  Inside: the same convention the other way round. It stays on the ring (the lava is hot
  from the start of the game), asks `in.side`
  every 15 s, walks round the ring to the side of `face N`, says `in.lava.<dir>`, takes its
  tile from `row 6` / `column 6`, then walks the steps it hears (`right 2 then up 1`), one
  tile at a time, each lava tile through `Play.allow`. `in.done` after each line, `in.ask`
  after 15 s of silence, `in.fell` after a fall. It presses E when it stands on the button.
- **botanical-mirror (4).** A pot is `the pot is row R column C`, one to twelve: rows
  counted from the edge beside face 5, columns from the edge beside face 3 (the same two
  edges for both players, whatever their turn; it is the canonical tile, row = y + 1,
  column = x + 1). Outside: `errand` carries the flower from face 6 and waits by the pots;
  it says `the flower is pink`, asks `out.ask` (again every 15 s) and plants where the
  human says; a strike: `out.strike`. Inside: the flower's colour is not in its
  observation, so it asks (`in.ask`) and the human says it; then it names the pot.

The simulated human plays the chain in the order 1, 2, 3, 5, 6, 4 (`order` in
`HumanOptions`; `CHAIN_ORDER` in `server/test/ai.test.ts`): the default list order would
send it to face 4 before the flower exists.
<!-- ---- end faces 4-6 ---- -->
