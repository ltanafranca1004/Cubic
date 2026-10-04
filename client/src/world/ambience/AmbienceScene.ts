import Phaser from 'phaser';
import { FACE_SIZE, TILE_PX, canonToScreen, defaultEnv, screenToCanon, type FaceId, type GameEvent, type GameState, type Side, type TileKind, type Vec } from '@cubic/shared';
import { asset } from '../../style/assets';
import { settings } from '../../style/settings';
import { C, FACE_STYLE, hex } from '../../style/tokens';
import { decorSpots, dressed, dripPoints, wadeAt } from '../biomes/decor';
import { propOnScreen, shownTick } from '../biomes/dress';
import { PROPS, PROP_COLS, PROP_SHEET, PROP_VEIL, PROP_W } from '../biomes/sheet';
import { FX, FX_CELL, FX_CLOUD, FX_SHEET } from './frames';
import { AmbienceLoops, dripSound, stepSound } from './loops';
import { Budget, LAND_TILES, besideSolid, effectCount, faceKey, facePlan, fleeVector, lightAt, pickTiles, shouldFlee, type EffectId, type FacePlan, type Motion, type Surface, type Tile } from './plan';

// THE LIVING WORLD. A scene on top of the game view that makes the face you are on feel
// alive: plants that sway, things that drift, small animals, dust under your feet and a
// quiet sound loop. It only looks and listens: no collision, no rules, no networking.
//
// It reads the game through the event bus (`cubic:state`, `cubic:event`) and never touches
// GameScene. Only the face being shown has effects; crossing an edge hides the layer for
// the turn of the cube and rebuilds it for the new face. Everything is drawn with plain
// images and rectangles at normal blend, in palette colours, so WebGL and Canvas match.
// What goes on which face, and how many, is decided in ./plan.ts.

const T = TILE_PX;
const W = FACE_SIZE * TILE_PX;
const SHEET = 'fx';
const CLOUD = 'fx-cloud';
/** The biome props, cut into tile-sized frames: a cell's upper half, then its lower half one row down. */
const BIOME = 'biome-props';
const VEIL = 'biome-veil';
const upperHalf = (cell: number) => Math.floor(cell / PROP_COLS) * 2 * PROP_COLS + (cell % PROP_COLS);
const lowerHalf = (cell: number) => upperHalf(cell) + PROP_COLS;
/** Hidden for this long after walking over an edge (the cube turn), then faded back in. */
const FLIP_HIDE_MS = 520;
const FADE_IN_MS = 220;
/** Standing still this long on the snow starts the breath puffs. */
const BREATH_AFTER_MS = 900;
const BREATH_EVERY_MS = 2600;

type Obj = Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;

/** One moving thing. `step` returns false when it is over; its objects are then destroyed. */
interface Part {
  objs: Obj[];
  step(dt: number, now: number): boolean;
  onDead?(): void;
}

/** A sprite that belongs to a tile. Hidden while the player stands on that tile. */
interface Decor {
  img: Phaser.GameObjects.Image;
  sx: number;
  sy: number;
}

interface Face {
  key: string;
  side: Side;
  face: FaceId;
  plan: FacePlan;
  motion: Motion;
  root: Phaser.GameObjects.Container;
  under: Phaser.GameObjects.Container;
  decorLayer: Phaser.GameObjects.Container;
  over: Phaser.GameObjects.Container;
  parts: Part[];
  budget: Budget;
  decor: Decor[];
  tickers: ((dt: number, now: number) => void)[];
  /** Free floor tiles in screen tile coords (no map object on them). */
  floor: Tile[];
  /** Where the birds on the ground are, in screen tiles (the dev hook reads it). */
  perched: (() => Tile | null)[];
  /** Footprints in the snow, oldest first. */
  prints: Phaser.GameObjects.Rectangle[][];
  /** What the biome layer draws over the player right now (the dev hook reads it). */
  overPlayer: { canopy: boolean; wade: boolean };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <X>(list: readonly X[]): X => list[Math.floor(Math.random() * list.length)]!;
const centre = (tile: number) => tile * T + T / 2;

/** Footstep dust per surface: two palette colours. */
const DUST: Record<Surface, [string, string]> = {
  grass: [C.green, C.greenDark],
  sand: [C.sandDark, C.lemon],
  snow: [C.skyLight, C.mist],
  leaves: [C.pine, C.copper],
  roof: [C.salmon, C.rose],
  stone: [C.silver, C.slate],
  room: [C.slate, C.silver],
};

export class AmbienceScene extends Phaser.Scene {
  private state: GameState | null = null;
  private me: Side = 'out';
  private current: Face | null = null;
  private loops = new AmbienceLoops();
  private hideUntil = 0;
  private steps = 0;
  /** The player on screen, in tiles, and when they last moved. */
  private player = { sx: 0, sy: 0, dir: 1, movedAt: 0, breathAt: 0, spot: '', fromX: 0, fromY: 0 };
  private frameMs = 0;

  constructor() {
    // active: it starts with the game (game/index.ts runs EXTRA_SCENES by key, not by class).
    super({ key: 'ambience', active: true });
  }

  preload(): void {
    this.load.spritesheet(SHEET, asset(FX_SHEET), { frameWidth: FX_CELL, frameHeight: FX_CELL });
    this.load.image(CLOUD, asset(FX_CLOUD));
    this.load.spritesheet(BIOME, asset(PROP_SHEET), { frameWidth: PROP_W, frameHeight: T });
    this.load.spritesheet(VEIL, asset(PROP_VEIL), { frameWidth: PROP_W, frameHeight: T });
  }

