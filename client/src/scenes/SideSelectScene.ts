import Phaser from 'phaser';
import type { Role, Side } from '@cubic/shared';
import { menuAction } from '../input/keymap';
import { C, EASE, ROLE, TIME, hex, type Ramp } from '../style/tokens';
import type { LobbyPlayer, LobbyState } from '../ui/hooks';
import { Sky } from './clouds';
import { MenuScene, type SceneData } from './flow';
import { Button, centre, hop, paint, seeded, shake, slice, text, textCentred, type Text } from './kit';

type Slot = Side | 'mid';

/** One player's arrow: the tag plate with the point, and a line saying who it is. */
interface Marker {
  root: Phaser.GameObjects.Container;
  note: Text;
  slot: Slot | null;
  /** Rest position; the idle bob moves around it. */
  y: number;
}

/**
 * Pick a side, the way NBA 2K's Blacktop picks a team: both players' arrows start in the
 * middle and move left (OUTSIDE, on top of the cube) or right (INSIDE the cube). Two
 * arrows never share a side. The guest readies up; then the host can start.
 * Everything shown here is the server's lobby state, so both screens always match.
 */
export class SideSelectScene extends MenuScene {
  private sky!: Sky;
  private zoom = 2;
  private slotX!: Record<Slot, number>;
  private cubes!: Record<Side, { image: Phaser.GameObjects.Image; hero: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Graphics; top: number; heroY: number }>;
  private markers!: Record<Role, Marker>;
  private badge!: Phaser.GameObjects.Image;
  private centreTitle!: Text;
  private centreHint!: Text;
  private status!: Text;
  private main!: Button;
  private leave!: Button;
  /** The bottom bar's keyboard focus: the main action, unless up / down moved it to Leave. */
  private onLeave = false;
  private last: { host: Side | null; guest: Side | null; error: string | null } = { host: null, guest: null, error: null };
  private first = true;

  constructor() {
    super('side');
  }

