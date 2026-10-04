import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACES, FACE_NAMES, FACE_SIZE, NORMALS, compassDrift, faceDistance, neighbours, screenToCanon, stepPose, upsOn, viewRight, type FaceId, type Pose, type Side } from '@cubic/shared';
import type { CubeMapDir } from '../src/cube/api';
import { apply, det, mul, rotZ, type Mat3 } from '../src/cube/mat';
import { QUARTER, ROOM_CAM, ROOM_QUARTER, floorOf, hudQuarter, hudView, poseView, risingWall, roomView, turnAt, turnBetween, upFromDrift } from '../src/cube/orient';
import { clearTarget, createTarget, drawRoom, projectRoom, roomFaces, type CubeFaces, type FaceTex } from '../src/cube/raster';

// The inside player's HUD cube: the room, its camera and its turn, against the shared cube
// math. No Phaser, no DOM.

const DIR_NAMES: readonly CubeMapDir[] = ['left', 'right', 'up', 'down'];
const DIRS: Record<CubeMapDir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const OPPOSITE: Record<CubeMapDir, CubeMapDir> = { left: 'right', right: 'left', up: 'down', down: 'up' };
const close = (a: Mat3, b: Mat3, msg: string) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-9, `${msg}: entry ${i} is ${v}, expected ${b[i]}`));
/** A texture whose every texel says which face and which texel it is: 0xff, face, v, u. */
const tex = (face: number, size: number): FaceTex => {
  const px = new Uint32Array(size * size);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) px[v * size + u] = (0xff000000 | (face << 16) | (v << 8) | u) >>> 0;
  return { size, px };
};
const faces = (size: number): CubeFaces => Object.fromEntries(FACES.map((f) => [f, tex(f, size)])) as CubeFaces;
/** A pose standing on the screen edge in a direction, so one step crosses it. */
function atEdge(side: Side, face: FaceId, up: Pose['up'], dir: CubeMapDir): Pose {
  const mid = Math.floor(FACE_SIZE / 2);
  const [sx, sy] = { left: [0, mid], right: [FACE_SIZE - 1, mid], up: [mid, 0], down: [mid, FACE_SIZE - 1] }[dir] as [number, number];
  const [x, y] = screenToCanon(side, face, up, sx, sy);
  return { side, face, up, x, y, dir: 1 };
}
/** The HUD's canvas and where the room is drawn on it (cube/hud.ts). */
const HUD = { cx: 28, cy: 28, half: 22, ink: null, ambient: 1, cam: ROOM_CAM };

test('room: the camera is in the cube: the floor is the face you are on, the walls are where the game says', () => {
  for (const face of FACES)
    for (const up of upsOn(face)) {
      const view = roomView(face, up);
      assert.equal(det(view), 1, 'a real camera, not a mirrored cube');
      assert.deepEqual(apply(view, NORMALS[face]), [0, 0, -1], 'the floor is the far face');
      assert.deepEqual(apply(view, up), [0, 1, 0], 'your up is screen up');
      assert.deepEqual(apply(view, viewRight('in', face, up)), [1, 0, 0], 'screen right is the mirrored right of the shared cube math');
      assert.equal(floorOf(view), face);
      assert.deepEqual(hudView('in', face, up), view);
      close(hudView('out', face, up), poseView('out', face, up), 'the outside cube is as it was');
      // the five faces of the room are drawn, the one behind the camera is not
      const seen = roomFaces(view, ROOM_CAM);
      assert.equal(seen.length, 5);
      assert.ok(!seen.some((f) => faceDistance(f, face) === 2), 'the face behind the camera is open');
      const n = neighbours({ side: 'in', face, up });
      const o = { ...HUD, cx: 0, cy: 0 };
      for (const dir of DIR_NAMES) {
        const [dx, dy] = DIRS[dir];
        assert.deepEqual(apply(view, NORMALS[n[dir]]), [dx, -dy + 0, 0], `the wall on the ${dir}`);
        assert.equal(risingWall(face, up, dir), n[dir]);
        const [x, y] = projectRoom(view, o, NORMALS[n[dir]]);
        assert.ok(x * dx + y * dy > 10, `the ${dir} wall is drawn on the ${dir}`);
      }
      // the floor is smaller than the open side: it is further away
      const [fx] = projectRoom(view, o, [0, 0, 0].map((_, i) => NORMALS[face][i]! + viewRight('in', face, up)[i]!) as [number, number, number]);
      assert.ok(Math.abs(fx - (22 * (ROOM_CAM - 1)) / (ROOM_CAM + 1)) < 1e-9);
    }
});

