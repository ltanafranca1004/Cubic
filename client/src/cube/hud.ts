import { FACES, FACE_NAMES, NORMALS, defaultEnv, neighbours, type FaceId, type Side } from '@cubic/shared';
import { settings } from '../style/settings';
import { ROLE } from '../style/tokens';
import { cubeMap, registerCubeMap, type CubeMapDir } from './api';
import { bakeFaces, loadCubeArt, type CubeArt } from './faces';
import { texelFor } from './layout';
import { apply, ease, mul, snap, type Mat3, type V3 } from './mat';
import { HUD_TILT, QUARTER, ROOM_CAM, facing, hudView, poseView, turnAt, upFromDrift } from './orient';
import { clearTarget, createTarget, drawCube, drawRoom, pack, projectRoom, roomFaces, visibleFaces, type CubeFaces, type FaceTex, type Target } from './raster';

// THE CUBE IN THE HUD. A small pixel cube that always shows the face you are on flat
// towards you, the right way up for your screen, with the faces above and to the right in
// view. Walk over an edge and it makes the same quarter turn the world just made. Drawn by
// the software renderer on its own little canvas (the HUD is DOM), in art pixels, scaled by
// the UI's whole-number scale like everything else.
//
// The inside player is IN the cube, so theirs is drawn from within, as a room: the face
// they are on is the floor, the four faces around it are walls in perspective, and nothing
// is drawn beyond them. Walking over an edge there tips the wall ahead down into the floor
// (cube/orient.ts: roomView), the opposite turn to the outside cube's roll.
//
// The same cube, larger and free to turn, is the cube map (cube/api.ts: show, hide, rotate).

/** What the cube shows. Everything comes from the HUD state; nothing is decided here. */
export interface CubeHudState {
  side: Side;
  face: FaceId;
  /** 0 | 90 | 180 | 270, as in the compass. */
  drift: number;
  solved: readonly FaceId[];
  portalOpen: boolean;
  /** The face of each puzzle: one progress pip per entry. Without it, one per face. */
  puzzleFaces?: readonly FaceId[];
}

export interface CubeHud {
  update(state: CubeHudState): void;
  destroy(): void;
}

/** A quarter turn, in ms. */
export const TURN_MS = 400;
const PULSE_MS = 420;
/** Canvas size and half the cube's edge, in art pixels. */
const SMALL = { px: 56, half: 19 };
const BIG = { px: 132, half: 44 };
/** From above and in front: the top is brightest, your own face nearly as bright. */
const HUD_LIGHT: V3 = [-0.2, 0.6, 0.77];
/** Half the room's open side, in art pixels, and its light: the floor is the brightest, the walls sit back. */
const ROOM_HALF = 22;
const ROOM_LIGHT: V3 = [-0.15, 0.3, 0.94];
const DIRS: readonly CubeMapDir[] = ['up', 'down', 'left', 'right'];

const INK = pack(ROLE.ink);
/** The face the portal is on. Null in a world without one: then no face gets the portal's frame. */
const PORTAL_FACE: FaceId | null = FACES.find((f) => (['out', 'in'] as const).some((side) => defaultEnv.world[side][f].objects.some((o) => o.type === 'portal'))) ?? null;

/** A copy of a face texture with a one-texel-wide frame (two for the larger textures). */
function framed(tex: FaceTex, color: number): FaceTex {
  const { size } = tex;
  const w = Math.max(1, Math.round(size / 40));
  const px = new Uint32Array(tex.px);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (x < w || y < w || x >= size - w || y >= size - w) px[y * size + x] = color;
  return { size, px };
}

/** One canvas with a cube on it. */
class CubeCanvas {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private target: Target;
  private image: ImageData;
  private marks = new Map<string, FaceTex>();

  constructor(
    private size: number,
    private half: number,
  ) {
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d')!;
    this.target = createTarget(size, size);
    this.image = this.g.createImageData(size, size);
  }

