import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOUBLE_TAP, cancelsPinch, isDoubleTap, ownsItsTaps } from '../src/input/zoomRules';
import { isZoomed, sizeKey, visibleFrom } from '../src/style/fit';

// The pure parts of "the page does not zoom, and recovers if it did" (input/zoomRules.ts,
// style/fit.ts). tools/screens/first-tap.ts does it with fingers on emulated phones.

// ---------- is the page zoomed ----------

test('zoom: x1 is not zoomed, and neither is a browser that reports it a hair off', () => {
  assert.equal(isZoomed(1), false);
  assert.equal(isZoomed(1.004), false);
  assert.equal(isZoomed(0.996), false);
  assert.equal(isZoomed(undefined), false); // no visual viewport
  assert.equal(isZoomed(null), false);
  assert.equal(isZoomed(0), false); // a page that is not shown yet
});

test('zoom: zoomed in, and zoomed out below x1', () => {
  assert.equal(isZoomed(1.01), true);
  assert.equal(isZoomed(2), true);
  assert.equal(isZoomed(0.8), true);
});

// ---------- the size the game is laid out from ----------

const LAYOUT = { width: 800, height: 400 };

test('visible size: at x1 it is the visual viewport, rounded', () => {
  assert.deepEqual(visibleFrom({ width: 750.4, height: 339.6, scale: 1 }, null, LAYOUT), { width: 750, height: 340 });
});

test('visible size: without a visual viewport, or with an empty one, it is the layout viewport', () => {
  assert.equal(visibleFrom(null, null, LAYOUT), LAYOUT);
  assert.equal(visibleFrom({ width: 0, height: 0, scale: 1 }, null, LAYOUT), LAYOUT);
  assert.equal(visibleFrom({ width: 750, height: 340, scale: 0 }, null, LAYOUT), LAYOUT);
});

test('visible size: zoomed in, the game keeps the size it had at x1', () => {
  const atRest = { width: 750, height: 340 };
  // x2: half the page is in sight
  assert.equal(visibleFrom({ width: 375, height: 170, scale: 2 }, atRest, LAYOUT), atRest);
  // in the middle of a pinch the numbers round a pixel up and down: still the same size
  assert.equal(visibleFrom({ width: 441.6, height: 199.8, scale: 1.7 }, atRest, LAYOUT), atRest);
  assert.equal(visibleFrom({ width: 288.1, height: 131.2, scale: 2.6 }, atRest, LAYOUT), atRest);
});

test('visible size: zoomed and then turned (or never seen at x1), it is the viewport times its scale', () => {
  assert.deepEqual(visibleFrom({ width: 170, height: 375, scale: 2 }, { width: 750, height: 340 }, LAYOUT), { width: 340, height: 750 });
  assert.deepEqual(visibleFrom({ width: 375, height: 170, scale: 2 }, null, LAYOUT), { width: 750, height: 340 });
});

// ---------- a menu is rebuilt only when its canvas changed ----------

test('size key: the same canvas has the same key; a new size or a new zoom has another', () => {
  const a = sizeKey({ width: 712, height: 327, zoom: 1 });
  assert.equal(sizeKey({ width: 712, height: 327, zoom: 1 }), a);
  assert.notEqual(sizeKey({ width: 327, height: 712, zoom: 1 }), a);
  assert.notEqual(sizeKey({ width: 712, height: 327, zoom: 4 / 3 }), a);
});

// ---------- a double tap ----------

test('double tap: a second tap soon after and close to the first', () => {
  const first = { t: 1000, x: 100, y: 100 };
  assert.equal(isDoubleTap(first, { t: 1150, x: 104, y: 97 }), true);
  assert.equal(isDoubleTap(first, { t: 1000 + DOUBLE_TAP.ms, x: 100, y: 100 }), true);
});

test('double tap: not the first tap, not a slow one, not one somewhere else', () => {
  const first = { t: 1000, x: 100, y: 100 };
  assert.equal(isDoubleTap(null, first), false);
  assert.equal(isDoubleTap(first, { t: 1001 + DOUBLE_TAP.ms, x: 100, y: 100 }), false);
  assert.equal(isDoubleTap(first, { t: 1100, x: 100 + DOUBLE_TAP.px + 1, y: 100 }), false);
  assert.equal(isDoubleTap(first, { t: 900, x: 100, y: 100 }), false); // (a clock that went back)
});

test('double tap: a text field keeps its own (it selects a word, and the keyboard must come up)', () => {
  assert.equal(ownsItsTaps({ tagName: 'INPUT' }), true);
  assert.equal(ownsItsTaps({ tagName: 'textarea' }), true);
  assert.equal(ownsItsTaps({ tagName: 'SELECT' }), true);
  assert.equal(ownsItsTaps({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(ownsItsTaps({ tagName: 'DIV' }), false);
  assert.equal(ownsItsTaps({ tagName: 'CANVAS' }), false);
  assert.equal(ownsItsTaps(null), false);
});

// ---------- a pinch ----------

test('pinch: the second finger is cancelled, one finger never is', () => {
  assert.equal(cancelsPinch(1, false), false);
  assert.equal(cancelsPinch(2, false), true);
  assert.equal(cancelsPinch(3, false), true);
});

test('pinch: on a page that is zoomed already, two fingers are let through to zoom back out', () => {
  assert.equal(cancelsPinch(2, true), false);
  assert.equal(cancelsPinch(1, true), false);
});
