import type Phaser from 'phaser';
import type { Side } from '@cubic/shared';
import { menuAction } from '../input/keymap';
import { EASE, ROLE, TIME, hex } from '../style/tokens';
import { Button, slice, text, textCentred, type Text } from './kit';
import { soloFocus, soloOrder, type PopupDraft, type Restorable, type SoloFocus } from './popupState';

/** What the solo popup is opened with. */
export interface SoloPopupOptions {
  /** This tab left a solo game the server still holds: offer to go on with it. */
  resume: boolean;
  /** Put back after a resize, with the focus where it was: it does not drop in again. */
  focus?: SoloFocus | null;
}

/**
 * PLAY SOLO: pick your side of the wall, the AI partner takes the other one. Left and
 * right move between the two sides, down reaches Cancel, Enter or Space picks, Esc closes.
 * Every choice is a real button, so the mouse and a finger work the same way. Plain
 * images, text and rectangles only: the same in WebGL and Canvas.
 *
 * A solo game this tab pressed Leave in is held for a minute like any seat. There is no
 * room code to type to get back into it, so while it is held the popup has one more
 * button: CONTINUE LAST GAME.
 */
export class AiPopup implements Restorable {
  private root: Phaser.GameObjects.Container;
  private buttons: Record<'out' | 'in' | 'cancel', Button> & { resume?: Button };
  private message: Text;
  private focus: SoloFocus = 'out';
  private busy = false;
  private closed = false;
  /** The held game is still there (it runs out while the popup is up: the button goes grey). */
  private canResume: boolean;
  /** The same surface as the join popup, so the mode screen can hold either: no code here. */
  readonly value = null;
  /** Still up (not cancelled). */
  get open(): boolean {
    return !this.closed;
  }
  /** What a resize keeps: where the keyboard was. */
  draft(): PopupDraft {
    return { kind: 'solo', focus: this.focus };
  }
  private readonly w = 196;
  private readonly h: number;

  constructor(
    private scene: Phaser.Scene,
    private onPick: (side: Side) => void,
    private onResume: () => void,
    private onClose: () => void,
    opts: SoloPopupOptions,
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    this.canResume = opts.resume;
    const h = (this.h = opts.resume ? 142 : 112);
    const { w } = this;
    // a veil, not a curtain: the world stays in view (and nothing behind it can be clicked)
    const veil = scene.add.rectangle(0, 0, W, H, hex(ROLE.ink), 0.45).setOrigin(0, 0).setInteractive();
    const panel = slice(scene, 0, 0, 'panel', w, h);
    const title = textCentred(scene, w / 2, 14, 'PLAY SOLO');
    const hint = textCentred(scene, w / 2, 28, 'PICK YOUR SIDE OF THE WALL.', ROLE.ink);
    const hint2 = textCentred(scene, w / 2, 38, 'THE AI TAKES THE OTHER ONE.', ROLE.ink);
    this.buttons = {
      out: new Button(scene, { label: 'OUTSIDE', variant: 'out', width: 82, onClick: () => this.pick('out') }).setPosition(12, 48),
      in: new Button(scene, { label: 'INSIDE', variant: 'in', width: 82, onClick: () => this.pick('in') }).setPosition(w - 94, 48),
      cancel: new Button(scene, { label: 'CANCEL', variant: 'light', width: 80, onClick: () => this.close() }).setPosition(Math.round((w - 80) / 2), h - 34),
    };
    if (opts.resume) this.buttons.resume = new Button(scene, { label: 'CONTINUE LAST GAME', variant: 'dark', width: w - 24, onClick: () => this.resume() }).setPosition(12, 78);
    this.message = text(scene, 0, 0, '', ROLE.danger);

    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    const body = scene.add.container(x, y, [panel, title, hint, hint2, ...Object.values(this.buttons).map((b) => b.root), this.message]);
    this.root = scene.add.container(0, 0, [veil, body]).setDepth(10);
    if (!opts.focus) {
      // it drops in from just above
      body.setY(y - 8).setAlpha(0);
      scene.tweens.add({ targets: body, y, alpha: 1, duration: TIME.panel, ease: EASE.back });
      veil.setAlpha(0);
      scene.tweens.add({ targets: veil, alpha: 1, duration: TIME.panel });
    }
    this.setFocus(soloFocus(opts.focus ?? 'out', null, opts.resume));
  }

  key(e: KeyboardEvent): void {
    if (this.closed) return;
    const action = menuAction(e);
    if (action === 'back') this.close();
    else if (action === 'select') this.buttons[this.focus]?.press();
    else this.setFocus(soloFocus(this.focus, action, !!this.buttons.resume));
  }

  paste(): void {}

  private setFocus(focus: SoloFocus): void {
    this.focus = focus;
    for (const key of soloOrder(true)) this.buttons[key]?.setFocus(key === focus);
  }

  /** The held game ran out (or is back): CONTINUE follows. */
  setResume(on: boolean): void {
    this.canResume = on;
    this.buttons.resume?.setEnabled(on && !this.busy);
  }

  private resume(): void {
    if (this.busy || this.closed || !this.canResume) return;
    this.message.setText('');
    this.onResume();
  }

  private pick(side: Side): void {
    if (this.busy || this.closed) return;
    this.message.setText('');
    this.onPick(side);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.buttons.out.setEnabled(!busy);
    this.buttons.in.setEnabled(!busy);
    this.buttons.resume?.setEnabled(!busy && this.canResume);
  }

  /** The server said no: say why, under the two sides. */
  fail(reason: string): void {
    this.message.setText(reason.toUpperCase().slice(0, 44));
    this.message.setPosition(Math.max(4, Math.round((this.w - this.message.width) / 2)), 70);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.tweens.add({ targets: this.root, alpha: 0, duration: TIME.quick, onComplete: () => this.root.destroy() });
    this.onClose();
  }
}
