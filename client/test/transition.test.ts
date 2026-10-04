import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACES, FACE_SIZE, SIDES, TILE_PX, canonToScreen, eq, screenToCanon, stepPose, upsOn, type Pose } from '@cubic/shared';
import {
  FADE_MS,
  FLUSH_BURST,
  FLUSH_GAP_MS,
  HOP_MS,
  InputBuffer,
  ROLL_MS,
  HOP_LANDING,
  HOP_SHADOW_ALPHA,
  HOP_SHADOW_H,
  HOP_TAKEOFF,
  easeInOut,
  hopBoxes,
  hopFrame,
  hopLift,
  mirrorStrip,
  rollPoint,
  rollStrips,
  rollWalker,
  transitionKind,
  transitionMs,
  upBeforeFlip,
  type Buffered,
} from '../src/game/transition';

const V = FACE_SIZE * TILE_PX;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

test('transition kinds: outside rolls ~500 ms, inside hops ~400 ms, reduce motion is a quick fade', () => {
  assert.equal(transitionKind('out', false), 'roll');
  assert.equal(transitionKind('in', false), 'hop');
  assert.equal(transitionKind('out', true), 'fade');
  assert.equal(transitionKind('in', true), 'fade');
  assert.equal(transitionMs('roll'), ROLL_MS);
  assert.equal(transitionMs('hop'), HOP_MS);
  assert.equal(transitionMs('fade'), FADE_MS);
  assert.equal(ROLL_MS, 500);
  assert.equal(HOP_MS, 400);
  assert.ok(FADE_MS <= 200);
});

test('direction: the old face is redrawn with the up from before the step, on every edge, corner and drift', () => {
  let checked = 0;
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const up of upsOn(face)) {
        for (const [dx, dy] of DIRS) {
          // Stand on the screen edge we are about to walk off, at any place along it.
          for (const along of [0, 5, FACE_SIZE - 1]) {
            const sx = dx > 0 ? FACE_SIZE - 1 : dx < 0 ? 0 : along;
            const sy = dy > 0 ? FACE_SIZE - 1 : dy < 0 ? 0 : along;
            const [x, y] = screenToCanon(side, face, up, sx, sy);
            const before: Pose = { side, face, up, x, y, dir: 1 };
            const { pose: after, crossed } = stepPose(before, dx, dy);
            assert.ok(crossed);
            assert.ok(eq(upBeforeFlip(after.face, after.up, dy), up), `${side} face ${face} step ${dx},${dy}`);
            // The tile we arrive on is the one across the edge: same place along it, far end.
            const [ax, ay] = canonToScreen(side, after.face, after.up, after.x, after.y);
            assert.deepEqual([(ax - dx + FACE_SIZE) % FACE_SIZE, (ay - dy + FACE_SIZE) % FACE_SIZE], [sx, sy]);
            checked++;
          }
        }
      }
    }
  }
  assert.equal(checked, 2 * 6 * 4 * 4 * 3);
});

test('roll: starts as the old face head-on and ends as the new face head-on, pixel for pixel', () => {
  for (const [turn, face] of [
    [0, 0],
    [1, 1],
  ] as const) {
    const strips = rollStrips(turn, V);
    assert.equal(strips.length, V);
    strips.forEach((s, i) => assert.deepEqual(s, { face, src: i, start: 0, length: V, light: 1 }, `turn ${turn} column ${i}`));
  }
});

test('roll: the new face comes in from the far end and the shared edge sweeps across, never leaving the view', () => {
  let lastOld = V;
  for (let step = 1; step < 20; step++) {
    const strips = rollStrips(step / 20, V);
    const faces = strips.map((s) => s.face).filter((f) => f >= 0);
    // old face first, then the new one: one edge between them, no holes
    assert.deepEqual(faces, [...faces].sort(), `step ${step}`);
    // Head-on, a cube shows one face: the next one appears once the cube has turned a little.
    if (step >= 4) assert.ok(faces.includes(1), `step ${step}: the new face is in view`);
    if (step >= 17) assert.ok(!faces.includes(0), `step ${step}: the old face has turned away`);
    const old = faces.filter((f) => f === 0).length;
    assert.ok(old <= lastOld, `step ${step}: the old face only shrinks`);
    lastOld = old;
    for (const face of [0, 1] as const) {
      const src = strips.filter((s) => s.face === face).map((s) => s.src);
      src.forEach((v, i) => assert.ok(i === 0 || v >= src[i - 1]!, `step ${step}: face ${face} is drawn in order`));
    }
    for (const s of strips) {
      if (s.face < 0) continue;
      assert.ok(Number.isInteger(s.start) && Number.isInteger(s.length), 'whole pixels');
      assert.ok(s.start >= 0 && s.start + s.length <= V, `step ${step}: a strip leaves the view`);
      assert.ok(s.light > 0 && s.light <= 1);
    }
  }
  assert.equal(lastOld, 0, 'the old face is gone at the end');
});

