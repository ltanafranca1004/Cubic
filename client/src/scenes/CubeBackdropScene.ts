import Phaser from 'phaser';
import { bakeFaces, type CubeArt } from '../cube/faces';
import { texelFor } from '../cube/layout';
import { pack } from '../cube/raster';
import { SPIN_FRAMES, bakeSpin } from '../cube/spin';
import { settings } from '../style/settings';
import { C, EASE, ROLE, hex } from '../style/tokens';
import { Sky } from './clouds';

/** Which menu the cube is behind. `off` = the game is on: the scene sleeps. */
export type CubeMode = 'start' | 'mode' | 'side' | 'off';

/** One full turn of the cube, in ms. */
const TURN_MS = 48_000;
/** The cube's edge as a share of the screen height (with its tilt it fills about 65%). */
const EDGE = 0.4;
/** The largest half-edge we bake: keeps the frame strip inside a 4096px texture. */
const MAX_HALF = 72;
const ATLAS_MAX = 4096;

interface Rest {
  x: number;
  y: number;
  alpha: number;
}

/**
 * For the screenshot check (tools/screens/cube.ts, dev builds only): what the last bake
 * cost, a clock speed (to film a whole turn quickly) and a way to hold the cube at one
 * point of its turn (to compare the two renderers pixel for pixel).
 */
export const cubeStats: { bakeMs: number; frames: number; size: number; speed: number; hold: number | null; mode: CubeMode } = { bakeMs: 0, frames: 0, size: 0, speed: 1, hold: null, mode: 'start' };
if (import.meta.env.DEV) Object.assign(window, { __cubicCube: cubeStats });

/**
 * THE WORLD BEHIND THE MENUS: the cube itself, slowly turning, under the title, the mode
 * screen, the join popup and the side select. It is its own scene at the bottom of the
 * stage and is never stopped between menus, so the cube keeps turning while the screens
 * above it come and go. It also owns what is behind the cube (the sky of the title, the
 * white of the mode screen, the sky and the dark of the side select), because the cube
 * has to be drawn between those and the menus.
 *
 * The cube is drawn by the software renderer in client/src/cube from the real face maps,
 * once, into a strip of frames; after that a frame is one image.
 */
export class CubeBackdropScene extends Phaser.Scene {
  private mode: CubeMode = 'start';
  /** Time on the cube's own clock. Kept across rebuilds so a resize never restarts the turn. */
  private clock = 0;
  private built = false;
  private cube!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Image;
  private skyLayer!: Phaser.GameObjects.Container;
  private sideLayer!: Phaser.GameObjects.Container;
  private sky: Sky | null = null;
  private sideSky!: Sky;
  /** Where the cube is now (the bob is added on top of y). */
  private at = { x: 0, y: 0, alpha: 1, scale: 1 };
  private half = 0;

  constructor() {
    super('cube');
  }

  private get W(): number {
    return this.scale.width;
  }
  private get H(): number {
    return this.scale.height;
  }

