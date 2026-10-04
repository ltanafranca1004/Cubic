// The two phone bugs, with real touch input on emulated phones, Chromium and WebKit, a
// FRESH browser context for every load:
//
//   1. THE FIRST TAP ON PLAY reaches the mode screen: on a fresh load held sideways, after
//      the page was opened upright and then turned, after the browser's toolbar slid away
//      (the window grew at the same scale), and when the browser says "resize" in the
//      middle of the tap. Each also checks that Phaser measures taps against the box the
//      canvas really has (the first three failed on every phone whose menu scale is 1).
//   2. THE PAGE NEVER ZOOMS: double tap and pinch, on the title and in a game, with the
//      viewport meta's scale limits taken out (iOS Safari ignores them, so they prove
//      nothing). Text fields still take the focus and typing, a panel still scrolls.
//   3. ZOOMED ANYWAY (Chromium: the page scale is forced to x2): the layout keeps its
//      size, the page lets go of every touch (so two fingers can zoom back out), and locks
//      again at x1. The pinch back out itself is not driven: a forced scale is pinned.
//
// What this cannot show: iOS Safari's own double tap and pinch. No desktop engine has
// them (Playwright's WebKit has no page zoom gestures), so on WebKit only the guards are
// checked: that the events a pinch and a double tap are made of get cancelled.
//
//   server:  PORT=3660 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3660 npm run dev -w client -- --port 5760
//   run:     cd tools && BASE=http://localhost:5760 RUNS=3 npx tsx screens/first-tap.ts [tap zoom]
//
// Screenshots of what failed go to docs/status/mobile-audit/ (not committed).
import { mkdirSync } from 'node:fs';
import { chromium, devices, webkit, type Browser, type BrowserContext, type BrowserType, type CDPSession, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5760';
const RUNS = Number(process.env.RUNS ?? 3);
const OUT = new URL('../../docs/status/mobile-audit/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** The last two have a menu scale of exactly 1 held sideways: the case Phaser gets wrong. */
const PHONES = ['iPhone 14 landscape', 'Pixel 7 landscape', 'iPhone 13 Mini landscape', 'iPhone SE landscape'];
const ENGINES: [BrowserType, string][] = [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
];

interface Btn {
  label: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface StageProbe {
  input: boolean;
  screen: string | null;
  resizes: number;
  bounds: Box;
}
declare const window: {
  __cubicButtons?(): Btn[];
  __cubicStage(): StageProbe;
  __clicks: number;
  __prevented: string[];
  visualViewport: { scale: number; width: number; height: number };
  addEventListener(type: string, fn: (e: Event) => void, opts?: unknown): void;
  dispatchEvent(e: Event): boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const problems: string[] = [];
let checks = 0;

interface Session {
  ctx: BrowserContext;
  page: Page;
  /** Chromium only: fingers that stay down, pinches, the page scale. */
  cdp: CDPSession | null;
  tag: string;
}

async function open(browser: Browser, engine: string, phone: string, opts: { upright?: boolean; shorter?: number; loose?: boolean } = {}): Promise<Session> {
  const d = devices[phone]!;
  const land = d.viewport;
  const viewport = opts.upright ? { width: land.height, height: land.width } : opts.shorter ? { width: land.width, height: land.height - opts.shorter } : land;
  const ctx = await browser.newContext({ ...d, viewport });
  const page = await ctx.newPage();
  // tsx names the functions it sends to the page; no browser voice in a test
  await page.addInitScript('window.__name = (f) => f; try { speechSynthesis.speak = () => {}; } catch {}');
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => !!window.__cubicButtons?.().some((b) => b.label === 'PLAY'), undefined, { timeout: 20000 });
  if (opts.loose) {
    // iOS Safari ignores maximum-scale and user-scalable: take them out, so the page has to hold by itself
    await page.evaluate(() => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
      meta.content = meta.content.replace(',maximum-scale=1,user-scalable=no', '');
    });
    await sleep(300);
  }
  return { ctx, page, cdp: engine === 'chromium' ? await ctx.newCDPSession(page) : null, tag: `${engine} ${phone.replace(' landscape', '')}` };
}

/** The stage canvas as the page lays it out, and as Phaser believes it is. */
const measure = (s: Session) =>
  s.page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#cu-stage canvas')!;
    const r = c.getBoundingClientRect();
    return { rect: { x: r.left, y: r.top, width: r.width, height: r.height }, art: c.width, stage: window.__cubicStage(), scale: window.visualViewport.scale };
  });