test('roll: the faces meet at the shared edge, and the edge is the nearest (tallest) line', () => {
  for (let step = 0; step <= 10; step++) {
    const turn = step / 10;
    const a = rollPoint(turn, V, 0, V, 40);
    const b = rollPoint(turn, V, 1, 0, 40);
    assert.ok(Math.abs(a.along - b.along) < 1e-6 && Math.abs(a.across - b.across) < 1e-6, `turn ${turn}`);
  }
  const mid = rollStrips(0.5, V);
  const edge = mid.findIndex((s) => s.face === 1);
  const longest = Math.max(...mid.map((s) => s.length));
  assert.ok(mid[edge]!.length >= longest - 1);
  assert.ok(mid[edge]!.length > mid.find((s) => s.face === 0)!.length, 'the far end of the old face is smaller');
  // Head-on the projection is the identity.
  assert.deepEqual(rollPoint(0, V, 0, 30, 70), { along: 30, across: 70 });
  const end = rollPoint(1, V, 1, 30, 70);
  assert.ok(Math.abs(end.along - 30) < 1e-6 && Math.abs(end.across - 70) < 1e-6);
});

test('roll: the character steps from the last tile of the old face to the first tile of the new one', () => {
  assert.deepEqual(rollWalker(0, V, TILE_PX), { face: 0, along: V - TILE_PX / 2 });
  assert.deepEqual(rollWalker(1, V, TILE_PX), { face: 1, along: TILE_PX / 2 });
  let last = -Infinity;
  for (let step = 0; step <= 16; step++) {
    const w = rollWalker(step / 16, V, TILE_PX);
    const unfolded = w.face === 0 ? w.along : V + w.along;
    assert.ok(unfolded >= last, 'never steps back');
    last = unfolded;
  }
  // Left and up are the same roll mirrored.
  assert.equal(mirrorStrip(0, V), V - 1);
  assert.equal(mirrorStrip(mirrorStrip(17, V), V), 17);
});

test('hop and easing: start and end on the ground, highest in the middle', () => {
  assert.equal(hopLift(0, 10), 0);
  assert.equal(hopLift(1, 10), 0);
  assert.equal(hopLift(0.5, 10), 10);
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
});

// ---------- the hop ----------

/** The scene's numbers: a tile, a face plus the wall, a tile plus the wall, the arc height. */
const WALL_PX = 10;
const HOP = { size: TILE_PX, span: V + WALL_PX, reach: TILE_PX + WALL_PX, height: 14 };
const FRAMES = Array.from({ length: 401 }, (_, i) => hopFrame(i / 400, HOP));
const APEX = (HOP_TAKEOFF + HOP_LANDING) / 2;

test('hop: starts and ends as the standing character, with no lift and no shadow', () => {
  for (const [k, slide, travel] of [
    [0, 0, 0],
    [1, HOP.span, HOP.reach],
  ] as const) {
    const f = hopFrame(k, HOP);
    assert.deepEqual(f, { slide, travel, lift: 0, width: TILE_PX, height: TILE_PX, shadowWidth: TILE_PX - 2, shadowAlpha: 0 }, `k ${k}`);
    // drawn exactly on the tile: nothing jumps when the transition starts or ends
    assert.deepEqual(hopBoxes(f, 32, 48, TILE_PX).body, { x: 32, y: 48, w: TILE_PX, h: TILE_PX });
  }
  // out of range is clamped
  assert.deepEqual(hopFrame(-1, HOP), hopFrame(0, HOP));
  assert.deepEqual(hopFrame(2, HOP), hopFrame(1, HOP));
});

