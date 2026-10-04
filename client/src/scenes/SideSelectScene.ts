import Phaser from 'phaser';
import type { Role, Side } from '@cubic/shared';
import { menuAction } from '../input/keymap';
import { device } from '../style/scale';
import { settings } from '../style/settings';
import { C, EASE, ROLE, TIME, hex, type Ramp } from '../style/tokens';
import type { LobbyPlayer, LobbyState } from '../ui/hooks';
import { MenuScene, type SceneData } from './flow';
import { Button, centre, hop, paint, seeded, shake, slice, text, textCentred, type Text, HAND } from './kit';
import { CUBE_ART, OUT_STRIPS, TURTLE_ART, idleTone, sideAt, sideLayout, sideState, turtleIn, type Box, type SideLayout, type SideState } from './sideLayout';

type Slot = Side | 'mid';

/** One player's arrow: the tag plate with the point, and a line saying who it is. */
interface Marker {
  root: Phaser.GameObjects.Container;
  note: Text;
  slot: Slot | null;
  /** Where it waits in the middle. */
  y: number;
  /** The x it rests at now (or is moving to): a shake swings around this. */
  x: number;
}

/**
 * Pick a side, the way NBA 2K's Blacktop picks a team: both players' arrows start in the
 * middle and move left (OUTSIDE, on top of the cube) or right (INSIDE the cube). Two
 * arrows never share a side. The guest readies up; then the host can start.
 * Everything shown here is the server's lobby state, so both screens always match.
 */
export class SideSelectScene extends MenuScene {
  private zoom = 2;
  /** Where the cubes, their faces and the turtles are at this screen size (sideLayout.ts). */
  private layout!: SideLayout;
  private slotX!: Record<Slot, number>;
  private cubes!: Record<Side, { image: Phaser.GameObjects.Image; hero: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Graphics; top: number; heroY: number; state: SideState }>;
  /** The cube the mouse is over. Never set by a finger: touch has no hover. */
  private hover: Side | null = null;
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
    this.layout = sideLayout(W, H);
    this.zoom = this.layout.zoom;
    const z = this.zoom;

