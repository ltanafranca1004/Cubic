import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, GRID, VOICE_ADJ, VOICE_OPP, VOICE_RAMP_MS, VOICE_SAME, createGame, signalBars, stepPose, upsOn, voiceGain, voiceMix, type FaceId, type Pose, type Side } from '../src/index';

const at = (side: Side, face: FaceId, x = 4, y = 4): Pose => ({ side, face, up: CANON_UP[face], x, y, dir: 1 });

// The cube: 1/3, 2/4 and 5/6 are opposite pairs. Everything else shares an edge.
const OPPOSITE: Record<FaceId, FaceId> = { 1: 3, 3: 1, 2: 4, 4: 2, 5: 6, 6: 5 };
const expected = (a: FaceId, b: FaceId) => (a === b ? 1.0 : OPPOSITE[a] === b ? 0 : 0.35);

/** Corners, edge midpoints and the middle. */
const SPOTS: [number, number][] = [
  [0, 0],
  [9, 0],
  [0, 9],
  [9, 9],
  [4, 0],
  [4, 9],
  [0, 4],
  [9, 4],
  [4, 4],
];

test('the constants are exactly 1.0, 0.35 and 0', () => {
  assert.equal(VOICE_SAME, 1.0);
  assert.equal(VOICE_ADJ, 0.35);
  assert.equal(VOICE_OPP, 0);
  assert.equal(VOICE_RAMP_MS, 150);
});

for (const [sa, sb] of [
  ['out', 'out'],
  ['in', 'in'],
  ['out', 'in'],
] as [Side, Side][]) {
  test(`all 6x6 face pairs, ${sa}/${sb}: exact gain`, () => {
    for (const a of FACES) {
      for (const b of FACES) {
        assert.equal(voiceGain(at(sa, a), at(sb, b)), expected(a, b), `${sa} ${a} vs ${sb} ${b}`);
        assert.equal(voiceGain(at(sb, b), at(sa, a)), expected(a, b)); // symmetric
      }
    }
  });
}

test('outside face N and inside face N are the same face', () => {
  for (const f of FACES) assert.equal(voiceGain(at('out', f), at('in', f)), 1.0);
});

test('position on the face never matters: every edge, corner and orientation gives the flat value', () => {
  for (const a of FACES) {
    for (const b of FACES) {
      for (const [ax, ay] of SPOTS) {
        for (const [bx, by] of SPOTS) {
          for (const up of upsOn(a)) {
            const turned: Pose = { ...at('out', a, ax, ay), up };
            assert.equal(voiceGain(turned, at('in', b, bx, by)), expected(a, b));
          }
        }
      }
    }
  }
});

test('opposite faces are silent even standing right next to an edge', () => {
  for (const f of FACES) {
    for (const [x, y] of SPOTS) for (const [px, py] of SPOTS) assert.equal(voiceGain(at('out', f, x, y), at('in', OPPOSITE[f], px, py)), 0);
  }
});

test('voiceMix reads the two players from the game state', () => {
  const s = createGame(0);
  assert.deepEqual(voiceMix(s), { gain: 1.0 }); // both spawn on face 1
  s.players.in.pose = at('in', 2);
  assert.deepEqual(voiceMix(s), { gain: 0.35 });
  s.players.in.pose = at('in', 3);
  assert.deepEqual(voiceMix(s), { gain: 0 });
});

test('a lap around the cube away from the partner reads 1, 0.35, 0, 0.35, 1 and only changes at edges', () => {
  const partner = at('in', 1);
  for (const [dx, dy] of [
    [1, 0],
    [0, -1],
  ] as const) {
    let pose = at('out', 1);
    const seen: number[] = [voiceGain(pose, partner)];
    for (let i = 0; i < GRID * 4; i++) {
      const next = stepPose(pose, dx, dy).pose;
      const gain = voiceGain(next, partner);
      if (next.face === pose.face) assert.equal(gain, seen[seen.length - 1]); // flat inside a face
      else seen.push(gain);
      pose = next;
    }
    assert.deepEqual(seen, [1.0, 0.35, 0, 0.35, 1.0]);
  }
});

test('signal bars come from the constants', () => {
  assert.equal(signalBars(VOICE_SAME), 3);
  assert.equal(signalBars(VOICE_ADJ), 1);
  assert.equal(signalBars(VOICE_OPP), 0);
});