test('hop: the arc peaks at the full height right above the wall, and only rises then falls', () => {
  const peak = Math.max(...FRAMES.map((f) => f.lift));
  assert.equal(peak, HOP.height);
  const mid = hopFrame(APEX, HOP);
  assert.equal(mid.lift, HOP.height);
  // the character's middle is over the middle of the wall at the top of the arc
  assert.equal(mid.travel, HOP.reach / 2);
  const top = FRAMES.findIndex((f) => f.lift === peak);
  FRAMES.forEach((f, i) => {
    if (i === 0) return;
    const before = FRAMES[i - 1]!.lift;
    assert.ok(i <= top ? f.lift >= before : f.lift <= before, `frame ${i}`);
  });
  assert.ok(HOP.height >= TILE_PX * 0.75, 'a hop you can see: most of a tile high');
});

test('hop: crouch on the ground, bigger in the air, squash on landing', () => {
  for (const [i, f] of FRAMES.entries()) {
    const k = i / 400;
    if (k < HOP_TAKEOFF || k >= HOP_LANDING) {
      assert.equal(f.lift, 0, `on the ground at ${k}`);
      assert.ok(f.height <= TILE_PX && f.width >= TILE_PX, `squashed, never stretched, at ${k}`);
    }
    if (k < HOP_TAKEOFF) assert.equal(f.travel, 0, 'no sliding along the floor before the jump');
    if (k >= HOP_LANDING) assert.equal(f.travel, HOP.reach, 'landed on the tile');
  }
  const crouch = hopFrame(HOP_TAKEOFF - 0.001, HOP);
  assert.ok(crouch.height < TILE_PX && crouch.width > TILE_PX);
  const apex = hopFrame(APEX, HOP);
  assert.ok(apex.width > TILE_PX && apex.height > TILE_PX, 'nearer the eye at the top');
  const landed = hopFrame(HOP_LANDING + 0.001, HOP);
  assert.ok(landed.height < TILE_PX && landed.width > TILE_PX);
});

test('hop: the view slide and the travel never step back and land exactly', () => {
  FRAMES.forEach((f, i) => {
    if (i === 0) return;
    assert.ok(f.slide >= FRAMES[i - 1]!.slide && f.travel >= FRAMES[i - 1]!.travel, `frame ${i}`);
  });
  assert.equal(FRAMES[400]!.slide, HOP.span);
  // the last frames of the slide close in one pixel at a time: no jump onto the new face
  const last = FRAMES.slice(360).map((f) => f.slide);
  last.forEach((s, i) => assert.ok(i === 0 || s - last[i - 1]! <= 1));
  // slow, fast, slow
  assert.ok(hopFrame(HOP_TAKEOFF, HOP).slide <= 2, 'the view waits for the crouch');
  assert.equal(hopFrame(0.5, HOP).slide, HOP.span / 2);
});

test('hop: the shadow stays on the floor line, and shrinks and fades towards the top', () => {
  const [gx, gy] = [64, 80];
  for (const f of FRAMES) {
    const { body, shadow, carried } = hopBoxes(f, gx, gy, TILE_PX);
    assert.deepEqual([shadow.y, shadow.h], [gy + TILE_PX - HOP_SHADOW_H, HOP_SHADOW_H], 'the shadow does not rise');
    assert.equal(shadow.x + shadow.w / 2, gx + TILE_PX / 2, 'centred under the character');
    assert.equal(body.x + body.w / 2, gx + TILE_PX / 2);
    assert.equal(body.y + body.h, gy + TILE_PX - f.lift, 'the feet are the lift above the floor');
    assert.equal(carried.y, body.y - 11, 'the carried item rides on the head');
    assert.equal(carried.x, gx);
    assert.ok(f.shadowAlpha >= 0 && f.shadowAlpha <= HOP_SHADOW_ALPHA);
  }
  const ground = hopFrame(HOP_TAKEOFF, HOP);
  const apex = hopFrame(APEX, HOP);
  assert.ok(apex.shadowWidth < ground.shadowWidth, 'smaller at the top');
  assert.ok(apex.shadowAlpha < ground.shadowAlpha && apex.shadowAlpha > 0, 'fainter at the top, still there');
  assert.equal(ground.shadowAlpha, HOP_SHADOW_ALPHA);
});

