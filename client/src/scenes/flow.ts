import Phaser from 'phaser';
import { C, TIME, hex } from '../style/tokens';
import type { UIActions, UIState } from '../ui/hooks';

// SCREEN FLOW. Which menu scene is showing, and how one hands over to the next:
//
//   start  --(Play: the dive through the clouds)-->  mode
//   mode   --(create / join: in a lobby)----------->  side
//   side   --(host starts) / mode --(AI)----------->  backdrop (behind the in-game HUD)
//
// The UI state decides where we should be; the flow only animates getting there.

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

export class Flow {
  current: Screen | null = null;
  /** Play was pressed (or we were dropped straight into a room): the title is behind us. */
  entered = false;
  private busy = false;
  private loaded = false;

  constructor(
    private game: Phaser.Game,
    private state: () => UIState,
  ) {}

  /** The assets are in: scenes can start. */
  ready(): void {
    this.loaded = true;
    this.route();
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
      scenes.start(to, {});
      return;
    }
    this.busy = true;
    const half = (to === 'backdrop' ? TIME.enterGame : TIME.scene) / 2;
    const cam = scenes.getScene(from).cameras.main;
    const { r, g, b } = splitRgb(hex(fade.color));
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      scenes.stop(from);
      scenes.start(to, { fadeIn: half, fadeColor: fade.color });
      this.busy = false;
      this.route(); // the state may have moved on while we were fading
    });
    cam.fadeOut(half, r, g, b);
  }

  /** Back from the mode screen to the title. Ignored mid-fade, mid-dive and when already there. */
  back(): void {
    if (!this.loaded || this.busy || this.current !== 'mode') return;
    this.go('start');
  }

  /** StartScene began its dive: the mode screen appears underneath it. */
  dive(): void {
    this.busy = true;
    this.entered = true;
    this.current = 'mode';
    this.game.scene.run('mode', { intro: true });
    this.game.scene.bringToTop('start');
  }

  diveDone(): void {
    this.game.scene.stop('start');
    this.busy = false;
    this.route();
  }
}

export function splitRgb(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
}

/** Data a scene is started with. */
export interface SceneData {
  /** Fade in from this colour over this many ms. */
  fadeIn?: number;
  fadeColor?: string;
  /** Mode screen only: arrive through the clouds. */
  intro?: boolean;
}

/** Base for the menu scenes: state access, fade in, rebuild on resize. */
export abstract class MenuScene extends Phaser.Scene {
  protected ctx!: StageContext;
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
    if (data.fadeIn) {
      const { r, g, b } = splitRgb(hex(data.fadeColor ?? C.white));
      this.cameras.main.fadeIn(data.fadeIn, r, g, b);
    }
    const rebuild = () => this.scene.restart({});
    this.game.events.on(UI_EVENT, this.onUi);
    this.scale.on(Phaser.Scale.Events.RESIZE, rebuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(UI_EVENT, this.onUi);
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
      if (document.activeElement instanceof HTMLInputElement || document.querySelector('.cu-modal.on')) return;
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', onKey));
  }

  /** The UI state changed: update what is on screen. */
  protected abstract sync(): void;
}
