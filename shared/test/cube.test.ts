import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, GRID, SIDES, canonToScreen, compassDrift, neighbours, screenToCanon, stepPose, upsOn, type FaceId, type Pose, type Side } from '../src/index';

const start = (side: Side, x = 4, y = 4): Pose => ({ side, face: 1, up: CANON_UP[1], x, y, dir: 1 });

function walk(pose: Pose, dx: number, dy: number, steps: number): { pose: Pose; faces: FaceId[] } {
  const faces: FaceId[] = [pose.face];
  for (let i = 0; i < steps; i++) {
    pose = stepPose(pose, dx, dy).pose;
    if (faces[faces.length - 1] !== pose.face) faces.push(pose.face);
  }
  return { pose, faces };
}

const DIRS: [string, number, number][] = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];

for (const side of SIDES) {
  for (const [name, dx, dy] of DIRS) {
    test(`${side}: walking straight ${name} visits 4 faces and returns to face 1 unchanged`, () => {
      const from = start(side);
      const { pose, faces } = walk(from, dx, dy, GRID * 4);
      assert.equal(faces.length, 5);
      assert.equal(new Set(faces).size, 4);
      assert.equal(faces[0], 1);
      assert.equal(faces[4], 1);
      assert.deepEqual({ ...pose, dir: 1 }, from);
    });
  }
}

test('outside and inside walk the horizontal ring in opposite orders (mirrored)', () => {
  assert.deepEqual(walk(start('out'), 1, 0, GRID * 4).faces, [1, 2, 3, 4, 1]);
  assert.deepEqual(walk(start('in'), 1, 0, GRID * 4).faces, [1, 4, 3, 2, 1]);
});

test('screen <-> canonical round-trips for every face, up vector and side', () => {
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const up of upsOn(face)) {
        const seen = new Set<string>();
        for (let sy = 0; sy < GRID; sy++) {
          for (let sx = 0; sx < GRID; sx++) {
            const [x, y] = screenToCanon(side, face, up, sx, sy);
            assert.ok(x >= 0 && x < GRID && y >= 0 && y < GRID);
            assert.deepEqual(canonToScreen(side, face, up, x, y), [sx, sy]);
            seen.add(`${x},${y}`);
          }
        }
        assert.equal(seen.size, GRID * GRID);
      }
    }
  }
});

test('with canonical up, outside sees the map as drawn and inside sees it mirrored', () => {
  for (const face of FACES) {
    assert.deepEqual(screenToCanon('out', face, CANON_UP[face], 2, 7), [2, 7]);
    assert.deepEqual(screenToCanon('in', face, CANON_UP[face], 2, 7), [GRID - 1 - 2, 7]);
  }
});

for (const side of SIDES) {
  test(`${side}: a loop around one cube corner returns the player rotated 90 degrees`, () => {
    // Near the top-right screen corner of face 1: up over the edge, right over the next
    // edge, down over the third. Three edges around a corner (270 degrees) and we are home.
    let pose = start(side, side === 'out' ? 8 : 1, 1);
    const origin = canonToScreen(side, 1, pose.up, pose.x, pose.y);
    assert.deepEqual(origin, [8, 1]);
    const faces = new Set<FaceId>([1]);
    for (const [dx, dy, n] of [
      [0, -1, 3],
      [1, 0, 3],
      [0, 1, 3],
    ] as const) {
      for (let i = 0; i < n; i++) {
        pose = stepPose(pose, dx, dy).pose;
        faces.add(pose.face);
      }
    }
    assert.equal(pose.face, 1);
    assert.equal(faces.size, 3);
    const drift = compassDrift(pose);
    assert.ok(drift === 90 || drift === 270, `drift ${drift}`);
    // Seen with the original up, we are back at the same corner of face 1.
    const [sx, sy] = canonToScreen(side, 1, CANON_UP[1], pose.x, pose.y);
    assert.ok(sx >= 7 && sy <= 2, `ended at screen ${sx},${sy}`);
  });
}

test('compass drift is 0 on spawn and covers all four values', () => {
  assert.equal(compassDrift(start('out')), 0);
  for (const face of FACES) {
    const drifts = upsOn(face).map((up) => compassDrift({ face, up }));
    assert.deepEqual([...drifts].sort((a, b) => a - b), [0, 90, 180, 270]);
  }
});

test('neighbours match where a step actually goes', () => {
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const up of upsOn(face)) {
        const pose: Pose = { side, face, up, x: 0, y: 0, dir: 1 };
        const n = neighbours(pose);
        for (const [name, dx, dy] of DIRS) {
          const edge = walk(pose, dx, dy, GRID).pose;
          assert.equal(edge.face, n[name as keyof typeof n]);
        }
      }
    }
  }
});
