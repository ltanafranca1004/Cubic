import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { WAKE, attemptsWithin, retryDelay, socketOptions, wakeText, wakeView } from '../src/net/wake';

// Waiting for a sleeping server (net/wake.ts): the retry schedule the socket is given, the
// progress the menus show and when they stop. The scenes cannot be loaded here (Phaser
// needs a browser), so their wiring is read from the source, like solo.test.ts.

const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

/** A cold start on free hosting: about 50 s. A slow one: up to 100 s. */
const COLD_MS = 50_000;
const SLOW_COLD_MS = 100_000;

test('wake: the client waits through a whole cold start, and a slow one, before it gives up', () => {
  assert.equal(WAKE.giveUpMs, 120_000, 'about two minutes');
  assert.ok(WAKE.expectMs >= COLD_MS && WAKE.giveUpMs > SLOW_COLD_MS);
  assert.equal(wakeView(0, COLD_MS).phase, 'waking');
  assert.equal(wakeView(0, SLOW_COLD_MS).phase, 'waking');
  assert.equal(wakeView(0, WAKE.giveUpMs - 1).phase, 'waking');
  assert.equal(wakeView(0, WAKE.giveUpMs).phase, 'failed');
});

test('wake: the socket never stops by itself, and its pauses are short', () => {
  const o = socketOptions();
  assert.equal(o.reconnection, true);
  assert.equal(o.reconnectionAttempts, Infinity, 'the give-up is ours, not the library counting attempts');
  assert.deepEqual([o.timeout, o.reconnectionDelay, o.reconnectionDelayMax], [WAKE.attemptMs, WAKE.retryMinMs, WAKE.retryMaxMs]);
  assert.deepEqual(o.transports, ['websocket', 'polling']);
  assert.equal(o.tryAllTransports, true);
  assert.deepEqual([0, 1, 2, 3, 9].map(retryDelay), [1000, 2000, 4000, 5000, 5000]);
});

test('wake: an attempt is always in the air soon after the server comes up', () => {
  // every attempt hanging for its full time, every pause at its longest
  const longestPause = WAKE.retryMaxMs * (1 + WAKE.jitter);
  assert.ok(longestPause <= 7_500, 'a server that just woke waits at most 7.5 s for our next attempt');
  assert.ok(attemptsWithin(COLD_MS) >= 3, `${attemptsWithin(COLD_MS)} attempts within a cold start`);
  assert.ok(attemptsWithin(WAKE.giveUpMs) >= 5, `${attemptsWithin(WAKE.giveUpMs)} attempts before the give-up`);
  // the last attempt before the give-up still has time to connect to a server that is up
  assert.ok(WAKE.giveUpMs - SLOW_COLD_MS >= longestPause);
});

test('wake: the bar only goes forward, starts at 0 and is never full while we wait', () => {
  assert.equal(wakeView(1000, 1000).progress, 0);
  assert.equal(wakeView(5000, 1000).progress, 0, 'a clock that jumped back is not negative progress');
  let last = -1;
  for (let t = 0; t < WAKE.giveUpMs; t += 250) {
    const v = wakeView(0, t);
    assert.ok(v.progress >= last, `at ${t} ms`);
    assert.ok(v.progress < 1 && v.percent <= 99);
    last = v.progress;
  }
  assert.equal(wakeView(0, WAKE.expectMs).percent, 90, 'nearly full when a usual cold start is over');
  assert.equal(wakeView(0, WAKE.expectMs / 2).percent, 45);
  assert.ok(wakeView(0, SLOW_COLD_MS).percent > 90, 'a slow start keeps creeping: it does not look stuck');
});

test('wake: the words', () => {
  assert.equal(wakeText({ since: 0, failed: false }, 30_000), 'WAKING THE SERVER... 45%');
  assert.equal(wakeText({ since: 0, failed: false }, 30_000, true), 'WAKING THE SERVER... ABOUT A MINUTE. 45%');
  // the clock alone never says "cannot reach": only the socket having stopped does
  assert.equal(wakeText({ since: 0, failed: false }, WAKE.giveUpMs + 5000), 'WAKING THE SERVER... 99%');
  assert.equal(wakeText({ since: 0, failed: true }, 1000), 'CANNOT REACH THE SERVER.');
  for (const long of [false, true]) assert.ok(wakeText({ since: 0, failed: true }, 0, long).length <= 48 && wakeText({ since: 0, failed: false }, 0, long).length <= 48);
});

test('wake: wired into the socket, the state and the two menu screens', () => {
  const net = src('net/client.ts');
  assert.match(net, /const options = socketOptions\(\);/);
  assert.match(net, /setTimeout\(\(\) => this\.waited\(\), WAKE\.giveUpMs\)/);
  assert.match(net, /if \(this\.code \|\| this\.blocked\)/, 'no give-up in a room, nor while the server refuses this site');
  assert.match(net, /visibilitychange/);
  assert.match(src('app.ts'), /onRetryConnect: \(\) => net\.retry\(\)/);
  assert.match(src('app.ts'), /wake: net\.wake,/);
  const mode = src('scenes/ModeScene.ts');
  assert.match(mode, /label: 'RETRY'[^\n]*onRetryConnect\(\)/);
  assert.match(mode, /wakeText\(waking, Date\.now\(\), true\)/);
  assert.doesNotMatch(mode.slice(mode.indexOf('this.bar = ['), mode.indexOf('this.retry = new Button')), /tween/, 'the bar is not animated: reduce motion has nothing to switch off');
  assert.match(src('scenes/StartScene.ts'), /wakeText\(this\.ui\.wake, Date\.now\(\)\)/);
});
