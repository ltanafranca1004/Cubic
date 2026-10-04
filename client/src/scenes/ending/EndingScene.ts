import Phaser from 'phaser';
import { FACES, FACE_SIZE, SIDES, TILE_PX, type FaceId, type Side } from '@cubic/shared';
import { bakeFaces, type CubeArt } from '../../cube/faces';
import { texelFor } from '../../cube/layout';
import { apply, type V3 } from '../../cube/mat';
import { clearDepthTarget, createDepthTarget, drawQuad, drawSprite, outline, pack, shadeBox, type CubeFaces, type DepthTarget, type FaceTex, type SpritePx } from '../../cube/raster';
import { faceShots, type FaceShots } from '../../game/shots';
import type { PlayerFrames } from '../../game/turtle';
import { settings } from '../../style/settings';
import { C, FACE_HUD, ROLE, hex } from '../../style/tokens';
import { Sky } from '../clouds';
import { ctxOf } from '../flow';
import { seeded } from '../kit';
import { ending } from './run';
import { endingFrame, endingLayout, endingView, netQuads, projectPoint, turtleLook, turtlePoint, turtleScale, type EndingFrame, type EndingLayout } from './timeline';

// THE ENDING ("Passed cube 1!"), on the stage: the full window, behind the DOM. It only
// draws what ./timeline.ts says for the time ./run.ts gives: the sky (the same one the
// outside player has behind the HUD), the grass, and on it the cube, opening.
//
// The cube and the two turtles are drawn by the software rasterizer of client/src/cube
// (cube/raster.ts: drawQuad, drawSprite) into one buffer of whole pixels, shown as one
// canvas texture: the same picture under WebGL and under Canvas. Its faces are the real
// ones, painted by the game scene as they are at the win (game/shots.ts): the outside of
// every wall, and the inside, which is what lies face up once the cube is flat.

const BUFFER_KEY = 'ending:cube';
const GROUND_KEY = 'ending:ground';
const INK = pack(ROLE.ink);
/** From above and in front: what lies on the grass is in full light, the wall towards us a little less. */
const LIGHT: V3 = [-0.25, 0.55, 0.8];
/** How much of its biome colour a face takes at the top of the flash. */
const FLASH = 0.7;
/** The turtle's sprite: a tile, standing on the point two pixels above its bottom edge. */
const FEET_PX = 14;
/** A sprite is this much nearer the camera than the ground it stands on (half cube edges). */
const NEARER = 0.35;
const Q = Math.PI / 2;

/**
 * How much of its biome's colour a room takes once daylight falls into it. The six rooms
 * are the same dark stone: without it the flat cube is a dark cross with six faces nobody
 * can tell apart (the HUD cube tints its rooms for the same reason, cube/faces.ts).
 */
const DAYLIGHT = 0.4;

/** Mix `tint` (packed) into every pixel of a texture, by `amount` 0..1. */
function tinted(tex: FaceTex, tint: number, amount: number): FaceTex {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  for (let i = 0; i < tex.px.length; i++) {
    const p = tex.px[i]!;
    tex.px[i] = (0xff000000 | (mix((p >>> 16) & 0xff, (tint >>> 16) & 0xff) << 16) | (mix((p >>> 8) & 0xff, (tint >>> 8) & 0xff) << 8) | mix(p & 0xff, tint & 0xff)) >>> 0;
  }
  return tex;
}

/** The faces of the run being shown: painted once, when it starts. */
let shot: { run: number; faces: FaceShots | null } | null = null;
/** Dev tools: hold the timeline at this time (ms) instead of the clock. */
let hold: number | null = null;

/** A painted face as a texture of `size` texels a side, cut down with nearest neighbour. */
function texOf(source: HTMLCanvasElement, size: number): FaceTex {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.drawImage(source, 0, 0, source.width, source.height, 0, 0, size, size);
  const px = new Uint32Array(g.getImageData(0, 0, size, size).data.buffer);
  for (let i = 0; i < px.length; i++) px[i] = (px[i]! | 0xff000000) >>> 0;
  return { size, px };
}

