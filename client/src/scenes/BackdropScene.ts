import type { Side } from '@cubic/shared';
import { C, ROLE, hex } from '../style/tokens';
import { Sky } from './clouds';
import { MenuScene, type SceneData } from './flow';
import { seeded } from './kit';

/**
 * What is behind the HUD while you play. Outside: the same sky as the title, calmer.
 * Inside: the dark, with dust hanging in it. The two players never see the same room.
 */
export class BackdropScene extends MenuScene {
  private sky: Sky | null = null;
  private side: Side | null = null;

  constructor() {
    super('backdrop');
  }

  create(data: SceneData): void {
    const { W, H } = this;
    this.side = this.ui.side ?? 'out';
    this.sky = null;
    if (this.side === 'out') {
      this.sky = new Sky(this, 0, W, H, [5, 4, 2, 0], 41);
      this.sky.speed = 0.6;
    } else {
      this.add.rectangle(0, 0, W, H, hex(ROLE.void)).setOrigin(0, 0);
      const rnd = seeded(9);
      for (let i = 0; i < 60; i++) {
        const mote = this.add.rectangle(Math.round(rnd() * W), Math.round(rnd() * H), 1, 1, hex(rnd() < 0.25 ? ROLE.in.dark : C.slate)).setOrigin(0, 0);
        this.tweens.add({ targets: mote, y: mote.y - 6 - rnd() * 12, alpha: 0.15, duration: 2600 + rnd() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    this.begin(data);
  }

  protected sync(): void {
    // a new game on the other side (leave, then play again): rebuild for that side
    if (this.ui.side && this.ui.side !== this.side) this.scene.restart({});
  }

  update(_time: number, delta: number): void {
    this.sky?.update(delta);
  }
}