    // left: the open sky of the outside. right: the dark inside of the cube. Both are drawn
    // by CubeBackdropScene underneath (its big cube is hidden behind this screen).
    const rnd = seeded(5);
    for (let i = 0; i < 26; i++) {
      // dust in the lantern light
      const mote = this.add.rectangle(half + 8 + Math.round(rnd() * (W - half - 16)), Math.round(rnd() * H), 1, 1, hex(rnd() < 0.3 ? ROLE.in.dark : C.slate)).setOrigin(0, 0);
      this.tweens.add({ targets: mote, y: mote.y - 6 - rnd() * 10, alpha: 0.2, duration: 2400 + rnd() * 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.slotX = this.layout.slotX;
    const cubeTop = this.layout.cubeTop;
    const make = (side: Side, key: string): (typeof this.cubes)[Side] => {
      const x = this.slotX[side];
      const ring = this.add.graphics();
      const image = this.add.image(x, cubeTop, key).setOrigin(0.5, 0).setScale(z);
      // the turtle stands in the middle of its side's face: the grass, or the room
      const { anchor } = this.layout.spots[side];
      const hero = this.add.sprite(anchor.x, anchor.y, `player-${side}`, 0).setOrigin(0.5, 0.5).setScale(z);
      image.setInteractive({ cursor: HAND });
      image.on('pointerdown', () => this.pick(side));
      return { image, hero, ring, top: cubeTop, heroY: anchor.y, state: 'idle' };
    };
    this.cubes = { out: make('out', this.deepCube()), in: make('in', 'cube-in') };
    // Hover is read from where the mouse is, not from over / out events: after a re-fit the
    // scene is rebuilt under a mouse that has not moved, and no event would say so.
    // (also on the first entry: the mouse may already be over a cube)
    this.hover = this.pointed();
    const onMove = (p: Phaser.Input.Pointer) => this.setHover(p.wasTouch ? null : sideAt(this.layout, p.x, p.y));
    const onOut = () => this.setHover(null);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.GAME_OUT, onOut);
    if (import.meta.env.DEV) {
      // where the two heroes stand now, in art pixels (tools/screens/check.ts)
      const at = (side: Side) => ({ x: this.cubes[side].hero.x, y: this.cubes[side].hero.y });
      // what is really on screen: each side's state, its face and its turtle (tools/screens/side-select.ts)
      const box = (r: Phaser.Geom.Rectangle): Box => ({ x: r.x, y: r.y, w: r.width, h: r.height });
      const seen = (side: Side) => {
        const { hero, image, state } = this.cubes[side];
        return { state, alpha: hero.alpha, texture: hero.texture.key, cube: box(image.getBounds()), face: this.layout.spots[side].face, turtle: box(hero.getBounds()) };
      };
      Object.assign(window, {
        __cubicHeroes: () => ({ out: at('out'), in: at('in') }),
        __cubicSide: () => ({ width: W, height: H, zoom: z, hover: this.hover, touch: device().touch, out: seen('out'), in: seen('in') }),
        /** Put a line in the status bar and say where it and its neighbours are (the panel above, LEAVE on its left). */
        __cubicSideStatus: (msg: string) => {
          this.setStatus(msg, ROLE.paper);
          const leave = this.leave.probe();
          return { status: { x: this.status.x, y: this.status.y, w: this.status.width, h: this.status.height }, panel: this.layout.panel, leave: { x: leave.x, y: leave.y, w: leave.width, h: leave.height }, mainX: this.main.probe().x };
        },
      });
    }

    // titles sit on their own halves, in their side's voice
    // (white on a sky with white clouds: an ink outline keeps it readable over both)
    textCentred(this, this.slotX.out, 38, 'OUTSIDE', ROLE.paper, 2, true);
    textCentred(this, this.slotX.out, 54, 'ON TOP OF THE CUBE', ROLE.paper, 1, true);
    textCentred(this, this.slotX.in, 38, 'INSIDE', ROLE.in.base, 2);
    textCentred(this, this.slotX.in, 54, 'INSIDE THE CUBE', ROLE.dimOnDark);

    // the middle: where the arrows wait
    const { w: pw, h: ph, y: py } = this.layout.panel;
    slice(this, half - pw / 2, py, 'panel', pw, ph);
    this.centreTitle = textCentred(this, half, py + 20, 'PICK A SIDE');
    this.centreHint = textCentred(this, half, py + ph - 20, '', ROLE.dimOnLight);
    const arrow = (frame: number, x: number, side: Side) => {
      const a = this.add.image(x, py + 13, 'icons', frame).setInteractive({ cursor: HAND });
      a.on('pointerdown', () => this.pick(side));
    };
    arrow(12, half - pw / 2 + 12, 'out');
    arrow(14, half + pw / 2 - 12, 'in');
    const zone = this.add.zone(half - pw / 2 + 22, py + 40, pw - 44, ph - 80).setOrigin(0, 0).setInteractive({ cursor: HAND });
    zone.on('pointerdown', () => this.pick(null));

    const marker = (role: Role, y: number): Marker => {
      const plate = this.add.image(0, 0, role === 'host' ? 'marker-p1' : 'marker-p2').setOrigin(0.5, 0);
      const note = text(this, 0, -13, '', ROLE.ink);
      const root = this.add.container(half, y, [plate, note]).setDepth(5);
      this.tweens.add({ targets: plate, y: 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: role === 'host' ? 0 : 350 });
      return { root, note, slot: null, y, x: half };
    };
    this.markers = { host: marker('host', py + ph / 2), guest: marker('guest', py + ph / 2) };
    this.badge = this.add.image(0, 0, 'not-ready').setOrigin(0.5, 0).setDepth(5);

    // bottom bar: leave on the left, the one action that matters on the right
    const barY = this.layout.barY;
    this.leave = new Button(this, { label: 'LEAVE', variant: 'light', width: 64, onClick: () => this.ctx.actions.onLeaveRoom() }).setPosition(8, barY);
    this.onLeave = false;
    this.main = new Button(this, { label: 'START', variant: 'in', width: 112, onClick: () => this.mainAction() }).setPosition(W - 120, barY);
    this.status = text(this, 0, barY + 3, '', ROLE.paper, 1, true);

    this.keys((e) => this.key(e));
    this.begin(data);
    this.main.setFocus(true);
  }

  /**
   * The outside cube with a deeper top: cube-out.png redrawn from its own rows
   * (OUT_STRIPS), so the grass is deep enough for a whole turtle to stand on. Composited
   * once into a plain texture: the same in WebGL and Canvas.
   */
  private deepCube(): string {
    const key = 'cube-out:deep';
    if (this.textures.exists(key)) return key;
    const src = this.textures.get('cube-out').getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = CUBE_ART.w;
    canvas.height = CUBE_ART.h;
    const g = canvas.getContext('2d')!;
    let y = 0;
    for (const [from, rows, mirrored] of OUT_STRIPS) {
      g.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? CUBE_ART.w : 0, 0);
      g.drawImage(src, 0, from, CUBE_ART.w, rows, 0, y, CUBE_ART.w, rows);
      y += rows;
    }
    this.textures.addCanvas(key, canvas);
    return key;
  }