export class EndingScene extends Phaser.Scene {
  private layout!: EndingLayout;
  private side: Side = 'out';
  private sky!: Sky;
  private dark!: Phaser.GameObjects.Rectangle;
  private veil!: Phaser.GameObjects.Rectangle;
  private buffer!: Phaser.Textures.CanvasTexture;
  private target!: DepthTarget;
  private image!: ImageData;
  private faces: Record<Side, CubeFaces> | null = null;
  private sprites = new Map<string, SpritePx>();
  /** The cube lying flat, drawn once: after the unfolding only the turtles move. */
  private flat: { px: Uint32Array; depth: Float32Array } | null = null;
  private run = 0;

  constructor() {
    super('ending');
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const L = (this.layout = endingLayout(W, H));
    this.side = ctxOf(this).state.side ?? 'out';
    this.faces = null;
    this.flat = null;
    this.run = 0;

    this.sky = new Sky(this, 0, W, L.horizon, [4, 3, 2, 0], 41);
    this.sky.speed = 0.6;
    this.paintGround(W, H - L.horizon);
    this.add.image(0, L.horizon, GROUND_KEY).setOrigin(0, 0);
    // the inside player comes out of the dark: it lifts as the cube opens
    this.dark = this.add.rectangle(0, 0, W, H, hex(ROLE.void)).setOrigin(0, 0).setVisible(false);

    if (this.textures.exists(BUFFER_KEY)) this.textures.remove(BUFFER_KEY);
    this.buffer = this.textures.createCanvas(BUFFER_KEY, W, H)!;
    this.target = createDepthTarget(W, H);
    this.image = this.buffer.context.createImageData(W, H);
    this.add.image(0, 0, BUFFER_KEY).setOrigin(0, 0);
    this.veil = this.add.rectangle(0, 0, W, H, hex(C.white)).setOrigin(0, 0).setVisible(false);

    // a new window size is a new layout: build it again (the run and its faces are kept)
    const rebuild = () => this.scene.restart();
    this.scale.on(Phaser.Scale.Events.RESIZE, rebuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, rebuild));

