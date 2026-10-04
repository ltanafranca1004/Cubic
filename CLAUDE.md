# Cubic

## Hackathon rules (override global settings)

- No CodeRabbit. Never wait for, read or act on CodeRabbit reviews, and never
  add CodeRabbit config.
- Merging: the orchestrator may merge PRs with merge commits once tests,
  typecheck, lint and build pass, unless the prompt says to leave a PR open.

2-player online co-op browser game for StormHacks 2026 (24h). One player walks the
OUTSIDE of a cube, the other is trapped INSIDE it. Each sees only their own side of the
same six walls, and they solve puzzles by talking through the wall (proximity voice + chat).
If there is no second player, a Gemini-powered AI plays the other side.

## Prize tracks (keep these in mind for every decision)

- **Huawei "Beyond Euclid" is a target.** The cube's non-Euclidean geometry must stay a
  core mechanic, never be flattened away or hidden:
  - 270-degree corners: three faces meet at a corner, so three left turns bring you home.
  - Walking a loop around a corner returns you rotated 90 degrees.
  - Compass drift: how far your "up" has turned from the face's own up. The cube in the
    HUD turns with it.
  - The inside is mirrored: the inside player sees every wall from behind.
- Also entering: Best Game, Best Design, MLH Best Use of Gemini, MLH Best Use of ElevenLabs.

## Architecture

npm workspaces monorepo, TypeScript everywhere, no build step for shared code (`tsx` on the
server and Vite on the client both consume `/shared` as TS source).

```
/shared   pure TS, no DOM, no networking. ALL game logic.
  src/types.ts        Vec, Side, FaceId, Pose, Player, Item, GameState, GameEvent, socket messages
  src/cube.ts         cube math: normals, view right, screen<->canonical, stepPose, compassDrift
  src/game.ts         createGame, applyMove, applyInteract, tick -> GameEvent[]
  src/maps/           map format + loaders (string maps, Tiled .tmj)
  src/puzzles/        PuzzleModule interface + one file per puzzle, lib/ (shared building
                      blocks), chain.ts (the items the chain hands from face to face)
  src/voice.ts        voiceMix(state): how loud the partner is, from cube distance
  src/bot/            the AI partner: observe(), pathTo(), decide(), scripts/ (one per puzzle)
/server   Node + Socket.io (tsx). Rooms, validation, chat, voice signaling, AI partner.
/client   Phaser 4 + Vite.
  src/game/           the playable scene, rendering, input, sound (core)
  src/net/            socket client, prediction
  src/voice/          WebRTC + Web Audio
  src/lobby/          placeholder UI (core)
  src/ui/             the real UI, behind the hook interface in ui/hooks.ts
  src/scenes/         the menu stage, the ending (scenes/ending), extra polish scenes
  public/assets/      real art + manifest.json
/maps     Tiled .tmj maps + template + legend
```

