import type Phaser from 'phaser';
import { ENABLE_AI } from '../config';
import { menuAction, pasteCode, stepFocus, typeCode } from '../input/keymap';
import { overlayOwnsInput } from '../input/overlay';
import { EASE, ROLE, TIME, hex } from '../style/tokens';
import { AiPopup } from './AiPopup';
import { BLOCKED_TEXT, MenuScene, type SceneData } from './flow';
import { Button, centre, paint, shake, slice, text, textCentred, type Text } from './kit';

const CODE_LEN = 4;

/**
 * Pick a mode: SELECT MODE and the choices on a panel. Behind it, on the white you
 * land on after the dive, the cube keeps turning (CubeBackdropScene, the scene underneath:
 * this scene draws no background of its own).
 */
export class ModeScene extends MenuScene {
  private buttons: Button[] = [];
  private aiButtons: Button[] = [];
  private back!: Button;
  private status!: Text;
  /** The status line is centred on this x. */
  private statusX = 0;
  /** Index into [...buttons, back]; -1 until a key is pressed. */
  private focus = -1;
  private popup: JoinPopup | AiPopup | null = null;
  /** The join request we are waiting on, to tell its error from an old one. */
  private joining = false;
  /**
   * The error the join popup was closed on. It belonged to the popup (a refused code) and
   * went with it: it is not shown again under the menu. Forgotten once the error changes.
   */
  private dismissed: string | null = null;

  constructor() {
    super('mode');
  }

  create(data: SceneData): void {
    const { W, H } = this;
    // rebuilt by a resize with the join popup open: it comes back with the letters typed so far
    const draft = data.rebuilt && this.popup?.open ? this.popup.value : null;
    this.popup = null;
    if (!data.rebuilt) this.joining = false;
    this.focus = -1;
    // the menu sits left of centre; the cube has the right of the screen
    const cx = Math.round(W * 0.31);
    const cy = Math.round(H / 2);

    const { actions } = this.ctx;
    const bw = 176;
    const bh = 26;
    const gap = 8;
    const items: { label: string; ai?: boolean; onClick(): void }[] = [
      { label: 'CREATE LOBBY', onClick: () => actions.onCreateRoom() },
      { label: 'JOIN LOBBY', onClick: () => this.openJoin() },
    ];
    // Solo: the AI partner takes the other side (config.ts switches it off).
    if (ENABLE_AI) items.push({ label: 'PLAY WITH AI', ai: true, onClick: () => this.openAi() });
    const menuH = items.length * bh + (items.length - 1) * gap;
    const top = cy - Math.round(menuH / 2) + 8;
    // a small title and one clear vertical menu, on a panel
    const pad = 12;
    const panel = slice(this, cx - bw / 2 - pad, top - 34, 'panel', bw + pad * 2, menuH + 34 + pad + 4);
    // Back button in the bottom-left corner, 16px from the left and the bottom. The panel is
    // already down and the cube is in the scene underneath: no scenery is drawn over it.
    this.back = new Button(this, { label: 'BACK', variant: 'light', width: 80, height: 26, onClick: () => this.ctx.flow.back() }).setPosition(16, H - 42);

    const title = textCentred(this, cx, top - 18, 'SELECT MODE', ROLE.ink);
    this.buttons = [];
    this.aiButtons = [];
    items.forEach((item, i) => {
      // solid yellow panels with ink text and outline: readable on the white panel
      const b = new Button(this, { label: item.label, variant: 'in', width: bw, height: bh, onClick: item.onClick }).setCentre(cx, top + i * (bh + gap));
      this.buttons.push(b);
      if (item.ai) this.aiButtons.push(b);
    });
    this.status = text(this, 0, top + menuH + pad + 10, '', ROLE.ink);
    this.statusX = cx;

    this.keys((e) => this.key(e));
    // Ctrl/Cmd+V in the join popup: the pasted room code (the keys themselves are not ours,
    // MenuScene.keys leaves modified keys to the browser, which then fires `paste`)
    const onPaste = (e: ClipboardEvent) => {
      if (!this.popup || !this.scene.isActive() || overlayOwnsInput()) return;
      e.preventDefault();
      this.popup.paste(e.clipboardData?.getData('text') ?? '');
    };
    window.addEventListener('paste', onPaste);
    this.events.once('shutdown', () => window.removeEventListener('paste', onPaste));
    if (import.meta.env.DEV) {
      // the letters in the join popup (null = not open) and the status line (tools/screens/check.ts)
      Object.assign(window, { __cubicJoinCode: () => (this.scene.isActive() ? (this.popup?.value ?? null) : null), __cubicModeStatus: () => (this.scene.isActive() ? this.status.text : '') });
    }

    if (data.intro) {
      // arriving through the clouds: the cube settles, then the choices land
      [panel, title, ...this.buttons.map((b) => b.root), this.status, this.back.root].forEach((o, i) => {
        const y = o.y;
        o.setAlpha(0).setY(y + 10);
        this.tweens.add({ targets: o, y, alpha: 1, delay: TIME.dive * 0.8 + i * 50, duration: TIME.panel, ease: EASE.out });
      });
    }
    if (draft !== null) this.openJoin(draft);
    this.begin(data);
  }

