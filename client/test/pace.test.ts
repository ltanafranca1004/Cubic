import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_MS, WALK_HOLD_MS } from '@cubic/shared';
import { GameKeys, HoldRepeat } from '../src/game/keys';
import { FLUSH_BURST, FLUSH_GAP_MS, InputBuffer, ROLL_MS, type Buffered } from '../src/game/transition';
import { WALK_HOLD_MS as TURTLE_HOLD } from '../src/game/turtle';

// The walking pace on the client: the held-key repeat (keyboard, gamepad and touch d-pad are
// all a held key: input/gamepad.ts, input/touch.ts) against the server's move budget.

/** The server's move budget (server/src/rooms.ts LIMITS, pinned in server/test/pace.test.ts): a burst of 5, one more every 90 ms. */
class ServerBudget {
  private tokens = 5;
  private last = 0;
  dropped = 0;
  low = 5;
  take(now: number): void {
    this.tokens = Math.min(5, this.tokens + (now - this.last) / 90);
    this.last = now;
    if (this.tokens >= 1) this.tokens--;
    else this.dropped++;
    this.low = Math.min(this.low, this.tokens);
  }
}

/** Hold a direction from t = 0 for `ms`, with a frame every `frame()` ms. Returns when each step went out. */
function hold(ms: number, frame: () => number): number[] {
  const repeat = new HoldRepeat();
  const steps = [0]; // the press itself: at once
  repeat.restart(0);
  for (let now = frame(); now <= ms; now += frame()) if (repeat.take(now)) steps.push(now);
  return steps;
}

test('a tap steps at once; a held key repeats every STEP_MS', () => {
  const sent: Buffered[] = [];
  const keys = new GameKeys({ act: (input) => sent.push(input), talk: () => {} });
  assert.equal(keys.down({ key: 'ArrowRight' }), 'move');
  assert.deepEqual(sent, [{ kind: 'move', dx: 1, dy: 0 }], 'the first step goes out on the key press, with no delay');
  const repeat = new HoldRepeat();
  repeat.restart(1000);
  assert.equal(repeat.take(1000 + STEP_MS - 1), false);
  assert.equal(repeat.take(1000 + STEP_MS), true);
  assert.equal(repeat.take(1000 + STEP_MS + 1), false);
  assert.equal(repeat.take(1000 + 2 * STEP_MS), true);
});

test('held for 3 s: 1 + floor(3000 / STEP_MS) = 18 tiles, at any frame rate', () => {
  const expected = 1 + Math.floor(3000 / STEP_MS);
  assert.equal(expected, 18);
  for (const fps of [30, 60, 120, 144]) {
    const steps = hold(3000, () => 1000 / fps);
    assert.ok(Math.abs(steps.length - expected) <= 1, `${fps} fps: ${steps.length} steps`);
  }
  // the old pace, for the record: 1 + floor(3000 / 130) = 24 tiles
  assert.equal(1 + Math.floor(3000 / 130), 24);
});

test('a late frame does not slow the walk down, and never bunches steps into a flood', () => {
  let seed = 7;
  const jitter = () => 8 + ((seed = (seed * 1103515245 + 12345) >>> 0) % 40); // frames of 8 to 47 ms
  const steps = hold(60_000, jitter);
  const mean = (steps.at(-1)! - steps[0]!) / (steps.length - 1);
  assert.ok(Math.abs(mean - STEP_MS) < 2, `one step per ${mean.toFixed(1)} ms on average`);
  const server = new ServerBudget();
  for (const at of steps) server.take(at);
  assert.equal(server.dropped, 0);
  assert.ok(server.low >= 3, `the budget never went under ${server.low.toFixed(2)} of 5`);
  // after a long pause (a transition, a menu) the repeat starts again from now: no catching up
  const repeat = new HoldRepeat();
  repeat.restart(0);
  assert.equal(repeat.take(5000), true);
  assert.equal(repeat.take(5001), false);
  assert.equal(repeat.take(5000 + STEP_MS), true);
});

