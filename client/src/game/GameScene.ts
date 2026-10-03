import Phaser from 'phaser';
import { GRID, TILE_PX, canonToScreen, itemsOn, screenToCanon, tileAt, visibleObjects, defaultEnv, type GameEvent, type GameState, type Side } from '@cubic/shared';
import { CodeArt, type ArtProvider } from './art';

// The playable view. Shows ONLY the local player's side of the face they are on, rotated
// and mirrored so their own "up" is screen-up: every screen cell is looked up through
// screenToCanon, so the rotation and the inside mirror come straight from the cube math.

export const VIEW_PX = GRID * TILE_PX;
const SLIDE_MS = 220;
const REPEAT_MS = 130;
const ANIM_MS = 250;
/** Inside: tiles this far from the player are fully lit / fully dark. */
const LIGHT_NEAR = 1.5;
const LIGHT_FAR = 5.5;
const DARK_MAX = 0.92;

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

export class GameScene extends Phaser.Scene {
  private art!: ArtProvider;
  private state: GameState | null = null;
  private me: Side = 'out';
  private view: Phaser.GameObjects.Container | null = null;
  private leaving: Phaser.GameObjects.Container | null = null;
  private slide: { t0: number; dx: number; dy: number } | null = null;
  private dirty = true;
  private frame = 0;
  /** Held direction keys, most recent last. */
  private held: string[] = [];
  private nextMoveAt = 0;
  private input_: GameInput | null = null;

  constructor() {
    super('game');
  }

  create(): void {
    this.art = new CodeArt(this.textures);
    this.cameras.main.setBackgroundColor('#05070D');
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
    this.state = state;
    this.me = me;
    this.dirty = true;
  }

  /** Things that happened to the local player that the view animates. */
  handle(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'flip' && e.side === this.me) this.startSlide(e.dx, e.dy);
      if (e.type === 'strike') this.cameras.main.shake(250, 0.01);
    }
  }

  private startSlide(dx: number, dy: number): void {
    this.leaving?.destroy();
    this.leaving = this.view;
    this.view = null;
    this.slide = { t0: this.time.now, dx, dy };
    this.dirty = true;
  }

  private releaseAll(): void {
    this.held = [];
    this.input_?.onTalk(false);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (typing()) return;
    if (KEYS[k]) {
      e.preventDefault();
      if (!this.held.includes(k)) {
        this.held.push(k);
        // Step at once on a fresh press: a tap can be shorter than a frame.
        this.nextMoveAt = performance.now() + REPEAT_MS;
        if (this.state) this.input_?.onMove(KEYS[k]![0], KEYS[k]![1]);
      }
    } else if (k === 'e' && !e.repeat) this.input_?.onInteract();
    else if (k === 'v' && !e.repeat) this.input_?.onTalk(true);
  }

  private keyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    this.held = this.held.filter((h) => h !== k);
    if (k === 'v') this.input_?.onTalk(false);
  }

  update(time: number): void {
    if (typing() && this.held.length) this.held = [];
    const key = this.held[this.held.length - 1];
    const now = performance.now();
    if (key && this.state && now >= this.nextMoveAt) {
      const [dx, dy] = KEYS[key]!;
      this.nextMoveAt = now + REPEAT_MS;
      this.input_?.onMove(dx, dy);
    }

    const frame = Math.floor(time / ANIM_MS);
    if (frame !== this.frame) {
      this.frame = frame;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }

    if (this.slide) {
      const k = Math.min(1, (time - this.slide.t0) / SLIDE_MS);
      const ease = 1 - Math.pow(1 - k, 3);
      const { dx, dy } = this.slide;
      // The new face comes in from the side we walked towards; the old one leaves behind us.
      this.view?.setPosition(Math.round(dx * VIEW_PX * (1 - ease)), Math.round(dy * VIEW_PX * (1 - ease)));
      this.leaving?.setPosition(Math.round(-dx * VIEW_PX * ease), Math.round(-dy * VIEW_PX * ease));
      if (k >= 1) {
        this.leaving?.destroy();
        this.leaving = null;
        this.slide = null;
      }
    }
  }

  private rebuild(): void {
    const at = this.view ? { x: this.view.x, y: this.view.y } : null;
    this.view?.destroy();
    this.view = null;
    const state = this.state;
    if (!state) return;

    const me = this.me;
    const player = state.players[me];
    const { face, up } = player.pose;
    const world = defaultEnv.world;
    const view = this.add.container(0, 0);
    const put = (key: string, sx: number, sy: number, dy = 0) => {
      const img = this.add.image(sx * TILE_PX, sy * TILE_PX + dy, key).setOrigin(0, 0);
      view.add(img);
      return img;
    };

    for (let sy = 0; sy < GRID; sy++) {
      for (let sx = 0; sx < GRID; sx++) {
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

    const [px, py] = canonToScreen(me, face, up, player.pose.x, player.pose.y);

    if (me === 'in') {
      // The inside is dark: light falls off by tile distance from the player.
      for (let sy = 0; sy < GRID; sy++) {
        for (let sx = 0; sx < GRID; sx++) {
          const d = Math.hypot(sx - px, sy - py);
          const dark = Phaser.Math.Clamp((d - LIGHT_NEAR) / (LIGHT_FAR - LIGHT_NEAR), 0, 1) * DARK_MAX;
          if (dark > 0) view.add(this.add.rectangle(sx * TILE_PX, sy * TILE_PX, TILE_PX, TILE_PX, 0x05070d, dark).setOrigin(0, 0));
        }
      }
      view.add(this.add.rectangle(px * TILE_PX - 4, py * TILE_PX - 4, TILE_PX + 8, TILE_PX + 8, 0xf2c14e, 0.12).setOrigin(0, 0));
    } else {
      view.add(this.add.rectangle(px * TILE_PX + 3, py * TILE_PX + 14, 10, 2, 0x000000, 0.25).setOrigin(0, 0));
    }

    put(this.art.player(me, player.steps), px, py).setFlipX(player.pose.dir < 0);
    if (player.carrying) {
      const item = state.items[player.carrying];
      if (item) put(this.art.item(item.kind), px, py, -11);
    }

    if (at) view.setPosition(at.x, at.y);
    else if (this.slide) view.setPosition(this.slide.dx * VIEW_PX, this.slide.dy * VIEW_PX);
    this.view = view;
  }
}
