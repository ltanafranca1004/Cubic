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
  - Compass drift: the HUD shows how far your "up" has turned from the face's own up.
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
  src/puzzles/        PuzzleModule interface + one file per puzzle
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
  tile)`, `onEnter` / `onLeave` (tile), `onItem`, `onTick`, `isSolved`, `visible(side)`
  (per-side visibility), `objective(side)`, plus `ctx.emit` for custom events. Example:
  `plateDoor.ts`. Template: `_template.ts`. Register in `puzzles/index.ts`.
- **UI:** `UIHost` / `UIState` / `UIActions` in `client/src/ui/hooks.ts`
  (`onCreateRoom`, `onJoinRoom(code)`, `onPlayWithAI(side)`, ...). Mock data in
  `client/src/ui/mock.ts`, shown with `?mock=lobby`, `?mock=hud` or `?mock=game`.
- **Assets:** `client/public/assets/manifest.json` (schema in that folder's README).

## Cube and coordinates

- Faces by normal: 1 = +z, 2 = +x, 3 = -z, 4 = -x, 5 = +y (top), 6 = -y (bottom).
  Canonical up: faces 1-4 = +y, face 5 = -z, face 6 = +z.
- A `Pose` is `{ side, face, up, x, y, dir }`. `x, y` are canonical tile coords (0-9, x
  right, y down as drawn in the map). Both sides share them: inside `(x, y)` is directly
  behind outside `(x, y)`.
- Screen right = `cross(up, normal)` outside, `cross(up, -normal)` inside (mirrored).
- Walking off the top of the screen: new `up = -oldNormal`. Off the bottom: `+oldNormal`.
  Sideways: `up` unchanged.
- Puzzles compare tiles, never screen directions.

## Map format

12 maps: outside 1-6 and inside 1-6, each 10x10 tiles of 16px. Two sources, per face:

1. **String maps** in `shared/src/maps/default.ts`: 10 strings of 10 characters.
   Terrain: `.` floor, `#` wall, `T` tree, `~` water (the last three are solid).
   Objects (on floor): `P` plate, `D` door, `C` crystal, `O` portal, `I` item, `U` target.
   Legend lives in `shared/src/maps/strings.ts`.
2. **Tiled** `/maps/<side>-<face>.tmj` (e.g. `out-1.tmj`), bundled by `npm run maps`. A
   face with a `.tmj` ignores its string map. Tile layer `tiles` (CSV; terrain from the
   tile's `kind` property) + object layer `objects` (each object has a `type`). Details
   and template: `/maps/README.md`.

Both load into the same `FaceMap { side, face, tiles[y][x], objects[] }`. Objects never
block by themselves; a puzzle's `isBlocked` decides.

## Items (carryable)

- Map object `type: "item"`, `name` = unique id, prop `kind` (e.g. `rose`). Press **E** to
  pick up the item on your tile, or to drop the one you carry. One item at a time. A
  carried item travels across face edges with the player and stays where it is dropped.
- Map object `type: "target"`, `name` = id, prop `accepts` = item id or kind (empty =
  anything). Dropping an accepted item on it "places" it: the item stays there for good.
- The server owns item state (`GameState.items`). Puzzles react through
  `onItem(s, ctx, ev)` with `ev.kind` = `picked` | `dropped` | `placed`; it fires for every
  face. Game events: `pickup`, `drop`, `place`.
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
