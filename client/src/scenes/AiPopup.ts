import type Phaser from 'phaser';
import type { Side } from '@cubic/shared';
import { menuAction } from '../input/keymap';
import { EASE, ROLE, TIME, hex } from '../style/tokens';
import { Button, slice, text, textCentred, type Text } from './kit';

type Focus = 'out' | 'in' | 'cancel';

/**
 * PLAY WITH AI: pick your side of the wall, the AI partner takes the other one. Left and
 * right move between the two sides, down reaches Cancel, Enter or Space picks, Esc closes.
 * Every choice is a real button, so the mouse and a finger work the same way. Plain
 * images, text and rectangles only: the same in WebGL and Canvas.
 */
export class AiPopup {
  private root: Phaser.GameObjects.Container;
  private buttons: Record<Focus, Button>;
  private message: Text;
  private focus: Focus = 'out';
  private busy = false;
  private closed = false;
  // The same surface as the join popup, so the mode screen can hold either: there is no
  // code here to keep over a resize, and nothing to paste.
  readonly open = false;
  readonly value = null;
  private readonly w = 196;
  private readonly h = 112;

  constructor(
    private scene: Phaser.Scene,
    private onPick: (side: Side) => void,
    private onClose: () => void,
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    const { w, h } = this;
    // a veil, not a curtain: the world stays in view (and nothing behind it can be clicked)
    const veil = scene.add.rectangle(0, 0, W, H, hex(ROLE.ink), 0.45).setOrigin(0, 0).setInteractive();
    const panel = slice(scene, 0, 0, 'panel', w, h);
    const title = textCentred(scene, w / 2, 14, 'PLAY WITH AI');
    const hint = textCentred(scene, w / 2, 28, 'PICK YOUR SIDE OF THE WALL.', ROLE.ink);
    const hint2 = textCentred(scene, w / 2, 38, 'THE AI TAKES THE OTHER ONE.', ROLE.ink);
    this.buttons = {
      out: new Button(scene, { label: 'OUTSIDE', variant: 'out', width: 82, onClick: () => this.pick('out') }).setPosition(12, 48),
      in: new Button(scene, { label: 'INSIDE', variant: 'in', width: 82, onClick: () => this.pick('in') }).setPosition(w - 94, 48),
      cancel: new Button(scene, { label: 'CANCEL', variant: 'light', width: 80, onClick: () => this.close() }).setPosition(Math.round((w - 80) / 2), h - 34),
    };
    this.message = text(scene, 0, 0, '', ROLE.danger);

    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    const body = scene.add.container(x, y, [panel, title, hint, hint2, this.buttons.out.root, this.buttons.in.root, this.buttons.cancel.root, this.message]);
    this.root = scene.add.container(0, 0, [veil, body]).setDepth(10);
    // it drops in from just above
    body.setY(y - 8).setAlpha(0);
    scene.tweens.add({ targets: body, y, alpha: 1, duration: TIME.panel, ease: EASE.back });
    veil.setAlpha(0);
    scene.tweens.add({ targets: veil, alpha: 1, duration: TIME.panel });
    this.setFocus('out');
  }

  key(e: KeyboardEvent): void {
    if (this.closed) return;
    const action = menuAction(e);
    if (action === 'back') this.close();
    else if (action === 'select') this.buttons[this.focus].press();
    else if (action === 'left') this.setFocus('out');
    else if (action === 'right') this.setFocus('in');
    else if (action === 'down') this.setFocus('cancel');
    else if (action === 'up') this.setFocus(this.focus === 'cancel' ? 'out' : this.focus);
    else if (action === 'next' || action === 'prev') {
      const order: Focus[] = ['out', 'in', 'cancel'];
      this.setFocus(order[(order.indexOf(this.focus) + (action === 'next' ? 1 : 2)) % 3]!);
    }
  }

  paste(): void {}

  private setFocus(focus: Focus): void {
    this.focus = focus;
    for (const key of ['out', 'in', 'cancel'] as const) this.buttons[key].setFocus(key === focus);
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
