import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import type { Side } from '@cubic/shared';
import { DESKTOP, uiScaleFor, type Device } from '../src/style/fit';
import { C } from '../src/style/tokens';
import { BAR, CUBE_ART, FACE_ART, GRASS_ROWS, OUT_STRIPS, PANEL, TURTLE_ART, centreOf, idleTone, inside, sideAt, sideLayout, sideState, turtleIn, type SideState } from '../src/scenes/sideLayout';

/** The logical screen the fit system gives a window (style/scale.ts logicalSize). */
function logical(width: number, height: number, d: Device): { W: number; H: number } {
  const scale = uiScaleFor(width, height, d);
  return { W: Math.ceil(width / scale), H: Math.ceil(height / scale) };
}

const PHONE: Device = { touch: true, dpr: 3 };
const SCREENS: [string, number, number, Device][] = [
  ['1920x1080', 1920, 1080, DESKTOP],
  ['1280x720', 1280, 720, DESKTOP],
  ['1000x640', 1000, 640, DESKTOP],
  ['phone landscape 844x390', 844, 390, PHONE],
];
const CASES: [SideState, Side][] = [
  ['hover', 'out'],
  ['hover', 'in'],
  ['selected', 'out'],
  ['selected', 'in'],
  ['idle', 'out'],
  ['idle', 'in'],
];
const whole = (n: number) => Number.isInteger(n);

for (const [name, w, h, d] of SCREENS) {
  const { W, H } = logical(w, h, d);
  const layout = sideLayout(W, H);
  for (const [state, side] of CASES) {
    test(`side select ${name} (${W}x${H}, x${layout.zoom}): ${state} ${side}, the turtle stands whole on its face, in the middle`, () => {
      const spot = layout.spots[side];
      const turtle = turtleIn(layout, side, state);
      assert.ok(inside(spot.face, spot.cube), 'the face is part of the cube');
      assert.ok(inside(turtle.box, spot.face), `turtle ${JSON.stringify(turtle.box)} is not inside face ${JSON.stringify(spot.face)}`);
      const [t, f] = [centreOf(turtle.box), centreOf(spot.face)];
      assert.ok(Math.abs(t.x - f.x) <= 2 && Math.abs(t.y - f.y) <= 2, `centre off by ${t.x - f.x}, ${t.y - f.y}`);
      assert.deepEqual(turtle.anchor, t);
      // whole pixels: the cube, the face and the turtle's corner
      for (const b of [spot.cube, spot.face, turtle.box]) for (const n of [b.x, b.y, b.w, b.h]) assert.ok(whole(n), `${n} is not a whole pixel`);
      // and the cube is on the screen
      assert.ok(inside(spot.cube, { x: 0, y: 0, w: W, h: H }));
    });
  }
}

test('side select: the turtle does not move between idle, hover and selected', () => {
  const layout = sideLayout(640, 360);
  for (const side of ['out', 'in'] as Side[]) {
    assert.deepEqual(turtleIn(layout, side, 'hover').box, turtleIn(layout, side, 'idle').box);
    assert.deepEqual(turtleIn(layout, side, 'selected').box, turtleIn(layout, side, 'idle').box);
  }
});