test('crossing an edge with the key held and presses buffered: nothing dropped', () => {
  const server = new ServerBudget();
  const buffer = new InputBuffer();
  const repeat = new HoldRepeat();
  let sent = 0;
  let now = 0;
  const send = () => {
    server.take(now);
    sent++;
  };
  // walk for 2 s, then cross an edge (a roll), mashing 10 more presses during it, six times over
  send();
  repeat.restart(now);
  for (let lap = 0; lap < 6; lap++) {
    for (const end = now + 2000; now < end; now += 16) {
      for (let input = buffer.next(now); input; input = buffer.next(now)) send();
      if (!buffer.length && repeat.take(now)) send();
    }
    for (let i = 0; i < 10; i++) buffer.push({ kind: 'move', dx: 1, dy: 0 });
    now += ROLL_MS;
    buffer.release(now);
  }
  assert.ok(sent > 6 * 10);
  assert.equal(server.dropped, 0, 'the server dropped a move');
  assert.ok(FLUSH_BURST + 1 <= 5 && FLUSH_GAP_MS >= 90 && STEP_MS >= FLUSH_GAP_MS);
});

test('the walk animation follows the pace', () => {
  assert.equal(TURTLE_HOLD, WALK_HOLD_MS);
  assert.ok(WALK_HOLD_MS > STEP_MS, 'the walk frame outlasts the gap between two held steps');
});

test('after a frame hitch: one catch-up step, never a burst', () => {
  // What HoldRepeat does today, written down. A frame that comes late takes ONE step, however
  // late it is. If it was late by less than a step, the next one keeps its old slot (so the
  // gap after a hitch is shorter than STEP_MS, down to almost nothing); if it was late by a
  // step or more, the clock restarts from now. Lost steps are never made up.
  const steps = (frames: number[]): number[] => {
    const repeat = new HoldRepeat();
    repeat.restart(0);
    return frames.filter((now) => repeat.take(now));
  };
  // a hitch of half a step: the late step, then the next on its old slot
  const half = Math.round(STEP_MS / 2);
  assert.deepEqual(steps([STEP_MS + half, 2 * STEP_MS - 1, 2 * STEP_MS, 3 * STEP_MS]), [STEP_MS + half, 2 * STEP_MS, 3 * STEP_MS]);
  // the worst case: late by one millisecond less than a whole step. The next step is 1 ms later, and that is all.
  const late = 2 * STEP_MS - 1;
  const worst = steps([late, late + 1, late + 2, late + 3, late + 1 + STEP_MS - 1, late + 1 + STEP_MS]);
  assert.deepEqual(worst, [late, late + 1, late + 1 + STEP_MS], 'two steps 1 ms apart (the minimum gap), then the normal pace: no third');
  // a hitch of ten steps: one step, not ten, and the next a whole step later
  const long = 10 * STEP_MS + 5;
  assert.deepEqual(steps([long, long + 1, long + 16, long + STEP_MS - 1, long + STEP_MS]), [long, long + STEP_MS]);

  // Against the budget: hitches as bad as they get, back to back, for a minute. Each pair
  // costs 2 and the two steps of slack before it earned 2 x 173 / 90 = 3.8.
  const server = new ServerBudget();
  const repeat = new HoldRepeat();
  repeat.restart(0);
  server.take(0);
  let sent = 1;
  let pairs = 0;
  let last = 0;
  let minGap = Infinity;
  const frame = (now: number) => {
    if (!repeat.take(now)) return;
    server.take(now);
    sent++;
    minGap = Math.min(minGap, now - last);
    if (now - last <= 1) pairs++;
    last = now;
  };
  for (let now = 0; now < 60_000; ) {
    now += 2 * STEP_MS - 1; // a frame that hung until 1 ms before the step after the one that was due
    frame(now);
    frame(++now);
  }
  assert.ok(pairs > 100 && minGap === 1, `${pairs} catch-up pairs, minimum gap ${minGap} ms`);
  assert.ok(sent <= 1 + Math.ceil(last / STEP_MS), `${sent} steps in ${last} ms: never more than the pace allows over the whole run`);
  assert.equal(server.dropped, 0);
  assert.ok(server.low >= 3, `the budget never went under ${server.low.toFixed(2)} of 5`);
});