test('room: compass drift turns the room in the screen plane, as it turns the cube', () => {
  for (const face of FACES)
    for (const drift of [0, 90, 180, 270]) {
      const up = upFromDrift(face, drift);
      assert.equal(compassDrift({ face, up }), drift);
      const base = roomView(face, upFromDrift(face, 0));
      const turn = turnBetween(base, roomView(face, up));
      assert.ok(Math.abs(turn.angle - (drift === 270 ? 90 : drift) * (Math.PI / 180)) < 1e-9);
      if (drift) assert.ok(Math.abs(Math.abs(turn.axis[2]) - 1) < 1e-9, 'about the axis that points at the viewer');
      // the same screen turn as the outside player's cube makes for that drift, mirrored
      const out = turnBetween(poseView('out', face, upFromDrift(face, 0)), poseView('out', face, up));
      assert.ok(Math.abs(out.angle - turn.angle) < 1e-9);
      if (drift === 90 || drift === 270) assert.ok(Math.abs(out.axis[2] + turn.axis[2]) < 1e-9, 'the inside is mirrored');
      close(mul(rotZ(turn.axis[2] * turn.angle), base), roomView(face, up), `face ${face} drift ${drift}`);
    }
});

test('room: walking over an edge tips the wall ahead into the floor, the opposite turn to the outside cube, from every pose', () => {
  let checked = 0;
  for (const face of FACES)
    for (const up of upsOn(face))
      for (const dir of DIR_NAMES) {
        const [dx, dy] = DIRS[dir];
        const what = `inside face ${face} (${FACE_NAMES.in[face]}) up ${up.join(',')} walking ${dir}`;
        const from = atEdge('in', face, up, dir);
        const { pose: to, crossed } = stepPose(from, dx, dy);
        assert.ok(crossed, what);
        const a = roomView(from.face, from.up);
        const b = roomView(to.face, to.up);
        // the wall that rises is the one the shared cube math walks onto
        assert.equal(risingWall(face, up, dir), to.face, what);
        assert.deepEqual(apply(a, NORMALS[to.face]), [dx, -dy + 0, 0], `${what}: it starts as the wall on that side`);
        assert.deepEqual(apply(b, NORMALS[to.face]), [0, 0, -1], `${what}: it ends as the floor`);
        // and the floor that was left is the wall behind you
        assert.deepEqual(apply(b, NORMALS[from.face]), [-dx + 0, dy + 0, 0], `${what}: the old floor is the wall on the other side`);
        assert.equal(neighbours(to)[OPPOSITE[dir]], from.face, what);

        // one quarter turn about a screen axis
        close(mul(ROOM_QUARTER[dir], a), b, what);
        close(mul(hudQuarter('in', dir), a), b, what);
        const turn = turnBetween(a, b);
        assert.ok(Math.abs(turn.angle - Math.PI / 2) < 1e-9, `${what}: a quarter turn`);

        // the outside player walking the same screen direction: same axis, the other way round
        const oFrom = atEdge('out', face, up, dir);
        const oTo = stepPose(oFrom, dx, dy).pose;
        const oa = poseView('out', oFrom.face, oFrom.up);
        const ob = poseView('out', oTo.face, oTo.up);
        close(mul(hudQuarter('out', dir), oa), ob, `${what}: outside`);
        const outTurn = turnBetween(oa, ob);
        assert.ok(Math.abs(outTurn.angle - turn.angle) < 1e-9);
        turn.axis.forEach((v, i) => assert.ok(Math.abs(v + outTurn.axis[i]!) < 1e-9, `${what}: the axis is the outside one, reversed`));
        // the axis lies along the edge crossed: screen y for a sideways walk, screen x for up and down
        assert.ok(Math.abs(Math.abs(turn.axis[dx ? 1 : 0]) - 1) < 1e-9, what);
        close(mul(ROOM_QUARTER[dir], QUARTER[dir]), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'the two quarters undo each other');

        // all the way through: the wall you enter stays on the side you walked to and comes
        // down flat, the floor you leave swings up on the other side and stays in view
        const o = { ...HUD, cx: 0, cy: 0 };
        let last = -Infinity;
        for (let i = 1; i < 10; i++) {
          const mid = turnAt(a, b, i / 10);
          const seen = roomFaces(mid, ROOM_CAM);
          assert.ok(seen.includes(to.face) && seen.includes(from.face), `${what}: both faces in view at ${i}/10`);
          const [nx, ny] = projectRoom(mid, o, NORMALS[to.face]);
          const [ox, oy] = projectRoom(mid, o, NORMALS[from.face]);
          assert.ok(nx * dx + ny * dy > 0, `${what}: the new floor comes from the ${dir}`);
          assert.ok(ox * dx + oy * dy < 0, `${what}: the old floor leaves to the other side`);
          // the wall's inner side turns steadily to face the viewer (the outside face would turn away)
          const facingUs = -apply(mid, NORMALS[to.face])[2];
          assert.ok(facingUs > last, what);
          last = facingUs;
          // outside, the face walked onto comes to the FRONT instead
          assert.ok(apply(turnAt(oa, ob, i / 10), NORMALS[oTo.face])[2] > 0, what);
        }
        close(turnAt(a, b, 0), a, what);
        close(turnAt(a, b, 1), b, what);
        checked++;
      }
  assert.equal(checked, 6 * 4 * 4);
});

