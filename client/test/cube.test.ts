import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACES, FACE_SIZE, NORMALS, SIDES, compassDrift, neighbours, screenToCanon, stepPose, upsOn, type FaceId, type Pose } from '@cubic/shared';
import type { CubeMapDir } from '../src/cube/api';
import { faceOps, startObjects, texelFor, type CubeManifest } from '../src/cube/layout';
import { apply, det, mul, rotX, rotY, type Mat3 } from '../src/cube/mat';
import { HUD_TILT, QUARTER, facing, poseView, turnAt, turnBetween, upFromDrift } from '../src/cube/orient';
import { clearTarget, createTarget, drawCube, project, shadeOf, visibleFaces, type CubeFaces, type FaceTex } from '../src/cube/raster';
import { SPIN_FRAMES, bakeSpin, frameSize, spinView } from '../src/cube/spin';

// The cube renderer's rasterizer and orientation math run without Phaser or a DOM.

const INK = 0xff000001;
/** A texture whose every texel says which face and which texel it is: 0xff, face, v, u. */
const tex = (face: number, size: number): FaceTex => {
  const px = new Uint32Array(size * size);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) px[v * size + u] = (0xff000000 | (face << 16) | (v << 8) | u) >>> 0;
  return { size, px };
};
const faces = (size: number): CubeFaces => Object.fromEntries(FACES.map((f) => [f, tex(f, size)])) as CubeFaces;
const close = (a: Mat3, b: Mat3, msg: string) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-9, `${msg}: entry ${i} is ${v}, expected ${b[i]}`));

const DIRS: Record<CubeMapDir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/** A pose standing on the screen edge in a direction, so one step crosses it. */
function atEdge(side: Pose['side'], face: FaceId, up: Pose['up'], dir: CubeMapDir): Pose {
  const mid = Math.floor(FACE_SIZE / 2);
  const [sx, sy] = { left: [0, mid], right: [FACE_SIZE - 1, mid], up: [mid, 0], down: [mid, FACE_SIZE - 1] }[dir] as [number, number];
  const [x, y] = screenToCanon(side, face, up, sx, sy);
  return { side, face, up, x, y, dir: 1 };
}

test('raster: a face seen flat on is its texture, the right way up; the inside view is mirrored', () => {
  const t = createTarget(8, 8);
  const opts = { cx: 4, cy: 4, half: 4, ink: null, ambient: 1 };
  drawCube(t, faces(2), poseView('out', 1, [0, 1, 0]), opts);
  assert.ok(t.id.every((f) => f === 1), 'only face 1 is drawn');
  // texel (u, v): top-left, top-right, bottom-left
  assert.equal(t.px[0]! & 0xffff, 0x0000);
  assert.equal(t.px[7]! & 0xffff, 0x0001);
  assert.equal(t.px[7 * 8]! & 0xffff, 0x0100);

  clearTarget(t);
  drawCube(t, faces(2), poseView('in', 1, [0, 1, 0]), opts);
  assert.ok(t.id.every((f) => f === 1));
  assert.equal(t.px[0]! & 0xffff, 0x0001, 'the inside player sees the wall from behind: left and right swap');
  assert.equal(t.px[7]! & 0xffff, 0x0000);
  assert.equal(det(poseView('in', 1, [0, 1, 0])), -1);
});

test('raster: nearest-neighbour sampling, every texel the same whole number of pixels', () => {
  const t = createTarget(12, 12);
  drawCube(t, faces(4), poseView('out', 2, [0, 1, 0]), { cx: 6, cy: 6, half: 6, ink: null, ambient: 1 });
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) assert.equal(t.px[y * 12 + x]! & 0xffffff, (2 << 16) | (Math.floor(y / 3) << 8) | Math.floor(x / 3));
});

