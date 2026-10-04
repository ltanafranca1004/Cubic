import Phaser from 'phaser';
import type { ButtonVariant } from '../style/assets';
import { device } from '../style/scale';
import { EASE, ROLE, SIZE, TIME, hex } from '../style/tokens';

// The UI kit for the menu scenes: text, 9-slice panels and buttons, built from the PNGs in
// assets/ui. Everything sits on whole pixels; positions are top-left unless said otherwise.

export const FONT = 'm5x7';
/** In an m5x7 line (16px cell) the capitals sit on rows 4 to 10. */
const CAP_TOP = 4;
const CAP_HEIGHT = 7;

export type Text = Phaser.GameObjects.BitmapText;

/**
 * THE CURSOR over anything that can be clicked: the pixel hand (the DOM uses the same one,
 * ui/css.ts). Everything else keeps the pixel arrow the page already has. Pass it to every
 * interactive object that does something: `setInteractive({ cursor: HAND })`. Never
 * `useHandCursor` (that is the system's hand) and never on something that only blocks
 * clicks (a veil). The variable is set per UI scale by ui/cubicUI.ts.
 */
export const HAND = 'var(--cursor-hand), pointer';

// RENDERER-PROOF BY DESIGN. Phaser falls back to its Canvas renderer when the browser has
// no WebGL (hardware acceleration off, some laptops and school machines). Canvas cannot
// tint bitmap text, draw drop shadows or draw NineSlice objects: buttons lose their
// panels and every label turns white. So the kit uses none of those. Text colour and
// outline are baked into per-colour copies of the font, and 9-slice boxes are composited
// once into plain textures. The menus then look identical in WebGL and Canvas.

interface Glyph {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  data: object;
  kerning: object;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
interface FontEntry {
  data: { font: string; size: number; lineHeight: number; chars: Record<string, Glyph> };
  texture: string;
  frame: string | null;
}

/**
 * The m5x7 font in one colour, optionally with a 1px ink outline, as its own bitmap font.
 * Built once per colour from the loaded font texture.
 */
export function fontKey(scene: Phaser.Scene, color: string, outline = false): string {
  const key = `${FONT}:${color}${outline ? ':o' : ''}`;
  const cache = scene.cache.bitmapFont;
  if (cache.exists(key)) return key;
  const base = cache.get(FONT) as FontEntry;
  const src = scene.textures.get(FONT).getSourceImage() as HTMLImageElement;
  const pad = outline ? 1 : 0;
  const w = src.width + pad * 2;
  const h = src.height + pad * 2;

  /** The glyph sheet filled with one colour. */
  const tinted = (c: string) => {
    const layer = document.createElement('canvas');
    layer.width = src.width;
    layer.height = src.height;
    const g = layer.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = c;
    g.fillRect(0, 0, layer.width, layer.height);
    return layer;
  };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  if (outline) {
    const ink = tinted(ROLE.ink);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.drawImage(ink, pad + dx, pad + dy);
  }
  g.drawImage(tinted(color), pad, pad);
  const texture = scene.textures.addCanvas(key, canvas)!;

  // Same glyphs. With an outline each one is a pixel larger on every side (the sheet has
  // spare room around every glyph) and drawn a pixel up and left, so the letter stays put.
  const chars: Record<string, Glyph> = {};
  for (const [code, c] of Object.entries(base.data.chars)) {
    const width = c.width + pad * 2;
    const height = c.height + pad * 2;
    chars[code] = {
      ...c,
      width,
      height,
      xOffset: c.xOffset - pad,
      yOffset: c.yOffset - pad,
      centerX: Math.floor(width / 2),
      centerY: Math.floor(height / 2),
      u0: c.x / w,
      v0: 1 - c.y / h,
      u1: (c.x + width) / w,
      v1: 1 - (c.y + height) / h,
    };
    if (width && height) texture.add(String.fromCharCode(Number(code)), 0, c.x, c.y, width, height);
  }
  cache.add(key, { data: { ...base.data, chars }, texture: key, frame: null });
  return key;
}

/**
 * A line of m5x7. `size` is a whole multiple of the font (1 = 16px). `outline` adds a 1px
 * ink outline: use it for any text that sits on the sky, clouds or art.
 */
export function text(scene: Phaser.Scene, x: number, y: number, value: string, color: string = ROLE.ink, size = 1, outline = false): Text {
  return scene.add.bitmapText(Math.round(x), Math.round(y), fontKey(scene, color, outline), value, SIZE.font * size).setData('outline', outline);
}

/** Change a text's colour (and optionally whether it is outlined). */
export function paint(t: Text, color: string, outline: boolean = t.getData('outline') === true): Text {
  const key = fontKey(t.scene, color, outline);
  if (t.font !== key) t.setFont(key, t.fontSize);
  return t.setData('outline', outline);
}

/** Put a text so its capitals are centred on (cx, cy). */
export function centre(t: Text, cx: number, cy: number): Text {
  const size = t.fontSize / SIZE.font;
  return t.setPosition(Math.round(cx - t.width / 2), Math.round(cy - (CAP_TOP + CAP_HEIGHT / 2) * size));
}

export function textCentred(scene: Phaser.Scene, cx: number, cy: number, value: string, color: string = ROLE.ink, size = 1, outline = false): Text {
  return centre(text(scene, 0, 0, value, color, size, outline), cx, cy);
}

/**
 * A 9-slice box from a 24x24 (6px corner) or 12x12 (4px corner) kit texture, composited
 * once per size into an ordinary texture (see the note above: no NineSlice objects).
 */
export function slice(scene: Phaser.Scene, x: number, y: number, key: string, width: number, height: number): Phaser.GameObjects.Image {
  const built = `${key}@${width}x${height}`;
  if (!scene.textures.exists(built)) {
    const src = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const c = src.width >= 24 ? SIZE.slice : 4;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // source and destination edges of the three columns and rows
    const sx = [0, c, src.width - c, src.width];
    const sy = [0, c, src.height - c, src.height];
    const dx = [0, c, width - c, width];
    const dy = [0, c, height - c, height];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const sw = sx[col + 1]! - sx[col]!;
        const sh = sy[row + 1]! - sy[row]!;
        const dw = dx[col + 1]! - dx[col]!;
        const dh = dy[row + 1]! - dy[row]!;
        if (dw > 0 && dh > 0) g.drawImage(src, sx[col]!, sy[row]!, sw, sh, dx[col]!, dy[row]!, dw, dh);
      }
    }
    scene.textures.addCanvas(built, canvas);
  }
  return scene.add.image(Math.round(x), Math.round(y), built).setOrigin(0, 0);
}

