import Phaser from 'phaser';
import { overlayOwnsInput } from '../input/overlay';
import { sizeKey } from '../style/fit';
import { C, TIME, hex } from '../style/tokens';
import type { UIActions, UIState } from '../ui/hooks';
import type { CubeBackdropScene } from './CubeBackdropScene';

// SCREEN FLOW. Which menu scene is showing, and how one hands over to the next:
//
//   start  --(Play: the dive through the clouds)-->  mode
//   mode   --(create / join: in a lobby)----------->  side
//   side   --(host starts) / mode --(AI)----------->  backdrop (behind the in-game HUD)
//
// The UI state decides where we should be; the flow only animates getting there.
//
// Under start, mode and side runs the cube scene (CubeBackdropScene, key 'cube'). It is
// not one of these screens and is never stopped between them: the menus fade over it and
// the flow only tells it which screen it is behind.

export type Screen = 'start' | 'mode' | 'side' | 'backdrop';

/** Scenes get the UI state and actions through the registry, never from the network. */
export interface StageContext {
  actions: UIActions;
  state: UIState;
  flow: Flow;
}

export const ctxOf = (scene: Phaser.Scene): StageContext => scene.registry.get('ctx') as StageContext;
/** Game event fired on every UI state change (payload: the UIState). */
export const UI_EVENT = 'cubic:ui';
/** Game event fired when a transition has ended: scenes that put off a rebuild do it now. */
export const SETTLED_EVENT = 'cubic:settled';
/**
 * How long after a transition should have ended the flow ends it by itself. Its end
 * normally comes from the leaving scene (a tween, a camera fade, a timer); if that scene
 * is restarted or stopped meanwhile the end never comes, and the menus would stay stuck.
 */
const GUARD_MS = 1000;

export class Flow {
  current: Screen | null = null;
  /** Play was pressed (or we were dropped straight into a room): the title is behind us. */
  entered = false;
  private busy = false;
  private loaded = false;
  /** Ends the transition under way. Safe to call twice: only the first call counts. */
  private finish: (() => void) | null = null;
  private guard: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private game: Phaser.Game,
    private state: () => UIState,
  ) {}

  /** The assets are in: scenes can start. */
  ready(): void {
    this.loaded = true;
    this.route();
  }

  /** Tell the cube scene which screen it is behind now (the game hides it). */
  private cube(to: Screen, ms: number): void {
    (this.game.scene.getScene('cube') as CubeBackdropScene).show(to === 'backdrop' ? 'off' : to, ms);
  }

  /** A transition is under way: scenes must not restart until it has ended. */
  get moving(): boolean {
    return this.busy;
  }

  /**
   * Start a transition of `ms`. `done` runs exactly once: when the caller's own end fires
   * (through `this.finish`), or from the guard timer if that end was lost.
   */
  private begin(ms: number, done: () => void): () => void {
    this.busy = true;
    const finish = () => {
      if (this.finish !== finish) return;
      clearTimeout(this.guard);
      this.finish = null;
      done();
      this.busy = false;
      this.game.events.emit(SETTLED_EVENT);
      this.route(); // the state may have moved on meanwhile
    };
    this.finish = finish;
    this.guard = setTimeout(finish, ms + GUARD_MS);
    return finish;
  }

  /** The stage is going away: no timer may fire into a destroyed game. */
  destroy(): void {
    clearTimeout(this.guard);
    this.finish = null;
  }

  private want(): Screen {
    const s = this.state();
    if (s.screen === 'game') return 'backdrop';
    if (s.lobby) return 'side';
    return this.entered ? 'mode' : 'start';
  }

  /** Move to the screen the state asks for, if we are not already there or on the way. */
  route(): void {
    if (!this.loaded || this.busy) return;
    const to = this.want();
    if (to === this.current) return;
    this.go(to);
  }

  private go(to: Screen): void {
    const from = this.current;
    const scenes = this.game.scene;
    // into the dark room we fade through ink, everywhere else through white
    const dark = to === 'backdrop' && this.state().side === 'in';
    const fade = { color: dark ? C.ink : C.white };
    this.current = to;
    this.entered = to !== 'start';
    if (!from) {
      this.cube(to, 0);
      scenes.start(to, {});
      return;
    }
    const half = (to === 'backdrop' ? TIME.enterGame : TIME.scene) / 2;
    const scene = scenes.getScene(from);
    const cam = scene.cameras.main;
    // Menu to menu, only the menu fades: the cube underneath keeps turning and glides to
    // its place behind the next screen. Into and out of the game everything goes through
    // a colour, and the cube is put away (or brought back) while the screen is covered.
    const menus = to !== 'backdrop' && from !== 'backdrop';
    const next = this.begin(half, () => {
      scenes.stop(from);
      if (!menus) this.cube(to, 0);
      scenes.start(to, menus ? { fadeIn: half, soft: true } : { fadeIn: half, fadeColor: fade.color });
    });
    if (menus) {
      this.cube(to, half * 2);
      scene.tweens.add({ targets: cam, alpha: 0, duration: half, onComplete: next });
      return;
    }
    const { r, g, b } = splitRgb(hex(fade.color));
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, next);
    cam.fadeOut(half, r, g, b);
  }

  /** Back from the mode screen to the title. Ignored mid-fade, mid-dive and when already there. */
  back(): void {
    if (!this.loaded || this.busy || this.current !== 'mode') return;
    this.go('start');
  }

  /** StartScene began its dive: the mode screen appears underneath it. */
  dive(): void {
    this.begin(TIME.dive, () => this.game.scene.stop('start'));
    this.entered = true;
    this.current = 'mode';
    this.game.scene.run('mode', { intro: true });
    this.game.scene.bringToTop('start');
    (this.game.scene.getScene('cube') as CubeBackdropScene).dive(TIME.dive);
  }

  diveDone(): void {
    this.finish?.();
  }
}