  protected sync(): void {
    const s = this.ui;
    if (s.error !== this.dismissed) this.dismissed = null;
    const error = this.popup || s.error === this.dismissed ? null : s.error;
    const busy = s.status === 'connecting' || !s.online;
    this.buttons.forEach((b) => b.setEnabled(!busy && !this.popup));
    this.aiButtons.forEach((b) => b.setEnabled(!busy && !this.popup && s.aiAvailable));
    // while we wait for a room, Back would only bounce straight into it
    this.back.setEnabled(s.status !== 'connecting' && !this.popup);
    const msg = !s.online ? (s.blocked ? BLOCKED_TEXT : 'WAKING THE SERVER... THIS CAN TAKE A MINUTE.') : s.status === 'connecting' ? 'CONNECTING...' : error ? error.toUpperCase() : ENABLE_AI && !s.aiAvailable ? 'THE AI PARTNER IS NOT AVAILABLE ON THIS SERVER.' : '';
    paint(this.status.setText(msg), (error && s.online) || (s.blocked && !s.online) ? ROLE.danger : ROLE.ink);
    // centred under the panel, but never off the left of the screen
    this.status.x = Math.max(6, Math.round(this.statusX - this.status.width / 2));

    if (this.popup) {
      this.popup.setBusy(s.status === 'connecting');
      if (this.joining && s.status !== 'connecting') {
        this.joining = false;
        if (s.error) this.popup.fail(s.error);
      }
    }
  }

  /** Open the join popup. `draft`: letters to start with, when a resize rebuilt the scene under it. */
  private openJoin(draft: string | null = null): void {
    if (this.popup) return;
    this.popup = new JoinPopup(
      this,
      (code) => {
        this.joining = true;
        this.ctx.actions.onJoinRoom(code);
      },
      () => {
        this.popup = null;
        this.dismissed = this.ui.error;
        this.sync();
      },
      draft,
    );
    this.setFocus(-1);
    this.sync();
  }

  /** PLAY WITH AI: choose your side, the AI takes the other one. */
  private openAi(): void {
    if (this.popup) return;
    this.popup = new AiPopup(
      this,
      (side) => {
        this.joining = true;
        this.ctx.actions.onPlayWithAI(side);
      },
      () => {
        this.popup = null;
        this.sync();
      },
    );
    this.setFocus(-1);
    this.sync();
  }

  /** Everything the focus can land on: the menu, top to bottom, then Back. */
  private get targets(): Button[] {
    return [...this.buttons, this.back];
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.targets.forEach((b, n) => b.setFocus(n === i));
  }

  private key(e: KeyboardEvent): void {
    if (this.popup) {
      this.popup.key(e);
      return;
    }
    // arrows or WASD walk the menu (down past the last choice, or left, is Back);
    // Enter or Space press; Esc is Back
    const action = menuAction(e);
    const last = this.targets.length - 1;
    if (action === 'up' || action === 'down') this.setFocus(stepFocus(this.focus, this.targets.length, action === 'up' ? -1 : 1));
    else if (action === 'left') this.setFocus(last);
    else if (action === 'right' && this.focus === last) this.setFocus(0);
    else if (action === 'select' && this.focus >= 0) this.targets[this.focus]!.press();
    else if (e.key === 'Escape') this.back.press();
  }
}

/**
 * Type a 4-letter room code. Letters only, upper-cased as you type; Enter joins, Esc
 * closes. A bad code shakes the boxes and says why. The cube keeps turning behind the veil.
 */
class JoinPopup {
  private root: Phaser.GameObjects.Container;
  private boxes: Phaser.GameObjects.Container;
  /** Where the code boxes rest: the shake swings around this. */
  private boxesX: number;
  private slots: { idle: Phaser.GameObjects.Image; active: Phaser.GameObjects.Image; error: Phaser.GameObjects.Image; letter: Text }[] = [];
  private message: Text;
  private join: Button;
  private cancel: Button;
  /** Where the keyboard is: the code boxes, or one of the two buttons. */
  private focus: 'code' | 'cancel' | 'join' = 'code';
  private code = '';
  private failed = false;
  private busy = false;
  private closed = false;
  /** The letters typed so far. */
  get value(): string {
    return this.code;
  }
  /** Still up (not cancelled). */
  get open(): boolean {
    return !this.closed;
  }
  private readonly w = 196;
  private readonly h = 126;