  create(): void {
    const onState = (state: GameState | null, me: Side) => {
      this.state = state;
      this.me = me;
    };
    const onEvent = (e: GameEvent) => {
      if (!('side' in e) || e.side !== this.me) return;
      if (e.type === 'flip') {
        this.hideUntil = this.time.now + FLIP_HIDE_MS;
        this.current?.root.setAlpha(0);
      } else if (e.type === 'step') this.steps++;
    };
    this.game.events.on('cubic:state', onState);
    this.game.events.on('cubic:event', onEvent);
    const off = () => {
      this.game.events.off('cubic:state', onState);
      this.game.events.off('cubic:event', onEvent);
      this.loops.set(null);
      this.clear();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    this.events.once(Phaser.Scenes.Events.DESTROY, off);
    if (import.meta.env.DEV) {
      // Dev only: the checks in tools/screens read how much is alive and what a frame costs.
      Object.assign(window, {
        __cubicAmbience: {
          stats: () => ({
            key: this.current?.key ?? null,
            effects: this.current?.plan.effects ?? [],
            parts: this.current?.parts.length ?? 0,
            cap: this.current?.plan.cap ?? 0,
            decor: this.current?.decor.length ?? 0,
            birds: (this.current?.perched ?? []).map((at) => at()).filter((t) => t !== null),
            canopy: this.current?.overPlayer.canopy ?? false,
            wade: this.current?.overPlayer.wade ?? false,
            prints: this.current?.prints.length ?? 0,
            tick: shownTick(),
            loop: this.loops.current,
            frameMs: this.frameMs,
            fps: this.game.loop.actualFps,
            renderer: this.game.renderer.type === Phaser.CANVAS ? 'canvas' : 'webgl',
          }),
        },
      });
    }
  }

  update(time: number, delta: number): void {
    const t0 = performance.now();
    const state = this.state;
    if (!state) {
      this.clear();
      this.loops.set(null);
      this.frameMs = 0;
      return;
    }
    const s = settings();
    const motion: Motion = { reduceMotion: s.reduceMotion, screenShake: s.screenShake };
    const pose = state.players[this.me].pose;
    const key = faceKey(this.me, pose.face, pose.up, motion);
    if (this.current?.key !== key) {
      this.clear();
      this.current = this.build(key, state, motion);
    }
    const face = this.current!;

    const [sx, sy] = canonToScreen(this.me, pose.face, pose.up, pose.x, pose.y);
    const spot = `${pose.face}:${pose.x},${pose.y}`;
    if (spot !== this.player.spot) Object.assign(this.player, { movedAt: time, fromX: this.player.sx, fromY: this.player.sy });
    Object.assign(this.player, { sx, sy, dir: pose.dir < 0 ? -1 : 1, spot });

    this.loops.set(face.plan.loop, face.plan.loopRate);
    this.loops.sync();

    // Hidden while the cube turns; nothing moves until it is back.
    if (time < this.hideUntil) {
      face.root.setAlpha(0);
      this.steps = 0;
      this.frameMs = performance.now() - t0;
      return;
    }
    face.root.setAlpha(Math.min(1, (time - this.hideUntil) / FADE_IN_MS));

    const dt = Math.min(delta, 50) / 1000;
    for (; this.steps > 0; this.steps--) this.footstep(face);
    for (const tick of face.tickers) tick(dt, time);
    for (let i = face.parts.length - 1; i >= 0; i--) {
      const part = face.parts[i]!;
      if (part.step(dt, time)) continue;
      this.kill(face, i);
    }
    for (const d of face.decor) d.img.setVisible(d.sx !== sx || d.sy !== sy);
    this.frameMs = performance.now() - t0;
  }

  // ----- the layer -----

  private clear(): void {
    this.current?.root.destroy();
    this.current = null;
  }

  private kill(face: Face, index: number): void {
    const [part] = face.parts.splice(index, 1);
    if (!part) return;
    for (const o of part.objs) o.destroy();
    face.budget.release();
    part.onDead?.();
  }

  /** Add a moving thing if the face's cap has room. `make` only runs when it does. */
  private spawn(face: Face, make: () => Part): boolean {
    if (!face.budget.take()) return false;
    face.parts.push(make());
    return true;
  }

  private image(layer: Phaser.GameObjects.Container, frame: number, x = 0, y = 0): Phaser.GameObjects.Image {
    const img = this.add.image(Math.round(x), Math.round(y), SHEET, frame);
    layer.add(img);
    return img;
  }

  private rect(layer: Phaser.GameObjects.Container, w: number, h: number, colour: string, alpha = 1, x = 0, y = 0): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(Math.round(x), Math.round(y), w, h, hex(colour), alpha).setOrigin(0, 0);
    layer.add(r);
    return r;
  }

