import Phaser from 'phaser';
import { GRID, TILE_PX, defaultEnv, type FaceId, type TileKind } from '@cubic/shared';
import { C, EASE, ROLE, TIME, hex } from '../style/tokens';
import { MenuScene, type SceneData } from './flow';
import { Button, centre, shake, slice, text, textCentred, type Text } from './kit';

/** Pixels per map tile in the cube net: each face is 40x40. */
const NET_TILE = 4;
const FACE_PX = GRID * NET_TILE;
/**
 * The cube unfolded, as [column, row] per face. Faces 4 1 2 3 run around the cube's
 * waist; 5 (top) and 6 (bottom) hang off face 1, each the right way up for that edge.
 */
const NET: Record<FaceId, [number, number]> = { 5: [1, 0], 4: [0, 1], 1: [1, 1], 2: [2, 1], 3: [3, 1], 6: [1, 2] };
const NET_ALPHA = 0.5;
const CODE_LEN = 4;

type Manifest = { tilesets: Record<string, { tiles: Record<TileKind, number[]> }> };
const hash = (f: number, x: number, y: number) => ((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0;

/**
 * Choose how to play. Far below, small and pale, is the world: the six real faces of the
 * cube laid out as a net, drawn from the actual maps and tiles.
 */
export class ModeScene extends MenuScene {
  private net!: Phaser.GameObjects.Container;
  private buttons: Button[] = [];
  private aiButtons: Button[] = [];
  private status!: Text;
  private focus = -1;
  private popup: JoinPopup | null = null;
  /** The join request we are waiting on, to tell its error from an old one. */
  private joining = false;

  constructor() {
    super('mode');
  }

  create(data: SceneData): void {
    const { W, H } = this;
    this.popup = null;
    this.joining = false;
    this.focus = -1;
    this.add.rectangle(0, 0, W, H, hex(ROLE.surface)).setOrigin(0, 0);

    const cx = Math.round(W / 2);
    const gridTop = Math.round(H * 0.66);
    this.buildNet(cx, Math.round((gridTop - 6) / 2) + 6);

    const bw = 150;
    const gap = 8;
    const left = cx - bw - gap / 2;
    const right = cx + gap / 2;
    const { actions } = this.ctx;
    const create = new Button(this, { label: 'CREATE LOBBY', variant: 'dark', width: bw, onClick: () => actions.onCreateRoom() }).setPosition(left, gridTop);
    const join = new Button(this, { label: 'JOIN LOBBY', variant: 'dark', width: bw, onClick: () => this.openJoin() }).setPosition(right, gridTop);
    const aiOut = new Button(this, { label: 'PLAY OUTSIDE WITH AI', variant: 'out', width: bw, onClick: () => actions.onPlayWithAI('out') }).setPosition(left, gridTop + 28);
    const aiIn = new Button(this, { label: 'PLAY INSIDE WITH AI', variant: 'in', width: bw, onClick: () => actions.onPlayWithAI('in') }).setPosition(right, gridTop + 28);
    this.buttons = [create, join, aiOut, aiIn];
    this.aiButtons = [aiOut, aiIn];
    this.status = text(this, 0, gridTop + 56, '', ROLE.dimOnLight);

    this.keys((e) => this.key(e));

    if (data.intro) {
      // arriving through the clouds: the world grows as we fall, then the choices land
      this.net.setScale(0.3).setAlpha(0);
      this.tweens.add({ targets: this.net, scale: 1, alpha: NET_ALPHA, delay: TIME.dive * 0.4, duration: TIME.dive * 0.6, ease: EASE.out });
      [...this.buttons.map((b) => b.root), this.status].forEach((o, i) => {
        const y = o.y;
        o.setAlpha(0).setY(y + 10);
        this.tweens.add({ targets: o, y, alpha: 1, delay: TIME.dive * 0.8 + i * 50, duration: TIME.panel, ease: EASE.out });
      });
    }
    this.begin(data);
  }

  /** Draw the six outside faces from the real maps with the real tiles, 4px per tile. */
  private buildNet(cx: number, cy: number): void {
    const key = 'cube-net';
    const w = FACE_PX * 4 + 5;
    const h = FACE_PX * 3 + 4;
    if (!this.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const manifest = this.cache.json.get('manifest') as Manifest;
      for (const face of [1, 2, 3, 4, 5, 6] as FaceId[]) {
        const [col, row] = NET[face];
        const ox = 1 + col * (FACE_PX + 1);
        const oy = 1 + row * (FACE_PX + 1);
        g.fillStyle = C.ink;
        g.fillRect(ox - 1, oy - 1, FACE_PX + 2, FACE_PX + 2);
        const sheet = this.textures.get(`tiles-out-${face}`).getSourceImage() as HTMLImageElement;
        const cols = Math.floor(sheet.width / TILE_PX);
        const tiles = manifest.tilesets[`out-${face}`]!.tiles;
        const map = defaultEnv.world.out[face];
        for (let y = 0; y < GRID; y++)
          for (let x = 0; x < GRID; x++) {
            const list = tiles[map.tiles[y]![x]!];
            const f = list[hash(face, x, y) % list.length]!;
            // the middle of the tile, one map tile to 4 pixels: its colours, not its detail
            g.drawImage(sheet, (f % cols) * TILE_PX + 4, Math.floor(f / cols) * TILE_PX + 4, 8, 8, ox + x * NET_TILE, oy + y * NET_TILE, NET_TILE, NET_TILE);
          }
      }
      this.textures.addCanvas(key, canvas);
    }
    const image = this.add.image(0, 0, key);
    this.net = this.add.container(cx, cy, [image]).setAlpha(NET_ALPHA);
    // idle: the net hangs in the air, a slow two-pixel bob
    this.tweens.add({ targets: image, y: 2, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  protected sync(): void {
    const s = this.ui;
    const busy = s.status === 'connecting' || !s.online;
    this.buttons.forEach((b) => b.setEnabled(!busy && !this.popup));
    this.aiButtons.forEach((b) => b.setEnabled(!busy && !this.popup && s.aiAvailable));
    const msg = !s.online ? 'WAKING THE SERVER... THIS CAN TAKE A MINUTE.' : s.status === 'connecting' ? 'CONNECTING...' : !this.popup && s.error ? s.error.toUpperCase() : !s.aiAvailable ? 'THE AI PARTNER IS NOT AVAILABLE ON THIS SERVER.' : '';
    this.status.setText(msg).setTint(hex(!this.popup && s.error && s.online ? ROLE.danger : ROLE.dimOnLight));
    this.status.x = Math.round(this.W / 2 - this.status.width / 2);

    if (this.popup) {
      this.popup.setBusy(s.status === 'connecting');
      if (this.joining && s.status !== 'connecting') {
        this.joining = false;
        if (s.error) this.popup.fail(s.error);
      }
    }
  }

  private openJoin(): void {
    if (this.popup) return;
    this.popup = new JoinPopup(
      this,
      (code) => {
        this.joining = true;
        this.ctx.actions.onJoinRoom(code);
      },
      () => {
        this.popup = null;
        this.sync();
      },
    );
    this.setFocus(-1);
    this.sync();
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.buttons.forEach((b, n) => b.setFocus(n === i));
  }

  private key(e: KeyboardEvent): void {
    if (this.popup) {
      this.popup.key(e);
      return;
    }
    // arrows walk the 2x2 grid, Enter presses
    const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
    if (e.key in move) {
      const next = this.focus < 0 ? 0 : this.focus + move[e.key]!;
      if (next >= 0 && next < this.buttons.length) this.setFocus(next);
    } else if (e.key === 'Enter' && this.focus >= 0) this.buttons[this.focus]!.press();
  }
}

/**
 * Type a 4-letter room code. Letters only, upper-cased as you type; Enter joins, Esc
 * closes. A bad code shakes the boxes and says why. The cube net stays visible behind it.
 */
class JoinPopup {
  private root: Phaser.GameObjects.Container;
  private boxes: Phaser.GameObjects.Container;
  private slots: { idle: Phaser.GameObjects.NineSlice; active: Phaser.GameObjects.NineSlice; error: Phaser.GameObjects.NineSlice; letter: Text }[] = [];
  private message: Text;
  private join: Button;
  private code = '';
  private failed = false;
  private busy = false;
  private closed = false;
  private readonly w = 196;
  private readonly h = 126;

  constructor(
    private scene: ModeScene,
    private onJoin: (code: string) => void,
    private onClose: () => void,
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    const { w, h } = this;
    // a veil, not a curtain: the world stays in view
    const veil = scene.add.rectangle(0, 0, W, H, hex(ROLE.ink), 0.35).setOrigin(0, 0).setInteractive();
    const panel = slice(scene, 0, 0, 'panel', w, h);
    const title = textCentred(scene, w / 2, 14, 'JOIN LOBBY');
    const hint = textCentred(scene, w / 2, 28, 'TYPE THE 4-LETTER ROOM CODE', ROLE.dimOnLight);

    const size = 28;
    const gap = 6;
    this.boxes = scene.add.container(Math.round((w - (size * CODE_LEN + gap * (CODE_LEN - 1))) / 2), 40);
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
    const cancel = new Button(scene, { label: 'CANCEL', variant: 'light', width: 80, onClick: () => this.close() }).setPosition(12, h - 34);
    this.join = new Button(scene, { label: 'JOIN', variant: 'dark', width: 80, onClick: () => this.submit() }).setPosition(w - 92, h - 34);

    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);
    const body = scene.add.container(x, y, [panel, title, hint, this.boxes, this.message, cancel.root, this.join.root]);
    this.root = scene.add.container(0, 0, [veil, body]).setDepth(10);
    // it drops in from just above
    body.setY(y - 8).setAlpha(0);
    scene.tweens.add({ targets: body, y, alpha: 1, duration: TIME.panel, ease: EASE.back });
    veil.setAlpha(0);
    scene.tweens.add({ targets: veil, alpha: 1, duration: TIME.panel });
    this.draw();
  }

  key(e: KeyboardEvent): void {
    if (this.closed) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'Enter') this.join.press();
    else if (e.key === 'Backspace') this.set(this.code.slice(0, -1));
    else if (/^[a-zA-Z]$/.test(e.key) && this.code.length < CODE_LEN) this.set(this.code + e.key.toUpperCase());
  }

  /** Pasted or typed text: keep the letters, upper-cased, at most four. */
  private set(code: string): void {
    if (this.busy) return;
    this.code = code.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, CODE_LEN);
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
    shake(this.scene, this.boxes);
  }

  private draw(): void {
    this.slots.forEach((slot, i) => {
      const active = !this.failed && i === Math.min(this.code.length, CODE_LEN - 1);
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