/** The middle of a button the menu canvas draws, in window pixels. */
async function spot(s: Session, label: string): Promise<{ x: number; y: number }> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const b = (await s.page.evaluate(() => window.__cubicButtons!())).find((x) => x.label === label && x.enabled);
    if (b) {
      const m = await measure(s);
      const k = m.rect.width / m.art;
      return { x: m.rect.x + (b.x + b.width / 2) * k, y: m.rect.y + (b.y + b.height / 2) * k };
    }
    if (Date.now() > deadline) throw new Error(`no button "${label}" (on screen: ${(await s.page.evaluate(() => window.__cubicButtons!())).map((x) => x.label).join(', ')})`);
    await sleep(100);
  }
}

async function reaches(s: Session, screen: string, ms = 3000): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if ((await s.page.evaluate(() => window.__cubicStage().screen)) === screen) return true;
    await sleep(100);
  }
  return false;
}

// ---------- 1. the first tap on PLAY ----------

type Way = 'fresh' | 'turned' | 'toolbar' | 'resize in the tap';
const tally = new Map<string, { ok: number; n: number; stale: number }>();

async function firstTap(browser: Browser, engine: string, phone: string, way: Way, run: number): Promise<void> {
  const land = devices[phone]!.viewport;
  const s = await open(browser, engine, phone, { upright: way === 'turned', shorter: way === 'toolbar' ? 40 : 0 });
  try {
    if (way === 'turned' || way === 'toolbar') {
      await sleep(600); // the page has settled the way it was opened
      await s.page.setViewportSize(land);
      // right after the turn, and after Phaser's own half-second look at its parent
      await sleep(run % 2 ? 250 : 800);
    }
    if (way === 'resize in the tap') {
      // the browser says "resize" (nothing changed size) while the finger is on the button
      await s.page.evaluate(() => window.addEventListener('touchend', () => window.dispatchEvent(new Event('resize')), { capture: true, once: true }));
    }
    const at = await spot(s, 'PLAY');
    const m = await measure(s);
    const near = (a: number, b: number) => Math.abs(a - b) < 0.6;
    const boundsOk = near(m.stage.bounds.x, m.rect.x) && near(m.stage.bounds.y, m.rect.y) && near(m.stage.bounds.width, m.rect.width) && near(m.stage.bounds.height, m.rect.height);
    await s.page.touchscreen.tap(at.x, at.y);
    const ok = await reaches(s, 'mode');
    const key = `${engine} | ${way}`;
    const t = tally.get(key) ?? { ok: 0, n: 0, stale: 0 };
    t.n++;
    if (ok) t.ok++;
    if (!boundsOk) t.stale++;
    tally.set(key, t);
    checks++;
    if (!ok || !boundsOk) {
      problems.push(`${s.tag}, ${way}, run ${run}: ${ok ? 'the tap worked' : 'THE FIRST TAP ON PLAY DID NOTHING'}; Phaser's canvas box ${boundsOk ? 'is right' : `is ${m.stage.bounds.width}x${m.stage.bounds.height}, the canvas is ${m.rect.width}x${m.rect.height}`}`);
      if (!ok) await s.page.screenshot({ path: `${OUT}first-tap-${s.tag.replace(/\W+/g, '-')}-${way.replace(/\W+/g, '-')}.png` });
    }
  } finally {
    await s.ctx.close();
  }
}

// ---------- 2 and 3. zoom ----------

const scaleOf = (s: Session) => s.page.evaluate(() => window.visualViewport.scale);

function expect(s: Session, ok: boolean, what: string): void {
  checks++;
  if (!ok) problems.push(`${s.tag}: ${what}`);
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

async function doubleTap(s: Session, x: number, y: number): Promise<void> {
  await s.page.touchscreen.tap(x, y);
  await sleep(90);
  await s.page.touchscreen.tap(x, y);
  await sleep(400);
}

/** Two fingers moving apart (Chromium). True if it could be sent at all. */
async function pinch(s: Session, x: number, y: number, factor: number): Promise<void> {
  await s.cdp!.send('Input.synthesizePinchGesture', { x: Math.round(x), y: Math.round(y), scaleFactor: factor, gestureSourceType: 'touch', relativeSpeed: 800 });
  await sleep(300);
}

/** Are the events a pinch is made of cancelled? (what an engine without the gesture can still show) */
const guards = (s: Session, selector: string) =>
  s.page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const send = (type: string, touches: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'touches', { value: { length: touches } });
      Object.defineProperty(e, 'changedTouches', { value: [{ clientX: 5, clientY: 5 }] });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    return { gesturestart: send('gesturestart', 2), gesturechange: send('gesturechange', 2), twoFingersDown: send('touchstart', 2), twoFingersMove: send('touchmove', 2) };
  }, selector);

