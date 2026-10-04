// INACTIVITY, IN REAL BROWSERS. Two (or three) headless Chromium pages in one room on a
// server with short timers, played with real keys; the pages are only read.
//
//   server:  AI_FAKE=1 TTS_MODE=browser PORT=3421 INACTIVE_MS=10000 INACTIVE_WARN_MS=5000 npm start -w server
//   client:  VITE_SERVER_URL=http://localhost:3421 npx vite --port 5521   (in client/)
//   run:     npx tsx screens/inactivity.ts [base url]                     (in tools/)
//
// Writes run.log and the screenshots to docs/status/inactivity/. Nothing is played out
// loud: the browser is muted, speech is stubbed, the microphone is Chromium's fake device.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { click, has, js, sleep, snap, toGame, toLobby, toMode, until } from './play';

const BASE = process.argv[2] ?? 'http://localhost:5521';
const OUT = new URL('../../docs/status/inactivity/', import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };
/** The server's timers (see above), for the waits. */
const IDLE = 10_000;
const WARN = 5000;
const REMOVED = 'YOU WERE REMOVED FOR INACTIVITY.';
const REPLACED = 'THIS SEAT WAS OPENED IN ANOTHER TAB.';
/** What the idle player's own banner says. */
const YOU = /^You are inactive\. Press any key\. Removed in 0:0[1-5]$/;

mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}run.log`;
const t0 = Date.now();
function log(line: string): void {
  const out = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}`;
  console.log(out);
  appendFileSync(LOG, `${out}\n`);
}
function check(ok: boolean, what: string): void {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) throw new Error(what);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.png` });

/** A new page on the title screen, connected: muted, no speech, a fake microphone. */
async function open(browser: Browser, query = '?renderer=canvas'): Promise<Page> {
  const context = await browser.newContext({ viewport: SIZE, permissions: ['microphone'] });
  await context.addInitScript(() => {
    const s = window.speechSynthesis;
    if (s) {
      s.speak = () => {};
      s.cancel = () => {};
    }
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/${query}`);
  await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
  await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
  return page;
}

/** What a page shows of the room. `sys`: the system lines of the game chat. `banner`: the lobby's system line (or the game's banner). */
interface View {
  online: boolean;
  code: string | null;
  role: string | null;
  side: string | null;
  screen: string;
  phase: string | null;
  sys: string[];
  log: string[];
  banner: string;
  mode: string;
  startedAt: number | null;
  solved: number[];
}
const view = (page: Page) =>
  js<View>(
    page,
    `(() => {
      const c = window.__cubic;
      const b = document.querySelector('#cu-banner');
      return {
        online: c.online, code: c.code, role: c.role, side: c.side, phase: c.room?.phase ?? null,
        screen: document.querySelector('.cu')?.dataset.screen ?? '',
        sys: [...document.querySelectorAll('#cu-log .sys')].map((n) => n.textContent),
        log: [...document.querySelectorAll('#cu-log > div')].map((n) => n.textContent),
        banner: b && !b.hidden ? b.textContent : '',
        mode: typeof window.__cubicModeStatus === 'function' ? window.__cubicModeStatus() : '',
        startedAt: c.state?.startedAt ?? null, solved: c.state?.solved ?? [],
      };
    })()`,
  );

/** Keep a player at the keys (one key a second) until the returned function is called. */
function keepActive(page: Page, keys: string[]): () => Promise<void> {
  let on = true;
  let n = 0;
  const loop = (async () => {
    while (on) {
      await page.keyboard.press(keys[n++ % keys.length]!).catch(() => {});
      await sleep(1000);
    }
  })();
  return async () => {
    on = false;
    await loop;
  };
}

const COUNTDOWN = (who: string) => new RegExp(`^${who} inactive, removed in 0:0[1-5]$`);

/** Host page `idle` and guest page `active` in one lobby (the host outside, the guest inside), both on the mode screen first. */
async function pair(browser: Browser, query?: string): Promise<{ idle: Page; active: Page }> {
  const idle = await open(browser, query);
  const active = await open(browser, query);
  await toMode(idle);
  await toMode(active);
  await toLobby(idle, active);
  return { idle, active };
}
const closeAll = (...pages: Page[]) => Promise.all(pages.map((p) => p.context().close()));

