import Phaser from 'phaser';
import { loadCubeArt } from '../cube/faces';
import { BUTTON_VARIANTS, PLAYER_FRAMES, UI_IMAGES, asset } from '../style/assets';
import { TIME } from '../style/tokens';
import { ctxOf } from './flow';
import { FONT } from './kit';

/** Loads the menu art, then lets the flow pick the first screen. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.bitmapFont(FONT, asset('fonts/m5x7.png'), asset('fonts/m5x7.xml'));
    for (const [key, path] of Object.entries(UI_IMAGES)) this.load.image(key, asset(path));
    for (const variant of BUTTON_VARIANTS) for (const state of ['idle', 'hover', 'pressed']) this.load.image(`btn-${variant}-${state}`, asset(`ui/btn-${variant}-${state}.png`));
    for (const side of ['out', 'in']) this.load.spritesheet(`player-${side}`, asset(`sprites/player-${side}.png`), { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('icons', asset('ui/icons.png'), { frameWidth: 16, frameHeight: 16 });
  }

  create(): void {
    for (const side of ['out', 'in']) {
      this.anims.create({
        key: `idle-${side}`,
        frames: this.anims.generateFrameNumbers(`player-${side}`, { frames: [...PLAYER_FRAMES.idle] }),
        frameRate: 1000 / TIME.idleFrame,
        repeat: -1,
      });
    }
    // the cube behind the menus is drawn from the real tiles, objects and turtles
    void loadCubeArt().then((art) => {
      if (!this.sys?.isActive()) return; // the stage was torn down while loading
      this.registry.set('cubeArt', art);
      this.scene.launch('cube');
      ctxOf(this).flow.ready();
      this.scene.stop();
    });
  }
}
