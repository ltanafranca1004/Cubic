import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, NORMALS, SIDES, canonRight, type FaceId } from '@cubic/shared';
import { apply, type V3 } from '../src/cube/mat';
import { clearDepthTarget, createDepthTarget, drawQuad, drawSprite, pack, shadeBox, type FaceTex } from '../src/cube/raster';
import type { PlayerFrames } from '../src/game/turtle';
import { Ending } from '../src/scenes/ending/run';
import {
  CARD_AT,
  CARD_DROP_MS,
  ENDING_MS,
  FLASH_MS,
  FLAT_AT,
  JUMP_AT,
  JUMP_MS,
  LID_AT,
  LID_MS,
  RUN_AT,
  RUN_LAP_MS,
  RUN_RADIUS,
  RUN_SPREAD_MS,
  SKIP_AFTER_MS,
  WALL_AT,
  YAW,
  canSkip,
  cardDelay,
  endingClock,
  endingFrame,
  endingLayout,
  endingView,
  fall,
  netQuads,
  phaseAt,
  projectPoint,
  runFacing,
  turtleLook,
  turtlePoint,
  turtleScale,
} from '../src/scenes/ending/timeline';

const Q = Math.PI / 2;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearV = (a: V3, b: readonly number[], eps = 1e-9) => a.every((v, i) => near(v, b[i]!, eps));
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Where a turtle is in the model, its lift included. */
const spot = (t: { at: V3; lift: number }): V3 => [t.at[0], t.at[1] + t.lift, t.at[2]];
/** The turtles' sheet as assets/manifest.json lists it. */
const SHEET: PlayerFrames = { image: 'sprites/player-out.png', idle: [0, 1], walk: [30, 31, 32, 33], walkDown: [30, 31, 32, 33], walkUp: [36, 37, 38, 39], walkRight: [42, 43, 44, 45] };

test('the timeline: flash, unfold, meet, run, card, in that order, about 8 seconds', () => {
  assert.deepEqual(
    [0, LID_AT - 1, LID_AT, FLAT_AT - 1, FLAT_AT, RUN_AT - 1, RUN_AT, CARD_AT - 1, CARD_AT, 60_000].map(phaseAt),
    ['flash', 'flash', 'unfold', 'unfold', 'meet', 'meet', 'run', 'run', 'card', 'card'],
  );
  assert.ok(FLASH_MS <= LID_AT && LID_AT < FLAT_AT && FLAT_AT < RUN_AT && RUN_AT < CARD_AT);
  assert.ok(FLASH_MS >= 400 && FLASH_MS <= 700, 'the flash is about half a second');
  assert.ok(CARD_AT - RUN_AT >= 2000 && CARD_AT - RUN_AT <= 3000, 'the card comes after about two seconds of running');
  assert.equal(ENDING_MS, CARD_AT + CARD_DROP_MS);
  assert.ok(ENDING_MS >= 7000 && ENDING_MS <= 10_000, `the whole sequence takes ${ENDING_MS} ms`);
  assert.ok(SKIP_AFTER_MS === 2000 && SKIP_AFTER_MS < CARD_AT);
});

test('the same time gives the same frame: nothing random, nothing read from a clock', () => {
  for (let t = 0; t <= ENDING_MS + 3000; t += 137) assert.deepEqual(endingFrame(t), endingFrame(t));
  assert.deepEqual(endingFrame(-50), endingFrame(0));
});

test('it starts as the closed cube: every hinge shut, the outside turtle on top, the camera turned', () => {
  const f = endingFrame(0);
  assert.equal(f.lid, 0);
  assert.deepEqual(f.walls, { 1: 0, 2: 0, 3: 0, 4: 0 });
  assert.equal(f.yaw, YAW);
  assert.equal(f.darkness, 1);
  assert.equal(f.card, false);
  assert.equal(f.turtles.out.at[1], 1, 'the outside turtle stands on the top face');
  assert.equal(f.turtles.in.at[1], -1, 'the inside turtle stands on the floor');
  for (const q of netQuads(f)) {
    assert.ok(nearV(q.c, NORMALS[q.face]) && nearV(q.n, NORMALS[q.face]), `face ${q.face} is where the cube has it`);
    assert.ok(nearV(q.r, canonRight(q.face)) && nearV(q.u, CANON_UP[q.face]), `face ${q.face} is the right way round`);
  }
});