// ---------- 1. lobby ----------
async function lobby(browser: Browser): Promise<void> {
  log('--- 1. lobby: B (the host, P1) idle, A (the guest) at the keys');
  const { idle: b, active: a } = await pair(browser);
  const code = (await view(a)).code!;
  const stop = keepActive(a, ['d']); // A already stands on the inside: the key changes nothing, it is only a key
  await until('the countdown in both lobbies', async () => COUNTDOWN('P1').test((await view(a)).banner) && YOU.test((await view(b)).banner), IDLE + 4000);
  log(`A sees "${(await view(a)).banner}", B sees "${(await view(b)).banner}"`);
  await shot(a, '1-lobby-countdown-A');
  await shot(b, '1-lobby-countdown-B');
  await until('B back on the mode screen', async () => (await view(b)).mode === REMOVED, WARN + 4000);
  await sleep(700);
  await shot(b, '1-lobby-removed-B');
  const vb = await view(b);
  check(vb.code === null && (await has(b, 'CREATE LOBBY')), `B is removed: on the mode screen with "${vb.mode}"`);
  await until('A to be the host', async () => (await view(a)).role === 'host' && (await has(a, 'START')), 3000);
  const va = await view(a);
  check(va.code === code && va.phase === 'lobby' && va.side === 'in' && (await has(a, 'LEAVE')), `A is still in lobby ${code}, with the pick kept (${va.side})`);
  check(va.role === 'host', 'A became the host (START button)');
  check(va.banner === 'P1 left due to inactivity', `A sees "${va.banner}"`);
  await shot(a, '1-lobby-after-A');
  // a new player joins with the code
  const c = await open(browser);
  await toMode(c);
  await click(c, 'JOIN LOBBY');
  await until('the join popup', () => has(c, 'CANCEL'));
  await c.waitForTimeout(350);
  await c.keyboard.type(code, { delay: 50 });
  await click(c, 'JOIN');
  await until('C in the lobby', () => has(c, 'READY'), 6000);
  const vc = await view(c);
  check(vc.code === code && vc.role === 'guest', `a new player joined ${code} as the guest`);
  check(vc.banner === '', `the newcomer (now P2) is not shown the old removal line: banner "${vc.banner}"`);
  await shot(c, '1-lobby-newcomer-C');
  check((await view(a)).role === 'host' && (await view(a)).code === code, 'A is still the host of the same room');
  await stop();
  await closeAll(a, b, c);
}

// ---------- 2. game ----------
async function game(browser: Browser): Promise<void> {
  log('--- 2. game: B (the host, OUTSIDE) idle, A (INSIDE) keeps playing');
  const { idle: b, active: a } = await pair(browser);
  await toGame(b, a);
  const before = await view(a);
  const stop = keepActive(a, ['a', 'd']);
  await until('the countdown in both chats', async () => (await view(a)).sys.some((t) => COUNTDOWN('OUTSIDE').test(t)) && (await view(b)).sys.some((t) => COUNTDOWN('OUTSIDE').test(t)), IDLE + 6000);
  log(`A's chat: ${JSON.stringify((await view(a)).sys)}, B's chat: ${JSON.stringify((await view(b)).sys)}`);
  const own = (await view(b)).banner;
  check(YOU.test(own) && (await view(a)).banner === '', `B, the idle one, also gets the banner "${own}"; A has no banner`);
  await shot(a, '2-game-countdown-A');
  await shot(b, '2-game-countdown-B');
  await a.locator('#cu-log').screenshot({ path: `${OUT}2-game-countdown-A-chat.png` });
  await sleep(1100);
  const later = (await view(a)).sys;
  check(later.length === 1, `one line that counts down in place, no flood: now ${JSON.stringify(later)}`);
  await until('B back on the mode screen', async () => (await view(b)).mode === REMOVED, WARN + 5000);
  await sleep(700);
  await shot(b, '2-game-removed-B');
  await until('A to see B leave', async () => (await view(a)).sys.includes('OUTSIDE left due to inactivity'), 3000);
  const va = await view(a);
  check(va.screen === 'game' && va.code === before.code && va.side === 'in' && va.online, `A is still in game ${va.code} on the same side`);
  check(va.role === 'host', 'A became the host');
  check(va.sys.length === 1, `A's chat has the one line: ${JSON.stringify(va.sys)}`);
  check(va.startedAt === before.startedAt && JSON.stringify(va.solved) === JSON.stringify(before.solved), 'the world is as it was (same game clock, same solved faces)');
  check(va.banner === 'Partner left. Anyone with the room code can join.', `A's banner: "${va.banner}"`);
  // A really still plays: a step is acknowledged by the server
  const pose = JSON.stringify((await snap(a)).state!.players.in.pose);
  await until('A to walk on', async () => JSON.stringify((await snap(a)).state!.players.in.pose) !== pose && (await snap(a)).pending === 0, 4000);
  check(true, 'A walks on and the server acknowledges the steps');
  await shot(a, '2-game-after-A');
  await stop();
  await closeAll(a, b);
}