/**
 * Shown on the title and the mode screen instead of "waking the server" when the server
 * answers but refuses this site: its CLIENT_ORIGIN does not list the address the game is
 * served from. The socket keeps retrying, so it clears by itself once that is fixed.
 */
export const BLOCKED_TEXT = 'THE SERVER REFUSES THIS SITE: CHECK CLIENT_ORIGIN. RETRYING...';

export function splitRgb(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
}

/** Data a scene is started with. */
export interface SceneData {
  /** Fade in from this colour over this many ms. */
  fadeIn?: number;
  fadeColor?: string;
  /** Fade the scene itself in (over the cube behind it) instead of fading from a colour. */
  soft?: boolean;
  /** Mode screen only: arrive through the clouds. */
  intro?: boolean;
  /** The scene was restarted where it stood (a resize): keep what the player was doing. */
  rebuilt?: boolean;
}

/** Base for the menu scenes: state access, fade in, rebuild on resize. */
export abstract class MenuScene extends Phaser.Scene {
  protected ctx!: StageContext;
  /** The window was resized during a transition: rebuild when it has ended. */
  private stale = false;
  private onUi = (): void => {
    if (this.scene.isActive()) this.sync();
  };

  /** Logical screen size in art pixels. */
  protected get W(): number {
    return this.scale.width;
  }
  protected get H(): number {
    return this.scale.height;
  }
  protected get ui(): UIState {
    return this.ctx.state;
  }

  init(): void {
    this.ctx = ctxOf(this);
  }

  /** Call at the end of create(): fade in, listen for state changes and resizes. */
  protected begin(data: SceneData): void {
    if (data.fadeIn && data.soft) {
      this.cameras.main.setAlpha(0);
      this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: data.fadeIn });
    } else if (data.fadeIn) {
      const { r, g, b } = splitRgb(hex(data.fadeColor ?? C.white));
      this.cameras.main.fadeIn(data.fadeIn, r, g, b);
    }
    // A restart in the middle of a transition would kill the tween, fade or timer that
    // ends it, so a resize then only marks the scene, and it is rebuilt once the flow has
    // settled (if it is still the screen being shown: the one we left is stopped instead).
    this.stale = false;
    // Phaser says "resize" for every resize event of the window, also when the canvas kept
    // its size (a phone's toolbar, a keyboard, the page settling after a turn). A restart
    // then would drop the button press under the finger, so only a real change rebuilds.
    const built = sizeKey(this.scale);
    const rebuild = () => {
      if (sizeKey(this.scale) === built) return;
      if (this.ctx.flow.moving) this.stale = true;
      else this.scene.restart({ rebuilt: true });
    };
    const settled = () => {
      if (this.stale && this.ctx.flow.current === this.scene.key) this.scene.restart({ rebuilt: true });
    };
    this.game.events.on(UI_EVENT, this.onUi);
    this.game.events.on(SETTLED_EVENT, settled);
    this.scale.on(Phaser.Scale.Events.RESIZE, rebuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(UI_EVENT, this.onUi);
      this.game.events.off(SETTLED_EVENT, settled);
      this.scale.off(Phaser.Scale.Events.RESIZE, rebuild);
    });
    this.sync();
  }

  /**
   * Keys for this scene, straight from the window (every key press arrives once and in
   * order, also when several land in one frame). Ignored while the player is typing in a
   * text field or a DOM panel (settings) is open on top of the scene.
   */
  protected keys(fn: (e: KeyboardEvent) => void): void {
    const onKey = (e: KeyboardEvent) => {
      if (!this.scene.isActive() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (overlayOwnsInput()) return;
      // Tab moved the focus to a DOM button (the settings gear): the key is that button's
      if (document.activeElement instanceof HTMLButtonElement) return;
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', onKey));
  }

  /** The UI state changed: update what is on screen. */
  protected abstract sync(): void;
}
