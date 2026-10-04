import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dpadDir, PAD_DEADZONE } from '../src/input/dpad';
import { DESKTOP, TOUCH, compactLayout, hudScaleFor, isPortrait, layoutMode, snap, uiScaleFor, viewZoomFor, wholeDown, wideLayout, type Device } from '../src/style/fit';
import { VIEW } from '../src/style/tokens';

// The pure parts of the touch layer: which way the d-pad points, which layout and zoom a
// screen gets, and when the device is upright. tools/screens/mobile.ts plays the real game
// with fingers on emulated devices.

const IPHONE: Device = { touch: true, dpr: 3 };
const PIXEL: Device = { touch: true, dpr: 2.625 };
const IPAD: Device = { touch: true, dpr: 2 };
const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;

// ---------- the d-pad ----------

test('d-pad: the stronger axis decides the direction', () => {
  assert.equal(dpadDir(0, -40, 66), 'up');
  assert.equal(dpadDir(0, 40, 66), 'down');
  assert.equal(dpadDir(-40, 0, 66), 'left');
  assert.equal(dpadDir(40, 0, 66), 'right');
  assert.equal(dpadDir(30, -40, 66), 'up');
  assert.equal(dpadDir(-41, 40, 66), 'left');
});

test('d-pad: the middle presses nothing, and a thumb past the rim still counts', () => {
  assert.equal(dpadDir(0, 0, 66), null);
  assert.equal(dpadDir(66 * PAD_DEADZONE * 0.6, 66 * PAD_DEADZONE * 0.6, 66), null);
  assert.equal(dpadDir(66 * PAD_DEADZONE + 1, 0, 66), 'right');
  assert.equal(dpadDir(-300, 20, 66), 'left', 'slid off the pad');
  assert.equal(dpadDir(10, 10, 0), null, 'a pad with no size');
});

test('d-pad: sliding changes direction, but a held direction does not flicker on the diagonal', () => {
  assert.equal(dpadDir(40, -42, 66, 'right'), 'right', 'just past the diagonal: still right');
  assert.equal(dpadDir(40, -60, 66, 'right'), 'up', 'clearly up now');
  assert.equal(dpadDir(42, -40, 66, 'up'), 'up');
  assert.equal(dpadDir(60, -40, 66, 'up'), 'right');
  assert.equal(dpadDir(0, 0, 66, 'up'), null, 'back in the middle: let go');
});

// ---------- upright or sideways ----------

test('portrait is taller than wide', () => {
  assert.equal(isPortrait(390, 664), true);
  assert.equal(isPortrait(750, 340), false);
  assert.equal(isPortrait(810, 1080), true);
  assert.equal(isPortrait(600, 600), false);
});

// ---------- which layout ----------

test('layout: a desktop is a desktop at any size, a phone is compact, a tablet is wide', () => {
  for (const [w, h] of [[390, 664], [844, 390], [1280, 720], [1920, 1080]] as const) assert.equal(layoutMode(w, h, DESKTOP), 'desktop');
  assert.equal(layoutMode(750, 340, IPHONE), 'compact');
  assert.equal(layoutMode(844, 390, IPHONE), 'compact');
  assert.equal(layoutMode(863, 360, PIXEL), 'compact');
  assert.equal(layoutMode(932, 430, IPHONE), 'compact', 'the largest phone');
  assert.equal(layoutMode(1080, 810, IPAD), 'wide');
  assert.equal(layoutMode(1024, 768, IPAD), 'wide');
  assert.equal(layoutMode(1194, 834, IPAD), 'wide');
});

// ---------- the desktop is what it was ----------

test('desktop: the scales are the whole numbers they always were', () => {
  assert.equal(uiScaleFor(1920, 1080, DESKTOP), 4);
  assert.equal(uiScaleFor(1280, 720, DESKTOP), 2);
  assert.equal(uiScaleFor(844, 390, DESKTOP), 1);
  assert.equal(uiScaleFor(300, 200, DESKTOP), 1);
  assert.equal(hudScaleFor(1920, 1080, DESKTOP), 3);
  assert.equal(viewZoomFor(1920, 1080, DESKTOP), 5);
  assert.equal(viewZoomFor(1280, 720, DESKTOP), 3);
  assert.equal(viewZoomFor(844, 390, DESKTOP), 1);
  // a high-density desktop screen changes nothing: the grid there is the CSS pixel
  assert.equal(viewZoomFor(1280, 720, { touch: false, dpr: 2 }), 3);
});

