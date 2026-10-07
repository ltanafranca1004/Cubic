import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP, DEFAULT_HOST, MAX_WAITING, createAnalytics, initAnalytics, setAnalyticsEnabled, track, type AnalyticsClient } from '../src/analytics/analytics';

// The analytics wrapper with posthog-js replaced by a fake that records every call. The
// real exports are used once too: this process has no VITE_POSTHOG_KEY, like dev and CI.

type Call = [method: string, ...args: unknown[]];

/** A posthog that records its calls, keeps the opt-out like the real one, and can be made to throw. */
function fake(broken: Partial<Record<keyof AnalyticsClient, boolean>> = {}) {
  const calls: Call[] = [];
  let out = false;
  let loads = 0;
  const call = (method: keyof AnalyticsClient, ...args: unknown[]) => {
    calls.push([method, ...args]);
    if (broken[method]) throw new Error(`posthog.${method} failed`);
  };
  const client: AnalyticsClient = {
    init: (key, options) => {
      call('init', key, options);
      out = options.opt_out_capturing_by_default === true;
    },
    register: (props) => call('register', props),
    capture: (event, props, options) => call('capture', event, props, options),
    opt_in_capturing: (options) => {
      call('opt_in_capturing', options);
      out = false;
    },
    opt_out_capturing: () => {
      call('opt_out_capturing');
      out = true;
    },
    has_opted_out_capturing: () => out,
  };
  return {
    client,
    calls,
    /** What the wrapper is given instead of `import('posthog-js')`. */
    load: async () => {
      loads++;
      return client;
    },
    loads: () => loads,
    names: () => calls.map((c) => c[0]),
    captured: () => calls.filter((c) => c[0] === 'capture').map((c) => c[1]),
  };
}

const KEY = 'phc_test_key';
/** posthog-js is its own chunk: it is there a moment after `init`. */
const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

test('with no key, every export does nothing and never throws', async () => {
  // the real module: no key in this process, so posthog-js is never even imported
  assert.doesNotThrow(() => {
    initAnalytics();
    track('game_started', { room: 'ABCD' });
    track('game_left', { room: 'ABCD' }, { beacon: true });
    setAnalyticsEnabled(false);
    setAnalyticsEnabled(true);
  });
  for (const env of [{}, { VITE_POSTHOG_KEY: '' }, { VITE_POSTHOG_KEY: '  ' }, { VITE_POSTHOG_HOST: 'https://eu.i.posthog.com' }]) {
    const ph = fake();
    const a = createAnalytics(ph.load, env);
    a.init();
    a.track('mode_selected', { mode: 'coop' });
    a.setEnabled(false);
    a.setEnabled(true);
    a.track('mode_selected', { mode: 'solo' });
    await loaded();
    assert.equal(ph.loads(), 0, 'posthog-js is not loaded');
    assert.deepEqual(ph.calls, [], JSON.stringify(env));
  }
});

test("with a key, init registers app = 'cubic' right after posthog.init", async () => {
  const ph = fake();
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init();
  await loaded();
  assert.deepEqual(ph.names(), ['init', 'register']);
  const [, key, options] = ph.calls[0]!;
  assert.equal(key, KEY);
  assert.deepEqual(
    Object.fromEntries(['api_host', 'capture_pageview', 'capture_pageleave', 'autocapture', 'disable_session_recording', 'persistence', 'respect_dnt', 'person_profiles', 'opt_out_capturing_by_default'].map((k) => [k, (options as Record<string, unknown>)[k]])),
    {
      api_host: DEFAULT_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
      persistence: 'localStorage',
      respect_dnt: true,
      person_profiles: 'identified_only',
      opt_out_capturing_by_default: false,
    },
  );
  assert.equal(APP, 'cubic');
  assert.deepEqual(ph.calls[1], ['register', { app: 'cubic' }]);
  // and every event of our own says so too
  a.track('lobby_created', { room: 'ABCD' });
  assert.deepEqual(ph.calls[2], ['capture', 'lobby_created', { room: 'ABCD', app: 'cubic' }, undefined]);
  a.track('game_left', { room: 'ABCD' }, { beacon: true });
  assert.deepEqual(ph.calls[3], ['capture', 'game_left', { room: 'ABCD', app: 'cubic' }, { transport: 'sendBeacon' }]);
  // a second init is not a second posthog.init
  a.init();
  await loaded();
  assert.equal(ph.loads(), 1);
  assert.equal(ph.names().filter((n) => n === 'init').length, 1);
});

test('the host comes from VITE_POSTHOG_HOST when it is set', async () => {
  const ph = fake();
  createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY, VITE_POSTHOG_HOST: 'https://eu.i.posthog.com' }).init();
  await loaded();
  assert.equal((ph.calls[0]![2] as { api_host: string }).api_host, 'https://eu.i.posthog.com');
});

