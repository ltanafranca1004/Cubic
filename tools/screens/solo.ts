// PLAY SOLO in a real browser: the mode screen with its three choices, the side popup, the
// popup put back after a resize (and after a rotation on a touch screen), the first frame
// of a solo game from each side, and Leave / CONTINUE LAST GAME. Screenshots go to
// docs/status/puzzles/solo-*.png.
//
//   servers (never with real keys):
//     AI_FAKE=1 TTS_MODE=browser PORT=3413 npm start -w server
//     VITE_SERVER_URL=http://localhost:3413 npm run dev -w client -- --port 5513
//   run:  cd tools && npx tsx screens/solo.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5513';
const OUT = new URL('../../docs/status/puzzles/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Btn = { label: string; enabled: boolean; focused: boolean; x: number; y: number; width: number; height: number };
type Draft = { kind: 'join'; code: string } | { kind: 'solo'; focus: string } | null;
type Seats = Record<'out' | 'in', { taken: boolean; connected: boolean; isAI: boolean; away?: unknown }>;
interface Cubic {
  code: string | null;
  side: 'out' | 'in' | null;
  room: { mode: string; phase: string; seats: Seats } | null;
  state: { solved: number[]; startedAt: number } | null;
  chat: { isAI: boolean; text: string }[];
}
declare const window: { __cubic: Cubic; __cubicButtons(): Btn[]; __cubicPopup(): Draft };
declare const document: {
  querySelector(s: string): { dataset: Record<string, string>; hidden: boolean; textContent: string | null; getBoundingClientRect(): { left: number; top: number; width: number }; width: number } | null;
};

const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
const buttons = (page: Page) => page.evaluate(() => window.__cubicButtons());
const labels = async (page: Page) => (await buttons(page)).map((b) => b.label).sort().join('|');
const popup = (page: Page) => page.evaluate(() => window.__cubicPopup());
const screenOf = (page: Page) => page.evaluate(() => document.querySelector('.cu')?.dataset.screen ?? '');
const text = (page: Page, sel: string) => page.evaluate((s) => { const e = document.querySelector(s); return e && !e.hidden ? (e.textContent ?? '') : ''; }, sel);
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: `${OUT}solo-${name}.png` });
  console.log('   shot:', `solo-${name}.png`);
};
async function expect(what: string, cond: () => Promise<boolean>, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) {
      problems.push(what);
      console.log('   FAIL:', what);
      return;
    }
    await sleep(100);
  }
  console.log('   ok:', what);
}
async function pressButton(page: Page, label: string, how: 'mouse' | 'touch'): Promise<void> {
  const b = (await buttons(page)).find((x) => x.label === label);
  if (!b || !b.enabled) throw new Error(`no enabled button "${label}" (have: ${await labels(page)})`);
  const at = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / c.width };
  });
  const x = at.left + (b.x + b.width / 2) * at.scale;
  const y = at.top + (b.y + b.height / 2) * at.scale;
  if (how === 'touch') await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await sleep(40);
    await page.mouse.up();
  }
  await sleep(350);
}
const keys = async (page: Page, ...list: string[]) => {
  for (const k of list) {
    await page.keyboard.press(k);
    await sleep(150);
  }
};

const MODE = 'BACK|CREATE LOBBY|JOIN LOBBY|PLAY SOLO';
const POPUP = 'BACK|CANCEL|CREATE LOBBY|INSIDE|JOIN LOBBY|OUTSIDE|PLAY SOLO';

