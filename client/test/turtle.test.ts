import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, FACE_SIZE, SIDES, canonToScreen, screenToCanon, stepPose, upsOn, type Pose } from '@cubic/shared';
import { CARRY_PX, ITEM_HOP_PX, carryBob, facingFromStep, facingOf, hasFacing, itemHop, playerFlip, playerFrames, type Facing, type PlayerFrames } from '../src/game/turtle';

const DIRS: [number, number, Facing][] = [
  [1, 0, 'right'],
  [-1, 0, 'left'],
  [0, 1, 'down'],
  [0, -1, 'up'],
];

test('facing of a screen step: y is down, and only a step along one axis has one', () => {
  for (const [dx, dy, facing] of DIRS) assert.equal(facingOf(dx, dy), facing);
  assert.equal(facingOf(0, 0), null);
  assert.equal(facingOf(1, 1), null);
});

test('facing: a step the player sees as screen-left faces left, on both sides, every face and every up', () => {
  let checked = 0;
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const up of upsOn(face)) {
        for (const [dx, dy, facing] of DIRS) {
          // a step in the middle of the face, taken in SCREEN space by the real game code
          const [x, y] = screenToCanon(side, face, up, 5, 5);
          const from: Pose = { side, face, up, x, y, dir: 1 };
          const { pose: to, crossed } = stepPose(from, dx, dy);
          assert.equal(crossed, false);
          assert.equal(facingFromStep(side, face, up, from, to), facing, `${side} face ${face} up ${up.join(',')} step ${dx},${dy}`);
          checked++;
        }
      }
    }
  }
  assert.equal(checked, 2 * 6 * 4 * 4);
});

test('facing: the inside view is mirrored, so the same canonical step faces the other way sideways', () => {
  for (const face of FACES) {
    for (const up of upsOn(face)) {
      const [x, y] = screenToCanon('out', face, up, 5, 5);
      for (const [dx, dy, facing] of DIRS) {
        const to = stepPose({ side: 'out', face, up, x, y, dir: 1 }, dx, dy).pose;
        const inside = facingFromStep('in', face, up, { x, y }, to);
        const mirrored: Facing = facing === 'left' ? 'right' : facing === 'right' ? 'left' : facing;
        assert.equal(inside, mirrored);
      }
    }
  }
});

test('facing: no step, a jump of two tiles and a diagonal have no facing', () => {
  const up = upsOn(1)[0]!;
  assert.equal(facingFromStep('out', 1, up, { x: 4, y: 4 }, { x: 4, y: 4 }), null);
  assert.equal(facingFromStep('out', 1, up, { x: 4, y: 4 }, { x: 6, y: 4 }), null);
  assert.equal(facingFromStep('out', 1, up, { x: 4, y: 4 }, { x: 5, y: 5 }), null);
  assert.deepEqual(canonToScreen('out', 1, up, 4, 4).length, 2);
});

const ROWS: PlayerFrames = { image: 'p.png', idle: [0, 1], walk: [30, 31], walkDown: [30, 31, 32, 33], walkUp: [36, 37, 38, 39], walkRight: [42, 43, 44, 45] };
const PLAIN: PlayerFrames = { image: 'p.png', idle: [0, 1], walk: [2, 3] };

test('frames: the walk row matches the facing, left plays the right row mirrored', () => {
  assert.equal(hasFacing(ROWS), true);
  assert.deepEqual(playerFrames(ROWS, 'down', true), ROWS.walkDown);
  assert.deepEqual(playerFrames(ROWS, 'up', true), ROWS.walkUp);
  assert.deepEqual(playerFrames(ROWS, 'right', true), ROWS.walkRight);
  assert.deepEqual(playerFrames(ROWS, 'left', true), ROWS.walkRight);
  assert.equal(playerFlip(true, 'left', 1), true);
  for (const facing of ['right', 'up', 'down'] as const) assert.equal(playerFlip(true, facing, -1), false);
});