  private build(key: string, state: GameState, motion: Motion): Face {
    const side = this.me;
    const { face: id, up } = state.players[side].pose;
    const plan = facePlan(side, id, motion);
    const map = defaultEnv.world[side][id];
    const root = this.add.container(0, 0);
    const under = this.add.container(0, 0);
    const decorLayer = this.add.container(0, 0);
    const over = this.add.container(0, 0);
    root.add([under, decorLayer, over]);

    const taken = new Set(map.objects.map((o) => `${o.x},${o.y}`));
    if (side === 'out') {
      // the biome layer has these tiles: nothing random grows on a pond or in the tall grass
      for (const s of decorSpots(id)) taken.add(`${s.x},${s.y}`);
      for (let y = 0; y < FACE_SIZE; y++) for (let x = 0; x < FACE_SIZE; x++) if (dressed(map.tiles, id, x, y)) taken.add(`${x},${y}`);
    }
    const isFree = (kind: TileKind, x: number, y: number) => kind === 'floor' && !taken.has(`${x},${y}`);
    const toScreen = (t: Tile): Tile => {
      const [x, y] = canonToScreen(side, id, up, t.x, t.y);
      return { x, y };
    };
    const face: Face = {
      key,
      side,
      face: id,
      plan,
      motion,
      root,
      under,
      decorLayer,
      over,
      parts: [],
      budget: new Budget(plan.cap),
      decor: [],
      tickers: [],
      floor: pickTiles(map.tiles, isFree, FACE_SIZE * FACE_SIZE, 1).map(toScreen),
      perched: [],
      prints: [],
      overPlayer: { canopy: false, wade: false },
    };

    /** Tiles for an effect, as screen tiles. Each decorated tile is used once. */
    const tilesFor = (effect: EffectId, want: (kind: TileKind, x: number, y: number) => boolean, seed: number): Tile[] => {
      const room = Math.max(0, plan.decorCap - face.decor.length);
      const found = pickTiles(map.tiles, (k, x, y) => !taken.has(`${x},${y}`) && want(k, x, y), Math.min(room, effectCount(effect, motion)), seed);
      for (const t of found) taken.add(`${t.x},${t.y}`);
      return found.map(toScreen);
    };
    const builders: Record<EffectId, () => void> = {
      tufts: () => this.plants(face, tilesFor('tufts', isFree, 11), [FX.tuft]),
      flowers: () => this.plants(face, tilesFor('flowers', isFree, 23), [FX.flowerPink, FX.flowerWhite]),
      butterflies: () => this.butterflies(face),
      wind: () => this.wind(face),
      sand: () => this.sand(face),
      shimmer: () => this.shimmer(face),
      tumbleweed: () => this.tumbleweed(face),
      snow: () => this.snow(face),
      breath: () => this.breath(face),
      iceSparkle: () => {
        const ice = pickTiles(map.tiles, (k) => k === 'water', FACE_SIZE * FACE_SIZE, 5);
        // No ice on this map: the snowy rocks glint instead.
        const spots = ice.length ? ice : pickTiles(map.tiles, (k) => k === 'wall', FACE_SIZE * FACE_SIZE, 5);
        this.sparkles(face, 'iceSparkle', spots.map(toScreen), 520);
      },
      waterGlints: () =>
        this.sparkles(
          face,
          'waterGlints',
          pickTiles(map.tiles, (k) => k === 'water', FACE_SIZE * FACE_SIZE, 7).map(toScreen),
          800,
        ),
      fireflies: () => this.fireflies(face),
      leaves: () => this.leaves(face),
      birds: () => this.birds(face),
      cloudShadows: () => this.cloudShadows(face),
      gulls: () => this.gulls(face),
      flags: () =>
        this.flags(
          face,
          tilesFor('flags', (k) => k === 'wall', 31),
        ),
      drips: () => this.drips(face),
      crystals: () =>
        this.crystals(
          face,
          tilesFor('crystals', (k, x, y) => isFree(k, x, y) && besideSolid(map.tiles, x, y), 41),
        ),
      motes: () => this.motes(face),
      wallLights: () =>
        this.wallLights(
          face,
          tilesFor('wallLights', (k) => k === 'wall', 53),
        ),
      tint: () => void this.rect(under, W, W, FACE_STYLE[id].base, 0.07),
      canopy: () => this.canopy(face, up),
      wade: () => this.wade(face, up),
      footprints: () => undefined, // left by footstep()
    };
    for (const effect of plan.effects) builders[effect]();
    return face;
  }

  private addDecor(face: Face, frame: number, t: Tile, dx = 0, dy = 0): Decor {
    const d: Decor = { img: this.image(face.decorLayer, frame, centre(t.x) + dx, centre(t.y) + dy), sx: t.x, sy: t.y };
    face.decor.push(d);
    return d;
  }

  // ----- 1 grass -----

  /** Tufts and flowers: a wave of wind runs across them, left to right. */
  private plants(face: Face, tiles: Tile[], kinds: readonly (readonly number[])[]): void {
    const plants = tiles.map((t, i) => ({ d: this.addDecor(face, kinds[i % kinds.length]![0]!, t, (i % 3) - 1, 0), frames: kinds[i % kinds.length]! }));
    if (face.motion.reduceMotion) return;
    face.tickers.push((_dt, now) => {
      for (const { d, frames } of plants) {
        const wave = Math.sin(now / 650 - d.sx * 0.8 + d.sy * 0.35);
        d.img.setFrame(frames[Math.min(frames.length - 1, Math.floor(((wave + 1) / 2) * frames.length))]!);
      }
    });
  }

