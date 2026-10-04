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
  src/bot/            the AI's body: observe(), pathTo()
/server   Node + Socket.io (tsx). Rooms, validation, chat, voice signaling, AI partner.
/client   Phaser 4 + Vite.
  src/game/           the playable scene, rendering, input, sound (core)
  src/net/            socket client, prediction
  src/voice/          WebRTC + Web Audio
  src/lobby/          placeholder UI (core)
  src/ui/             the real UI, behind the hook interface in ui/hooks.ts
  src/scenes/         extra polish scenes
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
  `visible(side)` (per-side visibility), `objective(side)`, `lines(side)`, `bright`, plus
  `ctx.emit` for custom events. See "Puzzles" below. Example: `hiddenCode.ts`. Template:
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
checks the terrain; boxes refuse the ring (`lib/push.ts`).

## Puzzles

Six, one per face, in `shared/src/puzzles` (`PUZZLES` in `index.ts`). Chain: 2 -> 5 -> 6 ->
4; faces 1 and 3 stand alone. The game is won the moment all six are solved: there is no
portal and no exit to walk to.

| Face | id | Outside | Inside | Unlocks |
| --- | --- | --- | --- | --- |
| 1 Grass / Keypad room | `hidden-code` | reads the 3-digit number laid out in the grass; it only reads right at compass drift 0 | types it on the floor keypad, then ENTER | nothing |
| 2 Desert / Vault | `equation-safe` | counts the berry bushes, round rocks and hopping birds (1 to 4 each) | types 3 x bushes x 2 x birds x rocks, then ENTER; the safe opens | the battery (inside), for face 5 |
| 3 Snow / Tile room | `mirrored-glyph` | describes the symbol carved in the snow | flips floor tiles (E) until they match it, mirrored; CLEAR in the corner | nothing |
| 4 Forest / Greenhouse | `botanical-mirror` | plants the flower in the pot the partner names | sees which of the five pots holds that colour | the last link (needs face 6's flower) |
| 5 Rooftop / Laser room | `sequence-laser` | calls the order the seven symbols light up in (E on REPLAY shows it again) | puts the battery in the emitter, presses the symbols in that order | the laser beam on face 6 |
| 6 Cave / Lava room | `laser-path` | pushes two mirrors so the beam burns the crate, then calls the safe path it reveals | walks that path over the lava to the button, E | the flower (outside), for face 4 |

- A wrong code, press, pot or lava tile is a strike. Face 3 has none.
- **Face 6's lava is deadly only while face 5 is solved and face 6 is not.** Before the
  laser is on, and after the button is pressed, it is cold and walkable (so the bot and
  the test scripts can cross it). While it is hot the inside player must stay on the ring.
- Hooks beyond the basics: `onUse` (E on a tile with empty hands and no item to pick up:
  keys, buttons, flip tiles), `onPush` (a step into a tile on the same face: move a box and
  return true), `lines(side)` (beams drawn over the face), `bright` (the inside of the
  face is drawn fully lit).
- Randomness: `ctx.rand(...keys)` = `mix(ctx.seed, ...keys)`, and `ctx.seed` in `init`.
  The seed (`GameState.seed`) is new for every game of a room and the same on the server
  and both clients. Derive content from it instead of storing it.
- `shared/src/puzzles/lib`: `keypad`, `flip`, `sequence`, `push`, `hazard`, `path`, `deps`.
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
steps, off with reduce motion). The ambience layer draws what goes OVER the player: the
crown of a tree they stand behind (dithered), tall grass over their feet, drips, snow.
When you move a map tile, run `npm test`: the biome test tells you what it now covers.

## Items (carryable)

- Map object `type: "item"`, `name` = unique id, prop `kind` (e.g. `battery`). Press **E** to
  pick up the item on your tile, or to drop the one you carry. One item at a time. A
  carried item travels across face edges with the player and stays where it is dropped.
- Map object `type: "target"`, `name` = id, prop `accepts` = item id or kind (empty =
  anything). Dropping an accepted item on it "places" it: the item stays there for good.
- The server owns item state (`GameState.items`). Puzzles react through
  `onItem(s, ctx, ev)` with `ev.kind` = `picked` | `dropped` | `placed`; it fires for every
  face. Game events: `pickup`, `drop`, `place`.
- A puzzle can also make, hand back or delete an item: `ctx.spawnItem`, `ctx.giveItem`,
  `ctx.removeItem`. The game's two items are made that way: the battery (inside, face 2 to
  the emitter on face 5) and the flower (outside, `flower-<colour>`, face 6 to a pot on
  face 4). No map has an item of its own.
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

`/shared/src/bot` is the body: `observe(state, side)` (only what that side can see, in its
own screen orientation), `pathTo` / `findPath` (BFS across faces with the real blockers)
and `planAction` (goto, go_face, step_on, move, pick_up, drop, wait). `/server/src/ai` is
the brain: `AiPlayer` sits in the empty seat, sends Gemini the rules + observation + chat,
validates the JSON reply `{ say, action }` and walks the action one step per 200 ms
through the same `Room` methods a human's socket uses. Max one Gemini call per 6 s per
room (no backlog), 12 s timeout; on errors it backs off and the scripted partner
(`scripted.ts`, also `AI_FAKE=1`) plays that turn. Lines are capped at 80 characters.
`AI_PERSONA` (default | tsundere) changes tone only. Speech: `TTS_MODE` browser |
elevenlabs, disk cache + voice bank in `server/src/ai/tts.ts`. Token and TTS character
usage are logged. New puzzle objects
are visible to the AI automatically through `visible()`; describe new mechanics in
`server/src/ai/prompt.ts` if the AI needs to know a rule.

The AI has not been taught the six current puzzles yet: the puzzle block in `prompt.ts`
is still a placeholder (between the `PUZZLES V2 PLACEHOLDER` markers). Its body also has
no "use" action: `pick_up` and `drop` are refused without an item, so it cannot press E on
a key, a button, a flip tile, REPLAY or RESET.

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