async function open(browser: Browser, size: { width: number; height: number }, touch: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, deviceScaleFactor: touch ? 3 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/?renderer=canvas${touch ? '&touch' : ''}`);
  await expect('the title screen', async () => (await labels(page)) === 'PLAY');
  if (touch) await pressButton(page, 'PLAY', 'touch');
  else await keys(page, 'Enter');
  await expect('the mode screen has three choices and Back', async () => (await labels(page)) === MODE && (await buttons(page)).every((b) => b.enabled), 8000);
  await sleep(1200); // the choices have landed
  return page;
}

async function desktop(browser: Browser): Promise<void> {
  console.log('desktop 1280x720');
  const page = await open(browser, { width: 1280, height: 720 }, false);
  await shot(page, 'mode-desktop');

  // keyboard: the third press of Down is PLAY SOLO, like the other two
  await keys(page, 'ArrowDown', 'ArrowDown', 'ArrowDown');
  await expect('three presses of Down focus PLAY SOLO', async () => (await buttons(page)).find((b) => b.focused)?.label === 'PLAY SOLO');
  await shot(page, 'mode-desktop-focus');
  await keys(page, 'Enter');
  await expect('Enter opens the side popup, on OUTSIDE', async () => (await labels(page)) === POPUP && JSON.stringify(await popup(page)) === '{"kind":"solo","focus":"out"}');
  await sleep(500);
  await shot(page, 'popup');

  // the resize: the popup is put back with the focus where it was
  await keys(page, 'ArrowRight');
  await expect('Right moves to INSIDE', async () => (await popup(page))?.kind === 'solo' && (await buttons(page)).find((b) => b.focused)?.label === 'INSIDE');
  await page.setViewportSize({ width: 960, height: 600 });
  await sleep(900);
  await expect('after a resize the popup is still up, on INSIDE', async () => (await labels(page)) === POPUP && JSON.stringify(await popup(page)) === '{"kind":"solo","focus":"in"}' && (await buttons(page)).find((b) => b.focused)?.label === 'INSIDE');
  await expect('the menu behind it is still disabled', async () => (await buttons(page)).filter((b) => MODE.split('|').includes(b.label)).every((b) => !b.enabled));
  await shot(page, 'popup-resized');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(900);
  await keys(page, 'ArrowDown');
  await expect('keys still work in it after two resizes (Down reaches CANCEL)', async () => (await popup(page) as { focus?: string } | null)?.focus === 'cancel');
  await keys(page, 'Escape');
  await expect('Esc closes it', async () => (await popup(page)) === null && (await labels(page)) === MODE);
  await page.setViewportSize({ width: 1100, height: 700 });
  await sleep(900);
  await expect('a resize does not re-open the cancelled popup', async () => (await popup(page)) === null && (await labels(page)) === MODE);
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(900);

  // mouse: PLAY SOLO, OUTSIDE: straight into the game, no lobby
  await pressButton(page, 'PLAY SOLO', 'mouse');
  await expect('a click opens the popup', async () => (await popup(page))?.kind === 'solo');
  await sleep(400);
  await pressButton(page, 'OUTSIDE', 'mouse');
  await expect('OUTSIDE: in the game outside, the AI inside, no lobby', async () => {
    const room = await net(page, (c) => c.room);
    return (await screenOf(page)) === 'game' && (await net(page, (c) => c.side)) === 'out' && room?.mode === 'ai' && room.seats.in.isAI && !room.seats.out.isAI;
  });
  await sleep(1500);
  await shot(page, 'game-outside');
  const code = (await net(page, (c) => c.code))!;
  await expect('the HUD shows no room code and no banner', async () => !(await page.evaluate((c) => document.querySelector('.cu')!.textContent!.includes(c), code)) && (await text(page, '#cu-room-v')) === 'AI' && (await text(page, '#cu-banner')) === '');

  // Leave: back on the mode screen, and the popup offers the held game
  await sleep(3000);
  const lines = await net(page, (c) => c.chat.filter((m) => m.isAI).length);
  await page.evaluate(() => (document.querySelector('#cu-leave') as unknown as { click(): void }).click());
  await sleep(300);
  if ((await screenOf(page)) === 'game') await keys(page, 'Enter'); // a confirm, if Leave asks
  await expect('Leave goes back to the mode screen', async () => (await labels(page)) === MODE && !(await net(page, (c) => c.code)), 8000);
  await sleep(600);
  await keys(page, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await expect('the popup offers CONTINUE LAST GAME', async () => (await buttons(page)).some((b) => b.label === 'CONTINUE LAST GAME' && b.enabled));
  await sleep(500);
  await shot(page, 'popup-continue');
  await keys(page, 'ArrowDown');
  await page.setViewportSize({ width: 1000, height: 640 });
  await sleep(900);
  await expect('a resize keeps the focus on CONTINUE LAST GAME', async () => (await buttons(page)).find((b) => b.focused)?.label === 'CONTINUE LAST GAME');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(900);
  await keys(page, 'Enter');
  await expect('CONTINUE: the same room, the same side, the AI still there', async () => {
    const room = await net(page, (c) => c.room);
    return (await screenOf(page)) === 'game' && (await net(page, (c) => c.code)) === code && (await net(page, (c) => c.side)) === 'out' && !!room?.seats.in.isAI && room.seats.in.connected;
  });
  const after = await net(page, (c) => c.chat.filter((m) => m.isAI).length);
  if (after < lines) problems.push(`the chat lost AI lines over Leave and CONTINUE (${lines} -> ${after})`);
  await page.context().close();

  // keyboard, the other side
  const b = await open(browser, { width: 1280, height: 720 }, false);
  await keys(b, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await sleep(500);
  await keys(b, 'ArrowRight', 'Enter');
  await expect('INSIDE by keyboard: in the game inside, the AI outside', async () => {
    const room = await net(b, (c) => c.room);
    return (await screenOf(b)) === 'game' && (await net(b, (c) => c.side)) === 'in' && room?.mode === 'ai' && room.seats.out.isAI;
  });
  await sleep(1500);
  await shot(b, 'game-inside');
  await b.context().close();
}

async function phone(browser: Browser): Promise<void> {
  console.log('phone 844x390, touch');
  const page = await open(browser, { width: 844, height: 390 }, true);
  await shot(page, 'mode-phone');
  await pressButton(page, 'PLAY SOLO', 'touch');
  await expect('a tap opens the side popup', async () => (await popup(page))?.kind === 'solo' && (await labels(page)) === POPUP);
  await sleep(500);
  await shot(page, 'popup-phone');
  // a slightly different landscape size (a toolbar going away): the one re-fit rebuilds the scene
  await page.setViewportSize({ width: 800, height: 360 });
  await sleep(900);
  await expect('the popup is still up after the re-fit', async () => (await popup(page))?.kind === 'solo' && (await labels(page)) === POPUP);
  await shot(page, 'popup-phone-resized');
  await pressButton(page, 'INSIDE', 'touch');
  await expect('a tap on INSIDE starts the game inside', async () => (await screenOf(page)) === 'game' && (await net(page, (c) => c.side)) === 'in');
  await sleep(1500);
  await shot(page, 'game-phone-inside');
  await page.context().close();
}

const browser = await chromium.launch();
try {
  await desktop(browser);
  await phone(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('\nsolo: all good');