  private butterflies(face: Face): void {
    for (let i = 0; i < effectCount('butterflies', face.motion); i++) {
      const frames = i % 2 ? FX.butterflyAmber : FX.butterflyViolet;
      let x = rnd(8, W - 8);
      let y = rnd(8, W - 8);
      let tx = x;
      let ty = y;
      let rest = rnd(0, 1.5);
      const phase = rnd(0, 6);
      this.spawn(face, () => {
        const img = this.image(face.over, frames[0], x, y);
        return {
          objs: [img],
          step: (dt, now) => {
            if (rest > 0) {
              rest -= dt;
              img.setFrame(frames[Math.floor(now / 420) % 2]!); // slow wings while it sits
              return true;
            }
            const d = Math.hypot(tx - x, ty - y);
            if (d < 2) {
              tx = rnd(8, W - 8);
              ty = rnd(8, W - 8);
              if (Math.random() < 0.35) rest = rnd(0.8, 2.2);
              return true;
            }
            x += ((tx - x) / d) * 18 * dt;
            y += ((ty - y) / d) * 18 * dt;
            img.setPosition(Math.round(x + Math.sin(now / 210 + phase) * 2), Math.round(y + Math.sin(now / 130 + phase) * 1.5));
            img.setFrame(frames[Math.floor(now / 110) % 2]!);
            return true;
          },
        };
      });
    }
  }

  /** A gust: a few pale streaks cross the meadow. */
  private wind(face: Face): void {
    let next = this.time.now + 1200;
    face.tickers.push((_dt, now) => {
      if (now < next) return;
      next = now + rnd(3200, 5600);
      const y0 = rnd(T, W - T * 3);
      for (let i = 0; i < effectCount('wind', face.motion); i++) {
        let x = -10 - i * 14;
        const y = y0 + i * rnd(9, 15);
        const speed = rnd(80, 100);
        this.spawn(face, () => {
          const r = this.rect(face.over, 7, 1, C.white, 0);
          return {
            objs: [r],
            step: (dt) => {
              x += speed * dt;
              r.setPosition(Math.round(x), Math.round(y + Math.sin(x / 14) * 2));
              r.setAlpha(0.5 * Math.sin((Math.PI * Phaser.Math.Clamp(x, 0, W)) / W));
              return x < W + 8;
            },
          };
        });
      }
    });
  }

  // ----- 2 desert -----

  private sand(face: Face): void {
    const want = effectCount('sand', face.motion);
    let alive = 0;
    const grain = (x: number) => {
      const y = rnd(0, W);
      const speed = rnd(38, 78);
      const phase = rnd(0, 6);
      const r = this.rect(face.over, Math.random() < 0.3 ? 2 : 1, 1, pick([C.lemon, C.white, C.sandDark]), rnd(0.5, 0.85));
      alive++;
      return {
        objs: [r],
        step: (dt: number) => {
          x += speed * dt;
          r.setPosition(Math.round(x), Math.round(y + Math.sin(x / 11 + phase) * 1.5));
          return x < W + 2;
        },
        onDead: () => void alive--,
      };
    };
    for (let i = 0; i < want; i++) this.spawn(face, () => grain(rnd(0, W)));
    face.tickers.push(() => {
      if (alive < want) this.spawn(face, () => grain(-2));
    });
  }

  /** Heat: short pale strips that tremble a pixel left and right and creep upwards. */
  private shimmer(face: Face): void {
    for (let i = 0; i < effectCount('shimmer', face.motion); i++) {
      let x = 0;
      let y = 0;
      let age = 0;
      let life = 0;
      const phase = rnd(0, 6);
      this.spawn(face, () => {
        const r = this.rect(face.over, 12, 1, C.lemon, 0);
        const reseed = () => {
          x = rnd(0, W - 16);
          y = rnd(T, W);
          age = 0;
          life = rnd(1.6, 3);
          r.setSize(Math.round(rnd(8, 18)), 1);
        };
        reseed();
        age = rnd(0, life);
        return {
          objs: [r],
          step: (dt, now) => {
            age += dt;
            if (age > life) reseed();
            y -= 4 * dt;
            r.setPosition(Math.round(x + Math.sin(now / 90 + phase) * 1.5), Math.round(y));
            r.setAlpha(0.3 * Math.sin((Math.PI * age) / life));
            return true;
          },
        };
      });
    }
  }

  private tumbleweed(face: Face): void {
    let next = this.time.now + 2500;
    face.tickers.push((_dt, now) => {
      if (now < next) return;
      next = now + rnd(8000, 14000);
      const dir = Math.random() < 0.8 ? 1 : -1;
      let x = dir > 0 ? -10 : W + 10;
      const y = rnd(T * 1.5, W - T);
      let age = 0;
      this.spawn(face, () => {
        const shadow = this.image(face.over, FX.shadow[0]).setAlpha(0.25);
        const img = this.image(face.over, FX.tumbleweed[0]);
        return {
          objs: [shadow, img],
          step: (dt) => {
            age += dt;
            x += dir * 42 * dt;
            const hop = Math.abs(Math.sin(age * 4.2)) * 5;
            img.setPosition(Math.round(x), Math.round(y - hop));
            img.setFrame(FX.tumbleweed[Math.floor(age * 7) % FX.tumbleweed.length]!);
            shadow.setPosition(Math.round(x), Math.round(y + 5));
            return x > -12 && x < W + 12;
          },
        };
      });
    });
  }

  // ----- 3 snow -----