  /** The six faces for a side, with a green frame on solved faces and a violet one on the open portal's. */
  private faces(art: CubeArt | null, s: CubeHudState, pulse: boolean): CubeFaces {
    // only what is the same in every game: this cube does not know the game's seed
    const base = bakeFaces(art, s.side, texelFor(this.half * 2), false, true);
    const out = {} as CubeFaces;
    for (const face of FACES) {
      const mark = face === PORTAL_FACE && s.portalOpen ? (pulse ? ROLE.portal : ROLE.portalDark) : s.solved.includes(face) ? ROLE.ok : null;
      if (!mark) {
        out[face] = base[face];
        continue;
      }
      const key = `${art ? 1 : 0}:${s.side}:${face}:${mark}`;
      let tex = this.marks.get(key);
      if (!tex) this.marks.set(key, (tex = framed(base[face], pack(mark))));
      out[face] = tex;
    }
    return out;
  }

  /** Draw the cube in a view, with a marker on the faces in `dots` (when they are in view). */
  draw(art: CubeArt | null, s: CubeHudState, view: Mat3, tilt: Mat3, pulse: boolean, dots: { face: FaceId; color: string }[]): void {
    const t = this.target;
    const m = mul(tilt, view);
    const o = { cx: this.size / 2, cy: this.size / 2, half: this.half, ink: INK, light: HUD_LIGHT, ambient: 0.7 };
    clearTarget(t);
    drawCube(t, this.faces(art, s, pulse), m, o);
    const seen = visibleFaces(m);
    for (const dot of dots) {
      if (!seen.includes(dot.face)) continue;
      // in the middle of the face: a diamond that grows and shrinks by a pixel
      const n = apply(m, NORMALS[dot.face]);
      this.diamond(Math.floor(o.cx + n[0] * o.half), Math.floor(o.cy - n[1] * o.half), (this.half >= 30 ? 3 : 2) + (pulse ? 1 : 0), pack(dot.color));
    }
    this.flush();
  }

  /** Draw the cube from inside, as a room, in a view (cube/orient.ts: roomView). The markers as in `draw`. */
  drawRoom(art: CubeArt | null, s: CubeHudState, view: Mat3, pulse: boolean, dots: { face: FaceId; color: string }[]): void {
    const t = this.target;
    const o = { cx: this.size / 2, cy: this.size / 2, half: ROOM_HALF, ink: INK, light: ROOM_LIGHT, ambient: 0.55, cam: ROOM_CAM };
    clearTarget(t);
    drawRoom(t, this.faces(art, s, pulse), view, o);
    const seen = roomFaces(view, ROOM_CAM);
    for (const dot of dots) {
      if (!seen.includes(dot.face)) continue;
      const [x, y] = projectRoom(view, o, NORMALS[dot.face]);
      this.diamond(Math.floor(x), Math.floor(y), 2 + (pulse ? 1 : 0), pack(dot.color));
    }
    this.flush();
  }

  private flush(): void {
    new Uint32Array(this.image.data.buffer).set(this.target.px);
    this.g.putImageData(this.image, 0, 0);
  }

  private diamond(cx: number, cy: number, r: number, color: number): void {
    const { width, height, px } = this.target;
    for (let y = -r - 1; y <= r + 1; y++)
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.abs(x) + Math.abs(y);
        if (d > r + 1 || cx + x < 0 || cy + y < 0 || cx + x >= width || cy + y >= height) continue;
        px[(cy + y) * width + cx + x] = d > r ? INK : color;
      }
  }
}

/** The longest step one frame may take through a turn, so a stalled frame cannot swallow it. */
const MAX_STEP_MS = 34;

/**
 * A view that is turning from one orientation to another. It advances by frame time, not
 * by the clock: entering a new face can stall the page for a moment, and the turn should
 * still be seen from its start.
 */
