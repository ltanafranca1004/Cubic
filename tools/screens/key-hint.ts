// The controls hint (.cu-onb-keys, the key strip over the bottom of the game view): it is
// up at the start, gone after 3 s without input, gone at once on the first move, and it
// does not come back. Headless and silent. Pictures and log.txt go to docs/status/key-hint.
//
//   1. two real clients against a running server: start, 3 s, a face change, a reload in
//      the middle of the game (the rejoin must not bring the hint back)
//   2. ?mock=game (the same layer, mounted by the same startApp): the first move
//   3. ?mock=game with "Reduce motion": no fade
//   4. ?mock=game&touch in a phone held sideways (the compact layout)
//
//   server:  PORT=3424 AI_FAKE=1 TTS_MODE=browser npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3424 npm run dev -w client -- --port 5524
//   run:     cd tools && BASE=http://localhost:5524 npx tsx screens/key-hint.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { CONTROLS_MS, FADE_MS } from '../../client/src/ui/onboarding/rules';

const BASE = process.env.BASE ?? 'http://localhost:5524';
const OUT = new URL('../../docs/status/key-hint/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

interface Cubic {
  code: string | null;
  role: string | null;
  side: 'out' | 'in' | null;
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null; ready: boolean } | null> } | null;
  state: { startedAt: number; players: Record<string, { pose: { face: number; x: number; y: number } }> } | null;
}

const lines: string[] = [];
const log = (text: string) => {
  console.log(text);
  lines.push(text);
};
const problems: string[] = [];
let failed = 0;
function check(what: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
}