  /**
   * Snow falls ONTO the ground: every flake has a spot it lands on, rests there for a
   * moment and melts away. Near flakes are bigger and faster than far ones, and every so
   * often a gust pushes them all sideways.
   */
  private snow(face: Face): void {
    for (let i = 0; i < effectCount('snow', face.motion); i++) {
      const near = i % 3 === 0;
      let x = rnd(0, W);
      let land = rnd(6, W);
      let y = rnd(-4, land);
      let rest = 0;
      const fall = near ? rnd(24, 34) : rnd(11, 19);
      const phase = rnd(0, 6);
      const size = near ? 2 : 1;
      this.spawn(face, () => {
        // The ground is white: a flake is drawn in the snow's own shadow tones, the near
        // ones with a white glint on them.
        const r = this.rect(face.over, size, size, near ? C.skyLight : pick([C.skyLight, C.silver, C.sky]), near ? 1 : rnd(0.6, 0.9));
        const glint = near ? this.rect(face.over, 1, 1, C.white) : null;
        return {
          objs: glint ? [r, glint] : [r],
          step: (dt, now) => {
            if (rest > 0) {
              // on the ground: one pixel that fades
              rest -= dt;
              r.setAlpha(Math.max(0, rest / 0.7));
              if (rest <= 0) {
                x = rnd(0, W);
                y = -3;
                land = rnd(6, W);
                r.setSize(size, size).setAlpha(near ? 1 : rnd(0.6, 0.9));
                glint?.setVisible(true);
              }
              return true;
            }
            const gust = Math.max(0, Math.sin(now / 2300)) ** 2;
            y += fall * dt;
            x += (Math.sin(now / 900 + phase) * 6 + 3 + gust * (near ? 26 : 14)) * dt;
            if (x > W) x -= W;
            if (y >= land) {
              y = land;
              rest = 0.7;
              r.setSize(1, 1);
              glint?.setVisible(false);
            }
            r.setPosition(Math.round(x), Math.round(y));
            glint?.setPosition(Math.round(x), Math.round(y));
            return true;
          },
        };
      });
    }
  }

  /** Stand still in the cold and your breath shows. */
  private breath(face: Face): void {
    face.tickers.push((_dt, now) => {
      const p = this.player;
      if (now - p.movedAt < BREATH_AFTER_MS || now - p.breathAt < BREATH_EVERY_MS) return;
      p.breathAt = now;
      let age = 0;
      const x = centre(p.sx) + p.dir * 7;
      const y = centre(p.sy) - 3;
      this.spawn(face, () => {
        const img = this.image(face.over, FX.puff[0], x, y);
        return {
          objs: [img],
          step: (dt) => {
            age += dt;
            const k = age / 1.1;
            img.setFrame(FX.puff[Math.min(FX.puff.length - 1, Math.floor(k * FX.puff.length))]!);
            img.setPosition(Math.round(x + p.dir * k * 4), Math.round(y - k * 5));
            img.setAlpha(1 - k * 0.7);
            return k < 1;
          },
        };
      });
    });
  }

  /** A glint now and then on one of `spots` (ice, wet rock, water). */
  private sparkles(face: Face, effect: EffectId, spots: Tile[], everyMs: number): void {
    if (!spots.length) return;
    const want = effectCount(effect, face.motion);
    const order = [0, 1, 2, 1, 0];
    let alive = 0;
    let next = this.time.now + 300;
    face.tickers.push((_dt, now) => {
      if (now < next || alive >= want) return;
      next = now + rnd(everyMs * 0.6, everyMs * 1.4);
      const t = pick(spots);
      let age = 0;
      this.spawn(face, () => {
        alive++;
        const img = this.image(face.over, FX.sparkle[0], centre(t.x) + rnd(-5, 5), centre(t.y) + rnd(-6, 3));
        return {
          objs: [img],
          step: (dt) => {
            age += dt;
            const i = Math.floor(age / 0.11);
            if (i < order.length) img.setFrame(FX.sparkle[order[i]!]!);
            return i < order.length;
          },
          onDead: () => void alive--,
        };
      });
    });
  }

  // ----- 4 forest -----

  private fireflies(face: Face): void {
    for (let i = 0; i < effectCount('fireflies', face.motion); i++) {
      let x = rnd(6, W - 6);
      let y = rnd(6, W - 6);
      let heading = rnd(0, Math.PI * 2);
      const phase = rnd(0, 6);
      this.spawn(face, () => {
        const halo = this.rect(face.over, 3, 3, C.lime, 0);
        const core = this.rect(face.over, 1, 1, C.lemon, 0);
        return {
          objs: [halo, core],
          step: (dt, now) => {
            heading += rnd(-1.8, 1.8) * dt;
            x = Phaser.Math.Wrap(x + Math.cos(heading) * 7 * dt, 0, W);
            y = Phaser.Math.Wrap(y + Math.sin(heading) * 7 * dt, 0, W);
            const glow = Math.max(0, Math.sin(now / 520 + phase));
            core.setPosition(Math.round(x), Math.round(y)).setAlpha(0.25 + 0.75 * glow);
            halo.setPosition(Math.round(x) - 1, Math.round(y) - 1).setAlpha(0.3 * glow);
            return true;
          },
        };
      });
    }
  }

  private leaves(face: Face): void {
    const want = effectCount('leaves', face.motion);
    let alive = 0;
    let next = 0;
    face.tickers.push((_dt, now) => {
      if (now < next || alive >= want) return;
      next = now + rnd(500, 1300);
      const frames = Math.random() < 0.6 ? FX.leaf : FX.leafGreen;
      const x0 = rnd(4, W - 4);
      let y = -4;
      const land = rnd(T, W - 4);
      const fall = rnd(12, 20);
      const phase = rnd(0, 6);
      let rest = 0;
      this.spawn(face, () => {
        alive++;
        const img = this.image(face.over, frames[0], x0, y);
        return {
          objs: [img],
          step: (dt, t) => {
            if (y >= land) {
              // on the ground: lie there, then fade
              rest += dt;
              img.setAlpha(1 - Math.max(0, rest - 1.2) / 0.6);
              return rest < 1.8;
            }
            y += fall * dt;
            img.setPosition(Math.round(x0 + Math.sin(t / 420 + phase) * 6), Math.round(y));
            img.setFrame(frames[Math.floor(t / 240 + phase) % frames.length]!);
            return true;
          },
          onDead: () => void alive--,
        };
      });
    });
  }

