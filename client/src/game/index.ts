import Phaser from 'phaser';
import type { GameEvent, GameState, Side } from '@cubic/shared';
import { EXTRA_SCENES } from '../scenes';
import { GameScene, VIEW_PX, type GameInput } from './GameScene';

export type { GameInput } from './GameScene';

export interface GameHandle {
  setState(state: GameState | null, me: Side): void;
  handle(events: GameEvent[]): void;
  destroy(): void;
}

/** Largest whole-number zoom that fits the window (pixel art must scale by integers). */
function fitZoom(): number {
  const room = Math.min(window.innerWidth - 120, window.innerHeight - 300);
  return Math.max(1, Math.min(6, Math.floor(room / VIEW_PX)));
}

export function createGameView(parent: HTMLElement, input: GameInput): GameHandle {
  const scene = new GameScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_PX,
    height: VIEW_PX,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#05070D',
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