Commands (from the repo root): `npm install`, `npm run dev` (server :3001 + client :5173),
`npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (client), `npm run maps`
(bundle `/maps/*.tmj`).

## Pinned versions

Node >= 22.12, TypeScript ~6.0 (typescript-eslint does not support TS 7 yet), Phaser ^4.2.1,
Vite ^8.3, Socket.io ^4.8, tsx ^4.23, ESLint ^10. Model IDs: Gemini `gemini-3.5-flash`,
ElevenLabs `eleven_flash_v2_5` (both overridable by env). Do not bump majors during the hackathon.
**Phaser 4, not Phaser 3:** check the Phaser 4 docs / `node_modules/phaser/types` before
using an API from memory.

## Rules

1. **All game logic lives in `/shared`.** If it decides what happens, it goes there.
2. **Client renders, server validates.** The server owns `GameState` and runs every move
   through `/shared`. The client predicts its own move with the same code, then accepts
   the server state.
3. **Only edit your own folder** (owners below). Need a change elsewhere? Ask the owner.
4. **API keys live in env only** (`server/.env`, Render, Vercel). Never in code, never
   committed, never sent to the client. Never print `.env` values.
5. Puzzle modules never touch networking, the DOM, timers, `Math.random` or `Date.now`.
6. Never commit `cube.html` (the design prototype; it is in `.gitignore`). It is a
   reference for cube math, mirroring, movement feel and look only. Do not copy its code,
   puzzles or face layouts.
7. `npm run typecheck`, `npm run lint` and `npm test` are clean before every commit.

## Owners

| Folder | Owner |
| --- | --- |
| `/server`, `/shared` core (types, cube, game, maps loader, voice, bot), AI, `/client/src/game`, `/client/src/net`, `/client/src/voice`, `/client/src/lobby` | Luis |
| `/shared/src/puzzles` | friend 1 |
| `/client/src/ui`, `/client/src/scenes` | friend 2 |
| `/maps`, `/client/public/assets`, `shared/src/maps/default.ts` | friend 3 |

Every owned folder has a README that says exactly what goes there.

## Interfaces teammates build against

- **Types:** `shared/src/types.ts`. Changing them affects everyone: ask Luis.
- **Puzzles:** `PuzzleModule` in `shared/src/puzzles/types.ts`: `init`, `isBlocked(side,
  tile)`, `onEnter` / `onLeave` (tile), `onUse`, `onPush`, `onItem`, `onTick`, `isSolved`,
  `visible(side)` (per-side visibility), `objective(side)`, `lines(side)`, `bright`,
  `onStart` (lay out items when the game is created), plus `ctx.emit` for custom events. See "Puzzles" below. Example: `hiddenCode.ts`. Template:
  `_template.ts`. Registered in `puzzles/index.ts`.
- **UI:** `UIHost` / `UIState` / `UIActions` in `client/src/ui/hooks.ts`
  (`onCreateRoom`, `onJoinRoom(code)`, `onPlayWithAI(side)`, ...). Mock data in
  `client/src/ui/mock.ts`, shown with `?mock=lobby`, `?mock=hud` or `?mock=game`.
- **Assets:** `client/public/assets/manifest.json` (schema in that folder's README).

## Cube and coordinates

- Faces by normal: 1 = +z, 2 = +x, 3 = -z, 4 = -x, 5 = +y (top), 6 = -y (bottom).
  Canonical up: faces 1-4 = +y, face 5 = -z, face 6 = +z.
- A `Pose` is `{ side, face, up, x, y, dir }`. `x, y` are canonical tile coords (0-11, x
  right, y down as drawn in the map). Both sides share them: inside `(x, y)` is directly
  behind outside `(x, y)`.
- Screen right = `cross(up, normal)` outside, `cross(up, -normal)` inside (mirrored).
- Walking off the top of the screen: new `up = -oldNormal`. Off the bottom: `+oldNormal`.
  Sideways: `up` unchanged.
- Puzzles compare tiles, never screen directions.

## Face transitions and sound by face (client only)

- Walking over an edge plays a transition in `client/src/game/GameScene.ts` (pure math and
  the input buffer in `client/src/game/transition.ts`): outside the cube rolls over the
  edge (500 ms), inside the character hops the wall while the view slides (400 ms), and
  the "Reduce motion" setting swaps both for a quick fade. Drawn with whole pixels on a 2D
  canvas texture, so it is the same in WebGL and Canvas. The server state is untouched.
- Keys pressed during a transition are buffered and applied after it, paced to stay under
  the server's move budget (`LIMITS` in `server/src/rooms.ts`).
- Pace: `WALK_PACE` in `shared/src/pace.ts` is the one knob for walking speed (0.75 = 25%
  slower than the original 130 ms step). `STEP_MS` (the held-direction repeat for keyboard,
  gamepad and touch d-pad: `HoldRepeat` in `client/src/game/keys.ts`), `WALK_HOLD_MS` (the
  walk frame) and `AI_STEP_MS` derive from it. A tap always steps at once. Keep `STEP_MS`
  over the server's refill (`LIMITS.moveRefillMs`): `server/test/pace.test.ts` checks it.
- `client/src/audio/hearing.ts` decides who hears what: the partner's footsteps only when
  they are on the same face number as you, and never the partner's face-change ding.
- Check and GIFs: `tools/screens/transitions.ts` (output in `docs/screens/transitions/`).

## Fit and touch (any screen, any browser)

Nothing here looks at a device name or the user agent: only the visible size, the pixel
density and the pointer.

- **One size.** `client/src/style/scale.ts` `visibleSize()` is `visualViewport` (falling
  back to the layout viewport, then the window); `viewport()` takes the safe area off it.
  Every scale, the CSS (`--vw` / `--vh` on `.cu`, never `100vw` / `100vh`) and the rotate
  card come from it.
- **One re-fit.** `onFit(fn)` in the same file is the only resize subscription: it hears
  resize, rotation, `visualViewport`, fold/unfold, toolbars and pointer changes, and runs
  one pass when a number really changed. Do not add `window.addEventListener('resize')`.
- **Canvas size.** Both Phaser canvases run `Scale.NONE`; `style/canvas.ts` `sizeCanvas`
  sets backing size, zoom and the CSS size together. Do not call `scale.setZoom` /
  `scale.resize` directly (Phaser leaves a stale CSS size: the iPad bug).
- `device()`: touch = the main pointer is a finger (`pointer: coarse`), or `?touch`
  (`?touch=0` forces a mouse). Re-read on every fit.
- On touch the pixel grid is the DEVICE pixel (`style/fit.ts`, pure and tested): every
  scale is a whole number of device pixels per art pixel, e.g. x5 device pixels = 1.667 CSS
  on an iPhone 14, so the view fills the height. A desktop keeps whole CSS pixels.
- Layouts (`fit.ts` `layoutMode`, by what FITS): the full layout whenever the view and the
  HUD column fit (`desktop` with a mouse, `wide` on touch: the same with the controls in a
  strip under it), else `compact` (view in the middle, the HUD column folded into a panel
  behind the HUD button; on touch a d-pad rail left and an action rail right, or stacked
  under the view when the screen is too narrow for rails). `.cu[data-layout]` is
  `full` | `compact`; `.cu[data-touch]` is there only for fingers. The CSS for both is in
  `client/src/ui/mobile/css.ts`.
- Controls (`client/src/ui/mobile`, wrapped around the UI in `ui/index.ts`) send KEYS
  through `sendTouch` in `client/src/input/touch.ts`, like the gamepad: d-pad = arrows, USE
  = E, DROP = Q, TALK = V held, MAP = Tab (a switch), MENU = Esc. CHAT opens a field at the
  top of the screen with the four quick lines as buttons. The join popup gets letter keys.
  A mouse never gets them.
- Held upright on touch: a rotate card that is a `.cu-modal`, so the input gates pause the
  game. A narrow desktop window never shows it.
- The page background is dark (`index.html` and `ui/css.ts`), never white.
- Sound and the mic start from a tap; the mic is never opened on the title screen.
- `?debug=fit` (also in production) prints the numbers the layout comes from.
- Checks: `tools/screens/devices.ts` (53 sizes on WebKit, Chromium, Firefox, contact
  sheets in `docs/status/screens-fix/`), `tools/screens/probe-fit.ts` (an iPad-shaped
  WebKit window through rotate / toolbars / split view), `tools/screens/mobile.ts`.

## Map format

12 maps: outside 1-6 and inside 1-6, each 12x12 tiles of 16px (`FACE_SIZE` in
`shared/src/types.ts`). Two sources, per face:

1. **String maps** in `shared/src/maps/default.ts`: 12 strings of 12 characters.
   Terrain: `.` floor, `#` wall, `T` tree, `~` water (the last three are solid).
   Objects (on floor): `I` item, `U` target, `0` to `9` and `e` keypad keys, `d` display
   cell, `p` pot (a target), `u` face 5 symbol, `v` replay, `w` emitter (a target), `x`
   rock, `y` crate, `z` reset, `Y` beam source, `X` button (`C`, the old stub crystal, is
   still in the legend and on no map). The legend lives in `shared/src/maps/strings.ts`
   (`LEGEND`), one section per face.
2. **Tiled** `/maps/<side>-<face>.tmj` (e.g. `out-1.tmj`), bundled by `npm run maps`. A
   face with a `.tmj` ignores its string map. Tile layer `tiles` (CSV; terrain from the
   tile's `kind` property) + object layer `objects` (each object has a `type`). Details
   and template: `/maps/README.md`.

Both load into the same `FaceMap { side, face, tiles[y][x], objects[] }`. Objects never
block by themselves; a puzzle's `isBlocked` decides.

**EDGE RULE: nothing solid on the outer ring of any face** (row 0, row 11, column 0,
column 11): no solid terrain there, and no puzzle may block a ring tile for either side, so
a player crossing in from the next face can always step in. `shared/test/maps.test.ts`
checks the terrain and the puzzles; boxes refuse the ring (`lib/push.ts`).
**One exception:** the wooden crate of face 6 (`f6-crate`, outside) stands on the ring and
is solid until the laser burns it away; from then on its tile is open like any other. The
tests allow exactly that object, only while it is unburnt. Nothing else may join it.

## Puzzles

Six, one per face, in `shared/src/puzzles` (`PUZZLES` in `index.ts`). Chain: 2 -> 5 -> 6 ->
4; faces 1 and 3 stand alone. The game is won the moment all six are solved: there is no
portal and no exit to walk to. The win plays the ending (see "Ending").

| Face | id | Outside | Inside | Unlocks |
| --- | --- | --- | --- | --- |
| 1 Grass / Keypad room | `hidden-code` | reads the 3-digit number laid out in the grass; it only reads right at compass drift 0 | types it on the floor keypad, then ENTER | nothing |
| 2 Desert / Vault | `equation-safe` | counts the berry bushes, round rocks and hopping birds (1 to 4 each) | types 3 x bushes x 2 x birds x rocks, then ENTER; the safe opens | the battery (inside), for face 5 |
| 3 Snow / Tile room | `mirrored-glyph` | describes the symbol carved in the snow | flips floor tiles (E) until they match it, mirrored; CLEAR in the corner | nothing |
| 4 Forest / Greenhouse | `botanical-mirror` | collects the five flowers and plants each in the pot the partner names | sees which of the five pots holds each colour | the last link (needs all five flowers, one from face 6) |
| 5 Rooftop / Laser room | `sequence-laser` | calls the order the seven symbols light up in (E on REPLAY shows it again) | puts the battery in the emitter, presses the symbols in that order | the laser beam on face 6 |
| 6 Cave / Lava room | `laser-path` | pushes two mirrors so the beam burns the crate on the edge, then calls the beam's route: it is the safe path | stays on the ring until then, walks the tiles behind the beam from the crate's edge tile to the button, E | the flower (outside), for face 4 |

- A wrong code, press, pot or lava tile is a strike. Face 3 has none.
- **Face 4: five flowers, five pots.** Four flowers lie outside from the start, one each on
  faces 1, 2, 3 and 5, on a `flower-spot` (legend `f`) the seed picks (`onStart`); the fifth
  comes out of face 6's crate when it burns (`chain.ts`: `flowerColour`, `startFlowers`).
  The pots are SOLID on both sides: plant from the tile next to a pot, FACING it
  (`facedTile`: the last step or bump, `Player.facing`), with E or Q. Right pot: the flower
  stays for good. Wrong pot: a strike, the flower is back in the hands. All five solve it.
  The pots never wait for face 6 (they used to, which handed the flower back silently).
- **Face 6's lava is hot (deadly) from the first second of the game until face 6 is
  solved.** A step in: back on the ring with a strike. Every inside walk across face 6
  keeps to the ring: the bot (`hazardAvoid`), the test harness (`t.go`), the playtest
  (`goTo`). After the button it crusts over (`cold`) and is walkable.
  **The beam is the safe path.** There is none until the laser burns the crate. The burn
  locks the mirrors (no push, RESET does nothing any more; before the burn RESET works),
  so the beam is frozen and stays drawn for the outside player. The safe tiles are exactly
  the tiles under that beam (same canonical tiles), from the ring tile where the crate
  stood (`9,11`) to the beam source; the button stands behind the source (`5,5`). Nothing
  marks them inside: the outside player reads the beam out. A fall puts the player on
  `RESPAWN` (`0,5`) before the burn, and on the crate's ring tile (the start of the path)
  after it. The crate is on the ring and solid until it burns (the edge rule's one
  exception); the flower lands on its tile.
  It LOOKS like lava the whole time: all 99 tiles are `f6-lava` objects in every state
  (`hot` flows, 4 frames, still with reduce motion; `cold` is lava under a dark crust), and
  the room is `bright`. Browser check: `tools/screens/lava.ts`.
- **Face 5's symbols have names, one list:** `SYMBOL_NAMES` in `shared/src/symbols.ts` (sun,
  moon, star, bolt, drop, leaf, eye). The puzzle's object states, the AI's words
  (`VOCAB_SYMBOLS`, one banked clip per word) and the label all read it: never rename or
  reorder. Standing on a symbol shows its name over YOUR OWN turtle (`symbolLabel` in
  `shared/src/labels.ts`, by tile through `visibleObjects`; placed by
  `client/src/ui/label.ts`, drawn as `.cu-label` in the DOM layer of the quick-chat
  bubbles). Client only, never for the partner, none during a face transition. It names
  the tile, never the order or a right press. Browser check: `tools/screens/face5-label.ts`.
- Hooks beyond the basics: `onUse` (E on a tile with empty hands and no item to pick up:
  keys, buttons, flip tiles), `onPush` (a step into a tile on the same face: move a box and
  return true), `lines(side)` (beams drawn over the face), `bright` (the inside of the
  face is drawn fully lit).
- Randomness: `ctx.rand(...keys)` = `mix(ctx.seed, ...keys)`, and `ctx.seed` in `init`.
  The seed (`GameState.seed`) is new for every game of a room and the same on the server
  and both clients. Derive content from it instead of storing it.
- `shared/src/puzzles/lib`: `keypad`, `flip`, `sequence`, `push`, `hazard`, `deps`.
  `chain.ts`: the battery and the flower (ids, kinds, the flower's colour).
- Art per face: `client/src/game/puzzleArt/faceN.ts` (`common.ts`, `items.ts`, `index.ts`
  beside them).
- Tests: `shared/test/<id>.test.ts`, `solutions.ts`; see `docs/puzzle-tests.md`.
- `npm run art` (in `tools/`) currently exits with an error: the teammates' turtle sprites
  are off-palette. It still writes every file first. Never modify the turtle sprites.

## HUD cube and the player sprite (client only)

The cube in the HUD is drawn by `client/src/cube`. The outside player's is a solid cube;
the inside player's is drawn as a room, seen from within. Both turn with the compass
drift. The turtle faces its screen direction and carries an item above its head.

## Ending ("Passed cube 1!", client only)

The win (6/6, decided in `/shared`, `GameState.wonAt` + one `win` event) is not a modal any
more: the cube opens. The server and the state are untouched.

- **Where.** `client/src/scenes/ending`: `timeline.ts` (PURE, tested in
  `client/test/ending.test.ts`: phases, hinge angles, camera, both turtles, the layout),
  `run.ts` (the one piece of state: when it started, whether it was skipped, is the card
  up), `EndingScene.ts` (a scene of the STAGE, full window, over the backdrop: it only
  draws what the timeline returns). The title card is DOM: `#cu-win` in `ui/cubicUI.ts`
  (`.cu-ending` in `ui/css.ts`), on from the moment the game is won, so the input gates
  treat it as a modal; `.cu[data-ending]` hides the HUD, the top bar and the touch controls.
- **Drawn** by the cube's software rasterizer (`cube/raster.ts`: `drawQuad`, `drawSprite`,
  one depth per pixel) into one canvas texture, whole pixels: identical in WebGL and Canvas.
  The faces are the REAL ones at the win: `GameScene.shots()` paints all twelve
  (`game/shots.ts`), the outside of each wall and its inside (fully lit, tinted with the
  biome colour: `DAYLIGHT`). A box opens with its inside up, so the flat net shows the rooms.
- **Timeline** (ms since the win event; the knobs are the constants at the top of
  `timeline.ts`): flash 0 to `FLASH_MS` 600 (every face in its biome colour); the lid (face
  5, hinged on the back wall, face 3) opens at `LID_AT` 800 and the outside turtle jumps off
  it (`JUMP_MS` 2000, `JUMP_HEIGHT`); the walls fall from `WALL_AT` (front 1700, sides 1900,
  back 2200), flat at `FLAT_AT` 3700, while the camera turns to the front (`YAW`, `PITCH`)
  and the inside player's dark lifts; two hops for joy; the circle from `RUN_AT` 4500
  (`RUN_LAP_MS` 2400, `RUN_RADIUS`); the card at `CARD_AT` 6900, dropped in by
  `CARD_DROP_MS` 600: `ENDING_MS` 7500. The turtles keep running behind the card. Facing and
  frames come from `game/turtle.ts` (`playerFrames`, `playerFlip`: left = the walk-right row
  mirrored).
- **In sync.** `app.ts` starts the run on the `win` EVENT (online only the server announces
  it, to both players in one broadcast), never on the mover's predicted state, and the
  frame is a pure function of the time since then: no randomness, no per-client state. A
  game found already won (reload, rejoin) has no event: it goes straight to the card.
- **Skip.** Any key or tap after `SKIP_AFTER_MS` 2000 jumps that player to the card
  (`endingClock`); before that, and for a held key, nothing. Esc never closes it. On the
  card Enter = PLAY AGAIN (`onPlayAgain`), MAIN MENU = `onLeaveRoom`, as before.
- **Reduce motion**: no unfold, no jump, no running: the flat cube, the two turtles side by
  side and the card, at once (`endingFrame(t, true)`).
- **Fit.** The stage's own size (`logicalSize`, `sizeCanvas`, `onFit`); `endingLayout(w, h)`
  puts the sky in the top third and sizes the cube so the open lid and the flat net fit;
  the scene is rebuilt on a re-fit. The card is at the top, over the sky.
- **Sound** is what the win always played: the `win` chime and the solved sting. In solo
  the AI says its banked `win` line as before, with its caption.
- Dev (`import.meta.env.DEV`): `__cubicEnding()` (what it shows), `__cubicEndingHold(ms |
  null)` (freeze the timeline), `__cubicEndingReplay()`. Checks and pictures:
  `tools/screens/ending.ts` (WebGL, Canvas, reduce motion, a phone, a reload; it wins
  through the dev command), and the playtest's `puzzles` section (a played win: the
  sequence starts for both, the skip, the card, play again).

## Biome layer (client only, outside faces)

`client/src/world/biomes` dresses the outside faces; it only looks, the map decides what
blocks. `decor.ts` (pure data): `TREES` says what a `T` is on each face (bush, cactus, a
palm beside water, snowy pine, oak, planter, stalagmite), `DECOR` is one 12x12 string map
per face of non-blocking floor things (tall grass, mushrooms, drifts, puddles, drip
points) plus landmark skins on solid tiles (`*` = the snowman). `dress.ts` paints it into
the face texture from `GameScene.paint` (through `ArtProvider.dress`), in screen space:
props stay upright when the face is turned and water gets a bank on every land side.
Tall props (two tiles high) may only stand on solid tiles with no puzzle object on any
neighbour; `client/test/biomes.test.ts` fails if a decor tile, a crown or a landmark ever
covers a puzzle object, an item or the forest clearing. Sprites: `tools/art/biomes.ts`
(cell order in `world/biomes/sheet.ts`). Sway follows one gust across the screen (250 ms
steps, off with reduce motion). The ambience layer draws tall grass over the player's
feet, drips and snow.
Depth (`world/biomes/depth.ts`, pure, drawn by `GameScene`): sorted by SCREEN row, lower on
the screen is in front. A tall prop (`TALL` in `sheet.ts`) stands on its base tile and
reaches over the tile above (clipped at the face edge), so a turtle on that tile is behind
it: the prop is taken out of the painted face, painted into a canvas layer over the turtle
and the item on its head, and fades to 50% (`FADE_ALPHA`, 150 ms, instant with reduce
motion); it comes back when the turtle leaves. An item lying on that tile is under the
crown too and keeps the prop faded. In a face transition the fade is baked into the two
painted faces. A turtle below or beside a prop is in front of it and nothing fades.
When you move a map tile, run `npm test`: the biome test tells you what it now covers.

## Items (carryable)

- Map object `type: "item"`, `name` = unique id, prop `kind` (e.g. `battery`). Press **E** to
  pick up the item on your tile, or to drop the one you carry. One item at a time. A
  carried item travels across face edges with the player and stays where it is dropped.
- Map object `type: "target"`, `name` = id, prop `accepts` = item id or kind (empty =
  anything). Dropping an accepted item on it "places" it: the item stays there for good.
  A target its puzzle blocks (face 4's pots) is filled from the tile next to it, facing it:
  the item lands on the target's tile. A target that holds an item takes no second one.
- The server owns item state (`GameState.items`). Puzzles react through
  `onItem(s, ctx, ev)` with `ev.kind` = `picked` | `dropped` | `placed`; it fires for every
  face. Game events: `pickup`, `drop`, `place`.
- A puzzle can also make, hand back or delete an item: `ctx.spawnItem`, `ctx.giveItem`,
  `ctx.removeItem`. The game's items are made that way: the battery (inside, face 2 to
  the emitter on face 5) and the five flowers (outside, kind `flower-<colour>`: four from
  face 4's `onStart`, one from face 6's crate; each to its pot on face 4). No map has an
  item of its own.
- Items live on one side: the outside player cannot pick up an inside item.

## Proximity voice

No Discord: voice is part of the game. `voiceMix(state)` in `shared/src/voice.ts` returns
`{ gain }` from the face distance between the players (outside face N and inside face N
are the same wall = same face). Flat per face: same face = 1.0 (`VOICE_SAME`), adjacent
face = 0.35 (`VOICE_ADJ`), opposite face = 0 (`VOICE_OPP`), wherever you stand on the
face. The client ramps gain changes over `VOICE_RAMP_MS` (150 ms) so crossing an edge does
not pop. Puzzle and map design should use this: send players to far faces and they lose
each other.

Client: `client/src/voice/voice.ts`. Native `RTCPeerConnection` (no PeerJS/simple-peer
dependency), signaled through our own Socket.io server (`voice:signal`). ICE servers come
from the server's `GET /ice` (`client/src/voice/ice.ts`, cached, STUN-only fallback):
public STUN, plus TURN when `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL` are all set.
If the direct connection fails it relays Opus/webm chunks through the server
(`voice:chunk`; `?relay` forces it). All remote audio, including the AI's ElevenLabs
speech (`tts`), goes through one Web Audio gain driven by `voiceMix`.

## AI partner

Solo play: PLAY WITH AI on the mode screen (`client/src/scenes/AiPopup.ts` picks the side,
`ENABLE_AI` in `client/src/config.ts`). Always available: no key is needed.

- **The script drives** (`shared/src/bot`, pure). `observe(state, side)` is what that side
  can see, in its own screen orientation. `decide(mind, observation, heard, now)` in
  `partner.ts` is the core: greet, find the human by voice or "face N", stay on their
  wall, "wait" / "go", and which tiles no walk may enter (hot lava on any face included:
  `hazardAvoid` in `path.ts`). `talk.ts` is the
  chat protocol (sign, direction, go, yes, no, wait, again, face N; quick chat counts).
  `findPath` / `planAction` walk with the real blockers plus those tiles to avoid.
- **The core knows no puzzle**: not how many, their ids or faces. Each puzzle is a
  `PuzzleScript` in `shared/src/bot/scripts/<id>.ts`, registered in `scripts/index.ts`
  (interface and how to add one: `shared/src/bot/scripts/README.md`). A puzzle with no
  script: the bot says so, keeps off everything it sees on that face, follows the human.
- **`server/src/ai/aiPlayer.ts`** runs it on a Room: one decision and one step per `AI_STEP_MS` (`shared/src/pace.ts`, 267 ms at the default pace)
  through the same `Room` methods a human's socket uses. Its lines are a beat apart.
- **Gemini is advisory** (`gemini.ts`, `prompt.ts`): it rewords small talk, answers
  free-form chat, returns `heard` (the human's message in protocol words) and may suggest
  a move on the current face, walked only if it avoids the script's unsafe tiles and the
  body is not holding a place. Max one call per 6 s per room, no backlog, 3 s deadline (6 s
  for a chat line, `CHAT_TIMEOUT_MS`); on timeout, error or 429 the script's own line is
  said and calls back off (6 s doubling to 60 s). No `GEMINI_API_KEY` (or `AI_FAKE=1`) =
  script alone, silently. A free-form chat line Gemini does not answer always gets the
  preset `huh` line, and the log says why (`[ai CODE] chat: gemini did not answer
  (why=...)`, `ChatMiss` in `aiPlayer.ts`). One real call to check a key:
  `npm run gemini:once -w server`.
- **Words** of every line: `server/src/ai/scripted.ts` (core lines per persona, puzzle
  lines by key). Lines are capped at 80 characters. `AI_PERSONA` (default | tsundere)
  changes tone only.
- **Voice** (`server/src/ai/tts.ts`): the committed bank `server/tts/bank` is looked up
  first (by normalized text; built by `npm run tts:bank -w server`, incremental), then the
  disk cache, then ElevenLabs for Gemini's lines only, at most `TTS_SESSION_LINES` (15)
  per room, else the browser voice. `TTS_MODE` browser | elevenlabs. The script's own
  lines are never bought at runtime. Every spoken line is also a caption
  (`client/src/ui/captions.ts`). Token and TTS character usage are logged.

The AI has not been taught the six current puzzles yet: `PUZZLE_SCRIPTS` is empty (it
greets, follows, talks, stays off hot lava and says it does not know the puzzle) and the
puzzle block in `prompt.ts` is still a placeholder (between the `PUZZLES V2 PLACEHOLDER`
markers). Its body can press E (`use` action). The interfaces, exactly: `docs/ai-partner.md`.

## Inactivity

- Each connected human has their own clock in `Room` (`server/src/rooms.ts`, section
  "inactivity"). Nothing one player does, or fails to do, ever removes the other.
- Activity = a move, use, chat, quick chat, a lobby action, or the client's `activity`
  message (any key or tap, or talking into the mic: `Net.activity()` in
  `client/src/net/client.ts`, at most one per 3 s; the mic level is `Voice.talkingNow`, so
  it also works through the relay). Tab focus alone is not activity.
- Idle for `INACTIVE_MS` (default 240000): ONE system line in the chat, "[name] inactive,
  removed in m:ss", sent once with a deadline; the client counts it down in place
  (`chatText` in `client/src/ui/hooks.ts`). What ends it ("is back", "left due to
  inactivity", "disconnected") comes with the same message id and replaces it. The idle
  player also gets it in the banner ("You are inactive. Press any key. Removed in m:ss").
  The lobby has no chat: there the line is in the banner. Names on the server: OUTSIDE /
  INSIDE in a game, P1 / P2 in the lobby, frozen when the countdown starts.
- The player who STAYS never reads a label (P1 / P2 shift when the host is removed). The
  client rewords every line about the other player per viewer, by the note's member id
  (`viewerNote` in `client/src/net/notes.ts`): "Your partner is inactive, removed in
  m:ss", "Your partner is back", "Your partner left due to inactivity", "Your partner
  disconnected" / "Your partner left". A line about yourself (also the human's own line in
  a solo room) keeps the server's words.
- `INACTIVE_WARN_MS` later (default 60000) only that player is removed (`removed` socket
  message, back to the mode screen with the reason). The other keeps the room, becomes the
  host, and the seat opens. The room is deleted only when no human is left, present or held.
- Not inactive: the AI; a player who is disconnected or pressed Leave (that is the seat
  hold; the clock stands still and goes on where it was when they come back); a host
  waiting alone in a lobby (the clocks start when the second player sits).
- Both env vars are kept between 1 s and 24 h (`inactivityMs`). System lines live in
  `Room.notes`, never in `Room.chat`, so the AI partner and Gemini never see them.
- A seat opened in a second tab with the same token: the old tab gets `removed` with
  reason `replaced` and goes to the mode screen; the token stays with the new tab.
- Rooms live in memory only: a server restart or a redeploy (every merge to `main` on
  Render, and the free tier's sleep) ends every room, and both players land on the mode
  screen with "That room is gone."
- Tests: `server/test/inactivity.test.ts`; in real browsers `tools/screens/inactivity.ts`
  (logs and screenshots in `docs/status/inactivity/`).

## Connection and timeouts

- **Waking the server** (`client/src/net/wake.ts`, pure, `client/test/wake.test.ts`): the
  socket retries for ever by itself (20 s per attempt, pauses of 1 to 5 s). Not in a room,
  the menus show "WAKING THE SERVER... n%" with a bar (90% at 60 s, creeping to 99%), and
  after `WAKE.giveUpMs` (120 s) with no answer the socket stops and the mode screen shows
  "CANNOT REACH THE SERVER." with a RETRY button (`UIState.wake`, `onRetryConnect`). In a
  room there is no give-up. A page that becomes visible again, or whose network comes
  back, tries at once.
- **Heartbeat** (`SOCKET_TIMING` in `server/src/app.ts`): ping every 15 s, 30 s to answer.
  A stalled page keeps its socket for 30 s; a dead one is noticed within 45 s, both ways.
  Only then do the room's clocks start (seat hold 60 s, lobby hold 15 s).
- The server logs one `[socket] room=... closed: <reason>` line when a seated player's
  socket closes ("ping timeout", "transport close", ...).
- Every deploy ends every room (see Inactivity). Put `[skip render]` in the merge commit
  when nothing under `server/` or `shared/` changed, and do not merge during a demo.

## Git workflow

- `main` is always runnable. Nobody commits to it directly after the initial setup.
- One branch per person (`core`, `puzzles`, `ui`, `art`, or `name/feature`), small
  commits, then a pull request into `main`. Keep PRs to your own folder so they merge
  without conflicts. Rebase on `main` before opening the PR.
- CodeRabbit reviews PRs; fix what is real. Luis merges.
- Before pushing: `npm run typecheck && npm run lint && npm test`.

## Deploy

Backend: Render (`render.yaml`, `npm start -w server`, `/health`). Frontend: Vercel
(`vercel.json`, `npm run build -w client`, output `client/dist`). Env vars are listed in
`server/.env.example` and `client/.env.example`.