/** Nothing may play through the speakers: no speech, and the browser itself is muted. */
async function context(browser: Browser, options: Parameters<Browser['newContext']>[0], settings?: object): Promise<BrowserContext> {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(() => {
    const s = window.speechSynthesis;
    if (s) {
      s.speak = () => {};
      s.cancel = () => {};
    }
  });
  if (settings) await ctx.addInitScript((text) => localStorage.setItem('cubic.settings.v1', text), JSON.stringify(settings));
  return ctx;
}
async function open(ctx: BrowserContext, query: string, tag: string): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${tag}: pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${tag}: console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/${query}`);
  return page;
}
const press = async (page: Page, ...keys: string[]) => {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(140);
  }
};
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
async function until(what: string, cond: () => Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The hint as the player sees it: is it on, can it be seen, and where it is against the view. */
interface Bar {
  screen: string;
  layout: string;
  touch: boolean;
  on: boolean;
  opacity: number;
  visibility: string;
  transition: string;
  text: string;
  /** How much of the bar is inside the game view, 0..1. */
  inView: number;
  /** Art-pixel rows of the view it covers, from the view's bottom edge. */
  fromBottom: number;
  /** Any OTHER element with key names in it that is visible over the view (there must be none). */
  others: string[];
}
const bar = (page: Page): Promise<Bar> =>
  page.evaluate(`(() => {
    const cu = document.querySelector('.cu');
    const el = document.querySelector('.cu-onb-keys');
    const view = document.querySelector('#cu-view').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const w = Math.max(0, Math.min(r.right, view.right) - Math.max(r.left, view.left));
    const h = Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top));
    const seen = (n) => { const s = getComputedStyle(n); const b = n.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && b.width > 0 && b.height > 0 && b.left < view.right && b.right > view.left && b.top < view.bottom && b.bottom > view.top; };
    const others = [...document.querySelectorAll('.cu kbd, .cu .cu-kbd')].filter((n) => !el.contains(n) && !n.closest('#cu-pause, #cu-settings') && seen(n)).map((n) => n.textContent.trim());
    return {
      screen: cu.dataset.screen, layout: cu.dataset.layout || '', touch: 'touch' in cu.dataset,
      on: el.classList.contains('on'), opacity: Number(cs.opacity), visibility: cs.visibility, transition: cs.transitionDuration,
      text: el.textContent.replace(/\\s+/g, ' ').trim(),
      inView: r.width && r.height ? (w * h) / (r.width * r.height) : 0,
      fromBottom: Math.round(view.bottom - r.top),
      others,
    };
  })()`) as Promise<Bar>;
const visible = (b: Bar) => b.on && b.opacity === 1 && b.visibility === 'visible';
const gone = (b: Bar) => !b.on && b.opacity === 0 && b.visibility === 'hidden';
const inGame = (page: Page) => async () => (await page.evaluate(() => (document.querySelector('.cu') as HTMLElement | null)?.dataset.screen)) === 'game';
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  log(`      ${name}.png`);
};
/** Polls from "the hint is on" until it is off: how long it was up, in ms. */
async function upFor(page: Page, since: number, max: number): Promise<number> {
  await until('the controls hint goes', async () => !(await bar(page)).on, max);
  return Date.now() - since;
}

const DESKTOP = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }; // an iPhone 14 held sideways

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  // ---------- 1. a real game, two clients: start, 3 s without input, then it stays away ----------
  log('1. two clients, a real game (outside = host), Canvas renderer, 1280x720');
  const ctxA = await context(browser, DESKTOP);
  const ctxB = await context(browser, DESKTOP);
  const a = await open(ctxA, '?renderer=canvas', 'out');
  const b = await open(ctxB, '?renderer=canvas', 'in');
  for (const p of [a, b]) {
    await p.waitForTimeout(1500);
    await press(p, 'Enter'); // title -> mode (the dive takes 1.2 s)
    await p.waitForTimeout(1900);
  }
  await press(a, 'ArrowDown', 'Enter'); // Create
  await until('the host is in a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  const code = (await net(a, (c) => c.code))!;
  await press(b, 'ArrowDown', 'ArrowDown', 'Enter'); // Join
  await b.waitForTimeout(400);
  await b.keyboard.type(code);
  await press(b, 'Enter');
  await until('the guest joined', async () => (await net(b, (c) => c.role)) === 'guest');
  await b.waitForTimeout(700);
  await press(a, 'a');
  await press(b, 'd');
  await until('sides picked', async () => (await net(a, (c) => c.room?.members.guest?.side)) === 'in' && (await net(a, (c) => c.room?.members.host?.side)) === 'out');
  await press(b, 'Enter');
  await until('guest ready', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(300);
  await a.keyboard.press('Enter');
  await until('the game started', inGame(a));
  await until('the controls hint is on', async () => (await bar(a)).on, 3000);
  const t0 = Date.now();
  await a.waitForTimeout(FADE_MS + 130); // the fade in
  let s = await bar(a);
  check('start: the hint is visible', visible(s), `"${s.text}"`);
  check('start: it lies over the game view, along its bottom', s.inView > 0.99 && s.fromBottom > 0, `${Math.round(s.inView * 100)}% inside #cu-view, top edge ${s.fromBottom}px above the view's bottom`);
  await shot(a, 'start');
  const up = await upFor(a, t0, CONTROLS_MS + 2000);
  check(`no input: it goes after ${CONTROLS_MS} ms`, up >= CONTROLS_MS - 250 && up <= CONTROLS_MS + 500, `up for ${up} ms, no key pressed`);
  await a.waitForTimeout(FADE_MS + 130);
  s = await bar(a);
  check('after 3 s: nothing of it is left', gone(s) && s.others.length === 0, `opacity ${s.opacity}, ${s.visibility}`);
  await shot(a, 'after-3s');

  // it does not come back: steps, a face change, a re-fit, a reload in the middle of the game
  let sawAgain = false;
  const watch = async (page: Page, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await bar(page)).on) sawAgain = true;
      await page.waitForTimeout(60);
    }
  };
  const face0 = (await net(a, (c) => c.state!.players.out!.pose)).face;
  for (let i = 0; i < 16 && (await net(a, (c) => c.state!.players.out!.pose)).face === face0; i++) {
    await a.keyboard.press('a');
    await watch(a, 180);
  }
  await watch(a, 1200);
  const face1 = (await net(a, (c) => c.state!.players.out!.pose)).face;
  check('it stays away over steps and a face change', !sawAgain && face1 !== face0, `face ${face0} -> ${face1}`);
  sawAgain = false;
  await a.setViewportSize({ width: 1100, height: 640 });
  await watch(a, 700);
  await a.setViewportSize(DESKTOP.viewport);
  await watch(a, 700);
  check('it stays away over a re-fit (window resized and back)', !sawAgain);
  sawAgain = false;
  const id = await net(a, (c) => c.state!.startedAt);
  await a.reload();
  await until('back in the game after the reload', inGame(a), 15_000);
  await until('the state is back', async () => (await net(a, (c) => c.state?.startedAt ?? null)) !== null);
  await watch(a, 2500);
  const idAfter = await net(a, (c) => c.state!.startedAt);
  check('it stays away after a reload / rejoin in the middle of the game', !sawAgain && idAfter === id && gone(await bar(a)), `same game ${idAfter === id}, sessionStorage cubic.onb.controls = ${await a.evaluate(() => sessionStorage.getItem('cubic.onb.controls'))}`);
  await shot(a, 'after-reload');

  // the pause menu still has the controls
  await a.keyboard.press('Escape'); // (after the reload the side card is up again: the first Esc closes that)
  await a.waitForTimeout(300);
  await a.keyboard.press('Escape');
  await a.waitForTimeout(500);
  const help = await a.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.cu-pause .cu-help');
    return el && el.getBoundingClientRect().height > 0 ? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  });
  check('the pause menu still lists the controls', !!help && /^Controls ?Key/.test(help) && /Gamepad/.test(help), help ?? 'no controls table found');
  await shot(a, 'pause-controls');
  await ctxA.close();
  await ctxB.close();

  // ---------- 2. the first move ----------
  log('2. ?mock=game (same onboarding layer, no server), Canvas renderer, 1280x720');
  const ctxC = await context(browser, DESKTOP);
  const c = await open(ctxC, '?mock=game&renderer=canvas', 'move');
  await until('the game is up', inGame(c));
  await until('the controls hint is on', async () => (await bar(c)).on, 3000);
  const c0 = Date.now();
  await c.waitForTimeout(FADE_MS + 130);
  check('start (mock): the hint is visible over the view, as in the real game', visible(await bar(c)) && (await bar(c)).inView > 0.99);
  await c.keyboard.press('d');
  const offAt = Date.now() - c0;
  const right = await bar(c);
  check('first move: the hint is off with the key press', !right.on && offAt < CONTROLS_MS - 1000, `class "on" gone ${offAt} ms after it came up, long before ${CONTROLS_MS} ms; fading over ${right.transition}`);
  await c.waitForTimeout(FADE_MS + 130);
  s = await bar(c);
  check('first move: nothing of it is left after the fade', gone(s) && s.others.length === 0, `opacity ${s.opacity}, ${s.visibility}`);
  await shot(c, 'after-first-move');
  sawAgain = false;
  await watch(c, CONTROLS_MS + 500);
  check('first move: it does not come back', !sawAgain);
  await ctxC.close();

  // ---------- 3. reduce motion: no fade ----------
  log('3. ?mock=game with "Reduce motion" on');
  const ctxD = await context(browser, DESKTOP, { reduceMotion: true });
  const d = await open(ctxD, '?mock=game&renderer=canvas', 'still');
  await until('the game is up', inGame(d));
  await until('the controls hint is on', async () => (await bar(d)).on, 3000);
  s = await bar(d);
  check('reduce motion: it is there at once, no fade in', visible(s), `transition-duration ${s.transition}`);
  const [still] = await Promise.all([
    d.evaluate(
      () =>
        new Promise<{ ms: number; opacity: string; visibility: string; duration: string }>((done) => {
          // the very next frame after the key: with a fade the opacity would still be near 1
          window.addEventListener('keydown', () => {
            const at = performance.now();
            requestAnimationFrame(() => {
              const cs = getComputedStyle(document.querySelector('.cu-onb-keys')!);
              done({ ms: Math.round(performance.now() - at), opacity: cs.opacity, visibility: cs.visibility, duration: cs.transitionDuration });
            });
          }, { once: true });
        }),
    ),
    d.waitForTimeout(100).then(() => d.keyboard.press('d')),
  ]);
  check('reduce motion: gone in the same frame as the first move, no fade', still.opacity === '0' && still.visibility === 'hidden' && /^0s(, 0s)*$/.test(still.duration), `${still.ms} ms after the key: opacity ${still.opacity}, ${still.visibility}, transition-duration ${still.duration}`);
  await shot(d, 'reduce-motion-after-move');
  await ctxD.close();
  const ctxE = await context(browser, DESKTOP, { reduceMotion: true });
  const e = await open(ctxE, '?mock=game&renderer=canvas', 'still-3s');
  await until('the game is up', inGame(e));
  await until('the controls hint is on', async () => (await bar(e)).on, 3000);
  const e0 = Date.now();
  const eUp = await upFor(e, e0, CONTROLS_MS + 2000);
  s = await bar(e);
  check('reduce motion: gone at 3 s without input, at once', gone(s) && eUp <= CONTROLS_MS + 500, `up for ${eUp} ms, then opacity ${s.opacity}, ${s.visibility}`);
  await ctxE.close();

  // ---------- 4. the compact layout, with fingers ----------
  log('4. ?mock=game&touch, a phone held sideways (844x390 @3), compact layout');
  const ctxF = await context(browser, PHONE);
  const f = await open(ctxF, '?mock=game&touch&renderer=canvas', 'phone');
  await until('the game is up', inGame(f));
  await f.waitForTimeout(900);
  s = await bar(f);
  log(`      layout "${s.layout}", touch ${s.touch}, hint on=${s.on} opacity=${s.opacity}, other key hints over the view: ${JSON.stringify(s.others)}`);
  check('phone: compact touch layout', s.layout === 'compact' && s.touch);
  check('phone, start: no key strip covers the map (the keyboard hint is never drawn for fingers)', s.opacity === 0 && s.others.length === 0, `.cu-onb-keys opacity ${s.opacity} (ui/mobile/css.ts), nothing else with key names over the view`);
  await shot(f, 'mobile-start');
  await f.waitForTimeout(CONTROLS_MS + 500);
  s = await bar(f);
  const lift = await f.evaluate(() => (document.querySelector('.cu') as HTMLElement).style.getPropertyValue('--subs-lift'));
  check('phone, after 3 s: the same rule ran (the hint is off, the captions are no longer lifted for it)', gone(s) && s.others.length === 0 && lift === '0px', `on=${s.on}, --subs-lift ${lift}`);
  await shot(f, 'mobile-after');
  await ctxF.close();

  check('no console error and no page error', problems.length === 0, problems.join(' | '));
} finally {
  await browser.close();
  log(failed ? `\n${failed} FAILED` : '\nall checks passed');
  writeFileSync(`${OUT}log.txt`, `${lines.join('\n')}\n`);
}
process.exit(failed ? 1 : 0);