async function middle(s: Session, selector: string): Promise<{ x: number; y: number }> {
  const box = await s.page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${s.tag}: ${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function zoom(browser: Browser, engine: string): Promise<void> {
  const s = await open(browser, engine, 'iPhone 14 landscape', { loose: true });
  console.log(`\n== zoom: ${s.tag} (no scale limits in the viewport meta)`);
  try {
    await s.page.evaluate(() => {
      window.__clicks = 0;
      document.addEventListener('click', () => window.__clicks++, true);
    });
    // --- the title ---
    await doubleTap(s, 40, 120); // the sky, on the canvas
    expect(s, (await scaleOf(s)) === 1, 'title: a double tap on the canvas does not zoom');
    const gear = await middle(s, '#cu-gear');
    await doubleTap(s, gear.x, gear.y);
    expect(s, (await scaleOf(s)) === 1, 'title: a double tap on a DOM button does not zoom');
    // (the first tap opens the settings, the second lands on what is there now: both are clicks)
    expect(s, (await s.page.evaluate(() => window.__clicks)) === 2, `title: both taps of a double tap are still clicks (${await s.page.evaluate(() => window.__clicks)})`);
    if (await s.page.evaluate(() => !!document.querySelector('#cu-settings.on'))) {
      const close = await middle(s, '#cu-settings [data-close]');
      await sleep(500); // (not a third tap of the same double tap)
      await s.page.touchscreen.tap(close.x, close.y);
    }
    await sleep(300);
    expect(s, await s.page.evaluate(() => !document.querySelector('.cu-modal.on')), 'title: the settings are closed again');
    const g = await guards(s, '.cu');
    expect(s, g.gesturestart && g.gesturechange && g.twoFingersDown && g.twoFingersMove, `title: the pinch events are cancelled (${JSON.stringify(g)})`);
    if (s.cdp) {
      await pinch(s, 375, 120, 2);
      expect(s, (await scaleOf(s)) === 1, 'title: a pinch does not zoom');
    }

    // --- a tap right beside PLAY and then PLAY, a double tap to a phone: PLAY is still pressed ---
    const play = await spot(s, 'PLAY');
    await s.page.touchscreen.tap(play.x, play.y - 40);
    await sleep(80);
    await s.page.touchscreen.tap(play.x, play.y);
    expect(s, await reaches(s, 'mode'), 'title: PLAY as the second tap of a double tap is not eaten');
    await sleep(1600);

    // --- into a solo game ---
    for (const label of ['PLAY SOLO', 'OUTSIDE']) {
      const at = await spot(s, label);
      await s.page.touchscreen.tap(at.x, at.y);
      await sleep(500);
    }
    await s.page.waitForSelector('.cu[data-screen="game"]', { timeout: 15000 });
    await sleep(2500);
    const view = await middle(s, '#game canvas');
    await s.page.touchscreen.tap(view.x, view.y); // (the side card closes on any press)
    await sleep(300);
    for (const [name, sel] of [['the game view', '#game canvas'], ['USE', '[data-m="interact"]'], ['the d-pad', '[data-m="pad"]'], ['MAP', '[data-m="map"]']] as const) {
      const at = await middle(s, sel);
      await doubleTap(s, at.x, at.y);
      expect(s, (await scaleOf(s)) === 1, `game: a double tap on ${name} does not zoom`);
      if (s.cdp) {
        await pinch(s, at.x, at.y, 2);
        expect(s, (await scaleOf(s)) === 1, `game: a pinch on ${name} does not zoom`);
      }
    }
    if (await s.page.evaluate(() => document.querySelector('[data-m="map"]')!.classList.contains('lit'))) await s.page.touchscreen.tap((await middle(s, '[data-m="map"]')).x, (await middle(s, '[data-m="map"]')).y);
    const g2 = await guards(s, '[data-m="pad"]');
    expect(s, g2.gesturestart && g2.twoFingersDown && g2.twoFingersMove, `game: the pinch events are cancelled (${JSON.stringify(g2)})`);

    if (s.cdp) {
      // two thumbs at once are still two controls (only the browser's own pinch is cancelled)
      const pad = await s.page.locator('[data-m="pad"]').boundingBox();
      const use = await middle(s, '[data-m="interact"]');
      const left = { x: Math.round(pad!.x + pad!.width * 0.16), y: Math.round(pad!.y + pad!.height / 2), id: 1 };
      const right = { x: Math.round(use.x), y: Math.round(use.y), id: 2 };
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] });
      await sleep(60);
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
      await sleep(60);
      const both = await s.page.evaluate(() => ({ pad: document.querySelector<HTMLElement>('[data-m="pad"]')!.dataset.dir, use: document.querySelector('[data-m="interact"]')!.classList.contains('on') }));
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(200);
      expect(s, both.pad === 'left' && both.use, `game: the d-pad and USE work under two thumbs at once (${JSON.stringify(both)})`);
    }

    // --- text fields and panels still work ---
    const chat = await middle(s, '[data-m="chat"]');
    await s.page.touchscreen.tap(chat.x, chat.y);
    await sleep(300);
    expect(s, await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.m === 'field'), 'chat: a tap on CHAT puts the cursor in the field');
    await s.page.keyboard.type('hi');
    const field = await middle(s, '[data-m="field"]');
    await doubleTap(s, field.x, field.y); // (a double tap in a field selects a word: it stays the field's)
    expect(s, await s.page.evaluate(() => document.querySelector<HTMLInputElement>('[data-m="field"]')!.value === 'hi' && (document.activeElement as HTMLElement | null)?.dataset.m === 'field'), 'chat: the field takes typing and keeps the focus through a double tap');
    expect(s, (await scaleOf(s)) === 1, 'chat: the page did not zoom');
    const x = await middle(s, '[data-m="x"]');
    await s.page.touchscreen.tap(x.x, x.y);
    await sleep(200);
    const one = await s.page.evaluate(() => {
      // one finger in a panel that scrolls is not cancelled (the log, a settings panel)
      const log = document.querySelector('.cu-log')!;
      const e = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'touches', { value: { length: 1 } });
      log.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(s, !one, 'a one-finger drag in a list that scrolls is left to the browser');

    // --- zoomed anyway ---
    if (s.cdp) {
      const before = await measure(s);
      const vw = await s.page.evaluate(() => getComputedStyle(document.querySelector('.cu')!).getPropertyValue('--vw'));
      await s.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      await sleep(500);
      const zoomed = await measure(s);
      expect(s, zoomed.scale === 2, `the page scale was forced to x2 (is x${zoomed.scale})`);
      expect(s, await s.page.evaluate(() => document.documentElement.hasAttribute('data-zoomed')), 'zoomed: the page knows (html[data-zoomed])');
      expect(s, zoomed.rect.width === before.rect.width && zoomed.rect.height === before.rect.height && (await s.page.evaluate(() => getComputedStyle(document.querySelector('.cu')!).getPropertyValue('--vw'))) === vw, 'zoomed: the layout kept its size');
      const g3 = await guards(s, '.cu');
      expect(s, !g3.gesturestart && !g3.twoFingersDown && !g3.twoFingersMove, 'zoomed: two fingers are let through, to zoom back out');
      const free = await s.page.evaluate(() => {
        const action = (sel: string) => getComputedStyle(document.querySelector(sel)!).touchAction;
        return { html: action('html'), cu: action('.cu'), pad: action('[data-m="pad"]'), canvas: getComputedStyle(document.querySelector('#game canvas')!).pointerEvents };
      });
      expect(s, free.html === 'auto' && free.cu === 'auto' && free.pad === 'auto' && free.canvas === 'none', `zoomed: the CSS lets go too (${JSON.stringify(free)})`);
      // (a scale forced through CDP is pinned: the pinch back out itself cannot be driven here)
      await s.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await sleep(500);
      expect(s, (await scaleOf(s)) === 1, 'the page scale is back at x1');
      expect(s, !(await s.page.evaluate(() => document.documentElement.hasAttribute('data-zoomed'))), 'back at x1: the page is locked again');
      await pinch(s, 375, 170, 2);
      expect(s, (await scaleOf(s)) === 1, 'back at x1: a pinch does not zoom');
      const after = await measure(s);
      expect(s, after.rect.width === before.rect.width && after.rect.height === before.rect.height, 'back at x1: the layout is what it was');
    }
  } catch (e) {
    problems.push(`${s.tag}: zoom: ${(e as Error).message}`);
    await s.page.screenshot({ path: `${OUT}zoom-${engine}-error.png` });
  } finally {
    await s.ctx.close();
  }
}

// ---------- run ----------
const parts = process.argv.slice(2);
const want = (part: string) => parts.length === 0 || parts.includes(part);

for (const [type, engine] of ENGINES) {
  const browser = await type.launch({ headless: true, args: engine === 'chromium' ? ['--mute-audio'] : [] });
  if (want('tap')) {
    for (const way of ['fresh', 'turned', 'toolbar', 'resize in the tap'] as Way[]) {
      for (const phone of PHONES) for (let run = 0; run < RUNS; run++) await firstTap(browser, engine, phone, way, run);
      const t = tally.get(`${engine} | ${way}`)!;
      console.log(`${engine.padEnd(8)} first tap, ${way.padEnd(17)}: ${t.ok}/${t.n} reached the mode screen, Phaser's canvas box wrong in ${t.stale}`);
    }
  }
  if (want('zoom')) await zoom(browser, engine);
  await browser.close();
}

console.log(`\n${checks} checks, ${problems.length} problems`);
for (const p of problems) console.log(' -', p);
process.exit(problems.length ? 1 : 0);