  /** Small birds hop about on the floor and take off when the player walks near. */
  private birds(face: Face): void {
    const farFromPlayer = (): Tile | null => {
      const far = face.floor.filter((t) => Math.hypot(t.x - this.player.sx, t.y - this.player.sy) >= LAND_TILES);
      return far.length ? pick(far) : null;
    };
    for (let i = 0; i < effectCount('birds', face.motion); i++) {
      type Mode = 'ground' | 'flee' | 'away' | 'land';
      let mode: Mode = 'away';
      let timer = rnd(0.2, 1.6) + i;
      let x = 0;
      let y = 0;
      let vx = 0;
      let vy = 0;
      let home: Tile = { x: 0, y: 0 };
      let hop = 0;
      face.perched.push(() => (mode === 'ground' ? home : null));
      this.spawn(face, () => {
        const img = this.image(face.over, FX.birdHop[0]).setVisible(false);
        return {
          objs: [img],
          step: (dt, now) => {
            timer -= dt;
            if (mode === 'away') {
              if (timer > 0) return true;
              const spot = farFromPlayer();
              if (!spot) {
                timer = 1;
                return true;
              }
              // fly in from above, off the nearer side
              home = spot;
              const from = spot.x < FACE_SIZE / 2 ? -1 : 1;
              x = centre(spot.x) + from * T * 4;
              y = centre(spot.y) - T * 5;
              mode = 'land';
              timer = 0.9;
              vx = (centre(spot.x) - x) / timer;
              vy = (centre(spot.y) - y) / timer;
              img.setVisible(true);
            } else if (mode === 'land') {
              x += vx * dt;
              y += vy * dt;
              if (timer <= 0) {
                mode = 'ground';
                x = centre(home.x);
                y = centre(home.y);
                timer = rnd(0.6, 2);
              }
            } else if (mode === 'ground') {
              if (shouldFlee({ x: x / T - 0.5, y: y / T - 0.5 }, { x: this.player.sx, y: this.player.sy })) {
                const away = fleeVector({ x: x / T - 0.5, y: y / T - 0.5 }, { x: this.player.sx, y: this.player.sy });
                mode = 'flee';
                vx = away.x * 95;
                vy = away.y * 95;
              } else if (timer <= 0) {
                // a little hop inside its tile
                timer = rnd(0.5, 2.4);
                hop = 0.14;
                vx = pick([-1, 1]);
                x = Phaser.Math.Clamp(x + vx * 2, centre(home.x) - 4, centre(home.x) + 4);
              }
              hop = Math.max(0, hop - dt);
            } else {
              x += vx * dt;
              y += vy * dt;
              if (y < -10 || x < -10 || x > W + 10) {
                mode = 'away';
                timer = rnd(5, 9);
                img.setVisible(false);
              }
            }
            const flying = mode === 'flee' || mode === 'land';
            img.setFrame(flying ? FX.birdFly[Math.floor(now / 90) % 2]! : FX.birdHop[hop > 0 ? 1 : 0]);
            img.setFlipX(vx < 0);
            img.setPosition(Math.round(x), Math.round(y - (hop > 0 ? 2 : 0)));
            return true;
          },
        };
      });
    }
  }

  // ----- 5 rooftop -----

  private cloudShadows(face: Face): void {
    for (let i = 0; i < effectCount('cloudShadows', face.motion); i++) {
      let x = rnd(-40, W);
      let y = rnd(10, W - 10);
      const speed = 5 + i * 3;
      this.spawn(face, () => {
        const img = this.add.image(0, 0, CLOUD).setAlpha(0.13).setFlipX(i % 2 === 1);
        face.under.add(img);
        return {
          objs: [img],
          step: (dt) => {
            x += speed * dt;
            if (x > W + 30) {
              x = -30;
              y = rnd(10, W - 10);
            }
            img.setPosition(Math.round(x), Math.round(y));
            return true;
          },
        };
      });
    }
  }

  /** A few gulls cross high above; their shadows follow on the roof. */
  private gulls(face: Face): void {
    let next = this.time.now + 1500;
    face.tickers.push((_dt, now) => {
      if (now < next) return;
      next = now + rnd(5000, 9000);
      const dir = pick([-1, 1]);
      const y0 = rnd(T, W - T * 3);
      const climb = rnd(-10, 10);
      const flock = 1 + Math.floor(Math.random() * effectCount('gulls', face.motion));
      for (let i = 0; i < flock; i++) {
        let x = dir > 0 ? -8 - i * 11 : W + 8 + i * 11;
        let y = y0 + i * 7 * (i % 2 ? 1 : -1);
        this.spawn(face, () => {
          const shadow = this.image(face.over, FX.shadow[0]).setAlpha(0.18);
          const img = this.image(face.over, FX.gull[0]).setFlipX(dir < 0);
          return {
            objs: [shadow, img],
            step: (dt, t) => {
              x += dir * 58 * dt;
              y += climb * dt;
              img.setPosition(Math.round(x), Math.round(y));
              img.setFrame(FX.gull[Math.floor(t / 180 + i) % 2]!);
              shadow.setPosition(Math.round(x + 6), Math.round(y + 14));
              return x > -40 && x < W + 40;
            },
          };
        });
      }
    });
  }

