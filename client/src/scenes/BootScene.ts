import Phaser from 'phaser';
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
    // the real tiles and the manifest, for the cube net on the mode screen
    for (let face = 1; face <= 6; face++) this.load.image(`tiles-out-${face}`, asset(`tiles/out-${face}.png`));
    this.load.json('manifest', asset('manifest.json'));
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
    ctxOf(this).flow.ready();
    this.scene.stop();
  }
}