// ---------- touch: the grid is the device pixel ----------

test('touch: every scale is a whole number of device pixels', () => {
  const screens: [number, number, Device][] = [[750, 340, IPHONE], [844, 390, IPHONE], [667, 331, IPAD], [863, 360, PIXEL], [1080, 810, IPAD], [1024, 768, IPAD], [1024, 690, IPAD], [1194, 834, IPAD]];
  for (const [w, h, d] of screens) {
    for (const scale of [uiScaleFor(w, h, d), hudScaleFor(w, h, d), viewZoomFor(w, h, d)]) {
      assert.ok(whole(scale * d.dpr), `${w}x${h}@${d.dpr}: ${scale}`);
      assert.ok(scale >= 1);
    }
  }
  assert.ok(Math.abs(wholeDown(1.9, IPHONE) - 5 / 3) < 1e-9);
  assert.equal(wholeDown(1.9, DESKTOP), 1);
  assert.ok(Math.abs(snap(10.4, IPHONE) - 31 / 3) < 1e-9);
});

test('phone: the view takes the height, at x5 device pixels on an iPhone 14', () => {
  // Safari with its bar: 750x340. The view is 320 of 340 pixels, not the 192 of a whole CSS zoom.
  assert.ok(Math.abs(viewZoomFor(750, 340, IPHONE) - 5 / 3) < 1e-9);
  // added to the home screen: 844x390, x6 device pixels = x2, 384 of 390
  assert.ok(Math.abs(viewZoomFor(844, 390, IPHONE) - 2) < 1e-9);
  assert.ok(Math.abs(viewZoomFor(863, 360, PIXEL) - 4 / 2.625) < 1e-9);
  for (const [w, h, d] of [[750, 340, IPHONE], [844, 390, IPHONE], [863, 360, PIXEL], [667, 331, IPAD]] as const) {
    const l = compactLayout(w, h, d);
    assert.ok(l.view.size <= h && l.view.size >= h * 0.8, `${w}x${h}: the view is ${l.view.size}`);
    assert.ok(l.rail >= TOUCH.rail, `${w}x${h}: rails of ${l.rail}`);
    assert.ok(Math.abs(l.view.x * 2 + l.view.size - w) < 1, 'the view is in the middle');
    assert.ok(whole(l.view.x * d.dpr) && whole(l.view.y * d.dpr), 'the view starts on a device pixel');
    // the controls fit their rail, beside the label of the neighbouring face, at thumb size
    assert.ok(l.pad >= TOUCH.padMin && l.pad <= TOUCH.padMax && l.pad + l.band + 2 * TOUCH.margin <= l.rail + 0.5);
    assert.ok(l.button >= TOUCH.buttonMin && 3 * l.button + 2 * TOUCH.gap + l.band + 2 * TOUCH.margin <= l.rail + 0.5);
  }
});

test('phone: a screen too square for the rails gives up zoom, never the controls', () => {
  const l = compactLayout(640, 480, IPAD);
  assert.ok(l.rail >= TOUCH.rail);
  assert.equal(l.z, 1);
});

test('tablet: the desktop layout with a strip for the controls under it', () => {
  for (const [w, h] of [[1080, 810], [1024, 768], [1194, 834], [1024, 690]] as const) {
    const l = wideLayout(w, h, IPAD);
    assert.ok(l.strip >= TOUCH.strip, `${w}x${h}: a strip of ${l.strip}`);
    assert.ok(l.pad <= l.strip && l.pad >= TOUCH.padMin);
    assert.ok(l.mid + l.strip <= h + 0.5);
    // the column still has its minimum width beside the view
    assert.ok(VIEW.px * l.z + (VIEW.chromeX + VIEW.columnMin) * l.u <= w);
  }
  assert.equal(viewZoomFor(1080, 810, IPAD), 3, 'the zoom of a desktop window of that size');
  // the width decides here: x2 in a desktop window, x2.5 (five device pixels) on the iPad
  assert.equal(viewZoomFor(1024, 768, IPAD), 2.5);
  assert.equal(viewZoomFor(1024, 768, DESKTOP), 2);
});
