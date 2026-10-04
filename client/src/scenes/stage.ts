import Phaser from 'phaser';
import { rendererType } from '../style/renderer';
import { logicalSize } from '../style/scale';
import { ROLE } from '../style/tokens';
import type { UIActions, UIState } from '../ui/hooks';
import { BackdropScene } from './BackdropScene';
import { BootScene } from './BootScene';
import { Flow, UI_EVENT, type Screen, type StageContext } from './flow';
import { ModeScene } from './ModeScene';
import { SideSelectScene } from './SideSelectScene';
import { StartScene } from './StartScene';

// THE STAGE: one full-window Phaser canvas behind the DOM UI. It runs the menu scenes
// (start, mode, side select) and the backdrop behind the in-game HUD. The game itself
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
    scene: [BootScene, StartScene, ModeScene, SideSelectScene, BackdropScene],
  });

  const ctx: StageContext = { actions, state: initial, flow: null as unknown as Flow };
  ctx.flow = new Flow(game, () => ctx.state);
  game.registry.set('ctx', ctx);

  const onResize = () => {
    const next = logicalSize();
    game.scale.setZoom(next.scale);
    game.scale.resize(next.width, next.height);
  };
  window.addEventListener('resize', onResize);

  return {
    update(state) {
      ctx.state = state;
      game.events.emit(UI_EVENT, state);
      ctx.flow.route();
    },
    screen: () => ctx.flow.current,
    destroy() {
      window.removeEventListener('resize', onResize);
      game.destroy(true);
    },
  };
}
