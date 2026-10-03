# /client/src/scenes (owner: friend 2)

Extra Phaser 4 scenes for polish: title/intro, face-change flourish, win cinematic,
particles, screen shake. The playable scene itself is `/client/src/game/GameScene.ts`
(core team); do not edit it, layer on top of it.

Rules:
- Phaser 4 (`phaser@^4.2`). Do not use Phaser 3 only APIs; check the Phaser 4 docs.
- A scene here is a normal `Phaser.Scene` subclass. Register it in `scenes/index.ts`:

```ts
// scenes/index.ts
import { TitleScene } from './TitleScene';
export const EXTRA_SCENES = [TitleScene];
```

  The game adds everything in `EXTRA_SCENES` after its own scenes and launches them in
  parallel with the game scene, so they draw on top.
- React to the game through the scene event bus, never by importing game internals:

```ts
this.game.events.on('cubic:event', (e: GameEvent) => { /* step, bump, flip, solve, win, ... */ });
this.game.events.on('cubic:state', (s: GameState, me: Side) => { /* every state change */ });
```

- The canvas is 160x160 logical pixels (10 tiles of 16px), `pixelArt: true`, scaled by
  whole numbers. Keep everything on the pixel grid.
- No game rules here. If a scene needs data that the events do not carry, ask Luis.