test('the flash: every face lights up in the first beat and is back to itself before the lid moves', () => {
  assert.equal(endingFrame(0).flash, 0);
  assert.equal(endingFrame(200).flash, 1);
  assert.equal(endingFrame(FLASH_MS).flash, 0);
  assert.equal(endingFrame(LID_AT).flash, 0);
  for (let t = 0; t <= FLASH_MS; t += 10) assert.ok(endingFrame(t).flash >= 0 && endingFrame(t).flash <= 1);
  assert.ok(endingFrame(0).veil === 1 && endingFrame(FLASH_MS).veil === 0);
});

test('the unfolding: the lid first, then the front, the sides, the back; nothing passes through the grass', () => {
  assert.ok(endingFrame(LID_AT + LID_MS / 2).lid > 0 && endingFrame(LID_AT + LID_MS / 2).walls[1] === 0, 'the lid opens before any wall falls');
  assert.equal(endingFrame(LID_AT + LID_MS).lid, Q);
  assert.ok(WALL_AT[1] < WALL_AT[2] && WALL_AT[2] === WALL_AT[4] && WALL_AT[4] < WALL_AT[3]);
  let last = endingFrame(0);
  for (let t = 0; t <= FLAT_AT + 200; t += 10) {
    const f = endingFrame(t);
    assert.ok(f.lid >= last.lid - 1e-9 && f.lid <= Q, 'the lid only opens');
    for (const w of [1, 2, 3, 4] as const) {
      assert.ok(f.walls[w] >= 0 && f.walls[w] <= Q, `wall ${w} stays between standing and flat at ${t}`);
      assert.ok(Math.abs(f.walls[w] - last.walls[w]) < 0.12, `wall ${w} does not jump at ${t}`);
    }
    for (const q of netQuads(f)) for (const [p, s] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) assert.ok(q.c[1] + p * q.r[1] + s * q.u[1] >= -1 - 1e-6, `face ${q.face} is under the grass at ${t}`);
    last = f;
  }
  assert.ok(fall(0) === 0 && fall(1) === 1 && fall(0.9) < 1, 'a wall falls, hits the ground and bounces once');
});

test('flat, the cube is its cross-shaped net on the grass, the rooms face up', () => {
  for (const t of [FLAT_AT, RUN_AT, CARD_AT, ENDING_MS + 5000]) {
    const f = endingFrame(t);
    assert.equal(f.lid, Q);
    assert.deepEqual(f.walls, { 1: Q, 2: Q, 3: Q, 4: Q });
    assert.equal(f.yaw, 0);
    assert.equal(f.darkness, 0, 'the dark has lifted');
    const at: Record<FaceId, readonly number[]> = { 1: [0, -1, 2], 2: [2, -1, 0], 3: [0, -1, -2], 4: [-2, -1, 0], 5: [0, -1, -4], 6: [0, -1, 0] };
    for (const q of netQuads(f)) {
      assert.ok(nearV(q.c, at[q.face]), `face ${q.face} lies at ${at[q.face]}, not ${q.c}`);
      assert.ok(nearV(q.n, [0, -1, 0]), `face ${q.face} has its outside on the grass`);
      assert.ok(near(q.r[1], 0) && near(q.u[1], 0), `face ${q.face} is flat`);
    }
  }
});

test('the faces stay joined on their hinges all the way through', () => {
  for (let t = 0; t <= FLAT_AT; t += 50) {
    const quads = new Map(netQuads(endingFrame(t)).map((q) => [q.face, q]));
    const edge = (face: FaceId, towards: readonly number[]): V3 => {
      // the middle of the edge of `face` that was on the `towards` side of the closed cube
      const q = quads.get(face)!;
      const r = canonRight(face);
      const u = CANON_UP[face];
      const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      const [p, s] = [dot(towards, r), dot(towards, u)];
      return [q.c[0] + p * q.r[0] + s * q.u[0], q.c[1] + p * q.r[1] + s * q.u[1], q.c[2] + p * q.r[2] + s * q.u[2]];
    };
    for (const wall of [1, 2, 3, 4] as const) assert.ok(dist(edge(wall, NORMALS[6]), edge(6, NORMALS[wall])) < 1e-6, `wall ${wall} left the floor at ${t}`);
    assert.ok(dist(edge(5, NORMALS[3]), edge(3, NORMALS[5])) < 1e-6, `the lid left the back wall at ${t}`);
  }
});

