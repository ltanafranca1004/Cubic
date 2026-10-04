import Phaser from 'phaser';
import { FACE_SIZE, TILE_PX, brightFace, canonToScreen, eq, itemsOn, linesOn, screenToCanon, tileAt, visibleObjects, defaultEnv, type FaceId, type GameEvent, type GameState, type Side, type Vec } from '@cubic/shared';
import { inputPaused } from '../input/gate';
import { settings } from '../style/settings';
import type { PropPass } from '../world/biomes/dress';
import { CodeArt, type ArtProvider } from './art';
import { PropFades, fadingProps, liftedProps, propsOver, tallProps, type TallProp } from '../world/biomes/depth';
import { GameKeys, HoldRepeat } from './keys';
import { InputBuffer, easeInOut, hopBoxes, hopFrame, mirrorStrip, rollPoint, rollStrips, rollWalker, transitionKind, transitionMs, upBeforeFlip, type Buffered, type TransitionKind } from './transition';
import { CARRY_PX, ITEM_HOP_MS, WALK_HOLD_MS, carryBob, facingFromStep, facingOf, itemHop, playerFlip, type Facing } from './turtle';

// The playable view. Shows ONLY the local player's side of the face they are on, rotated
// and mirrored so their own "up" is screen-up: every screen cell is looked up through
// screenToCanon, so the rotation and the inside mirror come straight from the cube math.
//
// The face is painted into one canvas texture, the character is a sprite on top of it.
// Walking over an edge plays a transition between two painted faces (math in
// ./transition.ts): outside the cube rolls, inside the character hops the wall while the
// view slides, and with "reduce motion" either is a quick fade. The transition is drawn
// with whole pixels on the 2D canvas, so it is identical in WebGL and in Canvas.
//
// Depth (../world/biomes/depth.ts): a tall prop whose base is on a lower screen row than
// the character is in front of it. The ones that cover the character are left out of the
// painted face and painted into a second canvas texture shown OVER the character and its
// item, faded so the turtle stays easy to see. Same 2D drawing, so again no difference
// between the renderers.

export const VIEW_PX = FACE_SIZE * TILE_PX;
const ANIM_MS = 250;
/** Inside: tiles this far from the player are fully lit / fully dark. */
const LIGHT_NEAR = 1.5;
const LIGHT_FAR = FACE_SIZE * 0.55;
const DARK_MAX = 0.92;
const BG = '#2e222f';
/** Inside: the wall between two rooms, seen while hopping over it. */
const WALL_PX = 10;
const WALL = '#3e3546';
const WALL_TOP = '#625565';
const WALL_LIGHT = '#7f708a';
const WALL_EDGE = '#2e222f';
const WALL_SHADE = 'rgba(0, 0, 0, 0.35)';
/** A wall lying across the screen shows this much of its near face; the top is that much higher. */
const WALL_FACE = 4;
const WALL_RISE = WALL_FACE + 1;
/** How much of the wall's thickness is its top (after the far edge line), by how it lies. */
const wallTop = (upright: boolean): number => WALL_PX - 2 - (upright ? 1 : WALL_FACE);
/** How high the inside player hops. */
const HOP_PX = 14;
const WALK_FRAME_MS = 90;
const FACE_KEY = 'game:face';
const FRONT_KEY = 'game:front';

export interface GameInput {
  onMove(dx: number, dy: number): void;
  /** E (no argument: pick up or use, whichever applies) or Q (`'drop'`: only ever puts down). */
  onInteract(only?: 'drop' | 'pick'): void;
  /** The push-to-talk key went down / up. */
  onTalk(down: boolean): void;
}

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

/**
 * An item on its way between the tile we stand on and our head: up when picked up, down
 * when dropped or placed. `sx, sy` is that tile on screen.
 */
