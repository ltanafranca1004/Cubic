import Phaser from 'phaser';
import { FACE_SIZE, TILE_PX, canonToScreen, itemsOn, screenToCanon, tileAt, visibleObjects, defaultEnv, type FaceId, type GameEvent, type GameState, type Side, type Vec } from '@cubic/shared';
import { inputPaused } from '../input/gate';
import { settings } from '../style/settings';
import { CodeArt, type ArtProvider } from './art';
import { InputBuffer, easeInOut, hopLift, mirrorStrip, rollPoint, rollStrips, rollWalker, transitionKind, transitionMs, upBeforeFlip, type Buffered, type TransitionKind } from './transition';

// The playable view. Shows ONLY the local player's side of the face they are on, rotated
// and mirrored so their own "up" is screen-up: every screen cell is looked up through
// screenToCanon, so the rotation and the inside mirror come straight from the cube math.
//
// The face is painted into one canvas texture, the character is a sprite on top of it.
// Walking over an edge plays a transition between two painted faces (math in
// ./transition.ts): outside the cube rolls, inside the character hops the wall while the
// view slides, and with "reduce motion" either is a quick fade. The transition is drawn
// with whole pixels on the 2D canvas, so it is identical in WebGL and in Canvas.

export const VIEW_PX = FACE_SIZE * TILE_PX;
const REPEAT_MS = 130;
const ANIM_MS = 250;
/** Inside: tiles this far from the player are fully lit / fully dark. */
const LIGHT_NEAR = 1.5;
const LIGHT_FAR = FACE_SIZE * 0.55;
const DARK_MAX = 0.92;
const BG = '#2e222f';
/** Inside: the wall between two rooms, seen while hopping over it. */
const WALL_PX = 6;
const WALL = '#3e3546';
const WALL_TOP = '#625565';
/** How high the inside player hops. */
const HOP_PX = 10;
const WALK_FRAME_MS = 90;
/** The turtle sheets (sprites/player-*.png): 6 columns, 4-frame walk rows per direction. */
const TURTLE = { cols: 6, down: 5, up: 6, right: 7, frames: 4 };
const FACE_KEY = 'game:face';

export interface GameInput {
  onMove(dx: number, dy: number): void;
  onInteract(): void;
  /** Push-to-talk key (V) went down / up. */
  onTalk(down: boolean): void;
}

const KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  arrowup: [0, -1],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowright: [1, 0],
};

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
};

/** A face edge crossing being played. `from` is the face we left and the screen tile we left it on. */
interface Transition {
  kind: TransitionKind;
  t0: number;
  ms: number;
  dx: number;
  dy: number;
  from: { face: FaceId; up: Vec; sx: number; sy: number };
}

function layer(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = VIEW_PX;
  return canvas.getContext('2d')!;
}

export class GameScene extends Phaser.Scene {
  private art!: ArtProvider;
  private state: GameState | null = null;
  private me: Side = 'out';
  /** What is on screen: the current face, or a frame of the transition. */
  private face!: Phaser.Textures.CanvasTexture;
  /** The two faces of a transition, painted off screen. */
  private fromG!: CanvasRenderingContext2D;
  private toG!: CanvasRenderingContext2D;
  private hero!: Phaser.GameObjects.Image;
  private carried!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Rectangle;
  private trans: Transition | null = null;
  private dirty = true;
  private frame = 0;
  /** Held direction keys, most recent last. */
  private held: string[] = [];
  private nextMoveAt = 0;
  private input_: GameInput | null = null;
  /** Key presses made during a transition: applied after it, never dropped. */
  private buffer = new InputBuffer();

  /** `makeArt` lets the caller plug in real art; the default is the code-drawn placeholder. */
  constructor(private makeArt: (textures: Phaser.Textures.TextureManager) => ArtProvider = (textures) => new CodeArt(textures)) {
    super('game');
  }