test('the jump: off the lid, in an arc, onto the floor right next to the inside turtle', () => {
  const start = endingFrame(JUMP_AT).turtles.out;
  assert.ok(start.at[1] === 1 && start.lift === 0, 'it takes off from the top face');
  const landed = endingFrame(JUMP_AT + JUMP_MS).turtles;
  assert.ok(landed.out.at[1] === -1 && landed.out.lift === 0 && landed.out.grounded, 'it lands on the floor');
  assert.ok(dist(landed.out.at, landed.in.at) < 0.5, 'beside the inside turtle');
  assert.ok(landed.out.facing === 'left' && landed.in.facing === 'right', 'the two face each other');
  let top = -Infinity;
  for (let t = JUMP_AT; t <= JUMP_AT + JUMP_MS; t += 10) {
    const out = endingFrame(t).turtles.out;
    top = Math.max(top, spot(out)[1]);
    if (t > JUMP_AT && t < JUMP_AT + JUMP_MS) assert.ok(!out.grounded && out.lift > 0, `in the air at ${t}`);
  }
  assert.ok(top > 1.5 && top < 3, `the arc tops out at ${top}, above the cube`);
  assert.equal(endingFrame(JUMP_AT - 1).turtles.out.walking, false);
});

test('no turtle ever jumps from one place to another', () => {
  let last = endingFrame(0).turtles;
  for (let t = 10; t <= ENDING_MS + 2 * RUN_LAP_MS; t += 10) {
    const now = endingFrame(t).turtles;
    for (const side of SIDES) assert.ok(dist(spot(now[side]), spot(last[side])) < 0.08, `${side} moved ${dist(spot(now[side]), spot(last[side]))} in 10 ms at ${t}`);
    last = now;
  }
});

test('the circle: the two run opposite each other, spread out to the radius, lap after lap', () => {
  for (let t = RUN_AT; t <= RUN_AT + 3 * RUN_LAP_MS; t += 70) {
    const { out, in: inn } = endingFrame(t).turtles;
    assert.ok(out.walking && inn.walking && out.grounded && inn.grounded && out.lift === 0);
    assert.ok(near(out.at[0], -inn.at[0]) && near(out.at[2], -inn.at[2]) && out.at[1] === -1, 'opposite each other, on the floor');
    const r = Math.hypot(out.at[0], out.at[2]);
    assert.ok(r <= RUN_RADIUS + 1e-9 && r < 1, 'they stay on the floor of the cube');
    if (t >= RUN_AT + RUN_SPREAD_MS) assert.ok(near(r, RUN_RADIUS), `the radius is ${r} at ${t}`);
  }
  const a = endingFrame(RUN_AT + RUN_SPREAD_MS + 300).turtles.out;
  const b = endingFrame(RUN_AT + RUN_SPREAD_MS + 300 + RUN_LAP_MS).turtles.out;
  assert.ok(dist(a.at, b.at) < 1e-9 && a.facing === b.facing, 'one lap later it is in the same place');
  assert.ok(endingFrame(CARD_AT + 5000).turtles.out.walking, 'they keep running behind the card');
});