  private flags(face: Face, tiles: Tile[]): void {
    const flags = tiles.map((t) => this.addDecor(face, FX.flag[0], t, 3, -8));
    if (face.motion.reduceMotion) return;
    face.tickers.push((_dt, now) => {
      flags.forEach((d, i) => d.img.setFrame(FX.flag[Math.floor(now / 170 + i) % FX.flag.length]!));
    });
  }

  // ----- 6 cave -----

  /** A drop falls from the ceiling and splashes on the floor. */
  private drips(face: Face): void {
    const want = effectCount('drips', face.motion);
    // The roof leaks in the same places every time: onto the puddles and into the pool
    // (world/biomes/decor.ts). A face with no such places drips anywhere.
    const map = defaultEnv.world[face.side][face.face];
    const { up } = this.state!.players[face.side].pose;
    const points = dripPoints(map.tiles, face.face).map((p) => {
      const [x, y] = canonToScreen(face.side, face.face, up, p.x, p.y);
      return { x, y, water: p.water };
    });
    let alive = 0;
    let next = this.time.now + 600;
    let turn = 0;
    face.tickers.push((_dt, now) => {
      if (now < next || alive >= want || (!points.length && !face.floor.length)) return;
      next = now + rnd(450, 1500);
      const point = points.length ? points[turn++ % points.length]! : null;
      const t = point ?? pick(face.floor);
      const water = point?.water ?? false;
      const x = centre(t.x) + (point ? 0 : Math.round(rnd(-4, 4)));
      const ground = point ? t.y * T + 10 : centre(t.y) + Math.round(rnd(-2, 5));
      // in water the drop spreads into a ring, on rock it splashes
      const frames: readonly number[] = water ? PROPS.ripple.map(lowerHalf) : FX.splash;
      let age = 0;
      let heard = false;
      this.spawn(face, () => {
        alive++;
        const drop = this.rect(face.over, 1, 2, C.skyLight, 0.9);
        const splash = water ? this.add.image(t.x * T, t.y * T, BIOME, frames[0]).setOrigin(0, 0).setVisible(false) : this.image(face.over, frames[0]!, x, ground - 6).setVisible(false);
        if (water) face.over.add(splash);
        return {
          objs: [drop, splash],
          step: (dt) => {
            age += dt;
            const fall = age / 0.38;
            if (fall < 1) {
              drop.setPosition(x, Math.round(ground - 26 * (1 - fall * fall)));
              return true;
            }
            drop.setVisible(false);
            if (!heard) {
              heard = true;
              if (point) dripSound(water);
            }
            const i = Math.floor((age - 0.38) / (water ? 0.16 : 0.09));
            if (i < frames.length) splash.setVisible(true).setFrame(frames[i]!);
            return i < frames.length;
          },
          onDead: () => void alive--,
        };
      });
    });
  }

  /** Crystal shards at the foot of the rocks, breathing light. */
  private crystals(face: Face, tiles: Tile[]): void {
    const shards = tiles.map((t, i) => ({
      glow: this.rect(face.under, 11, 8, C.aqua, 0, centre(t.x) - 5 + ((i % 3) - 1) * 3, centre(t.y)),
      d: this.addDecor(face, FX.shard[1], t, ((i % 3) - 1) * 3, 0),
      phase: i * 1.7,
    }));
    face.tickers.push((_dt, now) => {
      for (const { glow, d, phase } of shards) {
        const pulse = face.motion.reduceMotion ? 0.5 : (Math.sin(now / 760 + phase) + 1) / 2;
        d.img.setFrame(FX.shard[Math.min(2, Math.floor(pulse * 3))]!);
        glow.setAlpha(d.img.visible ? 0.08 + 0.22 * pulse : 0);
      }
    });
  }

  // ----- inside -----

  /** Dust in the player's light: it fades into the dark with distance, like the room does. */
  private motes(face: Face): void {
    const colour = FACE_STYLE[face.face].ramp.light;
    for (let i = 0; i < effectCount('motes', face.motion); i++) {
      let x = rnd(0, W);
      let y = rnd(0, W);
      const vx = rnd(-3, 3);
      const vy = rnd(-5, -1.5);
      const phase = rnd(0, 6);
      this.spawn(face, () => {
        const r = this.rect(face.over, 1, 1, colour, 0);
        return {
          objs: [r],
          step: (dt, now) => {
            x = Phaser.Math.Wrap(x + (vx + Math.sin(now / 1300 + phase) * 2) * dt, 0, W);
            y = Phaser.Math.Wrap(y + vy * dt, 0, W);
            const light = lightAt(Math.hypot(x / T - 0.5 - this.player.sx, y / T - 0.5 - this.player.sy));
            r.setPosition(Math.round(x), Math.round(y));
            r.setAlpha(light * (0.35 + 0.45 * (0.5 + 0.5 * Math.sin(now / 700 + phase))));
            return true;
          },
        };
      });
    }
  }

  /** A small lamp on some of the walls, burning in the room's colour. It gutters. */
  private wallLights(face: Face, tiles: Tile[]): void {
    const frames = FX[`sconce${face.face}`];
    const colour = FACE_STYLE[face.face].base;
    const lamps = tiles.map((t) => ({
      t,
      glow: this.rect(face.under, T + 6, T + 6, colour, 0, t.x * T - 3, t.y * T - 3),
      d: this.addDecor(face, frames[0], t, 0, -1),
      next: 0,
      level: 1,
    }));
    face.tickers.push((_dt, now) => {
      for (const lamp of lamps) {
        if (!face.motion.reduceMotion && now >= lamp.next) {
          lamp.next = now + rnd(90, 260);
          lamp.level = rnd(0.6, 1);
          lamp.d.img.setFrame(pick(frames));
        }
        // A lamp still shows in the dark, only dimmer.
        const seen = 0.3 + 0.7 * lightAt(Math.hypot(lamp.t.x - this.player.sx, lamp.t.y - this.player.sy));
        lamp.d.img.setAlpha(seen);
        lamp.glow.setAlpha(0.14 * lamp.level * seen);
      }
    });
  }