// ---------- 3. a chat message cancels the countdown ----------
async function cancel(browser: Browser): Promise<void> {
  log('--- 3. game: B idle, then B sends a chat message in the countdown');
  const { idle: b, active: a } = await pair(browser);
  await toGame(b, a);
  const stop = keepActive(a, ['a', 'd']);
  await until('the countdown in both chats', async () => (await view(a)).sys.some((t) => COUNTDOWN('OUTSIDE').test(t)) && (await view(b)).sys.some((t) => COUNTDOWN('OUTSIDE').test(t)), IDLE + 6000);
  await shot(b, '3-cancel-countdown-B');
  await b.locator('#cu-chat').fill('sorry, I am here');
  await b.locator('#cu-chat').press('Enter');
  await until('"is back" in both chats', async () => (await view(a)).sys.includes('OUTSIDE is back') && (await view(b)).sys.includes('OUTSIDE is back'), 3000);
  const va = await view(a);
  check(va.sys.length === 1 && va.log.some((t) => t!.includes('sorry, I am here')), `the countdown line became "OUTSIDE is back" and the message arrived: ${JSON.stringify(va.log)}`);
  await shot(a, '3-cancel-back-A');
  await sleep(WARN + 1500); // past where the countdown would have ended
  const vb = await view(b);
  check(vb.screen === 'game' && vb.code === va.code && vb.mode !== REMOVED, 'B is still in the game after the old deadline');
  await stop();
  await closeAll(a, b);
}

// ---------- 4. B's tab in the background ----------
async function background(browser: Browser): Promise<void> {
  log('--- 4. game: B\'s page frozen and throttled (a background tab), A plays for 60 s');
  const { idle: b, active: a } = await pair(browser);
  await toGame(b, a);
  const before = await view(a);
  // What is emulated: the page lifecycle state "frozen" (what Chrome does to a background
  // tab: its timers and rendering stop) and a 20x CPU throttle on top. B never comes to
  // the keys, so by the rules B is idle and is removed; A must never be.
  const cdp = await b.context().newCDPSession(b);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  log('B: Page.setWebLifecycleState frozen + Emulation.setCPUThrottlingRate 20');
  const stop = keepActive(a, ['a', 'd']);
  const start = Date.now();
  let bGone = 0;
  let checks = 0;
  while (Date.now() - start < 60_000) {
    const va = await view(a);
    if (!(va.screen === 'game' && va.online && va.code === before.code && va.side === 'in' && va.role !== null && va.mode !== REMOVED)) {
      await shot(a, '4-background-A-KICKED');
      check(false, `A was kicked after ${Math.round((Date.now() - start) / 1000)} s: ${JSON.stringify(va)}`);
    }
    checks++;
    if (!bGone && va.sys.includes('OUTSIDE left due to inactivity')) {
      bGone = Date.now() - start;
      log(`after ${(bGone / 1000).toFixed(0)} s B (frozen, idle) was removed by the rules; A's chat: ${JSON.stringify(va.sys)}`);
      await shot(a, '4-background-B-removed-A');
    }
    await sleep(1000);
  }
  const va = await view(a);
  check(checks >= 50, `A was in the game at every one of ${checks} checks over 60 s`);
  check(bGone > 0, 'B counted as idle and was removed');
  check(va.role === 'host' && va.startedAt === before.startedAt, 'A is the host of the same game after 60 s');
  await shot(a, '4-background-after-60s-A');
  await stop();
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await until('B (awake again) on the mode screen with the message', async () => (await view(b)).mode === REMOVED, 8000);
  check(true, `B woke up on the mode screen with "${REMOVED}"`);
  await closeAll(a, b);
}