test('running, a turtle faces the way it goes, with the walk row for it (left = the right row mirrored)', () => {
  // (the circle is x, z in the model; z comes towards the camera, so +z is down the screen)
  assert.deepEqual([0, Q, 2 * Q, 3 * Q].map(runFacing), ['down', 'left', 'up', 'right']);
  const view = endingView(0);
  const layout = endingLayout(480, 270);
  for (let t = RUN_AT + RUN_SPREAD_MS; t < RUN_AT + RUN_SPREAD_MS + RUN_LAP_MS; t += 40) {
    const now = endingFrame(t).turtles.out;
    const next = endingFrame(t + 40).turtles.out;
    const [dx, dz] = [next.at[0] - now.at[0], next.at[2] - now.at[2]];
    // the facing is that of the larger part of the step, as it is seen on screen
    const want = Math.abs(dx) > Math.abs(dz) * 1.3 ? (dx > 0 ? 'right' : 'left') : Math.abs(dz) > Math.abs(dx) * 1.3 ? (dz > 0 ? 'down' : 'up') : null;
    if (want) assert.equal(now.facing, want, `at ${t}`);
    const [a, b] = [turtlePoint(view, layout, now), turtlePoint(view, layout, next)];
    if (want === 'right') assert.ok(b.x >= a.x);
    if (want === 'left') assert.ok(b.x <= a.x);
    if (want === 'down') assert.ok(b.y >= a.y);
    if (want === 'up') assert.ok(b.y <= a.y);
  }
  assert.deepEqual(turtleLook(SHEET, { facing: 'right', walking: true, tick: 1 }), { index: 43, flip: false });
  assert.deepEqual(turtleLook(SHEET, { facing: 'left', walking: true, tick: 1 }), { index: 43, flip: true });
  assert.deepEqual(turtleLook(SHEET, { facing: 'up', walking: true, tick: 6 }), { index: 38, flip: false });
  assert.deepEqual(turtleLook(SHEET, { facing: 'down', walking: true, tick: 3 }), { index: 33, flip: false });
  assert.deepEqual(turtleLook(SHEET, { facing: 'down', walking: false, tick: 3 }), { index: 1, flip: false });
  assert.deepEqual(turtleLook(SHEET, { facing: 'left', walking: false, tick: 5 }), { index: 42, flip: true });
});

test('skip: not in the first two seconds, then straight to the card, and the clock runs on from there', () => {
  assert.equal(canSkip(0), false);
  assert.equal(canSkip(SKIP_AFTER_MS - 1), false);
  assert.equal(canSkip(SKIP_AFTER_MS), true);
  assert.equal(canSkip(CARD_AT), false, 'nothing to skip once the card is up');
  assert.equal(endingClock(1234, null), 1234);
  assert.equal(endingClock(2500, 2500), CARD_AT);
  assert.equal(endingClock(3500, 2500), CARD_AT + 1000);
  const f = endingFrame(endingClock(2500, 2500));
  assert.ok(f.card && f.phase === 'card' && f.lid === Q && f.walls[3] === Q && f.turtles.out.walking, 'skipped: the flat cube, the turtles running, the card');
  assert.equal(cardDelay(0, null, false), CARD_AT);
  assert.equal(cardDelay(0, 0, false), 0, 'a game found already won shows the card at once');
  assert.equal(cardDelay(0, null, true), 0, 'reduce motion shows the card at once');
});

test('reduce motion: no unfold, no jump, no running: the flat cube, the turtles side by side, the card', () => {
  for (const t of [0, 300, 2000, CARD_AT, 60_000]) {
    const f = endingFrame(t, true);
    assert.ok(f.card && f.phase === 'card' && f.flash === 0 && f.veil === 0 && f.darkness === 0 && f.yaw === 0);
    assert.equal(f.lid, Q);
    assert.deepEqual(f.walls, { 1: Q, 2: Q, 3: Q, 4: Q });
    for (const side of SIDES) assert.ok(!f.turtles[side].walking && f.turtles[side].lift === 0 && f.turtles[side].grounded && f.turtles[side].at[1] === -1);
    assert.ok(f.turtles.out.at[2] === f.turtles.in.at[2] && Math.abs(f.turtles.out.at[0] - f.turtles.in.at[0]) < 0.5, 'side by side');
    assert.deepEqual(f, endingFrame(0, true), 'nothing moves');
  }
});