test('side select: the idle turtle is fully opaque and grey, hover and selected are in colour', () => {
  const layout = sideLayout(640, 360);
  for (const side of ['out', 'in'] as Side[]) {
    for (const state of ['idle', 'hover', 'selected'] as SideState[]) assert.equal(turtleIn(layout, side, state).alpha, 1);
    assert.equal(turtleIn(layout, side, 'idle').grey, true);
    assert.equal(turtleIn(layout, side, 'idle').moving, false);
    assert.equal(turtleIn(layout, side, 'hover').grey, false);
    assert.equal(turtleIn(layout, side, 'selected').grey, false);
  }
  // the grey keeps light and dark apart (the outline stays ink) and takes most of the colour out
  const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
  const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  assert.deepEqual(idleTone(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(idleTone(255, 255, 255), [255, 255, 255]);
  for (const colour of [C.green, C.grass, C.greenDark]) {
    const from = hexRgb(colour);
    const to = idleTone(...from);
    assert.ok(spread(to) <= spread(from) * 0.25, `${colour} is still coloured: ${to.join(',')}`);
  }
  // on the grass it stands on, the grey turtle is plainly not grass
  const grass = hexRgb(C.grass);
  const body = idleTone(...hexRgb(C.green));
  assert.ok(spread(grass) - spread(body) > 60, 'grey on green');
});

test('side select: the middle panel never reaches the bottom bar, at any screen the fit system makes', () => {
  const sizes: [number, number, Device][] = [...SCREENS.map(([, w, h, d]) => [w, h, d] as [number, number, Device]), [1366, 768, DESKTOP], [2560, 1440, DESKTOP], [667, 375, { touch: true, dpr: 2 }], [932, 430, PHONE], [1024, 768, { touch: true, dpr: 2 }]];
  for (const [w, h, d] of sizes) {
    const { W, H } = logical(w, h, d);
    const { panel, barY, slotX } = sideLayout(W, H);
    assert.equal(barY, H - BAR);
    assert.ok(panel.y + panel.h < barY, `${w}x${h} (${W}x${H}): the panel ends at ${panel.y + panel.h}, the bar starts at ${barY}`);
    assert.ok(panel.y >= 40, `${w}x${h}: the panel starts at ${panel.y}, under the room code`);
    assert.deepEqual([panel.w, panel.h], [PANEL.w, PANEL.h]);
    assert.equal(panel.x + panel.w / 2, slotX.mid);
    for (const n of [panel.x, panel.y]) assert.ok(whole(n));
  }
  // a screen with room keeps the panel where it was: just above the cubes
  const roomy = sideLayout(640, 360);
  assert.equal(roomy.panel.y, roomy.cubeTop - 14);
});

test('side select: a picked side is selected, a mouse over a free side hovers, a finger never hovers', () => {
  assert.equal(sideState(true, false, false), 'selected');
  assert.equal(sideState(true, true, false), 'selected');
  assert.equal(sideState(false, true, false), 'hover');
  assert.equal(sideState(false, false, false), 'idle');
  assert.equal(sideState(false, true, true), 'idle');
  assert.equal(sideState(true, true, true), 'selected');
});

test('side select: the point under the mouse is on the outside cube, the inside cube or neither', () => {
  const layout = sideLayout(640, 360);
  for (const side of ['out', 'in'] as Side[]) {
    const c = centreOf(layout.spots[side].cube);
    assert.equal(sideAt(layout, c.x, c.y), side);
  }
  assert.equal(sideAt(layout, layout.slotX.mid, 180), null);
  assert.equal(sideAt(layout, layout.spots.out.cube.x - 1, layout.spots.out.cube.y), null);
});

test('side select: the deeper outside cube is cut from the whole picture, and a turtle fits on its grass and in the room', () => {
  assert.equal(OUT_STRIPS.reduce((n, [, rows]) => n + rows, 0), CUBE_ART.h);
  for (const [from, rows] of OUT_STRIPS) assert.ok(from >= 0 && from + rows <= CUBE_ART.h);
  assert.equal(FACE_ART.out.h, GRASS_ROWS);
  for (const side of ['out', 'in'] as Side[]) assert.ok(FACE_ART[side].w >= TURTLE_ART && FACE_ART[side].h >= TURTLE_ART);
});

// THE REAL PICTURES. FACE_ART and OUT_STRIPS are rows and columns of cube-out.png and
// cube-in.png: if the art is drawn again with another top or another room, these fail
// instead of the turtle quietly standing somewhere else.

/** An 8-bit RGBA PNG (what tools/art writes) as '#rrggbb' per pixel, null where it is clear. */
function readPng(path: string): { width: number; height: number; at(x: number, y: number): string | null } {
  const png = readFileSync(new URL(path, import.meta.url));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], `${path}: 8-bit RGBA, not interlaced`);
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const size = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? px[y * stride + i - 4]! : 0;
      const up = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const corner = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4]! : 0;
      const p = left + up - corner;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      const add = [0, left, up, (left + up) >> 1, paeth][filter]!;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i]! + add) & 255;
    }
  }
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return px[i + 3] === 0 ? null : `#${px.toString('hex', i, i + 3)}`;
  };
  return { width, height, at };
}