  // ----- the biome layer -----

  /**
   * A tree's crown hangs over the tile behind it. The crown is part of the painted face,
   * so the character (a sprite on top of the face) would walk over it: this draws every
   * other pixel of it once more, over the character, while they stand behind a tall prop.
   * They are behind the leaves and still easy to find.
   */
  private canopy(face: Face, up: Vec): void {
    // half strength: a green turtle behind a green crown has to stay easy to see
    const img = this.add.image(0, 0, VEIL, 0).setOrigin(0, 0).setAlpha(0.5).setVisible(false);
    face.root.add(img);
    face.tickers.push(() => {
      const { sx, sy } = this.player;
      const p = propOnScreen(face.face, up, sx, sy + 1, shownTick(), face.motion.reduceMotion);
      img.setVisible(!!p?.tall);
      face.overPlayer.canopy = !!p?.tall;
      if (p?.tall) img.setFrame(upperHalf(p.cell)).setPosition(sx * T, sy * T);
    });
  }

  /** Tall grass closes over the turtle's feet, and shakes for a moment when they walk in. */
  private wade(face: Face, up: Vec): void {
    const tiles = defaultEnv.world[face.side][face.face].tiles;
    const img = this.add.image(0, 0, BIOME, lowerHalf(PROPS.grassFront[1]!)).setOrigin(0, 0).setVisible(false);
    face.root.add(img);
    let spot = '';
    let shakeUntil = 0;
    face.tickers.push((_dt, now) => {
      const p = this.player;
      const [x, y] = screenToCanon(face.side, face.face, up, p.sx, p.sy);
      const inGrass = wadeAt(tiles, face.face, x, y);
      img.setVisible(inGrass);
      face.overPlayer.wade = inGrass;
      if (!inGrass) {
        spot = '';
        return;
      }
      if (spot !== p.spot) {
        spot = p.spot;
        if (!face.motion.reduceMotion) {
          shakeUntil = now + 360;
          this.rustle(face, p.sx, p.sy);
        }
      }
      // left, right, left, then upright again
      const frame = now < shakeUntil ? (Math.floor((shakeUntil - now) / 90) % 2 ? 0 : 2) : 1;
      img.setFrame(lowerHalf(PROPS.grassFront[frame]!)).setPosition(p.sx * T, p.sy * T);
    });
  }

  /** A few blades thrown up out of the grass. */
  private rustle(face: Face, sx: number, sy: number): void {
    for (let i = 0; i < 3; i++) {
      let x = centre(sx) + rnd(-5, 5);
      let y = sy * T + rnd(6, 11);
      const vx = rnd(-22, 22);
      let vy = rnd(-44, -24);
      let age = 0;
      this.spawn(face, () => {
        const r = this.rect(face.over, 1, 2, i % 2 ? C.lime : C.green);
        return {
          objs: [r],
          step: (dt) => {
            age += dt;
            vy += 150 * dt;
            x += vx * dt;
            y += vy * dt;
            r.setPosition(Math.round(x), Math.round(y)).setAlpha(1 - age / 0.45);
            return age < 0.45;
          },
        };
      });
    }
  }

  /** The print a step leaves in the snow: two toes where the player just stood. The oldest goes when there are too many. */
  private footprint(face: Face): void {
    const max = effectCount('footprints', face.motion);
    const x = this.player.fromX * T + 5;
    const y = this.player.fromY * T + 11;
    face.prints.push([this.rect(face.under, 2, 2, C.skyLight, 1, x, y), this.rect(face.under, 2, 2, C.skyLight, 1, x + 4, y + 1)]);
    while (face.prints.length > max) for (const d of face.prints.shift()!) d.destroy();
    // the trail fades towards its old end
    face.prints.forEach((dots, i) => dots.forEach((d) => d.setAlpha((i + 1 + max - face.prints.length) / max)));
  }

  // ----- the player -----

  /** Dust (or snow, or leaf bits) kicked up by a step, and its sound. */
  private footstep(face: Face): void {
    const surface = face.plan.surface;
    stepSound(surface);
    if (face.plan.effects.includes('footprints')) this.footprint(face);
    const colours = DUST[surface];
    const x0 = centre(this.player.sx);
    const y0 = this.player.sy * T + T - 2;
    for (let i = 0; i < (face.motion.reduceMotion ? 1 : 3); i++) {
      let x = x0 + rnd(-3, 3);
      let y = y0;
      const vx = rnd(-16, 16);
      let vy = rnd(-26, -12);
      let age = 0;
      this.spawn(face, () => {
        const r = this.rect(face.over, 1, 1, colours[i % 2]!, 0.9);
        return {
          objs: [r],
          step: (dt) => {
            age += dt;
            vy += 90 * dt;
            x += vx * dt;
            y = Math.min(y0 + 1, y + vy * dt);
            r.setPosition(Math.round(x), Math.round(y));
            r.setAlpha(0.9 * (1 - age / 0.36));
            return age < 0.36;
          },
        };
      });
    }
  }
}
