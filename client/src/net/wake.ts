// Waiting for the server: pure numbers, no socket and no DOM (client/test/wake.test.ts).
//
// The server sleeps on free hosting when nobody is there, and the first request wakes it:
// about 50 seconds, sometimes more. The socket retries by itself the whole time; this file
// says how (the options it is given), how far along the wait is, and when to stop.

/**
 * expectMs: how long a cold start usually takes (the bar is nearly full by then).
 * giveUpMs: when the menus stop and show RETRY: two cold starts, so a slow one still fits.
 * attemptMs: one connection attempt is dropped after this long and the next one starts.
 *   The host holds a request while the server boots, so an attempt in the air when it
 *   comes up connects at once.
 * retryMinMs / retryMaxMs: the pause between attempts, doubling from the first to the
 *   second. Short: a server that just woke should not wait for us.
 */
export const WAKE = { expectMs: 60_000, giveUpMs: 120_000, attemptMs: 20_000, retryMinMs: 1_000, retryMaxMs: 5_000, jitter: 0.5 };

/**
 * What socket.io-client is given. It never stops by itself (`reconnectionAttempts`): the
 * give-up is ours (`wakeView`), and in a room there is none, the seat may still be held.
 * WebSocket first; where a network blocks it (some campus and office networks), HTTP
 * long-polling. Without tryAllTransports the client would never try the second one.
 */
export function socketOptions() {
  return {
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    timeout: WAKE.attemptMs,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: WAKE.retryMinMs,
    reconnectionDelayMax: WAKE.retryMaxMs,
    randomizationFactor: WAKE.jitter,
  };
}

/** The pause before retry number `attempt` (0 = the first retry), without the jitter. */
export function retryDelay(attempt: number): number {
  return Math.min(WAKE.retryMaxMs, WAKE.retryMinMs * 2 ** Math.max(0, Math.floor(attempt)));
}

/**
 * How many attempts are sure to have STARTED within `ms`, when every one of them hangs for
 * the full `attemptMs` and every pause is as long as the jitter can make it.
 */
export function attemptsWithin(ms: number): number {
  let at = 0;
  let n = 0;
  while (at <= ms) {
    n++;
    at += WAKE.attemptMs + retryDelay(n - 1) * (1 + WAKE.jitter);
  }
  return n;
}

export interface WakeView {
  /** Still trying, or stopped (show RETRY). */
  phase: 'waking' | 'failed';
  /** 0..1 for the bar. It never goes back, and is never full while we wait. */
  progress: number;
  /** Whole percent of `progress`, for the text. */
  percent: number;
}

/** The bar is this full when a usual cold start should be over. The rest creeps. */
const USUAL = 0.9;
const NEARLY = 0.99;

/**
 * The wait as the menus show it: `since` is when we started (or pressed RETRY), `now` the
 * same clock. Up to `expectMs` the bar runs to 90%, then it creeps to 99% until
 * `giveUpMs`: it keeps moving, so a slow start does not look stuck, and it is never full
 * before the server answers.
 */
export function wakeView(since: number, now: number): WakeView {
  const t = Math.max(0, now - since);
  if (t >= WAKE.giveUpMs) return { phase: 'failed', progress: NEARLY, percent: Math.floor(NEARLY * 100) };
  const progress = t <= WAKE.expectMs ? (t / WAKE.expectMs) * USUAL : USUAL + ((t - WAKE.expectMs) / (WAKE.giveUpMs - WAKE.expectMs)) * (NEARLY - USUAL);
  return { phase: 'waking', progress, percent: Math.floor(progress * 100) };
}

/** What the connection looks like to the UI while we are not online. `since` is on this clock. */
export interface WakeState {
  since: number;
  /** We stopped trying: RETRY starts again. */
  failed: boolean;
}

/**
 * The status line of the menus while the server is not there. `failed` is the socket's
 * word (`WakeState.failed`), not the clock's: until it has really stopped we are waking.
 * `long` adds how long it usually takes (the mode screen has the room for it).
 */
export function wakeText(wake: WakeState, now: number, long = false): string {
  if (wake.failed) return long ? 'CANNOT REACH THE SERVER. IT MAY BE STARTING UP.' : 'CANNOT REACH THE SERVER.';
  return `WAKING THE SERVER...${long ? ' ABOUT A MINUTE.' : ''} ${wakeView(wake.since, now).percent}%`;
}