test('the layout: whole pixels, and the cube, the open lid and the flat net all fit, on any screen', () => {
  for (const [w, h] of [[480, 270], [640, 360], [422, 195], [844, 390], [960, 540], [480, 250], [568, 320], [1024, 768], [300, 200]] as const) {
    const L = endingLayout(w, h);
    for (const v of [L.half, L.cx, L.cy, L.horizon]) assert.ok(Number.isInteger(v), `${w}x${h}: ${JSON.stringify(L)}`);
    assert.ok(L.horizon > 0 && L.horizon < h / 2, 'the sky is the top of the screen');
    assert.ok(Number.isInteger(turtleScale(L)) && turtleScale(L) >= 1);
    for (let t = 0; t <= FLAT_AT; t += 100) {
      const f = endingFrame(t);
      const view = endingView(f.yaw);
      for (const q of netQuads(f)) {
        for (const [p, s] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          const at = projectPoint(view, L, [q.c[0] + p * q.r[0] + s * q.u[0], q.c[1] + p * q.r[1] + s * q.u[1], q.c[2] + p * q.r[2] + s * q.u[2]]);
          assert.ok(Number.isInteger(at.x) && Number.isInteger(at.y));
          assert.ok(at.x >= 0 && at.x <= w && at.y >= 0 && at.y <= h, `${w}x${h}: face ${q.face} leaves the screen at ${t} ms (${at.x}, ${at.y})`);
        }
      }
      for (const side of SIDES) {
        const at = turtlePoint(view, L, f.turtles[side]);
        assert.ok(at.x >= 8 && at.x <= w - 8 && at.y >= 16 && at.y <= h, `${w}x${h}: the ${side} turtle leaves the screen at ${t} ms`);
      }
    }
    // flat: the whole net lies on the grass, under the horizon
    const far = projectPoint(endingView(0), L, [0, -1, -5]);
    assert.ok(far.y > L.horizon, `${w}x${h}: the net reaches into the sky`);
  }
});

test('the camera looks down from the front: the flat net is a cross, nearer faces lower on the screen', () => {
  const L = endingLayout(480, 270);
  const view = endingView(0);
  const centre = (face: FaceId) => projectPoint(view, L, netQuads(endingFrame(FLAT_AT)).find((q) => q.face === face)!.c);
  assert.ok(centre(4).x < centre(6).x && centre(6).x < centre(2).x && centre(4).y === centre(6).y && centre(2).y === centre(6).y);
  assert.ok(centre(5).y < centre(3).y && centre(3).y < centre(6).y && centre(6).y < centre(1).y);
  assert.ok(centre(1).x === L.cx && centre(5).x === L.cx);
  assert.ok(centre(1).depth > centre(6).depth && centre(6).depth > centre(5).depth, 'nearer the camera = larger depth');
});

// ---------- the rasterizer's part (cube/raster.ts: drawQuad, drawSprite) ----------

const flatTex = (color: string): FaceTex => ({ size: 2, px: new Uint32Array(4).fill(pack(color)) });
const RED = '#ff0000';
const BLUE = '#0000ff';

test('drawQuad: either side of a face, the nearer one in front whatever the order drawn', () => {
  const o = { cx: 8, cy: 8, half: 4, ambient: 1 };
  const front = { id: 1, c: [0, 0, 1] as V3, r: [1, 0, 0] as V3, u: [0, 1, 0] as V3, n: [0, 0, 1] as V3, tex: flatTex(RED), back: flatTex(BLUE) };
  const behind = { ...front, id: 2, c: [0, 0, -1] as V3, tex: flatTex(BLUE), back: flatTex(RED) };
  for (const order of [[front, behind], [behind, front]]) {
    const t = createDepthTarget(16, 16);
    for (const q of order) drawQuad(t, q, o);
    assert.equal(t.px[8 * 16 + 8], pack(RED), 'the nearer quad shows');
    assert.equal(t.id[8 * 16 + 8], 1);
    assert.equal(t.px[0], 0, 'nothing outside the quad');
  }
  // seen from behind (its normal points away), a face shows its back texture
  const t = createDepthTarget(16, 16);
  drawQuad(t, { ...front, n: [0, 0, -1] }, o);
  assert.equal(t.px[8 * 16 + 8], pack(BLUE));
  // the flash: all of the tint at amount 1
  clearDepthTarget(t);
  drawQuad(t, { ...front, tint: pack('#00ff00'), amount: 1 }, o);
  assert.equal(t.px[8 * 16 + 8], pack('#00ff00'));
  assert.equal(t.depth[0], -Infinity);
});

