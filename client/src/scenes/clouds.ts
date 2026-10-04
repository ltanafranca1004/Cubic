import type Phaser from 'phaser';
import { ROLE, TIME, hex } from '../style/tokens';
import { seeded } from './kit';

// The sky and its clouds: four layers, far (small, slow) to near (large, fast). Positions
// are kept as fractions and drawn on whole pixels, so the drift never blurs.

export interface Cloud {
  sprite: Phaser.GameObjects.Image;
  /** Exact position; the sprite shows it rounded. */
  x: number;
  layer: number;
}

const SKY_HEIGHT = 360;

export class Sky {
  readonly back: Phaser.GameObjects.Rectangle;
  readonly gradient: Phaser.GameObjects.TileSprite;
  readonly clouds: Cloud[] = [];
  /** 1 = normal drift. */
  speed = 1;

  constructor(
    private scene: Phaser.Scene,
    private x0: number,
    private width: number,
    private height: number,
    /** How many clouds per layer, far to near. */
    counts: readonly number[] = [5, 4, 3, 2],
    seed = 7,
  ) {
    // the strip's horizon sits at the bottom of the screen; above it the sky is flat
    this.back = scene.add.rectangle(x0, 0, width, height, hex(ROLE.skyTop)).setOrigin(0, 0);
    this.gradient = scene.add.tileSprite(x0, height - SKY_HEIGHT, width, SKY_HEIGHT, 'sky').setOrigin(0, 0);
    const rnd = seeded(seed);
    counts.forEach((count, layer) => {
      const key = `cloud-${layer + 1}`;
      const w = scene.textures.get(key).getSourceImage().width;
      for (let i = 0; i < count; i++) {
        // spread along the width with some jitter; far clouds high, near clouds low
        const x = x0 + ((i + rnd() * 0.7) / count) * (width + w) - w;
        const band = [0.08, 0.2, 0.38, 0.62][layer]!;
        const y = Math.round(height * (band + rnd() * 0.16));
        const sprite = scene.add.image(Math.round(x), y, key).setOrigin(0, 0);
        this.clouds.push({ sprite, x, layer });
      }
    });
  }

  /** Drift. Clouds that leave on the right come back on the left. */
  update(deltaMs: number): void {
    for (const c of this.clouds) {
      c.x += (TIME.cloudSpeed[c.layer]! * this.speed * deltaMs) / 1000;
      if (c.x > this.x0 + this.width) c.x = this.x0 - c.sprite.width;
      c.sprite.x = Math.round(c.x);
    }
  }

  /** Everything that makes up the sky, for fading it as one. */
  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.back, this.gradient];
  }
}