const UI = '../public/assets/ui/';
const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

test('side select: cube-out.png has the grass where FACE_ART and OUT_STRIPS say it is', () => {
  const png = readPng(`${UI}cube-out.png`);
  assert.deepEqual([png.width, png.height], [CUBE_ART.w, CUBE_ART.h]);
  const grassy = (c: string | null) => same(c, C.grass) || same(c, C.grassLight) || same(c, C.green);
  /** A row of the top face: grass from edge to edge of the face, with the light grass in it. */
  const isGrass = (y: number) => {
    const row = Array.from({ length: FACE_ART.out.w }, (_, i) => png.at(FACE_ART.out.x + i, y));
    return row.every(grassy) && row.some((c) => same(c, C.grass) || same(c, C.grassLight));
  };
  const rows = Array.from({ length: png.height }, (_, y) => y).filter(isGrass);
  assert.deepEqual(rows, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'the grass rows of the picture');
  // the face is the grass and nothing wider: ink on both sides of it
  for (const y of rows) {
    assert.ok(same(png.at(FACE_ART.out.x - 1, y), C.ink));
    assert.ok(same(png.at(FACE_ART.out.x + FACE_ART.out.w, y), C.ink));
  }
  // the strips: the picture down to its last grass row, then only grass rows again, then
  // the lip (all dark green) right under them. Together: GRASS_ROWS of grass from row 1.
  const [top, more, lip] = OUT_STRIPS;
  assert.deepEqual([top![0], top![0] + top![1] - 1], [0, rows.at(-1)]);
  for (let y = more![0]; y < more![0] + more![1]; y++) assert.ok(rows.includes(y) && y !== rows[0], `row ${y} of the second strip is not plain grass`);
  assert.equal(lip![0], rows.at(-1)! + 1);
  for (let x = FACE_ART.out.x; x < FACE_ART.out.x + FACE_ART.out.w; x++) assert.ok(same(png.at(x, lip![0]), C.green), 'the lip under the grass');
  assert.equal(rows.length + more![1], GRASS_ROWS);
  assert.equal(FACE_ART.out.y, rows[0]);
});

test('side select: cube-in.png has the room where FACE_ART says it is', () => {
  const png = readPng(`${UI}cube-in.png`);
  assert.deepEqual([png.width, png.height], [CUBE_ART.w, CUBE_ART.h]);
  const { x, y, w, h } = FACE_ART.in;
  // an ink frame all around the opening
  for (let i = 0; i < w; i++) {
    assert.ok(same(png.at(x + i, y - 1), C.ink), `ink over the room at x=${x + i}`);
    assert.ok(same(png.at(x + i, y + h), C.ink), `ink under the room at x=${x + i}`);
  }
  for (let j = 0; j < h; j++) {
    assert.ok(same(png.at(x - 1, y + j), C.ink), `ink left of the room at y=${y + j}`);
    assert.ok(same(png.at(x + w, y + j), C.ink), `ink right of the room at y=${y + j}`);
  }
  // and no wall stone inside it
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) assert.ok(!same(png.at(x + i, y + j), C.mauve), `wall at ${x + i},${y + j}`);
  // the wall is right outside the frame
  assert.ok(same(png.at(x - 2, y + 2), C.mauve) || same(png.at(x - 2, y + 2), C.slate));
});