test('drawSprite: behind a nearer wall it is hidden, in front of a farther one it shows; mirrored and scaled in whole pixels', () => {
  const o = { cx: 8, cy: 8, half: 8, ambient: 1 };
  const wall = { id: 1, c: [0, 0, 0] as V3, r: [1, 0, 0] as V3, u: [0, 1, 0] as V3, n: [0, 0, 1] as V3, tex: flatTex(RED) };
  const sprite = { width: 2, height: 1, px: new Uint32Array([pack('#00ff00'), 0]) };
  const t = createDepthTarget(16, 16);
  drawQuad(t, wall, o);
  drawSprite(t, sprite, 4, 4, -1);
  assert.equal(t.px[4 * 16 + 4], pack(RED), 'hidden behind the wall');
  drawSprite(t, sprite, 4, 4, 1);
  assert.equal(t.px[4 * 16 + 4], pack('#00ff00'));
  assert.equal(t.px[4 * 16 + 5], pack(RED), 'a see-through pixel draws nothing');
  drawSprite(t, sprite, 8, 8, 1, true, 2);
  assert.deepEqual([t.px[8 * 16 + 8], t.px[8 * 16 + 10], t.px[9 * 16 + 11]], [pack(RED), pack('#00ff00'), pack('#00ff00')], 'mirrored, two pixels per pixel');
  shadeBox(t, 0, 0, 2, 2, 5, 0.5);
  assert.equal(t.px[0]! & 0xff, 127, 'a shadow darkens what is drawn');
  assert.ok(apply(endingView(0), [0, 0, 1])[2] > 0);
});

// ---------- the run (scenes/ending/run.ts) ----------

test('the run starts on the win event, not on the predicted state, and both clients get the same clock', () => {
  let now = 1000;
  const e = new Ending(() => now);
  let told = 0;
  e.onChange(() => told++);
  /** (a call, so one assert does not narrow the type for the next) */
  const run = () => e.current;
  e.sync(false);
  assert.equal(run(), null);
  e.sync(true); // the mover's own prediction says "won": armed, not started
  assert.equal(run(), null);
  now = 1080;
  e.won(); // the server's event
  assert.ok(run()?.t0 === 1080 && run()?.skippedAt === null);
  assert.equal(e.card, false);
  e.won(); // a second one changes nothing
  e.sync(true);
  assert.equal(run()?.t0, 1080);
  assert.equal(run()?.id, 1);
  now = 1080 + 1500;
  assert.equal(e.time(), 1500);
  assert.equal(e.skip(), false, 'too early to skip');
  now = 1080 + 2600;
  assert.equal(e.skip(), true);
  assert.ok(e.card);
  assert.equal(e.time(), CARD_AT);
  assert.equal(e.skip(), false, 'only once');
  now += 400;
  assert.equal(e.time(), CARD_AT + 400);
  assert.ok(told >= 2);
  e.sync(false); // play again: a new game
  assert.ok(run() === null && !e.card && e.time() === null);
  e.won();
  assert.equal(run()?.id, 2, 'the next win is a new run');
  e.sync(null);
  assert.equal(run(), null);
});

test('a game found already won goes straight to the card; so does reduce motion', () => {
  let now = 0;
  const late = new Ending(() => now);
  late.sync(true); // the first thing we hear of this game is that it is won
  assert.ok(late.current && late.card);
  assert.equal(endingFrame(late.time()!).phase, 'card');
  now = 500;
  assert.equal(endingFrame(late.time()!).turtles.out.walking, true);
  late.sync(null);

  const calm = new Ending(() => now);
  calm.sync(false, true);
  calm.won(true);
  assert.ok(calm.current && calm.card, 'the card is there at once');
  calm.sync(null);

  // the setting is turned on while the sequence plays: the card shows
  const mid = new Ending(() => now);
  mid.sync(false);
  mid.won(false);
  assert.equal(mid.card, false);
  mid.sync(true, true);
  assert.ok(mid.card);
  mid.sync(null);
});

test('every face of the cube is in the net exactly once', () => {
  for (const t of [0, 1500, 2500, FLAT_AT]) assert.deepEqual(netQuads(endingFrame(t)).map((q) => q.face).sort(), [...FACES]);
});
