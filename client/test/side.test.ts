import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Side } from '@cubic/shared';
import { DESKTOP, uiScaleFor, type Device } from '../src/style/fit';
import { CUBE_ART, FACE_ART, GRASS_ROWS, OUT_STRIPS, TURTLE_ART, centreOf, inside, sideAt, sideLayout, sideState, turtleIn, type SideState } from '../src/scenes/sideLayout';

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
  assert.ok(turtleIn(layout, 'out', 'idle').alpha < turtleIn(layout, 'out', 'hover').alpha);
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