// ---------- 5. both idle ----------
async function both(browser: Browser): Promise<void> {
  log('--- 5. game: both idle');
  const { idle: b, active: a } = await pair(browser);
  await toGame(b, a);
  const code = (await view(a)).code!;
  await until('both countdowns in both chats', async () => (await view(a)).sys.length === 2 && (await view(b)).sys.length === 2, IDLE + 6000);
  log(`A's chat: ${JSON.stringify((await view(a)).sys)}`);
  await shot(a, '5-both-countdown-A');
  await until('both back on the mode screen', async () => (await view(a)).mode === REMOVED && (await view(b)).mode === REMOVED, WARN + 6000);
  await sleep(700);
  check(true, `both are on the mode screen with "${REMOVED}"`);
  await shot(a, '5-both-removed-A');
  await shot(b, '5-both-removed-B');
  // the room is deleted: its code is unknown to the server
  await click(a, 'JOIN LOBBY');
  await until('the join popup', () => has(a, 'CANCEL'));
  await a.waitForTimeout(350);
  await a.keyboard.type(code, { delay: 50 });
  await click(a, 'JOIN');
  await until('the server to refuse the code', async () => /room not found/i.test(await js<string>(a, `JSON.stringify(window.__cubic.error)`)), 5000);
  check(true, `room ${code} is deleted: joining it again says "${await js<string>(a, 'window.__cubic.error')}"`);
  await closeAll(a, b);
}

// ---------- 6. talking is activity (fake microphone, audio through the relay) ----------
async function talking(browser: Browser): Promise<void> {
  log('--- 6. game, voice through the relay (?relay): B stands still and talks (open mic, Chromium\'s fake microphone)');
  const { idle: b, active: a } = await pair(browser, '?renderer=canvas&relay');
  await toGame(b, a);
  // the microphone is already allowed for this page, so it comes on by itself with the partner; else ENABLE MIC
  await until('B\'s mic on', async () => {
    if (await js<boolean>(b, `!!document.querySelector('#cu-voice [data-act="mode"]')`)) return true;
    await b.locator('#cu-voice [data-act="mic"]').click({ timeout: 500 }).catch(() => {});
    return false;
  }, 10_000);
  if (!(await js<boolean>(b, `document.querySelector('#cu-voice [data-act="mode"]').textContent.includes('Open mic')`))) await b.locator('#cu-voice [data-act="mode"]').click();
  await until('B heard talking by its own page', () => js<boolean>(b, 'window.__cubicVoice.talkingNow'), 6000);
  const link = await js<string>(b, 'window.__cubicVoice.snapshot(0).link');
  log(`B's mic is open and B is talking (link: ${link}); from here B touches nothing`);
  const stop = keepActive(a, ['a', 'd']);
  const start = Date.now();
  let heard = 0;
  while (Date.now() - start < IDLE + WARN + 10_000) {
    const vb = await view(b);
    if (await js<boolean>(b, 'window.__cubicVoice.talkingNow')) heard++;
    if (vb.screen !== 'game' || vb.sys.length > 0) {
      await shot(b, '6-talking-B-FAILED');
      check(false, `B was warned or removed while talking: ${JSON.stringify(vb)}`);
    }
    await sleep(500);
  }
  check(heard > 0, `B talked (${heard} of the samples above the level) and pressed nothing for ${(IDLE + WARN + 10_000) / 1000} s`);
  check((await view(b)).screen === 'game' && (await view(a)).sys.length === 0, 'B was never warned or removed: no system line in either chat');
  await shot(b, '6-talking-B');
  await stop();
  await closeAll(a, b);
}

// ---------- 7. a host waiting alone in a lobby ----------
async function alone(browser: Browser): Promise<void> {
  log('--- 7. lobby: the host waits ALONE and touches nothing, for the whole idle window and the countdown');
  const a = await open(browser);
  await toMode(a);
  await click(a, 'CREATE LOBBY');
  await until('the side select screen', () => has(a, 'LEAVE'), 6000);
  const code = (await view(a)).code!;
  const start = Date.now();
  let checks = 0;
  while (Date.now() - start < IDLE + WARN + 5000) {
    const va = await view(a);
    if (va.code !== code || va.phase !== 'lobby' || va.banner !== '' || va.mode === REMOVED) {
      await shot(a, '7-alone-A-FAILED');
      check(false, `the lone host was warned or removed after ${Math.round((Date.now() - start) / 1000)} s: ${JSON.stringify(va)}`);
    }
    checks++;
    await sleep(1000);
  }
  check(true, `the lone host was in lobby ${code} with no warning at every one of ${checks} checks over ${(IDLE + WARN + 5000) / 1000} s`);
  await shot(a, '7-alone-after-A');
  // the friend can still come in, and only then do the clocks run
  const b = await open(browser);
  await toMode(b);
  await click(b, 'JOIN LOBBY');
  await until('the join popup', () => has(b, 'CANCEL'));
  await b.waitForTimeout(350);
  await b.keyboard.type(code, { delay: 50 });
  await click(b, 'JOIN');
  await until('B in the lobby', () => has(b, 'READY'), 6000);
  check((await view(a)).role === 'host' && (await view(b)).code === code, `the friend joined ${code}; the host is still the host`);
  await sleep(IDLE - 3000);
  check((await view(a)).banner === '', 'the clocks started when the friend sat down: no warning yet after most of the idle window');
  await closeAll(a, b);
}