test('raster: back faces are culled and the rest is painted far to near', () => {
  for (let i = 0; i < 48; i++) {
    const view = spinView(i / 48);
    const seen = visibleFaces(view);
    assert.ok(seen.length >= 1 && seen.length <= 3, `${seen.length} faces at once`);
    const depth = seen.map((f) => apply(view, NORMALS[f])[2]);
    depth.forEach((z, n) => {
      assert.ok(z > 0);
      if (n) assert.ok(z >= depth[n - 1]!, 'nearer faces are drawn later');
    });
    const t = createTarget(40, 40);
    drawCube(t, faces(2), view, { cx: 20, cy: 20, half: 10, ink: null });
    const drawn = new Set([...t.id].filter(Boolean));
    for (const f of drawn) assert.ok(seen.includes(f as FaceId), `face ${f} is turned away but was drawn`);
    // (a face seen almost edge on can be thinner than a pixel)
    seen.forEach((f, n) => depth[n]! > 0.1 && assert.ok(drawn.has(f), `face ${f} is turned to the viewer but missing`));
  }
});

test('raster: the top is the brightest face, and shading is flat per face', () => {
  const view = mul(rotX(0.47), rotY(0.6));
  const top = shadeOf(apply(view, [0, 1, 0]));
  for (const f of visibleFaces(view)) if (f !== 5) assert.ok(shadeOf(apply(view, NORMALS[f])) < top, `face ${f} is darker than the top`);
  const t = createTarget(48, 48);
  const one: FaceTex = { size: 1, px: new Uint32Array([0xffc8c8c8]) };
  drawCube(t, Object.fromEntries(FACES.map((f) => [f, one])) as CubeFaces, view, { cx: 24, cy: 24, half: 12, ink: null });
  for (const f of visibleFaces(view)) {
    const shades = new Set([...t.px].filter((_, i) => t.id[i] === f));
    assert.equal(shades.size, 1, `face ${f} has one shade`);
  }
});

test('raster: one pixel of ink around the cube and along every inner edge', () => {
  const t = createTarget(48, 48);
  const view = mul(rotX(0.47), rotY(0.6));
  drawCube(t, faces(2), view, { cx: 24, cy: 24, half: 12, ink: INK });
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= 48 || y >= 48 ? 0 : t.id[y * 48 + x]!);
  let inked = 0;
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) {
      const f = at(x, y);
      if (!f) {
        assert.equal(t.px[y * 48 + x], 0, 'nothing is drawn outside the cube');
        continue;
      }
      const edge = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      const ink = t.px[y * 48 + x] === INK;
      if (edge.includes(0)) assert.ok(ink, `silhouette pixel ${x},${y} is ink`);
      if (edge.every((n) => n === f)) assert.ok(!ink, `pixel ${x},${y} inside a face is not ink`);
      if (ink) inked++;
    }
  assert.ok(inked > 60);
  // across an inner edge (walking down from the top face into a side) there is exactly one ink pixel
  const [ex] = project(view, { cx: 24, cy: 24, half: 12, ink: INK }, [0.4, 1, 1]);
  const column = Array.from({ length: 48 }, (_, y) => ({ f: at(Math.round(ex), y), ink: t.px[y * 48 + Math.round(ex)] === INK }));
  const cross = column.findIndex((p, y) => y > 0 && p.f !== 0 && column[y - 1]!.f !== 0 && column[y - 1]!.f !== p.f);
  assert.ok(cross > 0, 'the column crosses an inner edge');
  assert.ok(column[cross - 1]!.ink && !column[cross]!.ink && !column[cross - 2]!.ink, 'the inner edge is one pixel wide');
});

test('spin: all six faces come past in one turn, the strip loops, and it bakes fast', () => {
  const seen = new Set<FaceId>();
  for (let i = 0; i < SPIN_FRAMES; i++) for (const f of visibleFaces(spinView(i / SPIN_FRAMES))) seen.add(f);
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
  close(spinView(1), spinView(0), 'the last frame leads back into the first');

  const half = 54;
  const t0 = performance.now();
  const strip = bakeSpin(faces(FACE_SIZE * 8), half, INK);
  const ms = performance.now() - t0;
  console.log(`   spin strip: ${strip.count} frames of ${strip.size}px baked in ${ms.toFixed(0)} ms`);
  assert.equal(strip.size, frameSize(half));
  assert.equal(strip.px.length, SPIN_FRAMES * strip.size * strip.size);
  assert.ok(ms < 1500, `baking took ${ms} ms`);
  // the cube never touches the frame's border, so frames cannot bleed into each other
  const n = strip.size;
  for (let f = 0; f < strip.count; f += 7) {
    const frame = strip.px.subarray(f * n * n, (f + 1) * n * n);
    for (let i = 0; i < n; i++) assert.equal((frame[i]! | frame[(n - 1) * n + i]! | frame[i * n]! | frame[i * n + n - 1]!) >>> 0, 0);
  }
});

