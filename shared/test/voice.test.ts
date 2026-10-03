import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CANON_UP,
  FACES,
  GRID,
  VOICE_ADJACENT_GAIN,
  createGame,
  facePresence,
  faceDistance,
  signalBars,
  stepPose,
  voiceMix,
  type FaceId,
  type GameState,
  type Pose,
} from '../src/index';

const at = (side: 'out' | 'in', face: FaceId, x: number, y: number): Pose => ({ side, face, up: CANON_UP[face], x, y, dir: 1 });
function game(out: Pose, inn: Pose): GameState {
  const s = createGame(0);
  s.players.out.pose = out;
  s.players.in.pose = inn;
  return s;
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('same face (outside N and inside N are one wall): full volume', () => {
  for (const f of FACES) close(voiceMix(game(at('out', f, 4, 4), at('in', f, 5, 5))).gain, 1);
});

test('side by side is clear anywhere on the face, even right next to an edge', () => {
  for (const [x, y] of [[4, 8], [0, 0], [9, 5], [2, 9]] as const) close(voiceMix(game(at('out', 1, x, y), at('in', 1, x, y))).gain, 1);
  assert.ok(voiceMix(game(at('out', 1, 4, 8), at('in', 1, 2, 8))).gain > 0.85); // the spawn tiles
});

test('walking to an edge away from the partner fades towards the next face', () => {
  const partner = at('in', 1, 4, 4);
  const gains = [5, 6, 7, 8, 9].map((x) => voiceMix(game(at('out', 1, x, 4), partner)).gain);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i]! <= gains[i - 1]!);
  close(gains[0]!, 1);
  close(gains[4]!, (1 + VOICE_ADJACENT_GAIN) / 2);
});

test('adjacent faces are quieter, opposite faces are silent', () => {
  for (const a of FACES) {
    for (const b of FACES) {
      const gain = voiceMix(game(at('out', a, 4, 4), at('in', b, 5, 5))).gain;
      close(gain, [1, VOICE_ADJACENT_GAIN, 0][faceDistance(a, b)]!);
    }
  }
});

test('gain is symmetric and stays within 0..1 everywhere', () => {
  for (const a of FACES) {
    for (const b of FACES) {
      for (const [x, y] of [[0, 0], [9, 0], [4, 9], [0, 5], [9, 9]] as const) {
        const g1 = voiceMix(game(at('out', a, x, y), at('in', b, 3, 6))).gain;
        const g2 = voiceMix(game(at('out', b, 3, 6), at('in', a, x, y))).gain;
        close(g1, g2);
        assert.ok(g1 >= 0 && g1 <= 1);
      }
    }
  }
});

test('presence always sums to 1 and is shared half and half on an edge tile', () => {
  for (const f of FACES) {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const p = facePresence({ face: f, x, y });
        close(Object.values(p).reduce((a, b) => a + b, 0), 1);
      }
    }
  }
  const edge = facePresence({ face: 1, x: 9, y: 4 }); // right edge of face 1 leads to face 2
  close(edge[1]!, 0.5);
  close(edge[2]!, 0.5);
});

test('volume never jumps: a full lap away from the partner changes smoothly', () => {
  const partner = at('in', 1, 4, 4);
  for (const [dx, dy] of [[1, 0], [0, -1]] as const) {
    let pose = at('out', 1, 4, 4);
    let prev = voiceMix(game(pose, partner)).gain;
    let min = prev;
    for (let i = 0; i < GRID * 4; i++) {
      const before = pose.face;
      pose = stepPose(pose, dx, dy).pose;
      const gain = voiceMix(game(pose, partner)).gain;
      // Crossing the edge itself changes nothing; no single step is a big jump.
      if (pose.face !== before) close(gain, prev);
      assert.ok(Math.abs(gain - prev) <= 0.15, `step ${i}: ${prev} -> ${gain}`);
      min = Math.min(min, gain);
      prev = gain;
    }
    close(min, 0); // the far side of the cube is silent
    close(prev, 1); // and back home it is clear again
  }
});

test('signal bars', () => {
  assert.equal(signalBars(1), 3);
  assert.equal(signalBars(VOICE_ADJACENT_GAIN), 2);
  assert.equal(signalBars(0.1), 1);
  assert.equal(signalBars(0), 0);
});