test('room: three left turns round a corner bring you home, turned a quarter', () => {
  let pose: Pose = { side: 'in', face: 1, up: [0, 1, 0], x: 0, y: 0, dir: 1 };
  const start = roomView(pose.face, pose.up);
  let view = start;
  for (const dir of ['up', 'left', 'down'] as CubeMapDir[]) {
    pose = stepPose(atEdge('in', pose.face, pose.up, dir), ...DIRS[dir]).pose;
    view = mul(ROOM_QUARTER[dir], view);
    close(view, roomView(pose.face, pose.up), `after walking ${dir}`);
  }
  assert.equal(pose.face, 1);
  const twist = turnBetween(start, view);
  assert.ok(Math.abs(twist.angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(twist.axis[2]) - 1) < 1e-9, 'the room is turned a quarter in the screen plane');
});

test('room raster: the floor in the middle, mirrored like the game, a wall on each side, nothing beyond', () => {
  const t = createTarget(56, 56);
  const at = (x: number, y: number) => t.id[y * 56 + x]!;
  for (const face of FACES)
    for (const up of upsOn(face)) {
      const n = neighbours({ side: 'in', face, up });
      clearTarget(t);
      drawRoom(t, faces(2), roomView(face, up), HUD);
      assert.equal(at(28, 28), face, 'the floor is in the middle');
      assert.equal(at(8, 28), n.left);
      assert.equal(at(48, 28), n.right);
      assert.equal(at(28, 8), n.up);
      assert.equal(at(28, 48), n.down);
      const drawn = new Set([...t.id].filter(Boolean));
      assert.equal(drawn.size, 5);
      // straight on, the room is exactly the open side: 44 pixels square
      for (let i = 0; i < 56; i++) assert.equal(at(i, 5) | at(i, 50) | at(5, i) | at(50, i), 0, 'nothing is drawn beyond the walls');
      assert.ok(at(6, 6) && at(49, 49));
    }
  // the floor of face 1, the right way up: texel u runs right to left, as the inside player sees that wall
  clearTarget(t);
  drawRoom(t, faces(2), roomView(1, [0, 1, 0]), HUD);
  assert.equal(t.px[22 * 56 + 22]! & 0xffffff, (1 << 16) | 0x0001, 'top left of the floor is the texture`s top right');
  assert.equal(t.px[22 * 56 + 33]! & 0xffffff, (1 << 16) | 0x0000);
  assert.equal(t.px[33 * 56 + 22]! & 0xffffff, (1 << 16) | 0x0101);
});

test('room raster: the turning room stays on the HUD canvas, with the two faces of the corner side by side', () => {
  const t = createTarget(56, 56);
  for (const face of FACES)
    for (const up of upsOn(face))
      for (const dir of DIR_NAMES) {
        const to = stepPose(atEdge('in', face, up, dir), ...DIRS[dir]).pose;
        const a = roomView(face, up);
        const b = roomView(to.face, to.up);
        for (let i = 0; i <= 8; i++) {
          clearTarget(t);
          drawRoom(t, faces(2), turnAt(a, b, i / 8), HUD);
          for (let k = 0; k < 56; k++) assert.equal(t.id[k]! | t.id[55 * 56 + k]! | t.id[k * 56]! | t.id[k * 56 + 55]!, 0, 'the room touches the edge of the canvas');
        }
        // half way: the concave corner runs through the middle, the wall you enter on the side you walk to
        clearTarget(t);
        drawRoom(t, faces(2), turnAt(a, b, 0.5), HUD);
        const [dx, dy] = DIRS[dir];
        assert.equal(t.id[(28 + dy * 6) * 56 + 28 + dx * 6], to.face);
        assert.equal(t.id[(28 - dy * 6) * 56 + 28 - dx * 6], face);
      }
});