interface ItemHop {
  item: string;
  up: boolean;
  t0: number;
  face: FaceId;
  sx: number;
  sy: number;
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
  /** The tall props in front of the character: drawn over it. Empty most of the time. */
  private front!: Phaser.Textures.CanvasTexture;
  private frontImage!: Phaser.GameObjects.Image;
  /** How faded each tall prop is, and what the front layer shows now (to repaint only on a change). */
  private fades = new PropFades();
  private lifted: TallProp[] = [];
  private frontSig = '';
  private hero!: Phaser.GameObjects.Image;
  private carried!: Phaser.GameObjects.Image;
  /** The item while it hops onto the head or off it. */
  private flying!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Rectangle;
  private trans: Transition | null = null;
  private hop: ItemHop | null = null;
  /** The way the character faces on screen: the last step taken, kept while standing. */
  private facing: Facing = 'down';
  /** The pose the last step was measured from (the state itself changes in place). */
  private seen: { face: FaceId; up: Vec; x: number; y: number } | null = null;
  private stepAt = -WALK_HOLD_MS;
  /** The last step asked for: a bump turns the character that way without moving it. */
  private lastMove: { dx: number; dy: number } | null = null;
  private dirty = true;
  private frame = 0;
  /** What the keys mean (the player's bindings) and which are held: ./keys.ts. */
  private keys = new GameKeys({ act: (input) => this.act(input), talk: (down) => this.input_?.onTalk(down) });
  /** The walking pace of a held direction (STEP_MS in shared/src/pace.ts). */
  private repeat = new HoldRepeat();
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
    if (this.textures.exists(FRONT_KEY)) this.textures.remove(FRONT_KEY);
    this.front = this.textures.createCanvas(FRONT_KEY, VIEW_PX, VIEW_PX)!;
    this.add.image(0, 0, FACE_KEY).setOrigin(0, 0);
    // Dev only: the checks in tools/screens read the painted face without the sprites on top of it,
    // and what the depth sort does (which props are over the character, how faded, and where the character is drawn).
    if (import.meta.env.DEV)
      Object.assign(window, {
        __cubicFace: () => this.face.canvas,
        __cubicProps: () => ({
          lifted: this.lifted.map((p) => ({ key: p.key, sx: p.sx, sy: p.sy, alpha: this.fades.alpha(p.key) })),
          faded: this.fades.entries(),
          front: this.frontImage.visible,
          transition: this.trans?.kind ?? null,
          hero: this.hero.visible ? { x: this.hero.x, y: this.hero.y } : null,
        }),
      });
    this.shadow = this.add.rectangle(0, 0, 10, 2, 0x000000, 0.25).setOrigin(0, 0).setVisible(false);
    this.hero = this.add.image(0, 0, this.art.player('out', 0)).setOrigin(0, 0).setVisible(false);
    this.carried = this.add.image(0, 0, this.art.item('default')).setOrigin(0, 0).setVisible(false);
    this.flying = this.add.image(0, 0, this.art.item('default')).setOrigin(0, 0).setVisible(false);
    // added last: over the character and the item on its head
    this.frontImage = this.add.image(0, 0, FRONT_KEY).setOrigin(0, 0).setVisible(false);
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
      this.hop = null;
      this.seen = null;
      this.facing = 'down';
      this.buffer.clear();
      this.fades.clear();
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
      if ('side' in e && e.side === this.me) this.heroEvent(e);
    }
  }

  /** Remember where the character stands: the next step is measured from here. */
  private see(): void {
    const pose = this.state?.players[this.me].pose;
    this.seen = pose ? { face: pose.face, up: pose.up, x: pose.x, y: pose.y } : null;
  }

  /** Something the local player did: which way the character now faces, and what the item does. */
  private heroEvent(e: GameEvent): void {
    const state = this.state;
    if (!state) return;
    const player = state.players[this.me];
    const pose = player.pose;
    if (e.type === 'step') {
      // The step as it looks ON SCREEN, so the inside player's mirrored view faces the right way.
      const seen = this.seen;
      const facing = seen && seen.face === pose.face && eq(seen.up, pose.up) ? facingFromStep(this.me, pose.face, pose.up, seen, pose) : null;
      if (facing) this.facing = facing;
      this.stepAt = this.time.now;
      this.see();
    } else if (e.type === 'flip') {
      this.facing = facingOf(e.dx, e.dy) ?? this.facing;
      this.stepAt = this.time.now;
      this.see();
    } else if (e.type === 'bump') {
      if (this.lastMove) this.facing = facingOf(this.lastMove.dx, this.lastMove.dy) ?? this.facing;
    } else if (e.type === 'pickup' || e.type === 'drop' || e.type === 'place') {
      const up = e.type === 'pickup';
      const item = state.items[e.item];
      // A puzzle may already have changed its mind (ctx.giveItem puts a wrongly placed item
      // back in the hands, ctx.removeItem takes it away): then nothing hops, the sprites
      // just follow `carrying`.
      const here = !!item && (up ? player.carrying === item.id : !item.carriedBy && item.side === this.me && item.face === pose.face && item.x === pose.x && item.y === pose.y);
      this.hop = null;
      if (here && !this.trans && !settings().reduceMotion) {
        const [sx, sy] = canonToScreen(this.me, pose.face, pose.up, pose.x, pose.y);
        this.hop = { item: e.item, up, t0: this.time.now, face: pose.face, sx, sy };
      }
      this.dirty = true;
    }
  }

  /** The item hop still playing, or null. It ends at once when the game no longer agrees with it. */
  private hopNow(time: number): ItemHop | null {
    const hop = this.hop;
    if (!hop) return null;
    const item = this.state?.items[hop.item];
    const player = this.state?.players[this.me];
    const ok = !!item && !!player && !this.trans && player.pose.face === hop.face && time - hop.t0 < ITEM_HOP_MS && (hop.up ? player.carrying === hop.item : !item.carriedBy);
    if (ok) return hop;
    this.hop = null;
    this.dirty = true; // the dropped item is on the floor from now on
    return null;
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
    this.hop = null;
    this.dirty = true;
  }

  private releaseAll(): void {
    this.keys.releaseAll();
  }

  private send(input: Buffered): void {
    if (!this.state) return;
    if (input.kind === 'move') this.move(input.dx, input.dy);
    else this.input_?.onInteract(input.only);
  }

  private move(dx: number, dy: number): void {
    this.lastMove = { dx, dy };
    this.input_?.onMove(dx, dy);
  }

  /** A fresh key press: now, or after the transition (and after whatever already waits). */
  private act(input: Buffered): void {
    if (this.trans || this.buffer.length) this.buffer.push(input);
    else this.send(input);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // typing, or a menu / the cube map is on top: the keys are not the game's
    if (typing() || inputPaused()) return;
    // Step at once on a fresh press: a tap can be shorter than a frame. Every step, E and
    // Q goes through act(): pressed during a transition, it waits its turn in the buffer.
    const used = this.keys.down(e);
    if (used === 'move') this.repeat.restart(performance.now());
    if (used) e.preventDefault(); // (a bound Space or Tab must not scroll or move the focus)
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.up(e);
  }

  update(time: number, delta: number): void {
    const now = performance.now();
    if (this.trans && time - this.trans.t0 >= this.trans.ms) {
      this.trans = null;
      this.buffer.release(now);
      this.dirty = true;
    }

    // Input waits while a transition plays: the buffered presses go first, then the held key.
    if (typing() || inputPaused()) this.keys.releaseMoves();
    while (!this.trans) {
      const input = this.buffer.next(now);
      if (!input) break;
      this.send(input);
    }
    const held = this.keys.heldDir();
    if (held && this.state && !this.trans && !this.buffer.length && this.repeat.take(now)) this.move(held.dx, held.dy);
    this.see();
    this.hopNow(time);

    const frame = Math.floor(time / ANIM_MS);
    if (frame !== this.frame) {
      this.frame = frame;
      this.dirty = true;
    }
    this.sortProps(delta);
    if (this.trans) this.drawTransition(this.trans, time);
    else this.drawFace(time);
    this.dirty = false;
  }

  /**
   * The depth sort, once a frame: which tall props cover the character from the front
   * (they fade), and which are drawn over it. A change asks for a repaint. The fade keeps
   * running through a transition, so the props of the face we left are back to full
   * before it is gone and the ones we arrive behind are already fading.
   */
  private sortProps(delta: number): void {
    const state = this.state;
    if (!state) {
      this.lifted = [];
      return;
    }
    const player = state.players[this.me];
    const { face, up } = player.pose;
    const [sx, sy] = canonToScreen(this.me, face, up, player.pose.x, player.pose.y);
    const props = tallProps(this.me, face, up);
    // an item lying under a crown keeps that prop faded, turtle or not: also on the face a transition is leaving
    const hiding = this.hidingProps(face, up);
    if (this.trans) hiding.push(...this.hidingProps(this.trans.from.face, this.trans.from.up));
    this.fades.aim(fadingProps({ sx, sy, carrying: !!player.carrying }, props).map((p) => p.key), hiding.map((p) => p.key));
    const moving = this.fades.moving;
    this.fades.step(delta, settings().reduceMotion);
    const lifted = liftedProps(props, (p) => this.fades.faded(p.key), { sx, sy });
    if (moving || lifted.length !== this.lifted.length || lifted.some((p, i) => p !== this.lifted[i])) this.dirty = true;
    this.lifted = lifted;
  }

  /** The items lying on a face (not the one hopping to or from the head), as screen tiles. */
  private lyingItems(face: FaceId, up: Vec): { sx: number; sy: number; kind: string }[] {
    return itemsOn(this.state!, this.me, face)
      .filter((it) => it.id !== this.hop?.item)
      .map((it) => {
        const [sx, sy] = canonToScreen(this.me, face, up, it.x, it.y);
        return { sx, sy, kind: it.kind };
      });
  }

  /** The tall props of a face with an item lying under their crown. */
  private hidingProps(face: FaceId, up: Vec): TallProp[] {
    return propsOver(this.lyingItems(face, up), tallProps(this.me, face, up));
  }

  /** The alpha of the prop on a screen tile of `face`, for a face painted whole (a transition): the fade is baked in. */
  private bakedPass(face: FaceId, up: Vec): PropPass {
    const props = tallProps(this.me, face, up);
    return { water: true, alpha: (sx, sy) => this.fades.alpha(props.find((p) => p.sx === sx && p.sy === sy)?.key ?? '') };
  }

  /** The layer over the character: the lifted props, each as faded as it is now. Painted only when it changed. */
  private paintFront(face: FaceId, up: Vec): void {
    const lifted = this.lifted;
    const sig = lifted.length ? `${face}|${up.join(',')}|${this.frame}|${settings().reduceMotion}|${lifted.map((p) => `${p.key}=${this.fades.alpha(p.key)}`).join(';')}` : '';
    this.frontImage.setVisible(lifted.length > 0);
    if (sig === this.frontSig) return;
    this.frontSig = sig;
    const g = this.front.context;
    g.clearRect(0, 0, VIEW_PX, VIEW_PX);
    g.imageSmoothingEnabled = false;
    if (lifted.length) {
      const alpha = (sx: number, sy: number) => {
        const prop = lifted.find((p) => p.sx === sx && p.sy === sy);
        return prop ? this.fades.alpha(prop.key) : 0;
      };
      this.art.dress?.(g, this.me, face, up, this.frame, { water: false, alpha });
    }
    this.front.refresh();
  }

  /** Paint one face as `me` sees it with `up` as screen-up. `at` = the screen tile we stand on. */
  private paint(g: CanvasRenderingContext2D, face: FaceId, up: Vec, at: { sx: number; sy: number }, pass?: PropPass): void {
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
    // An item lying under the crown of a tall prop is behind it (the prop is lower on the
    // screen): it goes down before the props. Every other item is painted over them, as before.
    // (The item on its way down from the head is not here: the sprite shows it.)
    const items = this.lyingItems(face, up);
    const under = new Set(propsOver(items, tallProps(me, face, up)).map((p) => `${p.sx},${p.sy - 1}`));
    for (const it of items) if (under.has(`${it.sx},${it.sy}`)) put(this.art.item(it.kind), it.sx, it.sy);
    this.art.dress?.(g, me, face, up, this.frame, pass);
    const objects = visibleObjects(state, me, face);
    for (const o of objects) {
      const [sx, sy] = canonToScreen(me, face, up, o.x, o.y);
      // (objects that animate, like the hot lava, stand still with reduce motion)
      put(this.art.object(me, o.type, o.state, settings().reduceMotion ? 0 : this.frame), sx, sy);
    }
    for (const it of items) if (!under.has(`${it.sx},${it.sy}`)) put(this.art.item(it.kind), it.sx, it.sy);

    if (me === 'in' && !brightFace(face)) {
      // The inside is dark: light falls off by tile distance from the player. A room whose
      // puzzle is `bright` is drawn fully lit instead.
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

    // The puzzle's lines (laser beams), from tile centre to tile centre: one pixel wide,
    // whole pixels, over the darkness (a beam is its own light).
    for (const line of linesOn(state, me, face)) {
      const centre = ([x, y]: readonly [number, number]) => canonToScreen(me, face, up, x, y).map((c) => Math.floor(c * T + T / 2)) as [number, number];
      let [x, y] = centre(line.from);
      const [x1, y1] = centre(line.to);
      const dx = Math.abs(x1 - x);
      const dy = -Math.abs(y1 - y);
      let err = dx + dy;
      g.fillStyle = line.colour;
      for (;;) {
        g.fillRect(x, y, 1, 1);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += x1 > x ? 1 : -1;
        }
        if (e2 <= dx) {
          err += dx;
          y += y1 > y ? 1 : -1;
        }
      }
    }
  }

  /** Mirror the character? Only to face left when its sheet has a row per direction. */
  private flip(): boolean {
    return playerFlip(this.art.playerFacing?.(this.me) ?? false, this.facing, this.state!.players[this.me].pose.dir);
  }

  /**
   * The character with its top-left at x,y, and its item: riding above the head (`bob`
   * pixels lower on every other step), or hopping between the head and the tile.
   */
  private placeHero(x: number, y: number, key: string, flip: boolean, bob: number): void {
    const state = this.state!;
    const player = state.players[this.me];
    this.hero.setTexture(key).setPosition(x, y).setFlipX(flip).setVisible(true);
    this.shadow.setPosition(x + 3, y + 14).setVisible(this.me === 'out');
    const item = player.carrying ? state.items[player.carrying] : null;
    const head = { x, y: y - CARRY_PX + bob };
    const hop = this.hop;
    const flying = hop ? state.items[hop.item] : null;
    // (the item being lifted is not on the head yet)
    this.carried.setVisible(!!item && !(hop?.up && item.id === hop.item));
    if (item) this.carried.setTexture(this.art.item(item.kind)).setPosition(head.x, head.y);
    this.flying.setVisible(!!hop && !!flying);
    if (hop && flying) {
      const tile = { x: hop.sx * TILE_PX, y: hop.sy * TILE_PX };
      const k = (this.time.now - hop.t0) / ITEM_HOP_MS;
      const at = hop.up ? itemHop(k, tile, head) : itemHop(k, { x: tile.x, y: tile.y - CARRY_PX }, tile);
      this.flying.setTexture(this.art.item(flying.kind)).setPosition(at.x, at.y);
    }
  }

  /** The current face, standing still: painted when something changed, the sprites every frame. */
  private drawFace(time: number): void {
    const state = this.state;
    if (!state) {
      if (!this.dirty) return;
      const g = this.face.context;
      g.fillStyle = BG;
      g.fillRect(0, 0, VIEW_PX, VIEW_PX);
      this.face.refresh();
      for (const o of [this.hero, this.shadow, this.carried, this.flying, this.frontImage]) o.setVisible(false);
      return;
    }
    const player = state.players[this.me];
    const { face, up } = player.pose;
    const [sx, sy] = canonToScreen(this.me, face, up, player.pose.x, player.pose.y);
    if (this.dirty) {
      // the lifted props are not on the ground: they are painted over the character below.
      // A faded prop that is not lifted (it hides an item, the turtle is not behind it) is painted here, as faded as it is.
      const lifted = this.lifted;
      const baked = this.bakedPass(face, up);
      this.paint(this.face.context, face, up, { sx, sy }, { water: true, alpha: (px, py) => (lifted.some((p) => p.sx === px && p.sy === py) ? 0 : baked.alpha(px, py)) });
      this.face.refresh();
    }
    this.paintFront(face, up);
    const walking = time - this.stepAt < WALK_HOLD_MS;
    this.placeHero(sx * TILE_PX, sy * TILE_PX, this.art.player(this.me, player.steps, this.facing), this.flip(), carryBob(walking, player.steps));
  }

  /** The character mid-step over an edge: the walk towards the direction walked. */
  private walkKey(t: Transition, elapsed: number): { key: string; flip: boolean; bob: number } {
    const player = this.state!.players[this.me];
    const tick = Math.floor(elapsed / WALK_FRAME_MS);
    const facing = facingOf(t.dx, t.dy) ?? this.facing;
    const key = this.art.playerWalk?.(this.me, facing, tick);
    const bob = carryBob(true, tick);
    return key ? { key, flip: facing === 'left', bob } : { key: this.art.player(this.me, player.steps + tick, facing), flip: this.flip(), bob };
  }

  /**
   * Inside: the wall between two rooms, WALL_PX thick from `start` along the direction
   * walked. A wall running up the screen shows its top; one running across also shows its
   * near face. Either way it drops a shadow on the floor beside it.
   */
  private paintWall(g: CanvasRenderingContext2D, upright: boolean, start: number): void {
    const V = VIEW_PX;
    // `along` runs through the wall's thickness, whichever way the wall lies.
    const band = (along: number, thick: number, color: string) => {
      g.fillStyle = color;
      if (upright) g.fillRect(start + along, 0, thick, V);
      else g.fillRect(0, start + along, V, thick);
    };
    const face = upright ? 1 : WALL_FACE;
    const top = wallTop(upright) - 1;
    band(0, WALL_PX, WALL_EDGE);
    band(1, 1, WALL_LIGHT);
    band(2, top, WALL_TOP);
    band(2 + top, face, WALL);
    band(WALL_PX, 2, WALL_SHADE);
    // Stone joints, so the wall reads as built, not as a gap.
    g.fillStyle = WALL;
    for (let i = 0; i < V; i += TILE_PX) {
      const j = i + (TILE_PX >> 1);
      if (upright) g.fillRect(start + 2, j, top, 1);
      else g.fillRect(j, start + 2, 1, top);
    }
    if (!upright) {
      g.fillStyle = WALL_EDGE;
      for (let i = 0; i < V; i += TILE_PX) g.fillRect(i, start + 2 + top + 1, 1, face - 1);
    }
  }

  private drawTransition(t: Transition, time: number): void {
    const state = this.state;
    if (!state) return;
    const pose = state.players[this.me].pose;
    const [sx, sy] = canonToScreen(this.me, pose.face, pose.up, pose.x, pose.y);
    if (this.dirty) {
      // Both faces keep following the game while the transition plays. They are painted
      // whole, each prop as faded as it is at this moment: the one we stood behind comes
      // back on the old face, the one we arrive behind fades on the new one, with no jump
      // when the transition starts or ends.
      this.paint(this.fromG, t.from.face, t.from.up, t.from, this.bakedPass(t.from.face, t.from.up));
      this.paint(this.toG, pose.face, pose.up, { sx, sy }, this.bakedPass(pose.face, pose.up));
    }
    this.frontImage.setVisible(false);
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
      this.placeHero(sx * T, sy * T, this.art.player(this.me, state.players[this.me].steps, this.facing), this.flip(), 0);
      return;
    }

    const { key, flip, bob } = this.walkKey(t, elapsed);
    if (t.kind === 'hop') {
      // The view slides to the next room while the character jumps the wall between the two.
      // All of it is painted here, in whole pixels (the sprites are hidden): floor, shadow,
      // wall, then the character above the wall.
      const span = V + WALL_PX;
      const hop = hopFrame(k, { size: T, span, reach: T + WALL_PX, height: HOP_PX });
      const fromX = t.dx ? -t.dx * hop.slide : 0;
      const fromY = t.dy ? -t.dy * hop.slide : 0;
      const at = hopBoxes(hop, fromX + t.from.sx * T + t.dx * hop.travel, fromY + t.from.sy * T + t.dy * hop.travel, T);
      // A hop from the top rows would leave the view: the view follows it up instead, and
      // shows the wall along the top of the rooms.
      const peek = Math.max(0, -at.body.y);
      g.fillStyle = BG;
      g.fillRect(0, 0, V, V);
      g.save();
      g.translate(0, peek);
      if (peek > 0) this.paintWall(g, false, -WALL_PX);
      g.drawImage(from, fromX, fromY);
      g.drawImage(to, fromX + t.dx * span, fromY + t.dy * span);
      // The shadow stays on the ground under the character. The wall is painted over the
      // part on the floor behind it, and the part that falls on the wall lies on its top.
      const shade = (rise: number) => {
        const s = at.shadow;
        g.fillStyle = `rgba(0, 0, 0, ${hop.shadowAlpha})`;
        g.fillRect(s.x + 2, s.y - rise, s.w - 4, 1);
        g.fillRect(s.x, s.y - rise + 1, s.w, s.h - 2);
        g.fillRect(s.x + 2, s.y - rise + s.h - 1, s.w - 4, 1);
      };
      const wall = (sideways ? Math.min(fromX, fromX + t.dx * span) : Math.min(fromY, fromY + t.dy * span)) + V;
      if (hop.shadowAlpha > 0) shade(0);
      this.paintWall(g, sideways, wall);
      if (hop.shadowAlpha > 0) {
        g.save();
        g.beginPath();
        if (sideways) g.rect(wall + 1, 0, wallTop(true), V);
        else g.rect(0, wall + 1, V, wallTop(false));
        g.clip();
        shade(WALL_RISE);
        g.restore();
      }
      const image = (name: string) => this.textures.get(name).getSourceImage() as CanvasImageSource;
      const b = at.body;
      if (flip) {
        g.save();
        g.translate(b.x + b.w, b.y);
        g.scale(-1, 1);
        g.drawImage(image(key), 0, 0, b.w, b.h);
        g.restore();
      } else g.drawImage(image(key), b.x, b.y, b.w, b.h);
      const player = state.players[this.me];
      const item = player.carrying ? state.items[player.carrying] : null;
      if (item) g.drawImage(image(this.art.item(item.kind)), at.carried.x, at.carried.y + bob);
      g.restore();
      this.face.refresh();
      for (const o of [this.hero, this.shadow, this.carried, this.flying]) o.setVisible(false);
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
    this.placeHero(sideways ? along : across, sideways ? across : along, key, flip, bob);
  }
}
