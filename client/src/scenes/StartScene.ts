import Phaser from 'phaser';
import { EASE, ROLE, TIME } from '../style/tokens';
import { Sky } from './clouds';
import { MenuScene, type SceneData } from './flow';
import { menuAction } from '../input/keymap';
import { Button, seeded, textCentred, type Text } from './kit';

/**
 * The title: a sky of drifting clouds, the logo, one button. Play dives down through the
 * clouds: they rush past and part to the sides, and the mode screen is the world below.
 */
export class StartScene extends MenuScene {
  private sky!: Sky;
  private logo!: Phaser.GameObjects.Image;
  private tagline!: Text;
  private status!: Text;
  private play!: Button;
  /** The dive has started: nothing can start it twice. */
  private leaving = false;

  constructor() {
    super('start');
  }

  create(data: SceneData): void {
    this.leaving = false;
    const { W, H } = this;
    this.sky = new Sky(this, 0, W, H);

    const cx = Math.round(W / 2);
    const logoY = Math.round(H * 0.34);
    this.logo = this.add.image(cx, logoY, 'logo');
    const under = logoY + Math.round(this.logo.height / 2);
    // white text over sky and white clouds: the ink outline keeps it readable on both
    this.tagline = textCentred(this, cx, under + 13, 'TWO PLAYERS. ONE CUBE.', ROLE.paper, 1, true);
    this.play = new Button(this, { label: 'PLAY', variant: 'in', width: 136, height: 34, labelSize: 2, pulse: true, onClick: () => this.dive() }).setCentre(cx, under + 28);
    this.status = textCentred(this, cx, H - 14, '', ROLE.paper, 1, true);

    // the logo floats: two pixels up and down, landing on whole pixels
    this.tweens.add({ targets: this.logo, y: logoY - 2, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // One button, so there is nowhere for the focus to go: the first key of any kind
    // shows the outline on it (a mouse player keeps the plain pulsing button).
    this.keys((e) => {
      this.play.setFocus(true);
      if (menuAction(e) === 'select') this.play.press();
    });
    this.begin(data);
  }

  protected sync(): void {
    // the server may still be waking (free hosting): say so, but Play always works
    const msg = this.ui.online ? '' : 'WAKING THE SERVER...';
    if (this.status.text !== msg) {
      this.status.setText(msg);
      this.status.x = Math.round(this.W / 2 - this.status.width / 2);
    }
  }

  update(_time: number, delta: number): void {
    this.sky.update(delta);
  }

  private dive(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.ctx.flow.dive();
    const { W, H } = this;
    const cx = W / 2;
    const cy = H / 2;

    // the title lifts away
    this.tweens.killTweensOf(this.logo);
    this.tweens.add({ targets: [this.logo, this.tagline, this.play.root, this.status], y: `-=${Math.round(H * 0.2)}`, alpha: 0, duration: TIME.dive * 0.25, ease: EASE.in });

    // every cloud comes at the camera and parts to its own side
    this.sky.speed = 0;
    for (const c of this.sky.clouds) {
      const s = c.sprite;
      const mx = s.x + s.width / 2;
      const my = s.y + s.height / 2;
      const depth = 1.5 + c.layer; // near clouds pass faster and grow more
      const side = mx < cx ? -1 : 1;
      s.setOrigin(0.5, 0.5).setPosition(mx, my);
      this.tweens.add({
        targets: s,
        x: mx + side * (W * 0.35 + Math.abs(mx - cx)) * depth,
        y: my + (my - cy) * depth,
        scale: 1 + depth,
        duration: TIME.dive,
        ease: EASE.in,
      });
      this.tweens.add({ targets: s, alpha: 0, delay: TIME.dive * 0.55, duration: TIME.dive * 0.4 });
    }

    // a cloud bank straight ahead: it opens down the middle as we fall through it
    const rnd = seeded(11);
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      const x0 = cx + side * (10 + rnd() * W * 0.18);
      const y0 = cy + (rnd() - 0.5) * H * 0.7;
      const s = this.add.image(x0, y0, rnd() < 0.5 ? 'cloud-4' : 'cloud-3').setScale(0.5).setAlpha(0);
      const delay = TIME.dive * (0.1 + rnd() * 0.3);
      const duration = TIME.dive * 0.9 - delay;
      this.tweens.add({ targets: s, alpha: 1, delay, duration: TIME.dive * 0.12 });
      this.tweens.add({ targets: s, x: x0 + side * W * (0.7 + rnd() * 0.4), y: y0 + (y0 - cy) * 1.5, scale: 4 + rnd() * 2, delay, duration, ease: EASE.in });
      this.tweens.add({ targets: s, alpha: 0, delay: delay + duration * 0.7, duration: duration * 0.3 });
    }

    // the sky thins out and the world below shows through
    this.tweens.add({ targets: this.sky.parts, alpha: 0, delay: TIME.dive * 0.45, duration: TIME.dive * 0.45 });
    this.time.delayedCall(TIME.dive, () => this.ctx.flow.diveDone());
  }
}