class Turning {
  private from: Mat3;
  private to: Mat3;
  /** Progress through the turn, 0..1. */
  private t = 1;
  /** Animated turns started, for the screenshot check. */
  turns = 0;

  constructor(view: Mat3) {
    this.from = this.to = view;
  }

  get target(): Mat3 {
    return this.to;
  }
  get moving(): boolean {
    return this.t < 1;
  }
  get view(): Mat3 {
    return this.moving ? turnAt(this.from, this.to, ease(this.t)) : this.to;
  }
  step(ms: number): void {
    if (this.moving) this.t = Math.min(1, this.t + Math.min(ms, MAX_STEP_MS) / TURN_MS);
  }
  /** Turn to a new view from wherever the cube is now; `animate` false snaps. */
  go(to: Mat3, animate: boolean): void {
    this.from = this.view;
    this.to = to;
    this.t = animate ? 0 : 1;
    if (animate) this.turns++;
  }
}

const same = (a: Mat3, b: Mat3): boolean => a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);

/**
 * Mount the HUD cube in `mount` and the row of progress pips (one per puzzle) in `pips`. The cube map
 * goes in the same HUD, over the game. A chip or a pip takes its colour from its
 * `data-face` (ui/css.ts): the biome outside, the room's tint inside.
 */
export function createCubeHud(mount: HTMLElement, pips: HTMLElement): CubeHud {
  mount.innerHTML = `
    <div class="cu-cube-box">
      ${DIRS.map((d) => `<i class="cu-chip cu-cube-e ${d}" data-dir="${d}"></i>`).join('')}
    </div>`;
  const box = mount.querySelector<HTMLElement>('.cu-cube-box')!;
  const small = new CubeCanvas(SMALL.px, SMALL.half);
  small.canvas.className = 'cu-cube-c';
  box.appendChild(small.canvas);

  const map = document.createElement('div');
  map.className = 'cu-cubemap';
  map.innerHTML = `<div class="cu-panel"><b>Cube map</b><div class="cu-cubemap-c"></div><span class="cu-cubemap-f"></span><span class="cu-dim">Arrows turn the cube</span></div>`;
  const big = new CubeCanvas(BIG.px, BIG.half);
  map.querySelector('.cu-cubemap-c')!.appendChild(big.canvas);
  (mount.closest('.cu-hud') ?? mount).appendChild(map);

  let art: CubeArt | null = null;
  let state: CubeHudState | null = null;
  let hud: Turning | null = null;
  let free: Turning | null = null; // the cube map's own view
  let open = false;
  let pulse = false;
  let raf = 0;
  let last = 0;
  let sig = '';

  const up = (s: CubeHudState) => upFromDrift(s.face, s.drift);
  /** The cube seen from outside with the player's face in front: where the cube map starts. */
  const front = (s: CubeHudState) => poseView(s.side, s.face, up(s));
  const dots = (s: CubeHudState, you: boolean) => {
    const list: { face: FaceId; color: string }[] = [];
    if (you) list.push({ face: s.face, color: ROLE.focus });
    return list;
  };

  function draw(): void {
    if (!state || !hud) return;
    if (state.side === 'in') small.drawRoom(art, state, hud.view, pulse, dots(state, false));
    else small.draw(art, state, hud.view, HUD_TILT, pulse, dots(state, false));
    if (open && free) {
      big.draw(art, state, free.view, HUD_TILT, pulse, dots(state, true));
      const face = facing(free.target);
      const text = `Face ${face} ${FACE_NAMES[state.side][face]}${state.solved.includes(face) ? ' - solved' : ''}${face === state.face ? ' - you' : ''}`;
      const label = map.querySelector<HTMLElement>('.cu-cubemap-f')!;
      if (label.textContent !== text) label.textContent = text;
    }
    if (!raf && (hud.moving || (open && free?.moving))) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function tick(now: number): void {
    raf = 0;
    hud?.step(now - last);
    if (open) free?.step(now - last);
    draw();
  }

  /** The chips on the four edges and the six pips: redrawn only when they change. */
  function labels(s: CubeHudState): boolean {
    const pipFaces = s.puzzleFaces ?? FACES;
    const next = [s.side, s.face, s.drift, s.solved.join(''), s.portalOpen, pipFaces.join('')].join('|');
    if (next === sig) return false;
    sig = next;
    const around = neighbours({ side: s.side, face: s.face, up: up(s) });
    for (const dir of DIRS) {
      const chip = box.querySelector<HTMLElement>(`.cu-cube-e.${dir}`)!;
      const face = around[dir];
      chip.dataset.face = String(face);
      chip.classList.toggle('ok', s.solved.includes(face));
      chip.title = `Face ${face} ${FACE_NAMES[s.side][face]}`;
      chip.textContent = String(face);
    }
    // one pip per puzzle (so n/total fills them all), in the colour of its face once solved
    if (pips.dataset.faces !== pipFaces.join('')) {
      pips.dataset.faces = pipFaces.join('');
      pips.innerHTML = pipFaces.map((f) => `<i data-face="${f}"></i>`).join('');
    }
    for (const pip of pips.querySelectorAll<HTMLElement>(':scope > i')) {
      const face = Number(pip.dataset.face) as FaceId;
      pip.className = [s.solved.includes(face) ? 'ok' : '', face === s.face ? 'here' : ''].join(' ').trim();
      // every state has a shape as well as a colour: tick = solved, plus = you are on that face
      pip.innerHTML = `${s.solved.includes(face) ? '<i class="cu-tick"></i>' : ''}${face === s.face ? '<i class="cu-pip"></i>' : ''}`;
      pip.title = `Face ${face} ${FACE_NAMES[s.side][face]}${s.solved.includes(face) ? ': solved' : ': not solved'}${face === s.face ? ', you are here' : ''}`;
    }
    return true;
  }

  const timer = window.setInterval(() => {
    // the portal's frame pulses (not with reduced motion)
    if (settings().reduceMotion || !state || !mount.isConnected || mount.offsetParent === null) return;
    if (!(state.portalOpen && PORTAL_FACE !== null)) return;
    pulse = !pulse;
    draw();
  }, PULSE_MS);

  void loadCubeArt().then((loaded) => {
    art = loaded;
    draw();
  });

  registerCubeMap({
    show() {
      if (!state || !hud) return;
      // it opens as the HUD cube is: your face in front, your way up
      free = new Turning(front(state));
      open = true;
      map.classList.add('on');
      draw();
    },
    hide() {
      open = false;
      map.classList.remove('on');
    },
    rotate(dir) {
      if (!open || !free) return;
      // the same turn as walking off that edge: the face on that side comes to the front
      free.go(snap(mul(QUARTER[dir], free.target)), !settings().reduceMotion);
      draw();
    },
  });

  if (import.meta.env.DEV) {
    // for the screenshot check (tools/screens/cube.ts): what the two cubes show right now
    const probe = () => ({ front: state ? facing(front(state)) : null, turning: !!hud?.moving, turns: hud?.turns ?? 0, map: open && free ? facing(free.target) : null });
    Object.assign(window, { __cubicCubeMap: cubeMap, __cubicHudCube: probe });
  }

  return {
    update(next) {
      const view = hudView(next.side, next.face, upFromDrift(next.face, next.drift));
      if (!hud || !state || state.side !== next.side) hud = new Turning(view);
      else if (!same(hud.target, view)) hud.go(view, !settings().reduceMotion);
      state = next;
      if (labels(next)) draw(); // the HUD updates several times a second; the cube only when it changed
    },
    destroy() {
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
      registerCubeMap({ show() {}, hide() {}, rotate() {} });
      map.remove();
      mount.replaceChildren();
      pips.replaceChildren();
    },
  };
}
