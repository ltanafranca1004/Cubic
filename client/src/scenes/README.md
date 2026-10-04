# /client/src/scenes (owner: friend 2)

Phaser 4 scenes that are not the game itself. The playable scene is
`/client/src/game/GameScene.ts` (core team); do not edit it, layer on top of it.

## The stage: menus and backdrop

`stage.ts` runs one full-window Phaser canvas behind the DOM UI. `ui/cubicUI.ts` creates
it and feeds it the `UIState`. Design: [docs/menu-design.md](../../../docs/menu-design.md).

| File | What |
| --- | --- |
| `stage.ts` | Creates the stage game, resizes it to the UI's whole-number scale. |
| `flow.ts` | Which screen is showing and how it hands over to the next. The UI state decides; the flow animates. Also `MenuScene`, the base class (state, keys, fade, rebuild on resize). |
| `BootScene.ts` | Loads the menu art. |
| `CubeBackdropScene.ts` | The cube turning behind every menu (key `cube`), with the sky, the white and the side select halves behind it. Never stopped between menus; `flow.ts` tells it which screen it is behind. Drawn by `client/src/cube`. |
| `StartScene.ts` | Title: the near clouds, logo, Play, and the dive through the clouds. |
| `ModeScene.ts` | Create / Join / Play with AI on a panel beside the cube, and the join popup. |
| `SideSelectScene.ts` | Pick a side, ready, start. Draws `UIState.lobby`, nothing else. |
| `BackdropScene.ts` | Behind the in-game HUD: the sky outside, the dark inside. |
| `ending/` | The ending, "Passed cube 1!": the won cube opens into its net on the grass, over the backdrop (key `ending`). `timeline.ts` is pure (every number of the sequence, tested in `client/test/ending.test.ts`), `run.ts` is when it started and whether it was skipped, `EndingScene.ts` draws it with `client/src/cube`'s rasterizer. `stage.ts` runs it while a run is on; the title card is DOM (`ui/cubicUI.ts`). See "Ending" in the root `CLAUDE.md`. |
| `clouds.ts` | The sky and its four cloud layers. |
| `kit.ts` | Text, 9-slice panels, buttons, shake and hop, for all the scenes above. |

Rules:
- Phaser 4 (`phaser@^4.2`). Do not use Phaser 3 only APIs; check `node_modules/phaser/types`.
- Colours, sizes and timings come from `../style/tokens.ts`. Text is the `m5x7` bitmap
  font through `kit.text`, at whole multiples of 16px.
- Everything sits on whole pixels. Layouts are written for a 480x270 logical screen and
  anchored to the centre and the corners; a scene is rebuilt when the window is resized.
- A scene never talks to the network. It reads `ctxOf(this).state` and calls
  `ctxOf(this).actions`.
- Keys: use `MenuScene.keys()`, not Phaser's keyboard plugin (several keys in one frame
  arrived wrong through it, which broke fast typing in the join popup).

## Extra scenes on the game view

A scene can also run on top of the game view itself (face-change flourish, particles).
Register it in `index.ts`:

```ts
// scenes/index.ts
import { SparkScene } from './SparkScene';
export const EXTRA_SCENES = [SparkScene];
```

The game adds everything in `EXTRA_SCENES` after its own scenes and launches them in
parallel with the game scene, so they draw on top. React to the game through the event
bus, never by importing game internals:

```ts
this.game.events.on('cubic:event', (e: GameEvent) => { /* step, bump, flip, solve, win, ... */ });
this.game.events.on('cubic:state', (s: GameState, me: Side) => { /* every state change */ });
```

That canvas is 192x192 logical pixels (`FACE_SIZE` = 12 tiles of 16px), `pixelArt: true`, at the same
whole-number scale as the rest of the UI. No game rules here.