  constructor(
    private scene: ModeScene,
    private onJoin: (code: string) => void,
    private onClose: () => void,
    /** Letters already typed: the popup is being put back after a resize, so it does not drop in again. */
    draft: string | null = null,
  ) {
    this.code = pasteCode(draft ?? '', CODE_LEN);
    const W = scene.scale.width;
    const H = scene.scale.height;
    const { w, h } = this;
    // a veil, not a curtain: the world stays in view
    const veil = scene.add.rectangle(0, 0, W, H, hex(ROLE.ink), 0.45).setOrigin(0, 0).setInteractive();
    const panel = slice(scene, 0, 0, 'panel', w, h);
    const title = textCentred(scene, w / 2, 14, 'JOIN LOBBY');
    const hint = textCentred(scene, w / 2, 28, 'TYPE THE 4-LETTER ROOM CODE', ROLE.ink);

    const size = 28;
    const gap = 6;
    this.boxesX = Math.round((w - (size * CODE_LEN + gap * (CODE_LEN - 1))) / 2);
    this.boxes = scene.add.container(this.boxesX, 40);
    for (let i = 0; i < CODE_LEN; i++) {
      const x = i * (size + gap);
      const idle = slice(scene, x, 0, 'field', size, size);
      const active = slice(scene, x, 0, 'field-active', size, size);
      const error = slice(scene, x, 0, 'field-error', size, size);
      const letter = text(scene, x, 0, '', ROLE.ink, 2);
      this.boxes.add([idle, active, error, letter]);
      this.slots.push({ idle, active, error, letter });
    }
    this.message = text(scene, 0, 74, '', ROLE.danger);
    const cancel = (this.cancel = new Button(scene, { label: 'CANCEL', variant: 'light', width: 80, onClick: () => this.close() }).setPosition(12, h - 34));
    this.join = new Button(scene, { label: 'JOIN', variant: 'in', width: 80, onClick: () => this.submit() }).setPosition(w - 92, h - 34);

    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    const body = scene.add.container(x, y, [panel, title, hint, this.boxes, this.message, cancel.root, this.join.root]);
    this.root = scene.add.container(0, 0, [veil, body]).setDepth(10);
    if (draft === null) {
      // it drops in from just above
      body.setY(y - 8).setAlpha(0);
      scene.tweens.add({ targets: body, y, alpha: 1, duration: TIME.panel, ease: EASE.back });
      veil.setAlpha(0);
      scene.tweens.add({ targets: veil, alpha: 1, duration: TIME.panel });
    }
    this.draw();
  }

  /**
   * Type the code straight in: letters, Backspace, Enter joins, Esc closes. The arrows
   * reach the buttons (letters are the code here, so WASD do not move the focus):
   * down to JOIN, left / right between CANCEL and JOIN, up back to the code.
   */
  key(e: KeyboardEvent): void {
    if (this.closed) return;
    const action = menuAction(e, false);
    if (action === 'back') this.close();
    else if (action === 'select') (this.focus === 'cancel' ? this.cancel : this.join).press();
    else if (action === 'down' || action === 'next') this.setFocus(this.focus === 'code' ? 'join' : this.focus === 'join' ? 'cancel' : 'code');
    else if (action === 'up' || action === 'prev') this.setFocus('code');
    else if (action === 'left') this.setFocus('cancel');
    else if (action === 'right') this.setFocus('join');
    else {
      const next = typeCode(this.code, e, CODE_LEN);
      if (next === this.code) return;
      this.setFocus('code'); // typing always goes to the code
      this.set(next);
    }
  }

  private setFocus(focus: 'code' | 'cancel' | 'join'): void {
    this.focus = focus;
    this.cancel.setFocus(focus === 'cancel');
    this.join.setFocus(focus === 'join');
    this.draw();
  }

  /** Pasted text replaces the code, if there is a letter in it. */
  paste(text: string): void {
    if (this.closed || !pasteCode(text, CODE_LEN)) return;
    this.setFocus('code');
    this.set(text);
  }

  /** Pasted or typed text: keep the letters, upper-cased, at most four. */
  private set(code: string): void {
    if (this.busy) return;
    this.code = pasteCode(code, CODE_LEN);
    this.failed = false;
    this.message.setText('');
    this.draw();
  }

  private submit(): void {
    if (this.busy) return;
    if (this.code.length < CODE_LEN) {
      this.fail('Room codes are 4 letters.');
      return;
    }
    this.onJoin(this.code);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.join.setEnabled(!busy).setLabel(busy ? 'JOINING' : 'JOIN');
  }

  /** The code was refused: shake, turn the boxes red and say why. */
  fail(reason: string): void {
    this.failed = true;
    this.message.setText(reason.toUpperCase());
    this.message.x = Math.round((this.w - this.message.width) / 2);
    this.draw();
    shake(this.scene, this.boxes, this.boxesX);
  }

  private draw(): void {
    this.slots.forEach((slot, i) => {
      const active = !this.failed && this.focus === 'code' && i === Math.min(this.code.length, CODE_LEN - 1);
      slot.idle.setVisible(!this.failed && !active);
      slot.active.setVisible(active);
      slot.error.setVisible(this.failed);
      slot.letter.setText(this.code[i] ?? '');
      centre(slot.letter, slot.idle.x + 14 + 1, 14);
    });
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.tweens.add({ targets: this.root, alpha: 0, duration: TIME.quick, onComplete: () => this.root.destroy() });
    this.onClose();
  }
}
