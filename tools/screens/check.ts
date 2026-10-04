// End-to-end check of the menus with a real MOUSE, in both Phaser renderers (WebGL and
// the Canvas fallback used when a browser has no WebGL) and at two window sizes.
// It fails on any console error, any button that is missing, invisible or dead, and any
// step that does not end where it should. It also checks that no click on a DOM overlay
// (settings, pause, chat) reaches a canvas button behind it, and that the side select
// heroes land back where they started however fast the sides are switched.
// Before that it resizes the window in the middle of every screen transition (the dive,
// the fade to side select, the fade into the game and the fade back out), which must
// never leave the menus stuck between two screens. First of all it loads the page cold and
// touches nothing: only the menu track (one format) may be downloaded before the first click.
// heroes land back where they started however fast the sides are switched. And that no
// click on a DOM overlay reaches another DOM control under it either: the veil over the
// gear or LEAVE, the controls tab, the side card's GOT IT, COPY, the win screen.
//
//   one of the four runs:  SIZE=1920 RENDERER=webgl npx tsx screens/check.ts
//
//   needs:  npm run dev (server :3001, client :5173)      BASE overrides the client URL
//   run:    cd tools && npx tsx screens/check.ts            (add "resize" for the resize steps only)
//   other ports:  PORT=3340 AI_FAKE=1 npm run dev -w server
//                 VITE_SERVER_URL=http://localhost:3340 npm run dev -w client -- --port 5440
//                 cd tools && BASE=http://localhost:5440 npx tsx screens/check.ts
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
  online: boolean;
  blocked: boolean;
  code: string | null;
  role: string | null;
  error: string | null;
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null } | null> } | null;
}
interface Spot {
  x: number;
  y: number;
}
interface StageProbe {
  /** Is the stage's Phaser input on? (Off while a DOM overlay owns the pointer.) */
  input: boolean;
  /** Time stamp of the last press the stage's Phaser input saw. */
  lastDown: number;
}
declare const navigator: { clipboard: { readText(): Promise<string> } };
declare const window: { __cubicJoinCode(): string | null; __cubicModeStatus(): string; __cubic: Cubic; __cubicButtons(): Btn[]; __cubicStage(): StageProbe; __cubicHeroes(): { out: Spot; in: Spot } };

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};

async function open(browser: Browser, size: { width: number; height: number }, query: string, tag: string): Promise<Page> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
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

const stage = (page: Page) => page.evaluate(() => window.__cubicStage());
const heroes = (page: Page) => page.evaluate(() => window.__cubicHeroes());
const labelsOf = async (page: Page) => (await buttons(page)).map((b) => b.label).join('|');
/** The letters in the join popup's code boxes, or null when the popup is not open. */
const joinCode = (page: Page) => page.evaluate(() => window.__cubicJoinCode());
/** The line under the mode screen's panel (connecting, an error, or nothing). */
const statusLine = (page: Page) => page.evaluate(() => window.__cubicModeStatus());
/** Paste text into the page, as Ctrl/Cmd+V does (a real `paste` event with clipboard data). */
const paste = (page: Page, text: string) =>
  page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
const settingsOpen = (page: Page) => page.evaluate(() => !!document.querySelector('#cu-settings.on'));

/** Art pixels on the stage canvas to window pixels. */
async function toWindow(page: Page, x: number, y: number): Promise<Spot> {
  const at = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / c.width };
  });
  return { x: at.left + x * at.scale, y: at.top + y * at.scale };
}