  /**
   * A side's turtle as it waits: its first frame in stone grey (idleTone), fully opaque.
   * Painted once into a plain texture (the Canvas renderer cannot tint a sprite).
   */
  private greyTurtle(side: Side): string {
    const key = `player-${side}:idle`;
    if (this.textures.exists(key)) return key;
    const src = this.textures.get(`player-${side}`).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = TURTLE_ART;
    canvas.height = TURTLE_ART;
    const g = canvas.getContext('2d')!;
    g.drawImage(src, 0, 0, TURTLE_ART, TURTLE_ART, 0, 0, TURTLE_ART, TURTLE_ART);
    const image = g.getImageData(0, 0, TURTLE_ART, TURTLE_ART);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) [px[i], px[i + 1], px[i + 2]] = idleTone(px[i]!, px[i + 1]!, px[i + 2]!);
    g.putImageData(image, 0, 0);
    this.textures.addCanvas(key, canvas);
    return key;
  }

  /** The cube under the mouse right now, from the last place the browser saw it. */
  private pointed(): Side | null {
    const p = this.input.activePointer;
    const e = p.event as MouseEvent | TouchEvent | undefined;
    if (!e || p.wasTouch || !('clientX' in e)) return null;
    const r = this.game.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return sideAt(this.layout, ((e.clientX - r.left) * this.W) / r.width, ((e.clientY - r.top) * this.H) / r.height);
  }

  private setHover(side: Side | null): void {
    if (this.hover === side) return;
    this.hover = side;
    if (this.lobby) this.looks(this.lobby);
  }

  /**
   * Every cube in its state: idle (the turtle waits, grey and still), hover (the mouse
   * is over a free side: the turtle wakes, a paper frame) or selected (the owner's frame).
   * The turtle is on the same spot in all three: the middle of its face.
   */
  private looks(l: LobbyState): void {
    const touch = device().touch;
    for (const side of ['out', 'in'] as Side[]) {
      const owner: Role | null = l.host.side === side ? 'host' : l.guest?.side === side ? 'guest' : null;
      const cube = this.cubes[side];
      cube.state = sideState(owner !== null, this.hover === side, touch);
      const look = turtleIn(this.layout, side, cube.state);
      cube.hero.setAlpha(look.alpha);
      if (!look.moving) cube.hero.stop();
      else if (!cube.hero.anims.isPlaying) cube.hero.play(`idle-${side}`);
      if (look.grey) cube.hero.setTexture(this.greyTurtle(side));
      this.ring(side, owner ? (owner === 'host' ? ROLE.p1 : ROLE.p2) : null, cube.state === 'hover');
    }
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
      this.no(this.lobby!.role);
      this.flash(`${this.lobby!.role === 'host' ? 'P2' : 'P1'} ALREADY PICKED THAT SIDE`);
      return;
    }
    this.ctx.actions.onPickSide(side);
  }

  /** Shake a player's arrow: "no". */
  private no(role: Role): void {
    shake(this, this.markers[role].root, this.markers[role].x);
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
    // A line too long for the bar (a long server error on the narrowest screen) loses whole
    // words from its end, so it never runs under LEAVE.
    const room = this.W - 128 - (this.leave.root.x + this.leave.width + 6);
    for (let line = msg; this.status.width > room && line.includes(' '); ) {
      line = line.slice(0, line.lastIndexOf(' '));
      this.status.setText(`${line}...`);
    }
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
    this.looks(l);
    for (const side of ['out', 'in'] as Side[]) {
      const owner: Role | null = l.host.side === side ? 'host' : l.guest?.side === side ? 'guest' : null;
      const picked = this.last[owner ?? 'host'] !== side && owner !== null;
      // a small hop where it stands (it lands on the same pixel); none with reduce motion
      if (picked && !this.first && !settings().reduceMotion) {
        hop(this, this.cubes[side].hero, this.cubes[side].heroY, 2 * this.zoom);
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
      this.no(you);
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
    let dx: number;
    let dy: number;
    if (slot === 'mid') {
      dx = 0;
      dy = role === 'host' ? -20 : 20; // host above, guest below
    } else {
      dx = role === 'host' ? -30 : 30;
      dy = 0;
    }
    // (both heroes stand within their cube, so the arrow hangs over the cube itself)
    const y = slot === 'mid' ? (m.y + dy) : this.cubes[slot].top - 26 + dy;
    if (m.slot === slot) return;
    const from = m.slot;
    m.slot = slot;
    m.x = x + dx;
    if (from === null || this.first) m.root.setPosition(x + dx, y);
    else this.tweens.add({ targets: m.root, x: x + dx, y, duration: TIME.quick, ease: EASE.out });
  }

  /** Outline a cube in the colour of the player who picked it, or in paper under the mouse. */
  private ring(side: Side, ramp: Ramp | null, hover = false): void {
    const { ring, image, top } = this.cubes[side];
    ring.clear();
    const z = this.zoom;
    const w = image.displayWidth;
    const h = image.displayHeight;
    const x = image.x - w / 2;
    if (!ramp) {
      if (!hover) return;
      // hover: a thinner frame, one cube pixel of paper with its ink edge
      ring.fillStyle(hex(ROLE.ink));
      ring.fillRect(x - 2 * z, top - 2 * z, w + 4 * z, h + 4 * z);
      ring.fillStyle(hex(ROLE.paper));
      ring.fillRect(x - z, top - z, w + 2 * z, h + 2 * z);
      return;
    }
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
}