  create(data: SceneData): void {
    const { W, H } = this;
    this.first = true;
    this.last = { host: null, guest: null, error: null };
    const half = Math.round(W / 2);
    // the diorama is the game world seen closer: its art is shown at a whole multiple
    this.zoom = H >= 340 ? 3 : 2;
    const z = this.zoom;

    // left: the open sky of the outside. right: the dark inside of the cube.
    this.sky = new Sky(this, 0, half, H, [3, 2, 2, 1], 23);
    this.add.rectangle(half, 0, W - half, H, hex(ROLE.void)).setOrigin(0, 0);
    const rnd = seeded(5);
    for (let i = 0; i < 26; i++) {
      // dust in the lantern light
      const mote = this.add.rectangle(half + 8 + Math.round(rnd() * (W - half - 16)), Math.round(rnd() * H), 1, 1, hex(rnd() < 0.3 ? ROLE.in.dark : C.slate)).setOrigin(0, 0);
      this.tweens.add({ targets: mote, y: mote.y - 6 - rnd() * 10, alpha: 0.2, duration: 2400 + rnd() * 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.slotX = { out: Math.round(W * 0.2), mid: half, in: Math.round(W * 0.8) };
    const cubeH = this.textures.get('cube-out').getSourceImage().height * z;
    const cubeTop = Math.round(H * 0.56 - cubeH / 2) + 12;
    const make = (side: Side, heroRow: number): (typeof this.cubes)[Side] => {
      const x = this.slotX[side];
      const ring = this.add.graphics();
      const image = this.add.image(x, cubeTop, `cube-${side}`).setOrigin(0.5, 0).setScale(z);
      // the hero's feet land on this row of the cube art
      const heroY = cubeTop + heroRow * z;
      const hero = this.add.sprite(x, heroY, `player-${side}`, 0).setOrigin(0.5, 1).setScale(z).play(`idle-${side}`);
      image.setInteractive();
      image.on('pointerdown', () => this.pick(side));
      return { image, hero, ring, top: cubeTop, heroY };
    };
    this.cubes = { out: make('out', 9), in: make('in', 40) };

    // titles sit on their own halves, in their side's voice
    // (white on a sky with white clouds: an ink outline keeps it readable over both)
    textCentred(this, this.slotX.out, 38, 'OUTSIDE', ROLE.paper, 2, true);
    textCentred(this, this.slotX.out, 54, 'ON TOP OF THE CUBE', ROLE.paper, 1, true);
    textCentred(this, this.slotX.in, 38, 'INSIDE', ROLE.in.base, 2);
    textCentred(this, this.slotX.in, 54, 'INSIDE THE CUBE', ROLE.dimOnDark);

    // the middle: where the arrows wait
    const pw = 132;
    const ph = 96;
    const py = cubeTop - 14;
    slice(this, half - pw / 2, py, 'panel', pw, ph);
    this.centreTitle = textCentred(this, half, py + 13, 'PICK A SIDE');
    this.centreHint = textCentred(this, half, py + ph - 14, '', ROLE.dimOnLight);
    const arrow = (frame: number, x: number, side: Side) => {
      const a = this.add.image(x, py + 13, 'icons', frame).setInteractive();
      a.on('pointerdown', () => this.pick(side));
    };
    arrow(12, half - pw / 2 + 12, 'out');
    arrow(14, half + pw / 2 - 12, 'in');
    const zone = this.add.zone(half - pw / 2 + 22, py + 22, pw - 44, ph - 40).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', () => this.pick(null));

    const marker = (role: Role, y: number): Marker => {
      const plate = this.add.image(0, 0, role === 'host' ? 'marker-p1' : 'marker-p2').setOrigin(0.5, 0);
      const note = text(this, 0, -13, '', ROLE.ink);
      const root = this.add.container(half, y, [plate, note]).setDepth(5);
      this.tweens.add({ targets: plate, y: 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: role === 'host' ? 0 : 350 });
      return { root, note, slot: null, y };
    };
    this.markers = { host: marker('host', py + 34), guest: marker('guest', py + 34) };
    this.badge = this.add.image(0, 0, 'not-ready').setOrigin(0.5, 0).setDepth(5);

    // bottom bar: leave on the left, the one action that matters on the right
    const barY = H - 30;
    this.leave = new Button(this, { label: 'LEAVE', variant: 'light', width: 64, onClick: () => this.ctx.actions.onLeaveRoom() }).setPosition(8, barY);
    this.onLeave = false;
    this.main = new Button(this, { label: 'START', variant: 'in', width: 112, onClick: () => this.mainAction() }).setPosition(W - 120, barY);
    this.status = text(this, 0, barY + 3, '', ROLE.paper, 1, true);

    this.keys((e) => this.key(e));
    this.begin(data);
    this.main.setFocus(true);
  }

  private get lobby(): LobbyState | null {
    return this.ui.lobby;
  }

  private me(): LobbyPlayer | null {
    const l = this.lobby;
    return l ? (l.role === 'host' ? l.host : l.guest) : null;
  }

  /** Ask the server for a side. It may say no (the partner has it): then we shake. */
  private pick(side: Side | null): void {
    const me = this.me();
    if (!me || me.side === side) return;
    const partner = this.lobby!.role === 'host' ? this.lobby!.guest : this.lobby!.host;
    if (side && partner?.side === side) {
      // no need to ask: both screens already show that arrow there
      shake(this, this.markers[this.lobby!.role].root);
      this.flash(`${this.lobby!.role === 'host' ? 'P2' : 'P1'} ALREADY PICKED THAT SIDE`);
      return;
    }
    this.ctx.actions.onPickSide(side);
  }

  private flash(msg: string): void {
    this.setStatus(msg, ROLE.danger);
    this.time.delayedCall(1400, () => this.scene.isActive() && this.sync());
  }

  private key(e: KeyboardEvent): void {
    const me = this.me();
    if (!me) return;
    const action = menuAction(e);
    // one step at a time, through the middle, like moving a controller icon
    const order: (Side | null)[] = ['out', null, 'in'];
    const at = order.indexOf(me.side);
    if (action === 'left') this.pick(order[Math.max(0, at - 1)]!);
    else if (action === 'right') this.pick(order[Math.min(2, at + 1)]!);
    // left / right are the sides, so up / down move the focus between LEAVE and the action
    else if (action === 'up' || action === 'down' || action === 'next' || action === 'prev') this.focusLeave(!this.onLeave);
    else if (action === 'select') (this.onLeave ? this.leave : this.main).press();
    else if (action === 'back') {
      // Esc is back: out of the lobby
      this.focusLeave(true);
      this.leave.press();
    }
  }

  private focusLeave(on: boolean): void {
    this.onLeave = on;
    this.leave.setFocus(on);
    this.main.setFocus(!on);
  }

  private mainAction(): void {
    const l = this.lobby;
    if (!l) return;
    if (l.role === 'host') this.ctx.actions.onStartGame();
    else this.ctx.actions.onSetReady(!l.guest?.ready);
  }

  private setStatus(msg: string, color: string): void {
    paint(this.status.setText(msg), color);
    // right-aligned against the main button
    this.status.x = Math.round(this.W - 128 - this.status.width);
  }

  protected sync(): void {
    const l = this.lobby;
    if (!l) return;
    const you = l.role;

    this.place('host', l.host, you === 'host');
    this.place('guest', l.guest, you === 'guest');

    // the chosen cube wears its player's colour
    for (const side of ['out', 'in'] as Side[]) {
      const owner: Role | null = l.host.side === side ? 'host' : l.guest?.side === side ? 'guest' : null;
      this.ring(side, owner ? (owner === 'host' ? ROLE.p1 : ROLE.p2) : null);
      const picked = this.last[owner ?? 'host'] !== side && owner !== null;
      if (picked && !this.first) {
        hop(this, this.cubes[side].hero, 4 * this.zoom);
      }
    }
    this.last.host = l.host.side;
    this.last.guest = l.guest?.side ?? null;

    // the ready badge hangs under P2's arrow once P2 has a side
    const g = l.guest;
    this.badge.setVisible(!!g?.side);
    if (g?.side) {
      this.badge.setTexture(g.ready ? 'ready' : 'not-ready');
      const cube = this.cubes[g.side];
      this.badge.setPosition(this.slotX[g.side], cube.top + cube.image.displayHeight + 3 * this.zoom);
    }

    const waiting = !g;
        centre(this.centreHint.setText(waiting ? 'WAITING FOR P2' : 'A / D  OR  ARROWS'), this.slotX.mid, this.centreHint.y + 7.5);

    if (you === 'host') {
      this.main.setLabel('START').setEnabled(l.startBlocker === null);
    } else {
      this.main.setLabel(g?.ready ? 'NOT READY' : 'READY').setEnabled(!!g?.side);
    }
    const error = this.ui.error;
    if (error && error !== this.last.error) {
      shake(this, this.markers[you].root);
      this.setStatus(error.toUpperCase(), ROLE.danger);
    } else if (!this.ui.online) this.setStatus('CONNECTION LOST. RECONNECTING...', ROLE.danger);
    else if (you === 'host') this.setStatus((l.startBlocker ?? 'READY TO START').toUpperCase(), ROLE.paper);
    else this.setStatus(!g?.side ? 'PICK A SIDE, THEN READY UP' : g.ready ? 'WAITING FOR P1 TO START' : 'PRESS READY WHEN YOU ARE SET', ROLE.paper);
    this.last.error = error;
    this.first = false;
  }

  /** Move a player's arrow to where the server says they are. */
  private place(role: Role, p: LobbyPlayer | null, isYou: boolean): void {
    const m = this.markers[role];
    m.root.setVisible(!!p);
    if (!p) {
      m.slot = null;
      return;
    }
    const slot: Slot = p.side ?? 'mid';
    const who = role === 'host' ? 'HOST' : 'GUEST';
    m.note.setText(!p.connected ? 'AWAY' : isYou ? `${who} (YOU)` : who);
    m.note.x = Math.round(-m.note.width / 2);
    // on the dark half and over the sky the note needs light ink
    paint(m.note, slot === 'mid' ? ROLE.ink : ROLE.paper, slot !== 'mid');
    m.root.setAlpha(p.connected ? 1 : 0.5);
    const x = this.slotX[slot];
    // in the middle the two arrows stand side by side; over a cube, above the hero's head
    const off = slot === 'mid' ? (role === 'host' ? -30 : 30) : 0;
    // (the inside hero is in the cube, so that arrow hangs over the cube itself)
    const y = slot === 'mid' ? m.y : Math.min(this.cubes[slot].heroY - 16 * this.zoom, this.cubes[slot].top) - 26;
    if (m.slot === slot) return;
    const from = m.slot;
    m.slot = slot;
    if (from === null || this.first) m.root.setPosition(x + off, y);
    else this.tweens.add({ targets: m.root, x: x + off, y, duration: TIME.quick, ease: EASE.out });
  }

  /** Outline a cube in the colour of the player who picked it. */
  private ring(side: Side, ramp: Ramp | null): void {
    const { ring, image, top } = this.cubes[side];
    ring.clear();
    if (!ramp) return;
    const z = this.zoom;
    const w = image.displayWidth;
    const h = image.displayHeight;
    const x = image.x - w / 2;
    // a frame in the player's colour, two cube pixels wide, with its own ink edge
    ring.fillStyle(hex(ROLE.ink));
    ring.fillRect(x - 3 * z, top - 3 * z, w + 6 * z, h + 6 * z);
    ring.fillStyle(hex(ramp.base));
    ring.fillRect(x - 2 * z, top - 2 * z, w + 4 * z, h + 4 * z);
    ring.fillStyle(hex(ramp.light));
    ring.fillRect(x - 2 * z, top - 2 * z, w + 4 * z, z);
    ring.fillStyle(hex(ramp.dark));
    ring.fillRect(x - 2 * z, top + h + z, w + 4 * z, z);
  }

  update(_time: number, delta: number): void {
    this.sky.update(delta);
  }
}
