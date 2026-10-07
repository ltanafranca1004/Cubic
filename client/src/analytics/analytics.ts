import type { PostHogConfig } from 'posthog-js';

// Product analytics (PostHog): who visits, how long they stay, how far they get.
// The ONLY file that imports posthog-js: everything else calls `track`.
//
// - No key (VITE_POSTHOG_KEY unset: dev, tests, local builds) = every function does nothing
//   and posthog-js is never even loaded.
// - posthog-js is its own chunk, fetched after the game has started (and not at all for a
//   player who switched the stats off): it never holds up the first screen.
// - The PostHog project is shared with another website, so every event carries
//   app = 'cubic' (registered right after init: the automatic pageview and pageleave too).
// - Never a name, chat text, voice data or anything the player typed. Room codes are fine.
// - Nothing here may throw, block or slow the game: every call is wrapped.

/** How the shared PostHog project tells this game's events from the other site's. */
export const APP = 'cubic';
export const DEFAULT_HOST = 'https://us.i.posthog.com';
/** Events tracked while posthog-js is still loading wait here: at most this many. */
export const MAX_WAITING = 50;

/** What an event may carry: plain values only, never free text from the player. */
export type Props = Record<string, string | number | boolean | null>;

export interface TrackOptions {
  /** The page is going away (pagehide): send with a beacon, which outlives the page. */
  beacon?: boolean;
}

/** The part of posthog-js used here (the tests hand in a fake one). */
export interface AnalyticsClient {
  init(key: string, options: Partial<PostHogConfig>): unknown;
  register(props: Props): void;
  capture(event: string, props?: Props, options?: { transport?: 'sendBeacon'; timestamp?: Date }): unknown;
  opt_in_capturing(options?: { captureEventName?: false }): void;
  opt_out_capturing(): void;
  has_opted_out_capturing(): boolean;
}

export interface AnalyticsEnv {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}

export interface Analytics {
  /** Once, at startup. `enabled`: the player's "Share anonymous usage stats" setting. */
  init(enabled?: boolean): void;
  track(event: string, props?: Props, options?: TrackOptions): void;
  /** The setting changed: off = nothing is captured from now, on = capture again. */
  setEnabled(on: boolean): void;
}

export function createAnalytics(load: () => Promise<AnalyticsClient>, env: AnalyticsEnv): Analytics {
  const key = env.VITE_POSTHOG_KEY?.trim();
  /** `init` was called (with a key): from now posthog may be loaded. */
  let wanted = false;
  let loading = false;
  /** posthog, once it is loaded and its own init did not fail. */
  let client: AnalyticsClient | null = null;
  let enabled = true;
  /** Tracked while posthog was loading, with the time it happened. */
  let waiting: { event: string; props: Props; at: Date }[] = [];

  /** Tell posthog the player's choice (it keeps it, and holds back the pageleave too). */
  function consent(): void {
    if (!client) return;
    try {
      // (no '$opt_in' event of our own: the choice is a setting, not something to count)
      if (enabled && client.has_opted_out_capturing()) client.opt_in_capturing({ captureEventName: false });
      else if (!enabled && !client.has_opted_out_capturing()) client.opt_out_capturing();
    } catch {
      // analytics never breaks the game
    }
  }

  function send(c: AnalyticsClient, event: string, props: Props, options?: { transport?: 'sendBeacon'; timestamp?: Date }): void {
    try {
      c.capture(event, { ...props, app: APP }, options);
    } catch {
      // analytics never breaks the game
    }
  }

  function started(c: AnalyticsClient): void {
    try {
      c.init(key!, {
        api_host: env.VITE_POSTHOG_HOST?.trim() || DEFAULT_HOST,
        capture_pageview: true,
        capture_pageleave: true, // with the pageview: time on site
        autocapture: false,
        disable_session_recording: true,
        persistence: 'localStorage', // no cookies
        respect_dnt: true,
        person_profiles: 'identified_only',
        // switched off while it loaded: never counted, the first pageview included
        opt_out_capturing_by_default: !enabled,
        // The project is shared: whatever is switched on there for the other site (and
        // would load more scripts into the game) stays off here.
        disable_surveys: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
      });
      client = c;
      // before the first pageview, which posthog sends on the next tick
      c.register({ app: APP });
    } catch {
      if (!client) return; // posthog did not start: everything stays a no-op
    }
    consent();
    const held = waiting;
    waiting = [];
    if (enabled) for (const w of held) send(c, w.event, w.props, { timestamp: w.at });
  }

  /** Fetch posthog-js, once, and only for a player who shares their stats. */
  function start(): void {
    if (!wanted || !enabled || loading) return;
    loading = true;
    try {
      load().then(started, () => {});
    } catch {
      // analytics never breaks the game
    }
  }

  return {
    init(on = true) {
      enabled = on;
      if (!key) return;
      wanted = true;
      start();
    },
    track(event, props = {}, options) {
      if (!wanted || !enabled) return;
      if (client) send(client, event, props, options?.beacon ? { transport: 'sendBeacon' } : undefined);
      else if (waiting.length < MAX_WAITING) waiting.push({ event, props, at: new Date() });
    },
    setEnabled(on) {
      enabled = on;
      if (!on) waiting = [];
      start();
      consent();
    },
  };
}

/** Vite's env. Node (the tests) has none: no key, so nothing is loaded or sent. */
const analytics = createAnalytics(async () => (await import('posthog-js')).posthog, (import.meta as { env?: AnalyticsEnv }).env ?? {});

export const initAnalytics = (enabled = true): void => analytics.init(enabled);
export const track = (event: string, props?: Props, options?: TrackOptions): void => analytics.track(event, props, options);
export const setAnalyticsEnabled = (on: boolean): void => analytics.setEnabled(on);