  create(): void {
    const { W, H } = this;
    this.add.rectangle(0, 0, W, H, hex(ROLE.surface)).setOrigin(0, 0);
    this.skyLayer = this.add.container(0, 0);
    this.buildSky();

    // side select: sky over the outside half, the dark over the inside half
    const mid = Math.round(W / 2);
    this.sideSky = new Sky(this, 0, mid, H, [3, 2, 2, 1], 23);
    const dark = this.add.rectangle(mid, 0, W - mid, H, hex(ROLE.void)).setOrigin(0, 0);
    this.sideLayer = this.add.container(0, 0, [this.sideSky.back, this.sideSky.gradient, ...this.sideSky.clouds.map((c) => c.sprite), dark]);

    this.half = Math.min(MAX_HALF, Math.round((H * EDGE) / 2));
    this.shadow = this.add.image(0, 0, this.shadowTexture(this.half));
    this.cube = this.add.image(0, 0, this.spinTexture(this.half), 0);

    const rebuild = () => this.scene.restart();
    this.scale.on(Phaser.Scale.Events.RESIZE, rebuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, rebuild);
      this.built = false;
    });
    this.built = true;
    this.settle();
    this.scene.sendToBack();
    if (this.mode === 'off') this.scene.sleep(); // rebuilt by a resize during the game
  }

  /** The title's sky and its two far cloud layers; the near ones are StartScene's, in front of the cube. */
  private buildSky(): void {
    this.skyLayer.removeAll(true);
    this.sky = new Sky(this, 0, this.W, this.H, [5, 4, 0, 0]);
    this.skyLayer.add([this.sky.back, this.sky.gradient, ...this.sky.clouds.map((c) => c.sprite)]);
  }

  /** Where the cube rests behind each screen. */
  private rest(mode: CubeMode): Rest {
    const { W, H } = this;
    if (mode === 'mode') return { x: Math.round(W * 0.73), y: Math.round(H * 0.5), alpha: 0.9 };
    if (mode === 'side') return { x: Math.round(W / 2), y: Math.round(H * 0.52), alpha: 0.4 };
    return { x: Math.round(W / 2), y: Math.round(H * 0.52), alpha: 1 };
  }

  /** Put everything where the current mode has it, at once. */
  private settle(): void {
    this.tweens.killAll();
    Object.assign(this.at, this.rest(this.mode), { scale: 1 });
    this.skyLayer.setAlpha(this.mode === 'start' ? 1 : 0);
    this.sideLayer.setAlpha(this.mode === 'side' ? 1 : 0);
    this.place();
  }

  /**
   * Go behind another screen over `ms` (0 = at once). The cube glides to its place there;
   * it is the same cube, still turning.
   */
  show(mode: CubeMode, ms: number): void {
    const from = this.mode;
    this.mode = mode;
    if (mode === 'off') {
      if (this.built) this.scene.sleep();
      return;
    }
    if (!this.built) return; // create() will read this.mode
    if (this.scene.isSleeping()) this.scene.wake();
    if (mode === 'start' && from !== 'start') this.buildSky(); // the dive scattered its clouds
    if (ms <= 0 || from === 'off') {
      this.settle();
      return;
    }
    this.tweens.killAll();
    this.tweens.add({ targets: this.at, ...this.rest(mode), scale: 1, duration: ms, ease: EASE.inOut });
    this.tweens.add({ targets: this.skyLayer, alpha: mode === 'start' ? 1 : 0, duration: ms });
    this.tweens.add({ targets: this.sideLayer, alpha: mode === 'side' ? 1 : 0, duration: ms });
  }

  /**
   * Play was pressed: we fall through the clouds towards the cube. The far clouds part,
   * the sky thins to the white of the mode screen, the cube rushes up at us and then
   * settles where the mode screen keeps it. It never stops turning.
   */
  dive(ms: number): void {
    this.mode = 'mode';
    if (!this.built) return;
    const { W, H } = this;
    const cx = W / 2;
    const cy = H / 2;
    const to = this.rest('mode');
    this.tweens.killAll();
    if (settings().reduceMotion) {
      this.show('mode', ms / 2);
      this.mode = 'mode';
      return;
    }
    if (this.sky) {
      this.sky.speed = 0;
      for (const c of this.sky.clouds) {
        const s = c.sprite;
        const mx = s.x + s.width / 2;
        const my = s.y + s.height / 2;
        const depth = 1 + c.layer;
        const side = mx < cx ? -1 : 1;
        s.setOrigin(0.5, 0.5).setPosition(mx, my);
        this.tweens.add({ targets: s, x: mx + side * (W * 0.3 + Math.abs(mx - cx)) * depth, y: my + (my - cy) * depth, scale: 1 + depth, duration: ms, ease: EASE.in });
      }
    }
    this.tweens.add({ targets: this.skyLayer, alpha: 0, delay: ms * 0.45, duration: ms * 0.45 });
    // towards the cube, then it settles
    const near = ms * 0.55;
    this.tweens.add({ targets: this.at, scale: 1.5, duration: near, ease: EASE.in });
    this.tweens.add({ targets: this.at, ...to, scale: 1, delay: near, duration: ms - near, ease: EASE.out });
  }

  update(_time: number, delta: number): void {
    this.clock += delta * cubeStats.speed;
    cubeStats.mode = this.mode;
    if (this.mode === 'start') this.sky?.update(delta);
    if (this.mode === 'side') this.sideSky.update(delta);
    this.place();
  }

  private place(): void {
    const turn = cubeStats.hold ?? (this.clock % TURN_MS) / TURN_MS;
    this.cube.setFrame(Math.floor(turn * SPIN_FRAMES) % SPIN_FRAMES);
    // it hangs in the air: two pixels up and down, landing on whole pixels
    const bob = settings().reduceMotion || cubeStats.hold !== null ? 0 : Math.round(Math.sin(this.clock / 1100) * 2);
    const { x, y, alpha, scale } = this.at;
    this.cube.setPosition(Math.round(x), Math.round(y) + bob).setAlpha(alpha).setScale(scale);
    this.shadow.setPosition(Math.round(x), Math.round(y + this.half * 2.05 * scale)).setAlpha(alpha).setScale(scale);
  }

  /** The spin as one texture of frames. Baked once per cube size. */
  private spinTexture(half: number): string {
    const key = `cube-spin:${half}`;
    if (this.textures.exists(key)) return key;
    const art = (this.registry.get('cubeArt') as CubeArt | null) ?? null;
    const t0 = performance.now();
    const strip = bakeSpin(bakeFaces(art, 'out', texelFor(half * 2), true), half, pack(ROLE.ink));
    const n = strip.size;
    const cols = Math.max(1, Math.floor(ATLAS_MAX / n));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(cols, strip.count) * n;
    canvas.height = Math.ceil(strip.count / cols) * n;
    const g = canvas.getContext('2d')!;
    const bytes = new Uint8ClampedArray(strip.px.buffer);
    const frame = g.createImageData(n, n);
    for (let i = 0; i < strip.count; i++) {
      frame.data.set(bytes.subarray(i * n * n * 4, (i + 1) * n * n * 4));
      g.putImageData(frame, (i % cols) * n, Math.floor(i / cols) * n);
    }
    const texture = this.textures.addCanvas(key, canvas)!;
    for (let i = 0; i < strip.count; i++) texture.add(i, 0, (i % cols) * n, Math.floor(i / cols) * n, n, n);
    Object.assign(cubeStats, { bakeMs: Math.round(performance.now() - t0), frames: strip.count, size: n });
    return key;
  }

  /** A soft pixel shadow under the floating cube: solid in the middle, dithered out to nothing. */
  private shadowTexture(half: number): string {
    const key = `cube-shadow:${half}`;
    if (this.textures.exists(key)) return key;
    const w = Math.round(half * 2.6);
    const h = Math.max(6, Math.round(half * 0.42));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d')!;
    g.fillStyle = C.ink;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h / 2) / (h / 2));
        // three rings: full, checkerboard, one pixel in four
        const on = d < 0.55 ? true : d < 0.8 ? (x + y) % 2 === 0 : d < 1 ? x % 2 === 0 && y % 2 === 0 : false;
        if (on) g.fillRect(x, y, 1, 1);
      }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    g.fillRect(0, 0, w, h);
    this.textures.addCanvas(key, canvas);
    return key;
  }
}
