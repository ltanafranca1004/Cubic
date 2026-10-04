// End-to-end check of the menus with a real MOUSE, in both Phaser renderers (WebGL and
// the Canvas fallback used when a browser has no WebGL) and at two window sizes.
// It fails on any console error, any button that is missing, invisible or dead, and any
// step that does not end where it should.
//
//   needs:  npm run dev (server :3001, client :5173)      BASE overrides the client URL
//   run:    cd tools && npx tsx screens/check.ts
//
// Screenshots go to docs/screens/check/.
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = new URL('../../docs/screens/check/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

interface Btn {
  label: string;
  enabled: boolean;
  alpha: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Cubic {
  code: string | null;
  role: string | null;
  error: string | null;
  room: { phase: string } | null;
}
declare const window: { __cubic: Cubic; __cubicButtons(): Btn[] };

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};

async function open(browser: Browser, size: { width: number; height: number }, query: string, tag: string): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${tag}: console error: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1500);
  return page;
}

const buttons = (page: Page) => page.evaluate(() => window.__cubicButtons());
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
const screenOf = (page: Page) => page.evaluate(() => (document.querySelector('.cu') as unknown as { dataset: { screen: string } }).dataset.screen);

/** Click a canvas button by its label with the mouse. Fails if it is not there to click. */
async function click(page: Page, label: string, tag: string): Promise<boolean> {
  const b = (await buttons(page)).find((x) => x.label === label);
  if (!b) return fail(`${tag}: no "${label}" button on screen`), false;
  if (!b.enabled) return fail(`${tag}: "${label}" is disabled`), false;
  if (b.alpha < 0.99) return fail(`${tag}: "${label}" is not fully visible (alpha ${b.alpha.toFixed(2)})`), false;
  const at = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / c.width };
  });
  const x = at.left + (b.x + b.width / 2) * at.scale;
  const y = at.top + (b.y + b.height / 2) * at.scale;
  await page.mouse.move(x, y);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  return true;
}

async function expect(tag: string, what: string, cond: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return fail(`${tag}: expected ${what}`), false;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('   ok:', what);
  return true;
}

/** Is the button drawn as a solid panel? (Samples the canvas: a missing panel reads as the page behind it.) */
async function hasPanel(page: Page, label: string): Promise<boolean> {
  const b = (await buttons(page)).find((x) => x.label === label);
  if (!b) return false;
  const shot = await page.screenshot({ clip: await page.evaluate((r) => {
    const c = document.querySelector('canvas')!;
    const box = c.getBoundingClientRect();
    const s = box.width / c.width;
    return { x: box.left + (r.x + 3) * s, y: box.top + (r.y + 4) * s, width: 4, height: 4 };
  }, b) });
  // decode one pixel through the page (no PNG library needed here)
  const [r, g, bl] = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, shot.toString('base64'));
  return !(r! > 240 && g! > 240 && bl! > 240); // not white: there is a panel there
}

