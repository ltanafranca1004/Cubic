import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AI_STEP_MS, STEP_MS, WALK_HOLD_MS, WALK_PACE, paced } from '@cubic/shared';
import { LIMITS, Rooms } from '../src/rooms';

// The walking pace (shared/src/pace.ts) against the server's move budget (LIMITS in
// src/rooms.ts): a direction held down, by a human or by the AI, must never be dropped,
// because a dropped move is a step the client predicted and then has to take back.

let clock = 0;
const rooms = new Rooms(() => clock);
after(() => rooms.closeAll());

/** A real room with a player on the outside and a counter of the moves the server dropped. */
function seated() {
  const room = rooms.create('ai');
  room.sit('out');
  let dropped = 0;
  room.listen({ onAck: () => dropped++ });
  return { room, dropped: () => dropped };
}

test('the pace: one knob, 25% slower than the original 130 ms step', () => {
  assert.equal(WALK_PACE, 0.75);
  assert.equal(STEP_MS, Math.round(130 / WALK_PACE));
  assert.equal(STEP_MS, 173, '130 ms / 0.75');
  assert.equal(WALK_HOLD_MS, 2 * STEP_MS, 'the walk frame is held for two steps: a held walk never drops to idle');
  assert.equal(AI_STEP_MS, 267, '200 ms / 0.75');
  assert.equal(paced(200), AI_STEP_MS);
  // speed is 1 / interval: 130 / 173 = 0.751
  assert.ok(Math.abs(130 / STEP_MS - 0.75) < 0.01);
  assert.ok(Math.abs(200 / AI_STEP_MS - 0.75) < 0.01);
});

test('the budget arithmetic: a held direction earns more than it spends', () => {
  // the numbers the client mirrors in its own tests (client/test/pace.test.ts, transition.test.ts)
  assert.equal(LIMITS.moveBurst, 5);
  assert.equal(LIMITS.moveRefillMs, 90);
  // One step costs 1. Between two steps the budget earns STEP_MS / moveRefillMs = 173 / 90 = 1.92.
  const earned = STEP_MS / LIMITS.moveRefillMs;
  assert.ok(earned >= 1, `a step earns ${earned.toFixed(2)} and costs 1`);
  assert.ok(AI_STEP_MS / LIMITS.moveRefillMs >= 1);
  // Per second: 1000 / 173 = 5.78 steps asked, 1000 / 90 = 11.1 allowed.
  assert.ok(1000 / STEP_MS < 1000 / LIMITS.moveRefillMs);
  // The slowest refill that would still keep up is one per STEP_MS: there is 83 ms of slack per step.
  assert.equal(STEP_MS - LIMITS.moveRefillMs, 83);
});

test('the real room: a direction held for a minute at the new pace is never dropped', () => {
  for (const stepMs of [STEP_MS, AI_STEP_MS]) {
    const { room, dropped } = seated();
    let seq = 0;
    // back and forth, so every move is a real one whatever the map
    for (let i = 0; i < Math.floor(60_000 / stepMs); i++) {
      room.move('out', i % 2 ? 1 : -1, 0, ++seq);
      clock += stepMs;
    }
    assert.equal(dropped(), 0, `every ${stepMs} ms`);
    room.close();
  }
});

test('the real room: a tap burst on top of a held direction still fits', () => {
  // The worst a player does: hold a direction and hammer a second key. The burst is what
  // absorbs it: moveBurst taps at once, then the held pace alone keeps the budget rising.
  const { room, dropped } = seated();
  let seq = 0;
  clock += 10_000; // a full budget
  for (let i = 0; i < LIMITS.moveBurst; i++) room.move('out', i % 2 ? 1 : -1, 0, ++seq);
  assert.equal(dropped(), 0, 'the burst itself');
  for (let i = 0; i < 100; i++) {
    clock += STEP_MS;
    room.move('out', i % 2 ? 1 : -1, 0, ++seq);
  }
  assert.equal(dropped(), 0, 'the held key after the burst');
  // and the check is not vacuous: faster than the refill, the room does drop
  for (let i = 0; i < 40; i++) {
    clock += LIMITS.moveRefillMs / 2;
    room.move('out', i % 2 ? 1 : -1, 0, ++seq);
  }
  assert.ok(dropped() > 0, 'twice the refill rate is over the budget');
  room.close();
});