test('what is tracked while posthog-js loads is sent once it is there, after the register', async () => {
  const ph = fake();
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init();
  const before = Date.now();
  a.track('mode_selected', { mode: 'coop' });
  for (let i = 0; i < MAX_WAITING + 10; i++) a.track('strike', { room: 'ABCD', side: 'in', face: 6 });
  assert.equal(ph.calls.length, 0, 'nothing yet');
  await loaded();
  assert.deepEqual(ph.names().slice(0, 3), ['init', 'register', 'capture']);
  assert.equal(ph.captured().length, MAX_WAITING, 'the wait is bounded');
  const [, event, props, options] = ph.calls[2]!;
  assert.equal(event, 'mode_selected');
  assert.deepEqual(props, { mode: 'coop', app: 'cubic' });
  // stamped with when it happened, not when the chunk arrived
  const at = (options as { timestamp: Date }).timestamp.getTime();
  assert.ok(at >= before && at <= Date.now());
});

test('track() swallows whatever posthog throws', async () => {
  const ph = fake({ capture: true });
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init();
  a.track('mode_selected', { mode: 'coop' }); // also the ones that waited for the load
  await loaded();
  assert.doesNotThrow(() => a.track('strike', { room: 'ABCD', side: 'in', face: 6 }));
  assert.deepEqual(ph.captured(), ['mode_selected', 'strike'], 'both did reach posthog');
});

test('nothing else throws either: a posthog that fails to load or start leaves every call a no-op', async () => {
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => void rejections.push(e);
  process.on('unhandledRejection', onRejection);
  const use = async (a: ReturnType<typeof createAnalytics>) => {
    a.init();
    a.track('game_won', { room: 'ABCD' });
    await loaded();
    a.setEnabled(false);
    a.setEnabled(true);
    a.track('game_won', { room: 'ABCD' });
    await loaded();
  };
  // the chunk never arrives (offline, blocked), or importing it throws
  await use(createAnalytics(() => Promise.reject(new Error('no chunk')), { VITE_POSTHOG_KEY: KEY }));
  await use(
    createAnalytics(
      () => {
        throw new Error('no import');
      },
      { VITE_POSTHOG_KEY: KEY },
    ),
  );
  const dead = fake({ init: true });
  await use(createAnalytics(dead.load, { VITE_POSTHOG_KEY: KEY }));
  assert.deepEqual(dead.names(), ['init'], 'posthog did not start: it is never called again');
  for (const method of ['register', 'opt_out_capturing', 'opt_in_capturing', 'has_opted_out_capturing'] as const) {
    await use(createAnalytics(fake({ [method]: true }).load, { VITE_POSTHOG_KEY: KEY }));
  }
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections, []);
});

test('setAnalyticsEnabled(false) stops capture and setAnalyticsEnabled(true) resumes it', async () => {
  const ph = fake();
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init();
  await loaded();
  a.track('mode_selected', { mode: 'coop' });
  a.setEnabled(false);
  a.track('lobby_created', { room: 'ABCD' });
  a.track('game_left', { room: 'ABCD' }, { beacon: true });
  assert.deepEqual(ph.captured(), ['mode_selected'], 'nothing is captured while it is off');
  assert.deepEqual(ph.names().slice(-1), ['opt_out_capturing'], 'and posthog itself is opted out (pageleave too)');
  a.setEnabled(false);
  assert.equal(ph.names().filter((n) => n === 'opt_out_capturing').length, 1, 'off twice is one opt-out');
  a.setEnabled(true);
  // no "$opt_in" event of posthog's own
  assert.deepEqual(ph.calls.at(-1), ['opt_in_capturing', { captureEventName: false }]);
  a.track('lobby_joined', { room: 'ABCD' });
  assert.deepEqual(ph.captured(), ['mode_selected', 'lobby_joined']);
});

test('a player who had the stats switched off loads nothing, and can switch them on', async () => {
  const ph = fake();
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init(false);
  a.track('mode_selected', { mode: 'solo' });
  await loaded();
  assert.equal(ph.loads(), 0, 'posthog-js is not even fetched');
  assert.deepEqual(ph.calls, []);
  a.setEnabled(true);
  a.track('mode_selected', { mode: 'coop' });
  await loaded();
  assert.equal(ph.loads(), 1);
  assert.deepEqual(ph.captured(), ['mode_selected'], 'only what happened after the switch');
  assert.deepEqual((ph.calls.find((c) => c[0] === 'capture')![2] as { mode: string }).mode, 'coop');
});

test('switched off while posthog-js is still loading: it starts opted out and what waited is dropped', async () => {
  const ph = fake();
  const a = createAnalytics(ph.load, { VITE_POSTHOG_KEY: KEY });
  a.init();
  a.track('mode_selected', { mode: 'coop' });
  a.setEnabled(false);
  await loaded();
  assert.equal((ph.calls[0]![2] as { opt_out_capturing_by_default: boolean }).opt_out_capturing_by_default, true, 'not even the first pageview');
  assert.deepEqual(ph.captured(), []);
});