test('orientation: the pose view puts your face flat on with your up at the top', () => {
  for (const side of SIDES)
    for (const face of FACES)
      for (const up of upsOn(face)) {
        const view = poseView(side, face, up);
        assert.deepEqual(apply(view, NORMALS[face]), [0, 0, 1], 'your face is towards the viewer');
        assert.deepEqual(apply(view, up), [0, 1, 0], 'your up is screen up');
        assert.equal(det(view), side === 'out' ? 1 : -1);
        assert.equal(facing(view), face);
        // the faces around it are where the game says the neighbours are
        const n = neighbours({ side, face, up });
        assert.deepEqual(apply(view, NORMALS[n.right]), [1, 0, 0]);
        assert.deepEqual(apply(view, NORMALS[n.left]), [-1, 0, 0]);
        assert.deepEqual(apply(view, NORMALS[n.up]), [0, 1, 0]);
        assert.deepEqual(apply(view, NORMALS[n.down]), [0, -1, 0]);
        assert.deepEqual(upFromDrift(face, compassDrift({ face, up })), up, 'drift and up are two ways to say the same thing');
      }
});

test('orientation: crossing an edge turns the cube a quarter the way you walked, from every pose', () => {
  for (const side of SIDES)
    for (const face of FACES)
      for (const up of upsOn(face))
        for (const dir of ['left', 'right', 'up', 'down'] as CubeMapDir[]) {
          const from = atEdge(side, face, up, dir);
          const { pose: to, crossed } = stepPose(from, ...DIRS[dir]);
          assert.ok(crossed);
          const a = poseView(side, from.face, from.up);
          const b = poseView(side, to.face, to.up);
          const what = `${side} face ${face} up ${up.join(',')} walking ${dir}`;
          close(mul(QUARTER[dir], a), b, what);
          const turn = turnBetween(a, b);
          assert.ok(Math.abs(turn.angle - Math.PI / 2) < 1e-9, `${what}: a quarter turn`);
          // half way through, the face you left and the face you reach are both in view, the
          // new one on the side you walked to
          const mid = turnAt(a, b, 0.5);
          const seen = visibleFaces(mid);
          assert.deepEqual([...seen].sort(), [from.face, to.face].sort(), what);
          const [dx, dy] = DIRS[dir];
          const centre = apply(mid, NORMALS[to.face]);
          assert.ok(centre[0] * dx - centre[1] * dy > 0.5, `${what}: the new face comes in from the ${dir}`);
          close(turnAt(a, b, 1), b, what);
          close(turnAt(a, b, 0), a, what);
        }
});

