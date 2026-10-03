import Phaser from 'phaser';
import type { ButtonVariant } from '../style/assets';
import { EASE, ROLE, SIZE, TIME, hex } from '../style/tokens';

// The UI kit for the menu scenes: text, 9-slice panels and buttons, built from the PNGs in
// assets/ui. Everything sits on whole pixels; positions are top-left unless said otherwise.

export const FONT = 'm5x7';
/** In an m5x7 line (16px cell) the capitals sit on rows 4 to 10. */
const CAP_TOP = 4;
const CAP_HEIGHT = 7;

export type Text = Phaser.GameObjects.BitmapText;

/** A line of m5x7. `size` is a whole multiple of the font (1 = 16px). */
export function text(scene: Phaser.Scene, x: number, y: number, value: string, color: string = ROLE.ink, size = 1): Text {
  return scene.add.bitmapText(Math.round(x), Math.round(y), FONT, value, SIZE.font * size).setTint(hex(color));
}

/** Put a text so its capitals are centred on (cx, cy). */
export function centre(t: Text, cx: number, cy: number): Text {
  const size = t.fontSize / SIZE.font;
  return t.setPosition(Math.round(cx - t.width / 2), Math.round(cy - (CAP_TOP + CAP_HEIGHT / 2) * size));
}

export function textCentred(scene: Phaser.Scene, cx: number, cy: number, value: string, color: string = ROLE.ink, size = 1): Text {
  return centre(text(scene, 0, 0, value, color, size), cx, cy);
}

/** A 9-slice box from a 24x24 (6px corner) or 12x12 (4px corner) kit texture. */
export function slice(scene: Phaser.Scene, x: number, y: number, key: string, width: number, height: number): Phaser.GameObjects.NineSlice {
  const corner = scene.textures.get(key).getSourceImage().width >= 24 ? SIZE.slice : 4;
  return scene.add.nineslice(Math.round(x), Math.round(y), key, undefined, width, height, corner, corner, corner, corner).setOrigin(0, 0);
}

const TEXT_ON: Record<ButtonVariant, string> = { dark: ROLE.paper, light: ROLE.ink, out: ROLE.ink, in: ROLE.ink, danger: ROLE.paper };

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  width: number;
  onClick(): void;
}

/**
 * A button with idle, hover, pressed and disabled looks. The press shows for a beat
 * (TIME.press) before the action fires, so every click is seen as well as felt.
 */
export class Button {
  readonly root: Phaser.GameObjects.Container;
  readonly width: number;
  readonly height = SIZE.buttonHeight + 2;
  private faces: Record<'idle' | 'hover' | 'pressed' | 'disabled', Phaser.GameObjects.NineSlice>;
  private label: Text;
  private enabled = true;
  private over = false;
  private down = false;
  private focused = false;
  private busy = false;
  private variant: ButtonVariant;

  constructor(
    private scene: Phaser.Scene,
    private opts: ButtonOptions,
  ) {
    this.variant = opts.variant ?? 'dark';
    this.width = opts.width;
    const face = (state: string) => slice(scene, 0, 0, state === 'disabled' ? 'btn-disabled' : `btn-${this.variant}-${state}`, this.width, this.height);
    this.faces = { idle: face('idle'), hover: face('hover'), pressed: face('pressed'), disabled: face('disabled') };
    this.label = text(scene, 0, 0, opts.label);
    const zone = scene.add.zone(0, 0, this.width, this.height).setOrigin(0, 0).setInteractive();
    this.root = scene.add.container(0, 0, [...Object.values(this.faces), this.label, zone]);
    zone.on('pointerover', () => {
      this.over = true;
      this.draw();
    });
    zone.on('pointerout', () => {
      this.over = false;
      this.down = false;
      this.draw();
    });
    zone.on('pointerdown', () => {
      if (!this.enabled || this.busy) return;
      this.down = true;
      this.draw();
    });
    zone.on('pointerup', () => {
      if (this.down) this.press();
    });
    this.draw();
  }

  /** Click it from code (keyboard): the same pressed beat, then the action. */
  press(): void {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    this.down = true;
    this.draw();
    this.scene.time.delayedCall(TIME.press, () => {
      this.busy = false;
      this.down = false;
      this.draw();
      this.opts.onClick();
    });
  }

  setPosition(x: number, y: number): this {
    this.root.setPosition(Math.round(x), Math.round(y));
    return this;
  }

  /** Centre the button on x, with its top at y. */
  setCentre(cx: number, y: number): this {
    return this.setPosition(cx - this.width / 2, y);
  }

  setEnabled(enabled: boolean): this {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.draw();
    }
    return this;
  }

  setLabel(value: string): this {
    if (this.label.text !== value) {
      this.label.setText(value);
      this.draw();
    }
    return this;
  }

  /** Keyboard focus looks like hover. */
  setFocus(focused: boolean): this {
    if (this.focused !== focused) {
      this.focused = focused;
      this.draw();
    }
    return this;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private draw(): void {
    const state = !this.enabled ? 'disabled' : this.down ? 'pressed' : this.over || this.focused ? 'hover' : 'idle';
    for (const [name, face] of Object.entries(this.faces)) face.setVisible(name === state);
    this.label.setTint(hex(this.enabled ? TEXT_ON[this.variant] : ROLE.dimOnLight));
    // the face is the box minus its 3px lip; a pressed face sits 2px lower
    centre(this.label, this.width / 2, (this.height - 3) / 2 + (state === 'pressed' ? 2 : 0));
  }
}

/** Three quick swings left and right: "no". Returns to where it started. */
export function shake(scene: Phaser.Scene, target: { x: number }, amount = 4): void {
  const x = target.x;
  scene.tweens.add({
    targets: target,
    x: { from: x - amount, to: x + amount },
    duration: TIME.shake / 6,
    yoyo: true,
    repeat: 2,
    ease: 'Sine.easeInOut',
    onComplete: () => (target.x = x),
  });
}

/** A small hop: "picked". */
export function hop(scene: Phaser.Scene, target: { y: number }, height = 6): void {
  const y = target.y;
  scene.tweens.add({ targets: target, y: y - height, duration: TIME.quick, yoyo: true, ease: EASE.out, onComplete: () => (target.y = y) });
}

/** Deterministic random numbers, so clouds sit in the same place on every screen. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