  create(): void {
    this.art = this.makeArt(this.textures);
    this.cameras.main.setBackgroundColor(BG);
    if (this.textures.exists(FACE_KEY)) this.textures.remove(FACE_KEY);
    this.face = this.textures.createCanvas(FACE_KEY, VIEW_PX, VIEW_PX)!;
    this.fromG = layer();
    this.toG = layer();
    this.add.image(0, 0, FACE_KEY).setOrigin(0, 0);
    this.shadow = this.add.rectangle(0, 0, 10, 2, 0x000000, 0.25).setOrigin(0, 0).setVisible(false);
    this.hero = this.add.image(0, 0, this.art.player('out', 0)).setOrigin(0, 0).setVisible(false);
    this.carried = this.add.image(0, 0, this.art.item('rose')).setOrigin(0, 0).setVisible(false);
    const down = (e: KeyboardEvent) => this.keyDown(e);
    const up = (e: KeyboardEvent) => this.keyUp(e);
    const blur = () => this.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  bind(input: GameInput): void {
    this.input_ = input;
  }

  setState(state: GameState | null, me: Side): void {
    if (!state || me !== this.me) {
      this.trans = null;
      this.buffer.clear();
    }
    this.state = state;
    this.me = me;
    this.dirty = true;
  }

  /** Things that happened to the local player that the view animates. */
  handle(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'flip' && e.side === this.me) this.startTransition(e.from, e.to, e.dx, e.dy);
      if (e.type === 'strike' && settings().screenShake) this.cameras.main.shake(250, 0.01);
    }
  }

  /** We just stepped (dx,dy) over an edge from `from` onto `to`: the state already has us there. */
  private startTransition(from: FaceId, to: FaceId, dx: number, dy: number): void {
    const pose = this.state?.players[this.me].pose;
    if (!pose || pose.face !== to) return;
    const [sx, sy] = canonToScreen(this.me, pose.face, pose.up, pose.x, pose.y);
    const kind = transitionKind(this.me, settings().reduceMotion);
    this.trans = {
      kind,
      t0: this.time.now,
      ms: transitionMs(kind),
      dx,
      dy,
      // The tile we left: one step back, on the far end of the old face, seen with the old up.
      from: { face: from, up: upBeforeFlip(to, pose.up, dy), sx: (sx - dx + FACE_SIZE) % FACE_SIZE, sy: (sy - dy + FACE_SIZE) % FACE_SIZE },
    };
    this.dirty = true;
  }

  private releaseAll(): void {
    this.held = [];
    this.input_?.onTalk(false);
  }

  private send(input: Buffered): void {
    if (input.kind === 'move') this.input_?.onMove(input.dx, input.dy);
    else this.input_?.onInteract();
  }

  /** A fresh key press: now, or after the transition (and after whatever already waits). */
  private act(input: Buffered): void {
    if (this.trans || this.buffer.length) this.buffer.push(input);
    else this.send(input);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // typing, or a menu / the cube map is on top: the keys are not the game's
    if (typing() || inputPaused()) return;
    if (KEYS[k]) {
      e.preventDefault();
      if (!this.held.includes(k)) {
        this.held.push(k);
        // Step at once on a fresh press: a tap can be shorter than a frame.
        this.nextMoveAt = performance.now() + REPEAT_MS;
        if (this.state) this.act({ kind: 'move', dx: KEYS[k]![0], dy: KEYS[k]![1] });
      }
    } else if (k === 'e' && !e.repeat) this.act({ kind: 'interact' });
    else if (k === 'v' && !e.repeat) this.input_?.onTalk(true);
  }

  private keyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    this.held = this.held.filter((h) => h !== k);
    if (k === 'v') this.input_?.onTalk(false);
  }

  update(time: number): void {
    const now = performance.now();
    if (this.trans && time - this.trans.t0 >= this.trans.ms) {
      this.trans = null;
      this.buffer.release(now);
      this.dirty = true;
    }

    // Input waits while a transition plays: the buffered presses go first, then the held key.
    if ((typing() || inputPaused()) && this.held.length) this.held = [];
    while (!this.trans) {
      const input = this.buffer.next(now);
      if (!input) break;
      this.send(input);
    }
    const key = this.held[this.held.length - 1];
    if (key && this.state && !this.trans && !this.buffer.length && now >= this.nextMoveAt) {
      const [dx, dy] = KEYS[key]!;
      this.nextMoveAt = now + REPEAT_MS;
      this.input_?.onMove(dx, dy);
    }

    const frame = Math.floor(time / ANIM_MS);
    if (frame !== this.frame) {
      this.frame = frame;
      this.dirty = true;
    }
    if (this.trans) this.drawTransition(this.trans, time);
    else if (this.dirty) this.drawFace();
    this.dirty = false;
  }

  /** Paint one face as `me` sees it with `up` as screen-up. `at` = the screen tile we stand on. */
  private paint(g: CanvasRenderingContext2D, face: FaceId, up: Vec, at: { sx: number; sy: number }): void {
    const state = this.state!;
    const me = this.me;
    const world = defaultEnv.world;
    const T = TILE_PX;
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = false;
    g.fillStyle = BG;
    g.fillRect(0, 0, VIEW_PX, VIEW_PX);
    const put = (key: string, sx: number, sy: number) => g.drawImage(this.textures.get(key).getSourceImage() as CanvasImageSource, sx * T, sy * T);

    for (let sy = 0; sy < FACE_SIZE; sy++) {
      for (let sx = 0; sx < FACE_SIZE; sx++) {
        const [x, y] = screenToCanon(me, face, up, sx, sy);
        put(this.art.tile(me, face, tileAt(world, me, face, x, y), x, y, this.frame), sx, sy);
      }
    }
    for (const o of visibleObjects(state, me, face)) {
      const [sx, sy] = canonToScreen(me, face, up, o.x, o.y);
      put(this.art.object(me, o.type, o.state, this.frame), sx, sy);
    }
    for (const it of itemsOn(state, me, face)) {
      const [sx, sy] = canonToScreen(me, face, up, it.x, it.y);
      put(this.art.item(it.kind), sx, sy);
    }

    if (me === 'in') {
      // The inside is dark: light falls off by tile distance from the player.
      for (let sy = 0; sy < FACE_SIZE; sy++) {
        for (let sx = 0; sx < FACE_SIZE; sx++) {
          const d = Math.hypot(sx - at.sx, sy - at.sy);
          const dark = Phaser.Math.Clamp((d - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR), 0, 1) * DARK_MAX;
          if (dark <= 0) continue;
          g.fillStyle = `rgba(46, 34, 47, ${dark})`;
          g.fillRect(sx * T, sy * T, T, T);
        }
      }
      g.fillStyle = 'rgba(249, 194, 43, 0.12)';
      g.fillRect(at.sx * T - 4, at.sy * T - 4, T + 8, T + 8);
    }
  }

  /** The character (and what they carry) with its top-left at x,y. */
  private placeHero(x: number, y: number, key: string, flip: boolean): void {
    const state = this.state!;
    const player = state.players[this.me];
    this.hero.setTexture(key).setPosition(x, y).setFlipX(flip).setVisible(true);
    this.shadow.setPosition(x + 3, y + 14).setVisible(this.me === 'out');
    const item = player.carrying ? state.items[player.carrying] : null;
    this.carried.setVisible(!!item);
    if (item) this.carried.setTexture(this.art.item(item.kind)).setPosition(x, y - 11);
  }

  /** The current face, standing still. */
  private drawFace(): void {
    const g = this.face.context;
    const state = this.state;
    if (!state) {
      g.fillStyle = BG;
      g.fillRect(0, 0, VIEW_PX, VIEW_PX);
      this.face.refresh();
      for (const o of [this.hero, this.shadow, this.carried]) o.setVisible(false);
      return;
    }
    const player = state.players[this.me];
    const { face, up } = player.pose;
    const [sx, sy] = canonToScreen(this.me, face, up, player.pose.x, player.pose.y);
    this.paint(g, face, up, { sx, sy });
    this.face.refresh();
    this.placeHero(sx * TILE_PX, sy * TILE_PX, this.art.player(this.me, player.steps), player.pose.dir < 0);
  }

  /** The character mid-step: the turtle's walk row for the direction walked. */
  private walkKey(t: Transition, elapsed: number): { key: string; flip: boolean } {
    const player = this.state!.players[this.me];
    const tick = Math.floor(elapsed / WALK_FRAME_MS);
    const row = t.dx ? TURTLE.right : t.dy < 0 ? TURTLE.up : TURTLE.down;
    const key = this.art.playerFrame?.(this.me, row * TURTLE.cols + (tick % TURTLE.frames));
    return key ? { key, flip: t.dx < 0 } : { key: this.art.player(this.me, player.steps + tick), flip: player.pose.dir < 0 };
  }

  private drawTransition(t: Transition, time: number): void {
    const state = this.state;
    if (!state) return;
    const pose = state.players[this.me].pose;
    const [sx, sy] = canonToScreen(this.me, pose.face, pose.up, pose.x, pose.y);
    if (this.dirty) {
      // Both faces keep following the game while the transition plays.
      this.paint(this.fromG, t.from.face, t.from.up, t.from);
      this.paint(this.toG, pose.face, pose.up, { sx, sy });
    }
    const elapsed = time - t.t0;
    const k = Phaser.Math.Clamp(elapsed / t.ms, 0, 1);
    const g = this.face.context;
    const from = this.fromG.canvas;
    const to = this.toG.canvas;
    const T = TILE_PX;
    const V = VIEW_PX;
    const forward = t.dx > 0 || t.dy > 0;
    const sideways = t.dx !== 0;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;

    if (t.kind === 'fade') {
      g.drawImage(from, 0, 0);
      g.globalAlpha = k;
      g.drawImage(to, 0, 0);
      g.globalAlpha = 1;
      this.face.refresh();
      this.placeHero(sx * T, sy * T, this.art.player(this.me, state.players[this.me].steps), pose.dir < 0);
      return;
    }

    const { key, flip } = this.walkKey(t, elapsed);
    if (t.kind === 'hop') {
      // The view slides to the next room; the wall between the two passes under the hop.
      const e = easeInOut(k);
      const span = V + WALL_PX;
      const fromX = Math.round(-t.dx * span * e);
      const fromY = Math.round(-t.dy * span * e);
      const toX = fromX + t.dx * span;
      const toY = fromY + t.dy * span;
      g.fillStyle = WALL;
      g.fillRect(0, 0, V, V);
      g.fillStyle = WALL_TOP;
      if (sideways) g.fillRect(Math.min(fromX, toX) + V + 1, 0, 2, V);
      else g.fillRect(0, Math.min(fromY, toY) + V + 1, V, 2);
      g.drawImage(from, fromX, fromY);
      g.drawImage(to, toX, toY);
      this.face.refresh();
      const ax = fromX + t.from.sx * T;
      const ay = fromY + t.from.sy * T;
      const bx = toX + sx * T;
      const by = toY + sy * T;
      this.placeHero(Math.round(ax + (bx - ax) * e), Math.round(ay + (by - ay) * e) - hopLift(k, HOP_PX), key, flip);
      return;
    }

    // Roll: the cube turns a quarter over the edge we walked off, one pixel line at a time.
    const turn = easeInOut(k);
    g.fillStyle = BG;
    g.fillRect(0, 0, V, V);
    const strips = rollStrips(turn, V);
    for (let i = 0; i < V; i++) {
      const s = strips[i]!;
      if (s.face < 0) continue;
      const at = forward ? i : mirrorStrip(i, V);
      const src = forward ? s.src : mirrorStrip(s.src, V);
      const image = s.face === 0 ? from : to;
      g.globalAlpha = s.light;
      if (sideways) g.drawImage(image, src, 0, 1, V, at, s.start, 1, s.length);
      else g.drawImage(image, 0, src, V, 1, s.start, at, s.length, 1);
    }
    g.globalAlpha = 1;
    this.face.refresh();
    // The character steps across the edge, standing on the turning cube.
    const walker = rollWalker(turn, V, T);
    const p = rollPoint(turn, V, walker.face, walker.along, (sideways ? sy : sx) * T + T / 2);
    const along = Math.round((forward ? p.along : V - p.along) - T / 2);
    const across = Math.round(p.across - T / 2);
    this.placeHero(sideways ? along : across, sideways ? across : along, key, flip);
  }
}
