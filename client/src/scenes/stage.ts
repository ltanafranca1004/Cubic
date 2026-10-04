import Phaser from 'phaser';
import { pointerGate } from '../input/overlay';
import { rendererType } from '../style/renderer';
import { sizeCanvas } from '../style/canvas';
import { logicalSize, onFit } from '../style/scale';
import { ROLE } from '../style/tokens';
import type { UIActions, UIState } from '../ui/hooks';
import { BackdropScene } from './BackdropScene';
import { BootScene } from './BootScene';
import { CubeBackdropScene } from './CubeBackdropScene';
import { Flow, UI_EVENT, type Screen, type StageContext } from './flow';
import { ModeScene } from './ModeScene';
import { SideSelectScene } from './SideSelectScene';
import { StartScene } from './StartScene';

// THE STAGE: one full-window Phaser canvas behind the DOM UI. It runs the menu scenes
// (start, mode, side select) over the turning cube, and the backdrop behind the in-game HUD. The game itself
// stays in its own small canvas (client/src/game), drawn at the same pixel scale.

export interface Stage {
  update(state: UIState): void;
  /** The screen the stage is showing (or heading to). */
  screen(): Screen | null;
  destroy(): void;
}

export function createStage(parent: HTMLElement, actions: UIActions, initial: UIState): Stage {
  const size = logicalSize();
  const game = new Phaser.Game({
    type: rendererType(),
    parent,
    width: size.width,
    height: size.height,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: ROLE.surface,
    banner: false,
    audio: { noAudio: true }, // all sound goes through style/audioApi
    scale: { mode: Phaser.Scale.NONE, zoom: size.scale },
    // Only presses on the canvas itself count. By default Phaser also listens on the window
    // and treats a press on any DOM element (a settings button, the pause menu, the chat
    // field) as a press on the canvas button that happens to be behind it.
    input: { windowEvents: false },
    // drawn in this order: the cube is under every menu
    scene: [BootScene, CubeBackdropScene, StartScene, ModeScene, SideSelectScene, BackdropScene],
  });

  const ctx: StageContext = { actions, state: initial, flow: null as unknown as Flow };
  ctx.flow = new Flow(game, () => ctx.state);
  game.registry.set('ctx', ctx);

  // While a DOM overlay is open on top of the stage (settings, pause, win, a focused text
  // field) the stage takes no pointer input at all, and it gets it back a frame after the
  // overlay closes. Keys are gated the same way in MenuScene.keys (flow.ts).
  const gate = pointerGate();
  const onStep = () => {
    game.input.enabled = gate.step();
  };
  game.events.on(Phaser.Core.Events.PRE_STEP, onStep);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      /** Is the stage taking pointer input, and when it last saw a press (tools/screens/check.ts). */
      __cubicStage: () => ({ input: game.input.enabled, lastDown: Math.max(...game.input.pointers.map((p) => p.downTime)) }),
    });
  }

  const fit = () => {
    const next = logicalSize();
    sizeCanvas(game, next.width, next.height, next.scale);
  };
  const fitOff = onFit(fit);
  game.events.once(Phaser.Core.Events.READY, fit); // the window may have changed while Phaser booted

  return {
    update(state) {
      ctx.state = state;
      game.events.emit(UI_EVENT, state);
      ctx.flow.route();
    },
    screen: () => ctx.flow.current,
    destroy() {
      fitOff();
      ctx.flow.destroy();
      game.destroy(true);
    },
  };
}
