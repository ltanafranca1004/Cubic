import Phaser from 'phaser';
import { rendererType } from '../style/renderer';
import type { GameEvent, GameState, Side } from '@cubic/shared';
import { EXTRA_SCENES } from '../scenes';
import { SheetArt } from '../style/art';
import { uiScale } from '../style/scale';
import { CodeArt } from './art';
import { GameScene, VIEW_PX, type GameInput } from './GameScene';

export type { GameInput } from './GameScene';

export interface GameHandle {
  setState(state: GameState | null, me: Side): void;
  handle(events: GameEvent[]): void;
  destroy(): void;
}

/** The game view shares the UI's whole-number scale, so a pixel is one size everywhere. */
function fitZoom(): number {
  return uiScale();
}

export function createGameView(parent: HTMLElement, input: GameInput): GameHandle {
  // Real tiles from assets/manifest.json, with the code-drawn art as the fallback.
  const scene = new GameScene((textures) => new SheetArt(textures, new CodeArt(textures)));
  const game = new Phaser.Game({
    type: rendererType(),
    parent,
    width: VIEW_PX,
    height: VIEW_PX,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#2e222f',
    banner: false,
    audio: { noAudio: true }, // sound effects use our own Web Audio graph
    scale: { mode: Phaser.Scale.NONE, zoom: fitZoom() },
    scene: [scene, ...EXTRA_SCENES],
  });
  scene.bind(input);
  const onResize = () => game.scale.setZoom(fitZoom());
  window.addEventListener('resize', onResize);
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const extra of EXTRA_SCENES) game.scene.run(extra);
  });

  return {
    setState(state, me) {
      scene.setState(state, me);
      game.events.emit('cubic:state', state, me);
    },
    handle(events) {
      scene.handle(events);
      for (const e of events) game.events.emit('cubic:event', e);
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      game.destroy(true);
    },
  };
}