test('hop: every frame is whole pixels, and sizes stay even so the centre does not wobble', () => {
  for (const f of FRAMES) {
    for (const [name, v] of Object.entries(f)) if (name !== 'shadowAlpha') assert.ok(Number.isInteger(v), `${name} = ${v}`);
    assert.equal(f.width % 2, 0);
    assert.equal(f.shadowWidth % 2, 0);
    const { body, shadow, carried } = hopBoxes(f, 7, 9, TILE_PX);
    for (const v of [...Object.values(body), ...Object.values(shadow), carried.x, carried.y]) assert.ok(Number.isInteger(v));
  }
});

// ---------- input during a transition ----------

/** The server's move budget (server/src/rooms.ts LIMITS): a burst of 5, one more every 90 ms. */
class ServerBudget {
  private tokens = 5;
  private last = 0;
  dropped = 0;
  take(now: number): void {
    this.tokens = Math.min(5, this.tokens + (now - this.last) / 90);
    this.last = now;
    if (this.tokens >= 1) this.tokens--;
    else this.dropped++;
  }
}

const move = (dx: number, dy: number): Buffered => ({ kind: 'move', dx, dy });

test('input buffer: presses made during a transition come back in order, none dropped', () => {
  const buffer = new InputBuffer();
  const pressed: Buffered[] = [move(1, 0), move(0, 1), { kind: 'interact' }, move(-1, 0), move(0, -1), move(1, 0), { kind: 'interact' }, move(1, 0), move(1, 0)];
  pressed.forEach((p) => buffer.push(p));
  assert.equal(buffer.length, pressed.length);
  assert.equal(buffer.next(0)?.kind, 'move', 'handed out when asked');
  buffer.clear();
  pressed.forEach((p) => buffer.push(p));

  buffer.release(1000);
  const got: Buffered[] = [];
  const perFrame: number[] = [];
  for (let now = 1000; now < 3000; now += 16) {
    let n = 0;
    for (let input = buffer.next(now); input; input = buffer.next(now)) {
      got.push(input);
      n++;
    }
    perFrame.push(n);
  }
  assert.deepEqual(got, pressed);
  assert.equal(buffer.length, 0);
  assert.equal(perFrame[0], FLUSH_BURST, 'the first frame flushes the burst');
  assert.ok(Math.max(...perFrame.slice(1)) <= 1, 'after the burst, one at a time');
});

test('input buffer: the flush stays inside the server budget, even with a key held', () => {
  const buffer = new InputBuffer();
  const server = new ServerBudget();
  for (let i = 0; i < 12; i++) buffer.push(move(1, 0));
  // The transition played for ROLL_MS, so the server budget is full again.
  const t0 = ROLL_MS;
  buffer.release(t0);
  let sent = 0;
  let nextRepeat = t0;
  for (let now = t0; now < t0 + 4000; now += 16) {
    for (let input = buffer.next(now); input; input = buffer.next(now)) {
      server.take(now);
      sent++;
    }
    // GameScene: the held key repeats (every 130 ms) only once the buffer is empty.
    if (!buffer.length && now >= nextRepeat) {
      nextRepeat = now + 130;
      server.take(now);
      sent++;
    }
  }
  assert.ok(sent > 12);
  assert.equal(server.dropped, 0, 'the server dropped a move');
  assert.ok(FLUSH_BURST + 1 <= 5 && FLUSH_GAP_MS >= 90);
});

test('input buffer: nothing comes out before the transition is released', () => {
  const buffer = new InputBuffer();
  buffer.release(0);
  buffer.push(move(1, 0));
  for (let i = 0; i < FLUSH_BURST; i++) buffer.push(move(1, 0));
  let n = 0;
  while (buffer.next(10)) n++;
  assert.equal(n, FLUSH_BURST);
  assert.equal(buffer.next(10 + FLUSH_GAP_MS - 1), null, 'the rest waits for the gap');
  assert.ok(buffer.next(10 + FLUSH_GAP_MS));
});