/** The middle of a DOM element, in window pixels. */
async function middle(page: Page, selector: string): Promise<Spot> {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real mouse click: move there, press, let go. */
async function mouseClick(page: Page, at: Spot): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/**
 * A point inside a canvas button that the open settings modal covers with something a
 * click does not change: plain panel ("panel") or the veil around it ("veil", which closes
 * the settings). Null if the button is not covered by either.
 */
async function coveredSpot(page: Page, b: Btn): Promise<(Spot & { over: 'panel' | 'veil' }) | null> {
  for (let fy = 0.5; fy < 1; fy += 0.2) {
    for (let fx = 0.1; fx < 1; fx += 0.1) {
      const at = await toWindow(page, b.x + b.width * fx, b.y + b.height * fy);
      const over = await page.evaluate((p) => {
        const modal = document.querySelector('#cu-settings');
        const hit = document.elementFromPoint(p.x, p.y);
        if (!modal || !hit || !modal.contains(hit)) return null;
        if (hit === modal) return 'veil';
        return hit.closest('button, input, [role="slider"], [role="switch"], [role="radio"], [tabindex], .cu-slider, .cu-toggle, .cu-choice') ? null : 'panel';
      }, at);
      if (over) return { ...at, over };
    }
  }
  return null;
}

/**
 * With the settings open over the mode screen, click with the mouse on DONE and on the
 * spots of the modal that sit right over each canvas button. Nothing behind may react.
 */
async function settingsBlockClicks(page: Page, tag: string): Promise<void> {
  const want = await labelsOf(page);
  const unchanged = async (what: string, before: StageProbe) => {
    await page.waitForTimeout(700);
    const after = await stage(page);
    if (after.lastDown !== before.lastDown) fail(`${tag}: ${what}: the click reached the canvas behind the settings`);
    if ((await labelsOf(page)) !== want) fail(`${tag}: ${what}: the screen behind changed to [${await labelsOf(page)}]`);
    if (await net(page, (c) => c.code)) fail(`${tag}: ${what}: a room was created behind the settings`);
  };
  const openSettings = async () => {
    if (await settingsOpen(page)) return;
    await page.locator('#cu-gear').click();
    await page.waitForTimeout(300);
    if ((await stage(page)).input) fail(`${tag}: the stage still takes pointer input with the settings open`);
  };

  await openSettings();
  let before = await stage(page);
  await mouseClick(page, await middle(page, '#cu-settings [data-close]'));
  await page.waitForTimeout(100);
  if (await settingsOpen(page)) fail(`${tag}: DONE did not close the settings`);
  await unchanged('DONE in settings', before);
  if (!(await stage(page)).input) fail(`${tag}: the stage input did not come back after the settings closed`);

  let tested = 0;
  for (const b of await buttons(page)) {
    await openSettings();
    const spot = await coveredSpot(page, b);
    if (!spot) continue;
    tested++;
    before = await stage(page);
    await mouseClick(page, spot);
    await unchanged(`a click on the settings ${spot.over} over "${b.label}"`, before);
  }
  if (!tested) fail(`${tag}: no canvas button sits under the settings modal, nothing was checked`);
  if (await settingsOpen(page)) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log(`   ok: no click passes through the settings to the menu (${tested} buttons behind it)`);
}

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

/**
 * A cold load with no interaction: of the audio, only the menu track is requested, in one
 * format. The other tracks start downloading with the first click or key, in the background.
 */
async function coldLoad(browser: Browser): Promise<void> {
  const tag = 'cold load';
  console.log(`\n${tag}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }); // its own empty cache
  const page = await context.newPage();
  const audio: string[] = [];
  page.on('request', (r) => {
    const at = r.url().indexOf('/assets/audio/');
    if (at >= 0) audio.push(r.url().slice(at + '/assets/audio/'.length).split('?')[0]!);
  });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(6000); // long enough for a background queue to have moved on
  const before = [...audio];
  if (before.length !== 1 || !/^music-menu\.(ogg|mp3)$/.test(before[0]!)) fail(`${tag}: audio requested before the first click: [${before.join(', ')}] (want the menu track only, one format)`);
  else console.log(`   ok: before the first click the only audio request is ${before[0]}`);
  await page.keyboard.press('Enter');
  const music = () => audio.filter((f) => /^music-(lobby|outside|inside)\./.test(f));
  await expect(tag, 'the other three tracks are fetched after the first key press', async () => music().length === 3, 20_000);
  if (new Set(music().map((f) => f.split('.')[1])).size !== 1) fail(`${tag}: the tracks were fetched in more than one format: [${music().join(', ')}]`);
  await context.close();
}

/**
 * The server is up but refuses this site (a wrong CLIENT_ORIGIN on the server): /health
 * answers "originAllowed: false" and every socket handshake fails. The menus must say so,
 * not "waking the server", and must connect by themselves once it is put right.
 */
async function blockedOrigin(browser: Browser): Promise<void> {
  const tag = 'blocked origin';
  console.log(`\n${tag}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/health', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, rooms: 0, originAllowed: false }) }));
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.goto(`${BASE}/?renderer=canvas`);
  await expect(tag, 'the client knows it is blocked, not waiting for a cold start', () => page.evaluate(() => !window.__cubic.online && window.__cubic.blocked), 10_000);
  await expect(tag, 'the title is up', async () => (await labelsOf(page)) === 'PLAY', 15_000);
  await page.keyboard.press('Enter');
  await expect(tag, 'Play still works', async () => (await buttons(page)).some((b) => b.label === 'CREATE LOBBY'), 10_000);
  await page.waitForTimeout(1500);
  const line = await statusLine(page);
  if (!/CLIENT_ORIGIN/.test(line) || /WAKING/.test(line)) fail(`${tag}: the mode screen says "${line}"`);
  else console.log(`   ok: the mode screen says "${line}"`);
  if ((await buttons(page)).some((b) => b.label === 'CREATE LOBBY' && b.enabled)) fail(`${tag}: Create Lobby is enabled with no server`);

  // put right: the socket's own retries get through, and the message goes
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.routeWebSocket(/socket\.io/, (ws) => void ws.connectToServer());
  await expect(tag, 'it connects by itself once the server allows the site', () => page.evaluate(() => window.__cubic.online && !window.__cubic.blocked), 20_000);
  await expect(tag, 'the message is gone and Create Lobby works', async () => (await statusLine(page)) === '' && (await buttons(page)).some((b) => b.label === 'CREATE LOBBY' && b.enabled));
  await page.close();
}

/**
 * Resize the window again and again for `ms`, as dragging its edge or going fullscreen
 * does, and end on the size it started with.
 */
async function resizeStorm(page: Page, size: { width: number; height: number }, ms: number): Promise<void> {
  const small = { width: size.width - 160, height: size.height - 90 };
  const end = Date.now() + ms;
  for (let i = 0; Date.now() < end; i++) {
    await page.setViewportSize(i % 2 ? size : small);
    await page.waitForTimeout(50);
  }
  await page.setViewportSize(size);
}

/**
 * The window is resized in the middle of every screen transition. Each one must still end
 * on the screen it was heading for, with the keyboard and the mouse working there.
 */
async function resizeMidTransition(browser: Browser, size: { width: number; height: number }, renderer: 'webgl' | 'canvas'): Promise<void> {
  const tag = `${size.width}x${size.height} ${renderer} resize`;
  const q = renderer === 'canvas' ? '?renderer=canvas' : '';
  const MODE = 'BACK|CREATE LOBBY|JOIN LOBBY';
  const a = await open(browser, size, q, `${tag} host`);

  // during the dive after Play
  await click(a, 'PLAY', tag);
  await a.waitForTimeout(150);
  await resizeStorm(a, size, 700);
  await expect(tag, 'a resize during the dive still lands on the mode screen', async () => (await labelsOf(a)) === MODE, 6000);
  await a.waitForTimeout(400);
  await a.keyboard.press('Escape');
  await expect(tag, 'Esc works after it (back to the title)', async () => (await labelsOf(a)) === 'PLAY');
  await a.waitForTimeout(600);
  await click(a, 'PLAY', tag);
  await a.waitForTimeout(2200);

  // The join popup: a room code can be pasted, the popup and its letters survive a
  // resize, and the error of a refused code does not linger on the mode screen after Cancel.
  await click(a, 'JOIN LOBBY', tag);
  await expect(tag, 'the join popup opens', async () => (await joinCode(a)) === '');
  await a.waitForTimeout(300);
  await paste(a, ' room: qz-7w k\n');
  await expect(tag, 'a pasted code is cleaned to letters, upper-cased, four at most', async () => (await joinCode(a)) === 'ROOM');
  await paste(a, 'zzzz');
  await expect(tag, 'a paste replaces what was typed', async () => (await joinCode(a)) === 'ZZZZ');
  await click(a, 'JOIN', tag);
  await expect(tag, 'the pasted code is sent (and refused: no such room)', async () => /not found/i.test((await net(a, (c) => c.error)) ?? ''));
  await a.keyboard.press('Backspace');
  await a.keyboard.press('Backspace');
  await expect(tag, 'two letters left in the popup', async () => (await joinCode(a)) === 'ZZ');
  await a.setViewportSize({ width: size.width - 180, height: size.height - 20 });
  await a.waitForTimeout(600);
  if ((await joinCode(a)) !== 'ZZ') fail(`${tag}: a resize closed the join popup or lost its letters (now ${JSON.stringify(await joinCode(a))})`);
  else console.log('   ok: the join popup and its letters survive a resize');
  await a.keyboard.type('qq');
  await expect(tag, 'typing goes on in the popup after the resize', async () => (await joinCode(a)) === 'ZZQQ');
  await a.keyboard.press('Escape');
  await expect(tag, 'Esc closes the popup', async () => (await joinCode(a)) === null);
  await a.waitForTimeout(300);
  if (await statusLine(a)) fail(`${tag}: the mode screen shows "${await statusLine(a)}" after the join popup was cancelled`);
  await a.setViewportSize(size);
  await a.waitForTimeout(600);
  if ((await joinCode(a)) !== null) fail(`${tag}: a resize re-opened the cancelled join popup`);
  if (await statusLine(a)) fail(`${tag}: the mode screen shows "${await statusLine(a)}" after a resize, from the cancelled join`);
  else console.log('   ok: no stale error on the mode screen after Cancel, also after a resize');

  // during the fade from the mode screen to side select
  // (the storm starts the moment the room exists, which is when the fade starts)
  await click(a, 'CREATE LOBBY', tag);
  await a.waitForFunction(() => !!window.__cubic.code, undefined, { polling: 'raf', timeout: 5000 }).catch(() => fail(`${tag}: Create Lobby made no room`));
  await resizeStorm(a, size, 700);
  await expect(tag, 'a resize during the fade to side select still shows the lobby', async () => !!(await net(a, (c) => c.code)) && (await buttons(a)).some((b) => b.label === 'LEAVE') && !(await buttons(a)).some((b) => b.label === 'CREATE LOBBY'), 6000);
  await a.waitForTimeout(500);
  await a.keyboard.press('a');
  await expect(tag, 'keys work after it (the host picks a side)', async () => !!(await net(a, (c) => c.room?.members.host?.side ?? null)));
  const code = (await net(a, (c) => c.code)) ?? '';

  // during the fade into the game, on both clients
  const b = await open(browser, size, q, `${tag} guest`);
  await click(b, 'PLAY', tag);
  await b.waitForTimeout(2200);
  await click(b, 'JOIN LOBBY', tag);
  await b.waitForTimeout(500);
  await b.keyboard.type(code.toLowerCase());
  await click(b, 'JOIN', tag);
  await expect(tag, 'the guest joins', async () => (await net(b, (c) => c.role)) === 'guest');
  await b.waitForTimeout(900);
  await b.keyboard.press('d');
  await b.waitForTimeout(400);
  await click(b, 'READY', tag);
  await a.waitForTimeout(600);
  await click(a, 'START', tag);
  await a.waitForFunction(() => window.__cubic.room?.phase === 'playing', undefined, { polling: 'raf', timeout: 5000 }).catch(() => fail(`${tag}: Start did not start the game`));
  await Promise.all([resizeStorm(a, size, 800), resizeStorm(b, size, 800)]);
  await expect(tag, 'a resize during the fade into the game still ends in the game, menus gone', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game' && (await labelsOf(a)) === '' && (await labelsOf(b)) === '', 6000);
  await a.waitForTimeout(800);
  await a.keyboard.press('Escape');
  await expect(tag, 'Esc opens the pause menu after it', () => a.evaluate(() => !!document.querySelector('#cu-pause.on')));

  // during the fade out of the game, after Leave
  await mouseClick(a, await middle(a, '#cu-pause [data-act="leave"]'));
  await resizeStorm(a, size, 800);
  await expect(tag, 'a resize during the fade out of the game still lands on the mode screen', async () => (await labelsOf(a)) === MODE, 6000);
  await a.waitForTimeout(700);
  await click(a, 'CREATE LOBBY', tag);
  await expect(tag, 'the mouse works after it (Create Lobby makes a room)', async () => !!(await net(a, (c) => c.code)));

  await a.close();
  await b.close();
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

  // a press on Play that is dragged onto the DOM (the gear) and let go there is not a
  // click, and must not leave the button armed for the next release over it
  const play = (await buttons(a)).find((x) => x.label === 'PLAY');
  if (play) {
    const on = await toWindow(a, play.x + play.width / 2, play.y + play.height / 2);
    const off = await toWindow(a, play.x + play.width / 2, play.y + play.height + 30);
    const gear = await middle(a, '#cu-gear');
    await a.mouse.move(on.x, on.y);
    await a.mouse.down();
    await a.mouse.move(gear.x, gear.y, { steps: 8 });
    await a.mouse.up();
    await a.mouse.move(off.x, off.y, { steps: 4 });
    await a.mouse.down();
    await a.mouse.move(on.x, on.y, { steps: 4 });
    await a.mouse.up();
    await a.waitForTimeout(500);
    if (await settingsOpen(a)) fail(`${tag}: a press dragged from the canvas onto the gear opened the settings`);
    if ((await labelsOf(a)) !== 'PLAY') fail(`${tag}: a press dragged off Play and let go on the DOM left Play armed`);
    await a.mouse.move(off.x, off.y);
  }

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

  // no click on the settings (DONE, the panel, the veil) reaches the menu behind it
  await settingsBlockClicks(a, tag);

  // Join Lobby opens the popup; a wrong code is refused; Cancel closes it
  await click(a, 'JOIN LOBBY', tag);
  await a.waitForTimeout(500);
  await expect(tag, 'the join popup opens', async () => (await buttons(a)).some((b) => b.label === 'CANCEL'));
  // behind the popup's veil nothing is clickable: the menu buttons are off, and a click
  // where one of them is does nothing
  const behind = (await buttons(a)).filter((b) => ['CREATE LOBBY', 'JOIN LOBBY', 'BACK'].includes(b.label));
  if (behind.length !== 3 || behind.some((b) => b.enabled)) fail(`${tag}: buttons behind the join popup are still enabled`);
  const back = behind.find((b) => b.label === 'BACK');
  if (back) await mouseClick(a, await toWindow(a, back.x + back.width / 2, back.y + back.height / 2));
  await a.waitForTimeout(700);
  if (!(await buttons(a)).some((b) => b.label === 'CANCEL')) fail(`${tag}: a click behind the join popup got through to Back`);
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

  // COPY next to the room code: a DOM button over the stage. It copies, says COPIED, and
  // the click reaches nothing behind it.
  {
    const before = await stage(a);
    await mouseClick(a, await middle(a, '#cu-copy'));
    await a.waitForTimeout(300);
    if (!/copied/i.test((await a.locator('#cu-copy').textContent()) ?? '')) fail(`${tag}: COPY does not say COPIED`);
    if ((await a.evaluate(() => navigator.clipboard.readText())) !== code) fail(`${tag}: COPY did not copy the room code`);
    if ((await stage(a)).lastDown !== before.lastDown) fail(`${tag}: the click on COPY reached the canvas behind`);
    if ((await net(a, (c) => c.room?.phase)) !== 'lobby') fail(`${tag}: the click on COPY left the lobby`);
    await shot(a, '4a-side-select-copied');
  }

  // switch sides 20 times, fast: each hero hops when its side is picked and must land
  // exactly where it started (it used to end a little higher every time)
  const start = await heroes(a);
  for (let i = 0; i < 20; i++) {
    const side = i % 2 ? 'out' : 'in';
    const at = await toWindow(a, start[side].x, start[side].y + (side === 'out' ? 10 : -10));
    await a.mouse.click(at.x, at.y);
    await a.waitForTimeout(40);
  }
  await expect(tag, 'the host ends on the outside after 20 fast switches', async () => (await net(a, (c) => c.room?.members.host?.side ?? null)) === 'out');
  await a.waitForTimeout(700);
  const end = await heroes(a);
  for (const side of ['out', 'in'] as const) {
    if (end[side].y !== start[side].y || end[side].x !== start[side].x) fail(`${tag}: the ${side} hero moved from (${start[side].x}, ${start[side].y}) to (${end[side].x}, ${end[side].y}) after 20 side switches`);
  }
  console.log(`   heroes after 20 switches: out y=${end.out.y}, in y=${end.in.y} (started at ${start.out.y}, ${start.in.y})`);
  await shot(a, '4b-side-select-after-switching');

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

  // the side card (still up for the guest): GOT IT closes it and the click goes nowhere else
  {
    const before = await stage(b);
    if (!(await b.evaluate(() => !!document.querySelector('.cu-onb-card.on')))) fail(`${tag}: the side card is not up at the start of the game`);
    await mouseClick(b, await middle(b, '.cu-onb-card button'));
    await b.waitForTimeout(500);
    if (await b.evaluate(() => !!document.querySelector('.cu-onb-card.on'))) fail(`${tag}: GOT IT did not close the side card`);
    if ((await stage(b)).lastDown !== before.lastDown) fail(`${tag}: the click on GOT IT reached the canvas behind`);
    if ((await screenOf(b)) !== 'game' || (await b.evaluate(() => !!document.querySelector('.cu-modal.on')))) fail(`${tag}: the click on GOT IT did more than close the card`);
  }

  // settings open from the gear in game
  await a.locator('#cu-gear').click();
  await a.waitForTimeout(400);
  await shot(a, '8-settings');
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);

  // The pause menu and the settings opened from it, clicked with the mouse: none of those
  // clicks may reach the stage canvas behind, and the game stays the game.
  const quiet = async (what: string, act: () => Promise<void>) => {
    const before = await stage(a);
    await act();
    await a.waitForTimeout(400);
    if ((await stage(a)).lastDown !== before.lastDown) fail(`${tag}: ${what}: the click reached the canvas behind`);
    if ((await screenOf(a)) !== 'game') fail(`${tag}: ${what}: left the game`);
  };
  const isOn = (id: string) => a.evaluate((i) => !!document.querySelector(`#${i}.on`), id);
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  if (!(await isOn('cu-pause'))) fail(`${tag}: Esc did not open the pause menu`);
  if ((await stage(a)).input) fail(`${tag}: the stage still takes pointer input with the pause menu open`);
  await shot(a, '9-pause');
  await quiet('Settings in the pause menu', async () => mouseClick(a, await middle(a, '#cu-pause [data-act="settings"]')));
  if (!(await isOn('cu-settings'))) fail(`${tag}: Settings in the pause menu did not open the settings`);
  await quiet('DONE in settings, in game', async () => mouseClick(a, await middle(a, '#cu-settings [data-close]')));
  if ((await isOn('cu-settings')) || !(await isOn('cu-pause'))) fail(`${tag}: DONE did not go back to the pause menu`);
  await quiet('Resume in the pause menu', async () => mouseClick(a, await middle(a, '#cu-pause [data-act="resume"]')));
  if (await isOn('cu-pause')) fail(`${tag}: Resume did not close the pause menu`);
  await a.waitForTimeout(200);
  if (!(await stage(a)).input) fail(`${tag}: the stage input did not come back after the pause menu closed`);
  // DOM under DOM: the veil lies over the gear and LEAVE. A click on it there closes the
  // settings and must not ALSO press what is under it (the gear would open them again).
  const gear = await middle(a, '#cu-gear');
  await a.mouse.click(gear.x, gear.y);
  await a.waitForTimeout(300);
  if (!(await isOn('cu-settings'))) fail(`${tag}: the gear did not open the settings`);
  await a.mouse.move(gear.x, gear.y);
  await a.mouse.down();
  await a.waitForTimeout(60);
  if (!(await isOn('cu-settings'))) fail(`${tag}: the settings closed on the press (the release would then land on the gear under the veil)`);
  await a.mouse.up();
  await a.waitForTimeout(300);
  if (await isOn('cu-settings')) fail(`${tag}: a click on the veil over the gear closed the settings and opened them again`);
  await a.mouse.click(gear.x, gear.y);
  await a.waitForTimeout(300);
  await quiet('a click on the settings veil over LEAVE', async () => mouseClick(a, await middle(a, '#cu-leave')));
  if (await isOn('cu-settings')) fail(`${tag}: a click on the veil did not close the settings`);
  // the controls tab: its tab, a key button (it waits for a key; Esc takes it back), DONE
  await a.mouse.click(gear.x, gear.y);
  await a.waitForTimeout(300);
  await quiet('the CONTROLS tab', async () => mouseClick(a, await middle(a, '#cu-settings [data-tab="controls"]')));
  await quiet('a key button in the controls tab', async () => mouseClick(a, await middle(a, '#cu-settings [data-bind="drop"]')));
  if (!/press a key/i.test((await a.locator('#cu-settings [data-bind="drop"]').textContent()) ?? '')) fail(`${tag}: a click on a key button does not wait for a key`);
  await a.keyboard.press('Escape');
  if (!(await isOn('cu-settings'))) fail(`${tag}: Esc on a waiting key button closed the settings`);
  await quiet('DONE on the controls tab', async () => mouseClick(a, await middle(a, '#cu-settings [data-close]')));
  if (await isOn('cu-settings')) fail(`${tag}: DONE did not close the settings`);
  // the pause veil over the gear and LEAVE: nothing happens at all
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  for (const under of ['#cu-gear', '#cu-leave']) {
    await quiet(`a click on the pause veil over ${under}`, async () => mouseClick(a, await middle(a, under)));
    if (!(await isOn('cu-pause')) || (await isOn('cu-settings'))) fail(`${tag}: a click on the pause veil over ${under} went through to it`);
  }
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  // the win screen (shown here by hand: nobody has won): its veil and its panel take the click
  await a.evaluate(() => (document.querySelector('#cu-win') as unknown as { classList: { add(c: string): void } }).classList.add('on'));
  await a.waitForTimeout(300);
  await quiet('a click on the win screen veil over LEAVE', async () => mouseClick(a, await middle(a, '#cu-leave')));
  await quiet('a click on the win screen panel', async () => mouseClick(a, await middle(a, '#cu-win h2')));
  await a.evaluate(() => (document.querySelector('#cu-win') as unknown as { classList: { remove(c: string): void } }).classList.remove('on'));
  await a.waitForTimeout(300);
  await quiet('a click in the chat field', async () => mouseClick(a, await middle(a, '#cu-chat')));
  await a.keyboard.press('Escape');
  await a.waitForTimeout(200);
  console.log('   pause menu, settings and chat clicks checked in game');

  // Leave, from the pause menu: back on the mode screen, and the click pressed nothing there
  if (!(await isOn('cu-pause'))) await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  if (!(await isOn('cu-pause'))) await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  const beforeLeave = await stage(a);
  await mouseClick(a, await middle(a, '#cu-pause [data-act="leave"]'));
  await expect(tag, 'Leave in the pause menu goes back to the mode screen', async () => (await labelsOf(a)) === 'BACK|CREATE LOBBY|JOIN LOBBY');
  await a.waitForTimeout(700);
  if ((await stage(a)).lastDown !== beforeLeave.lastDown) fail(`${tag}: Leave in the pause menu: the click reached the canvas behind`);
  if ((await labelsOf(a)) !== 'BACK|CREATE LOBBY|JOIN LOBBY' || (await net(a, (c) => c.code))) fail(`${tag}: Leave in the pause menu also pressed something on the mode screen`);

  await a.close();
  await b.close();
}

const browser = await chromium.launch();
try {
  await coldLoad(browser);
  await blockedOrigin(browser);
  // SIZE=1920x1080 and RENDERER=webgl (or canvas) cut the matrix down to one size or one renderer
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    if (process.env.SIZE && process.env.SIZE !== `${size.width}x${size.height}`) continue;
    for (const renderer of ['webgl', 'canvas'] as const) {
      if (process.env.RENDERER && process.env.RENDERER !== renderer) continue;
      await resizeMidTransition(browser, size, renderer).catch((e: Error) => fail(`${size.width}x${size.height} ${renderer} resize: stopped early: ${e.message}`));
      if (process.argv[2] !== 'resize') await run(browser, size, renderer);
    }
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