test('orientation: three left turns round a corner bring you home, turned a quarter', () => {
  for (const side of SIDES) {
    const start: Pose = { side, face: 1, up: [0, 1, 0], x: 0, y: 0, dir: 1 };
    let pose = start;
    let view = poseView(side, pose.face, pose.up);
    // round the corner where faces 1, 5 and 4 meet: up, then left, then down. Each leg is a
    // walk off one edge, and the HUD applies one quarter turn per crossing.
    for (const dir of ['up', 'left', 'down'] as CubeMapDir[]) {
      pose = stepPose(atEdge(side, pose.face, pose.up, dir), ...DIRS[dir]).pose;
      view = mul(QUARTER[dir], view);
      close(view, poseView(side, pose.face, pose.up), `${side}: after walking ${dir}`);
    }
    assert.equal(pose.face, 1, 'three crossings round a corner: back on the first face');
    assert.notDeepEqual(pose.up, start.up, 'but no longer the same way up');
    assert.ok([90, 270].includes(compassDrift(pose)), 'turned a quarter: the 270 degree corner');
    // the HUD cube shows that twist: same face in front, turned a quarter in the screen plane
    const twist = turnBetween(poseView(side, 1, start.up), view);
    assert.ok(Math.abs(twist.angle - Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(Math.abs(twist.axis[2]) - 1) < 1e-9, 'about the axis that points at the viewer');
  }
});

test('orientation: the HUD tilt shows the face in front, the one above and the one to the right', () => {
  for (const side of SIDES)
    for (const face of FACES)
      for (const up of upsOn(face)) {
        const n = neighbours({ side, face, up });
        const seen = visibleFaces(mul(HUD_TILT, poseView(side, face, up)));
        assert.deepEqual([...seen].sort(), [face, n.up, n.right].sort());
        assert.equal(seen[seen.length - 1], face, 'your own face is the nearest');
      }
});

test('faces: every tile of the real map is drawn, then its objects, then the turtle at the start', () => {
  const sheet = (name: string) => ({ image: name, tiles: { floor: [0, 1], wall: [5], tree: [8], water: [11, 12] } });
  const manifest: CubeManifest = {
    tilesets: Object.fromEntries(SIDES.flatMap((s) => FACES.map((f) => [`${s}-${f}`, sheet(`tiles/${s}-${f}.png`)]))),
    objects: { door: { image: 'objects.png', frames: { default: 0 } }, plate: { image: 'objects.png', frames: { default: 2 }, sides: { in: { default: 4 } } }, unknown: { image: 'objects.png', frames: { default: 15 } } },
    items: { default: { image: 'items.png', frame: 2 } },
    players: { out: { image: 'player-out.png', idle: [0, 1], walk: [30] }, in: { image: 'player-in.png', walk: [30] } },
  };
  for (const side of SIDES)
    for (const face of FACES) {
      const ops = faceOps(manifest, side, face, true);
      const tiles = ops.filter((o) => o.image === `tiles/${side}-${face}.png`);
      assert.equal(tiles.length, FACE_SIZE * FACE_SIZE, `${side} ${face}: one tile per map tile`);
      assert.ok(ops.every((o) => o.x >= 0 && o.y >= 0 && o.x < FACE_SIZE && o.y < FACE_SIZE));
      assert.equal(ops.filter((o) => o.image === `player-${side}.png`).length, face === 1 ? 1 : 0, 'the turtle stands on face 1');
      assert.equal(faceOps(manifest, side, face, false).filter((o) => o.image.startsWith('player')).length, 0);
    }
  assert.deepEqual([4, 8, 16].map((t) => texelFor(FACE_SIZE * t)), [4, 8, 16]);
});

test('faces: the cube shows what the puzzles show, in its state, and the HUD only what every game has', () => {
  // none of these is a map object: they exist only through the puzzle's visible()
  const has = (side: 'out' | 'in', face: FaceId, type: string, fixed = false) => startObjects(side, face, fixed).some((o) => o.type === type);
  assert.ok(has('out', 1, 'code-mark') && has('in', 1, 'key') && has('in', 2, 'f2-safe'));
  assert.ok(has('out', 3, 'f3-glyph') && has('in', 3, 'f3-tile') && has('out', 4, 'f4-pot'));
  assert.ok(has('out', 5, 'f5-symbol') && has('out', 6, 'f6-mirror') && has('in', 6, 'f6-lava'));
  // the number, the counts and the flowers differ per game: the HUD cube must not show another game's
  assert.ok(!has('out', 1, 'code-mark', true) && !has('in', 4, 'f4-flowerpot', true));
  assert.ok(has('out', 3, 'f3-glyph', true) && has('in', 1, 'key', true) && has('in', 6, 'f6-lava', true));
  // the frame is the one of the object's state, not the type's default
  const manifest: CubeManifest = { objects: { 'f6-lava': { image: 'objects.png', frames: { default: 1, hot: 1, cold: 2 } }, unknown: { image: 'objects.png', frames: { default: 9 } } } };
  const lava = startObjects('in', 6).find((o) => o.type === 'f6-lava')!;
  assert.equal(faceOps(manifest, 'in', 6, false).find((o) => o.x === lava.x && o.y === lava.y)!.frame, 2);
});