test('frames: standing uses the idle for the facing when the sheet has one, else the one idle', () => {
  assert.deepEqual(playerFrames(ROWS, 'down', false), ROWS.idle);
  // No idle for the facing: it holds the first frame of that walk row (left = right, mirrored).
  assert.deepEqual(playerFrames(ROWS, 'up', false), [36]);
  assert.deepEqual(playerFrames(ROWS, 'left', false), [42]);
  assert.deepEqual(playerFrames(ROWS, 'right', false), [42]);
  for (const facing of ['down', 'up', 'left', 'right'] as const) assert.deepEqual(playerFrames(PLAIN, facing, false), PLAIN.idle);
  const more = { ...ROWS, idleUp: [36], idleRight: [42] };
  assert.deepEqual(playerFrames(more, 'up', false), [36]);
  assert.deepEqual(playerFrames(more, 'left', false), [42]);
  assert.deepEqual(playerFrames(more, 'right', false), [42]);
  assert.deepEqual(playerFrames(more, 'down', false), ROWS.idle);
});

test('frames: an old manifest (walk and idle only) still works, mirrored by the pose', () => {
  assert.equal(hasFacing(PLAIN), false);
  for (const facing of ['down', 'up', 'left', 'right'] as const) {
    assert.deepEqual(playerFrames(PLAIN, facing, true), PLAIN.walk);
    assert.deepEqual(playerFrames(PLAIN, facing, false), PLAIN.idle);
    assert.equal(playerFlip(false, facing, -1), true);
    assert.equal(playerFlip(false, facing, 1), false);
  }
  // no idle at all: stand on the walk frames; an empty row falls back to `walk`
  assert.deepEqual(playerFrames({ image: 'p.png', walk: [2, 3] }, 'up', false), [2, 3]);
  assert.deepEqual(playerFrames({ ...PLAIN, walkUp: [] }, 'up', true), PLAIN.walk);
});

test('manifest: both turtles list a walk per direction, inside the 6 x 9 sheet', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')) as { players: Record<string, PlayerFrames> };
  for (const side of SIDES) {
    const entry = manifest.players[side]!;
    assert.equal(hasFacing(entry), true);
    assert.deepEqual(entry.walkDown, [30, 31, 32, 33]); // row 5
    assert.deepEqual(entry.walkUp, [36, 37, 38, 39]); // row 6
    assert.deepEqual(entry.walkRight, [42, 43, 44, 45]); // row 7
    assert.deepEqual(entry.walk, entry.walkDown);
    for (const list of [entry.idle ?? [], entry.walk, entry.walkDown!, entry.walkUp!, entry.walkRight!]) for (const i of list) assert.ok(i >= 0 && i < 6 * 9);
  }
});

test('carry bob: one pixel on every other step, none standing still', () => {
  assert.equal(carryBob(false, 0), 0);
  assert.equal(carryBob(false, 1), 0);
  assert.equal(carryBob(true, 0), 0);
  assert.equal(carryBob(true, 1), 1);
  assert.equal(carryBob(true, 2), 0);
  assert.equal(carryBob(true, 7), 1);
});

test('item hop: starts on one end, lands on the other, arcs above both, whole pixels all the way', () => {
  const tile = { x: 5 * 16, y: 7 * 16 };
  const head = { x: tile.x, y: tile.y - CARRY_PX };
  for (const [from, to] of [
    [tile, head],
    [head, tile],
  ] as const) {
    assert.deepEqual(itemHop(0, from, to), from);
    assert.deepEqual(itemHop(1, from, to), to);
    assert.deepEqual(itemHop(-1, from, to), from);
    assert.deepEqual(itemHop(2, from, to), to);
    let top = Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = itemHop(i / 20, from, to);
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
      assert.equal(p.x, tile.x);
      top = Math.min(top, p.y);
    }
    // the arc goes over the head, not straight to it
    assert.ok(top < head.y);
    assert.ok(top >= head.y - ITEM_HOP_PX);
  }
  // a hop with a sideways part moves evenly, and the lift is the height in the middle
  assert.deepEqual(itemHop(0.5, { x: 0, y: 0 }, { x: 16, y: 0 }, 6), { x: 8, y: -6 });
  // on a face of FACE_SIZE tiles the hop from the top row leaves the view by a few pixels only
  assert.ok(itemHop(0.5, { x: 0, y: 0 }, { x: 0, y: -CARRY_PX }).y > -FACE_SIZE * 16);
});