    if (import.meta.env.DEV) {
      Object.assign(window, {
        /** What the ending shows now (tools/screens), a way to hold it at a time, and to play it again. */
        __cubicEnding: () => {
          const t = hold ?? ending.time();
          return { run: ending.current, elapsed: ending.elapsed(), t, card: ending.card, phase: t === null ? null : endingFrame(t, settings().reduceMotion).phase, layout: this.layout, side: this.side, faces: shot?.faces ? 'game' : 'start' };
        },
        __cubicEndingHold: (t: number | null) => {
          hold = t;
        },
        __cubicEndingReplay: () => ending.replay(settings().reduceMotion),
      });
    }
    this.frame();
  }

  update(_time: number, delta: number): void {
    this.sky.update(settings().reduceMotion ? 0 : delta);
    this.frame();
  }

  /** The grass: one colour, a darker band where it meets the sky, and tufts. Painted once. */
  private paintGround(width: number, height: number): void {
    if (this.textures.exists(GROUND_KEY)) this.textures.remove(GROUND_KEY);
    const texture = this.textures.createCanvas(GROUND_KEY, width, Math.max(1, height))!;
    const g = texture.context;
    g.fillStyle = C.grass;
    g.fillRect(0, 0, width, height);
    g.fillStyle = C.greenDark;
    g.fillRect(0, 0, width, 1);
    g.fillStyle = C.green;
    g.fillRect(0, 1, width, 2);
    const rnd = seeded(23);
    for (let i = 0; i < (width * height) / 260; i++) {
      const x = Math.floor(rnd() * (width - 4));
      const y = 4 + Math.floor(rnd() * Math.max(1, height - 8));
      if (rnd() < 0.35) {
        g.fillStyle = C.grassLight;
        g.fillRect(x, y, 2, 1);
      } else {
        // a tuft: three blades
        g.fillStyle = C.green;
        g.fillRect(x, y + 1, 1, 2);
        g.fillRect(x + 1, y, 1, 3);
        g.fillRect(x + 2, y + 1, 1, 2);
      }
    }
    texture.refresh();
  }

  /** The twelve face textures of this run: the game's own faces, or the start-of-game ones when there is no game view. */
  private loadFaces(run: number): void {
    if (shot?.run !== run) shot = { run, faces: faceShots() };
    const size = FACE_SIZE * texelFor(this.layout.half * 2);
    const faces = { out: {}, in: {} } as Record<Side, CubeFaces>;
    const art = (this.registry.get('cubeArt') as CubeArt | null | undefined) ?? null;
    for (const side of SIDES) {
      const baked = shot.faces ? null : bakeFaces(art, side, size / FACE_SIZE);
      for (const face of FACES) {
        const tex = shot.faces ? texOf(shot.faces[side][face], size) : { size: baked![face].size, px: baked![face].px.slice() };
        faces[side][face] = side === 'in' ? tinted(tex, pack(FACE_HUD[face].out), DAYLIGHT) : tex;
      }
    }
    this.faces = faces;
    this.flat = null;
  }

  /** One frame of a turtle's sheet as pixels. Without the sheet: a block in the side's colour. */
  private sprite(side: Side, index: number): SpritePx {
    const key = `${side}:${index}`;
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    const art = this.registry.get('cubeArt') as CubeArt | null | undefined;
    const entry = art?.manifest.players?.[side];
    const sheet = entry && art?.sheets.get(entry.image);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_PX;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    if (sheet) {
      const cols = Math.floor(sheet.width / TILE_PX);
      g.drawImage(sheet, (index % cols) * TILE_PX, Math.floor(index / cols) * TILE_PX, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
    } else {
      g.fillStyle = ROLE.ink;
      g.fillRect(3, 3, 10, 11);
      g.fillStyle = side === 'out' ? ROLE.out.base : ROLE.in.base;
      g.fillRect(4, 4, 8, 9);
    }
    sprite = { width: TILE_PX, height: TILE_PX, px: new Uint32Array(g.getImageData(0, 0, TILE_PX, TILE_PX).data.buffer) };
    this.sprites.set(key, sprite);
    return sprite;
  }

  /** Draw the moment the run is at. */
  private frame(): void {
    const run = ending.current;
    const t = hold ?? ending.time();
    if (!run || t === null) return;
    if (run.id !== this.run || !this.faces) {
      this.run = run.id;
      this.loadFaces(run.id);
    }
    const frame = endingFrame(t, settings().reduceMotion);
    this.dark.setVisible(this.side === 'in' && frame.darkness > 0).setAlpha(frame.darkness);
    this.veil.setVisible(frame.veil > 0).setAlpha(frame.veil * 0.85);
    this.draw(frame);
  }

  private draw(frame: EndingFrame): void {
    const t = this.target;
    const L = this.layout;
    const faces = this.faces!;
    const view = endingView(frame.yaw);
    const flat = frame.yaw === 0 && frame.flash === 0 && frame.lid === Q && FACES.every((f) => f > 4 || frame.walls[f as 1 | 2 | 3 | 4] === Q);
    if (flat && this.flat) {
      t.px.set(this.flat.px);
      t.depth.set(this.flat.depth);
    } else {
      clearDepthTarget(t);
      const o = { cx: L.cx, cy: L.cy, half: L.half, light: LIGHT, ambient: 0.7 };
      for (const q of netQuads(frame)) {
        const face: FaceId = q.face;
        drawQuad(t, { id: face, c: apply(view, q.c), r: apply(view, q.r), u: apply(view, q.u), n: apply(view, q.n), tex: faces.out[face], back: faces.in[face], tint: pack(FACE_HUD[face].out), amount: frame.flash * FLASH }, o);
      }
      outline(t, INK);
      if (flat) this.flat = { px: t.px.slice(), depth: t.depth.slice() };
    }
    const entries = (this.registry.get('cubeArt') as CubeArt | null | undefined)?.manifest.players as Partial<Record<Side, PlayerFrames>> | undefined;
    const k = turtleScale(L);
    for (const side of SIDES) {
      const turtle = frame.turtles[side];
      const entry = entries?.[side];
      const look = entry ? turtleLook(entry, turtle) : { index: 0, flip: turtle.facing === 'left' };
      const at = turtlePoint(view, L, turtle);
      if (turtle.grounded) {
        const ground = projectPoint(view, L, turtle.at);
        shadeBox(t, ground.x - 5 * k, ground.y - k, 10 * k, 3 * k, ground.depth + NEARER, 0.72);
      }
      drawSprite(t, this.sprite(side, look.index), at.x - (TILE_PX / 2) * k, at.y - FEET_PX * k, at.depth + NEARER, look.flip, k);
    }
    new Uint32Array(this.image.data.buffer).set(t.px);
    this.buffer.context.putImageData(this.image, 0, 0);
    this.buffer.refresh();
  }
}