// ---------- 8. the seat is opened in another tab ----------
async function duplicate(browser: Browser): Promise<void> {
  log('--- 8. game: B\'s tab is duplicated (the copy has the same sessionStorage, so the same token)');
  const { idle: b, active: a } = await pair(browser);
  await toGame(b, a);
  const seat = await js<string>(b, `sessionStorage.getItem('cubic.seat')`);
  const stop = keepActive(a, ['a', 'd']);
  // what "Duplicate tab" does: a new page of the same browser profile, born with a copy of the session storage
  const copy = await b.context().newPage();
  await copy.addInitScript((value) => sessionStorage.setItem('cubic.seat', value), seat);
  await copy.goto(`${BASE}/?renderer=canvas`);
  await until('the copy in the game', async () => (await view(copy)).screen === 'game', 15_000);
  await until('the old tab on the mode screen with the reason', async () => (await view(b)).mode === REPLACED, 6000);
  await sleep(700);
  const vb = await view(b);
  check(vb.code === null && vb.online && (await has(b, 'CREATE LOBBY')), `the old tab is on the mode screen, online, with "${vb.mode}" (not stuck on "reconnecting")`);
  await shot(b, '8-duplicate-old-tab-B');
  await sleep(3000); // no tug of war: the old tab does not take the seat back
  const vc = await view(copy);
  const va = await view(a);
  check(vc.screen === 'game' && vc.side === 'out' && vc.code === va.code && vc.online, 'the new tab holds the seat, in the same game');
  check((await view(b)).mode === REPLACED && (await view(b)).code === null, 'the old tab stays out');
  check(va.screen === 'game' && va.sys.length === 0 && va.banner === '', `A plays on and is told nothing: chat ${JSON.stringify(va.sys)}, banner "${va.banner}"`);
  await shot(copy, '8-duplicate-new-tab');
  await stop();
  await closeAll(a, b);
}

// ---------- 9. solo ----------
async function solo(browser: Browser): Promise<void> {
  log('--- 9. solo (the scripted AI partner, AI_FAKE=1): the human does nothing');
  const a = await open(browser);
  await toMode(a);
  await click(a, 'PLAY SOLO');
  await until('the solo popup', () => has(a, 'OUTSIDE'));
  await a.waitForTimeout(350);
  await click(a, 'OUTSIDE');
  await until('the solo game', async () => (await view(a)).screen === 'game', 10_000);
  await until('the countdown: the chat line and the banner', async () => {
    const v = await view(a);
    return v.sys.some((t) => COUNTDOWN('OUTSIDE').test(t)) && YOU.test(v.banner);
  }, IDLE + 8000);
  const va = await view(a);
  log(`chat: ${JSON.stringify(va.log)}; banner: "${va.banner}"`);
  check(va.sys.length === 1, 'one countdown line, about the human only (the AI is never inactive, and its lines did not stop the clock)');
  await shot(a, '9-solo-countdown');
  await until('back on the mode screen', async () => (await view(a)).mode === REMOVED, WARN + 5000);
  await sleep(700);
  check((await view(a)).code === null, `the room is closed: on the mode screen with "${REMOVED}"`);
  check((await js<number | null>(a, 'window.__cubic.leftSolo()')) === null, 'nothing is kept to continue (no left seat)');
  await click(a, 'PLAY SOLO');
  await until('the solo popup', () => has(a, 'OUTSIDE'));
  await a.waitForTimeout(350);
  check(!(await has(a, 'CONTINUE LAST GAME')), 'the solo popup does not offer CONTINUE LAST GAME');
  await shot(a, '9-solo-removed-popup');
  await closeAll(a);
}

writeFileSync(LOG, '');
log(`inactivity check against ${BASE} (server timers: INACTIVE_MS=${IDLE} INACTIVE_WARN_MS=${WARN})`);
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  await lobby(browser);
  await game(browser);
  await cancel(browser);
  await background(browser);
  await both(browser);
  await talking(browser);
  await alone(browser);
  await duplicate(browser);
  await solo(browser);
  log('ALL PASSED');
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