/** Buttons on screen right now, for the end-to-end check (tools/screens/check.ts). */
const live = new Set<Button>();
if (import.meta.env.DEV) {
  Object.assign(window, {
    /** Label, enabled and position (art pixels) of every button on screen. */
    __cubicButtons: () => [...live].filter((b) => b.root.scene.scene.isActive()).map((b) => b.probe()),
  });
}

/** How far past its box a button listens on a touch screen, at most, in art pixels (half the gap in a menu). */
const TOUCH_GROW = 4;
/** How far the focus outline reaches outside a button, in art pixels. */
const FOCUS_RING = 4;

const TEXT_ON: Record<ButtonVariant, string> = { dark: ROLE.paper, light: ROLE.ink, out: ROLE.ink, in: ROLE.ink, danger: ROLE.paper };

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  width: number;
  /** Box height in art pixels (default: the standard menu button). */
  height?: number;
  /** Label size as a multiple of the font (default 1). */
  labelSize?: number;
  /** A slow glow behind the button: "press me". */
  pulse?: boolean;
  onClick(): void;
}

/**
 * A button with idle, hover, pressed and disabled looks. The press shows for a beat
 * (TIME.press) before the action fires, so every click is seen as well as felt.
 */
export class Button {
  readonly root: Phaser.GameObjects.Container;
  readonly width: number;
  readonly height: number;
  private faces: Record<'idle' | 'hover' | 'pressed' | 'disabled', Phaser.GameObjects.Image>;
  private shadow: Phaser.GameObjects.Rectangle;
  /** The keyboard focus outline: ink, amber, ink, just outside the box. */
  private ring: Phaser.GameObjects.Graphics;
  private zone: Phaser.GameObjects.Zone;
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
    this.height = opts.height ?? SIZE.buttonHeight + 2;
    const face = (state: string) => slice(scene, 0, 0, state === 'disabled' ? 'btn-disabled' : `btn-${this.variant}-${state}`, this.width, this.height);
    this.faces = { idle: face('idle'), hover: face('hover'), pressed: face('pressed'), disabled: face('disabled') };
    this.label = text(scene, 0, 0, opts.label, TEXT_ON[this.variant], opts.labelSize ?? 1);
    // a soft drop shadow lifts the button off whatever is behind it
    this.shadow = scene.add.rectangle(2, 3, this.width, this.height - 1, hex(ROLE.ink), 0.3).setOrigin(0, 0);
    // Under a thumb the button listens a little past its own box (it looks the same): up to
    // 44 CSS pixels high, and never further than half the gap to the next button.
    const grow = device().touch ? Math.min(TOUCH_GROW, Math.max(0, Math.ceil((44 / scene.scale.zoom - this.height) / 2))) : 0;
    const zone = scene.add.zone(0, 0, this.width, this.height).setOrigin(0, 0);
    zone.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-grow, -grow, this.width + grow * 2, this.height + grow * 2), hitAreaCallback: Phaser.Geom.Rectangle.Contains, cursor: HAND });
    // Three plain bands (filled rectangles: the same in WebGL and Canvas), so the outline
    // reads on the white menu, the sky and the dark half alike. It is a shape, not a tint.
    this.ring = scene.add.graphics();
    const band = (grow: number, color: string) => this.ring.fillStyle(hex(color)).fillRect(-grow, -grow, this.width + grow * 2, this.height + grow * 2);
    band(FOCUS_RING, ROLE.ink);
    band(FOCUS_RING - 1, ROLE.focus);
    band(1, ROLE.ink);
    this.ring.setVisible(false);
    const parts: Phaser.GameObjects.GameObject[] = [this.ring, this.shadow, ...Object.values(this.faces), this.label, zone];
    if (opts.pulse) {
      const glow = scene.add.rectangle(-3, -3, this.width + 6, this.height + 6, hex(ROLE.paper), 0.15).setOrigin(0, 0);
      scene.tweens.add({ targets: glow, alpha: 0.65, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      parts.unshift(glow);
    }
    this.root = scene.add.container(0, 0, parts);
    this.zone = zone;
    live.add(this);
    this.root.once(Phaser.GameObjects.Events.DESTROY, () => live.delete(this));
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

  /** Where the button is and what it says (dev check). */
  probe(): { label: string; enabled: boolean; focused: boolean; alpha: number; x: number; y: number; width: number; height: number } {
    const m = this.zone.getWorldTransformMatrix();
    return { label: this.label.text, enabled: this.enabled, focused: this.focused, alpha: this.root.alpha, x: m.tx, y: m.ty, width: this.width, height: this.height };
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
      // a disabled button cannot be clicked: it keeps the arrow
      if (this.zone.input) this.zone.input.cursor = enabled ? HAND : '';
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

  /** Keyboard focus: the hover face plus the focus outline. */
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
    this.ring.setVisible(this.focused);
    paint(this.label, this.enabled ? TEXT_ON[this.variant] : ROLE.dimOnLight);
    // pressed: the button sinks into its shadow
    this.shadow.setVisible(this.enabled && state !== 'pressed');
    // the face is the box minus its 3px lip; a pressed face sits 2px lower
    centre(this.label, this.width / 2, (this.height - 3) / 2 + (state === 'pressed' ? 2 : 0));
  }
}

/** The shake (x) or hop (y) playing on a target right now: one per target and axis. */
const nudges = { x: new WeakMap<object, Phaser.Tweens.Tween>(), y: new WeakMap<object, Phaser.Tweens.Tween>() };

/**
 * Play a shake or a hop around the target's REST position, which the caller passes in. It
 * is never read from the target: a second call while the first is still playing would
 * read a mid-swing position, return to that, and so creep a little further every time.
 * A nudge still playing on the same target is stopped first.
 */
function nudge<A extends 'x' | 'y'>(scene: Phaser.Scene, axis: A, target: Record<A, number>, base: number, config: Phaser.Types.Tweens.TweenBuilderConfig): void {
  const running = nudges[axis];
  running.get(target)?.stop();
  target[axis] = base;
  const tween = scene.tweens.add({
    ...config,
    onComplete: () => {
      target[axis] = base;
      if (running.get(target) === tween) running.delete(target);
    },
  });
  running.set(target, tween);
}

/** Three quick swings left and right of `baseX`, the target's rest x: "no". Ends on `baseX`. */
export function shake(scene: Phaser.Scene, target: { x: number }, baseX: number, amount = 4): void {
  nudge(scene, 'x', target, baseX, { targets: target, x: { from: baseX - amount, to: baseX + amount }, duration: TIME.shake / 6, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
}

/** A small hop up from `baseY`, the target's rest y: "picked". Ends on `baseY`. */
export function hop(scene: Phaser.Scene, target: { y: number }, baseY: number, height = 6): void {
  nudge(scene, 'y', target, baseY, { targets: target, y: { from: baseY, to: baseY - height }, duration: TIME.quick, yoyo: true, ease: EASE.out });
}

/** Deterministic random numbers, so clouds sit in the same place on every screen. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