async function run(browser: Browser, size: { width: number; height: number }, renderer: 'webgl' | 'canvas'): Promise<void> {
  const tag = `${size.width}x${size.height} ${renderer}`;
  const q = renderer === 'canvas' ? '?renderer=canvas' : '';
  const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${size.width}-${renderer}-${name}.png` });
  console.log(`\n${tag}`);

  const a = await open(browser, size, q, `${tag} host`);
  const actual = await a.evaluate(() => {
    const c = document.querySelector('canvas')!;
    return c.getContext('2d') ? 'canvas' : 'webgl';
  });
  if (actual !== renderer) fail(`${tag}: wanted the ${renderer} renderer, got ${actual}`);
  await shot(a, '1-start');

  // Play, with the mouse; then twice more mid-dive, which must not break anything
  await click(a, 'PLAY', tag);
  await a.waitForTimeout(250);
  await a.mouse.click(size.width / 2, size.height / 2);
  await a.mouse.click(size.width / 2, size.height / 2);
  await a.waitForTimeout(2200);
  await shot(a, '2-mode');
  const labels = (await buttons(a)).map((b) => b.label);
  if (labels.join('|') !== 'BACK|CREATE LOBBY|JOIN LOBBY') fail(`${tag}: mode screen buttons are [${labels.join(', ')}]`);
  for (const label of ['CREATE LOBBY', 'JOIN LOBBY']) if (!(await hasPanel(a, label))) fail(`${tag}: "${label}" has no solid panel`);

  // Back (the button, then Esc) returns to the title; a second press mid-fade must not break anything
  await click(a, 'BACK', tag);
  await a.mouse.down();
  await a.mouse.up();
  await expect(tag, 'Back on the mode screen goes back to the title', async () => (await buttons(a)).some((b) => b.label === 'PLAY'));
  await a.waitForTimeout(600);
  await click(a, 'PLAY', tag);
  await a.waitForTimeout(2200);
  await a.keyboard.press('Escape');
  await expect(tag, 'Esc on the mode screen goes back to the title', async () => (await buttons(a)).some((b) => b.label === 'PLAY'));
  await a.waitForTimeout(600);
  await click(a, 'PLAY', tag);
  await a.waitForTimeout(2200);
  // Esc with the settings open closes the settings only
  await a.locator('#cu-gear').click();
  await a.waitForTimeout(400);
  await a.keyboard.press('Escape');
  await a.waitForTimeout(600);
  if (await a.evaluate(() => !!document.querySelector('#cu-settings.on'))) fail(`${tag}: Esc does not close the settings panel`);
  if (!(await buttons(a)).some((b) => b.label === 'CREATE LOBBY')) fail(`${tag}: the Esc that closed settings also left the mode screen`);

  // Join Lobby opens the popup; a wrong code is refused; Cancel closes it
  await click(a, 'JOIN LOBBY', tag);
  await a.waitForTimeout(500);
  await expect(tag, 'the join popup opens', async () => (await buttons(a)).some((b) => b.label === 'CANCEL'));
  await a.keyboard.type('zzzz');
  await click(a, 'JOIN', tag);
  await expect(tag, 'a wrong code is refused', async () => /not found/i.test((await net(a, (c) => c.error)) ?? ''));
  await a.waitForTimeout(500);
  await shot(a, '3-join-wrong-code');
  await click(a, 'CANCEL', tag);
  await a.waitForTimeout(400);

  // Create Lobby goes to side select
  await click(a, 'CREATE LOBBY', tag);
  await expect(tag, 'Create Lobby makes a room', async () => !!(await net(a, (c) => c.code)));
  const code = (await net(a, (c) => c.code))!;
  await a.waitForTimeout(900);
  await shot(a, '4-side-select-host');

  // a second client joins with the code through the popup
  const b = await open(browser, size, q, `${tag} guest`);
  await click(b, 'PLAY', tag);
  await b.waitForTimeout(2200);
  await click(b, 'JOIN LOBBY', tag);
  await b.waitForTimeout(500);
  await b.keyboard.type(code.toLowerCase());
  await b.waitForTimeout(200);
  await shot(b, '5-join-typed');
  await click(b, 'JOIN', tag);
  await expect(tag, 'the guest joins with the code', async () => (await net(b, (c) => c.role)) === 'guest');
  await b.waitForTimeout(900);

  // pick sides, ready, start
  await a.keyboard.press('a');
  await b.keyboard.press('d');
  await b.waitForTimeout(400);
  await click(b, 'READY', tag);
  await a.waitForTimeout(600);
  await shot(a, '6-side-select-ready-host');
  await shot(b, '6-side-select-ready-guest');
  await click(a, 'START', tag);
  await expect(tag, 'the host starts the game for both', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game');
  await a.waitForTimeout(1200);
  await shot(a, '7-game-outside');
  await shot(b, '7-game-inside');

  // settings open from the gear in game
  await a.locator('#cu-gear').click();
  await a.waitForTimeout(400);
  await shot(a, '8-settings');
  await a.keyboard.press('Escape');

  await a.close();
  await b.close();
}

const browser = await chromium.launch();
try {
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    for (const renderer of ['webgl', 'canvas'] as const) await run(browser, size, renderer);
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nall clean');
