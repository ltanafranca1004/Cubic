// Phones and tablets: the whole game played with FINGERS ONLY, on an emulated iPhone 14 and
// Pixel 7 (held sideways) and an iPad, with two players per device. Real touch events
// (page.touchscreen and CDP touch points, for holding, sliding and two fingers at once): no
// keyboard and no mouse, except to type the chat line the on-screen keyboard would type.
//
// It goes through the title, the settings, create and join a lobby (the room code on the
// letter keys), side select, start, walking with the d-pad to an item, picking it up and
// dropping it, walking over an edge, hold to talk, the map, the menu, chat and quick chat.
// It fails if anything is cut off by the screen, if a control covers the game view, if the
// view is not on whole device pixels, if the page scrolls or zooms, or on a console error.
// Then: the rotate card when the device is held upright, and no card and no touch layout in
// a narrow DESKTOP window.
//
//   server:  PORT=3410 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3410 npm run dev -w client -- --port 5510
//   run:     cd tools && BASE=http://localhost:5510 npx tsx screens/mobile.ts [iphone pixel ipad extra]   (default: iphone)
//
// Screenshots go to docs/screens/mobile/.
import { mkdirSync } from 'node:fs';
import { chromium, devices, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { DESKTOP, compactLayout, layoutMode, viewZoomFor, wideLayout } from '../../client/src/style/fit';
import { VIEW } from '../../client/src/style/tokens';

const BASE = process.env.BASE ?? 'http://localhost:5510';
const OUT = new URL('../../docs/screens/mobile/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { id: 'iphone', name: 'iPhone 14 landscape', renderer: 'webgl' },
  { id: 'pixel', name: 'Pixel 7 landscape', renderer: 'webgl' },
  { id: 'ipad', name: 'iPad (gen 7) landscape', renderer: 'webgl' },
] as const;

interface Btn {
  label: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Spot {
  x: number;
  y: number;
}
interface Pose {
  face: number;
  x: number;
  y: number;
}
interface Cubic {
  code: string | null;
  side: 'out' | 'in' | null;
  role: string | null;
  room: { phase: string } | null;
  chat: { text: string; from: string }[];
  state: { players: Record<'out' | 'in', { pose: Pose; carrying: string | null }>; items: Record<string, { id: string; kind: string; side: string; face: number; x: number; y: number }> } | null;
}
interface VoiceProbe {
  snapshot(signal: number): { mic: string; talking: boolean };
}
declare const window: {
  __cubic: Cubic;
  __cubicVoice: VoiceProbe;
  __cubicAudio: { unlocked: boolean };
  __cubicButtons(): Btn[];
  __cubicStage(): { input: boolean; lastDown: number };
  __cubicHeroes(): { out: Spot; in: Spot };
};

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One player: a page, its touch screen and what it is called in the messages. */
interface Player {
  page: Page;
  cdp: CDPSession;
  tag: string;
}

async function open(ctx: BrowserContext, query: string, tag: string): Promise<Player> {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fail(`${tag}: console error: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  await page.addInitScript('window.__name = (f) => f'); // tsx names the functions it sends to the page
  await page.goto(`${BASE}/${query}`);
  await page.waitForSelector('#cu-stage canvas');
  await sleep(1500);
  return { page, cdp: await ctx.newCDPSession(page), tag };
}

const shot = (p: Player, name: string) => p.page.screenshot({ path: `${OUT}${name}.png` });
const net = <T>(p: Player, fn: (c: Cubic) => T): Promise<T> => p.page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
const buttons = (p: Player) => p.page.evaluate(() => window.__cubicButtons());

/** The middle of a DOM element. */
async function middle(p: Player, selector: string): Promise<Spot> {
  const box = await p.page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${p.tag}: ${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A finger tap on a DOM element. */
async function tap(p: Player, selector: string): Promise<void> {
  const at = await middle(p, selector);
  await p.page.touchscreen.tap(at.x, at.y);
  await sleep(120);
}
const ctl = (id: string) => `[data-m="${id}"]`;

/** Art pixels on the stage canvas to window pixels. */
async function onStage(p: Player, x: number, y: number): Promise<Spot> {
  const at = await p.page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#cu-stage canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / c.width };
  });
  return { x: at.left + x * at.scale, y: at.top + y * at.scale };
}

/** A finger tap on a button the menu canvas draws. */
async function tapCanvas(p: Player, label: string): Promise<void> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const b = (await buttons(p)).find((x) => x.label === label && x.enabled);
    if (b) {
      const at = await onStage(p, b.x + b.width / 2, b.y + b.height / 2);
      await p.page.touchscreen.tap(at.x, at.y);
      await sleep(250);
      return;
    }
    if (Date.now() > deadline) throw new Error(`${p.tag}: no live button "${label}" (have ${(await buttons(p)).map((x) => x.label).join('|')})`);
    await sleep(150);
  }
}

// ---------- fingers that stay down (CDP: a start or a move lists every finger on the glass, an end the one that lifts) ----------
const fingers = new Map<CDPSession, Map<number, Spot>>();
async function finger(p: Player, id: number, at: Spot | null, type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
  const down = fingers.get(p.cdp) ?? new Map<number, Spot>();
  fingers.set(p.cdp, down);
  const lifted = down.get(id);
  if (at) down.set(id, at);
  else down.delete(id);
  const points = type === 'touchEnd' ? (lifted ? [[id, lifted] as const] : []) : [...down];
  await p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([n, s]) => ({ x: Math.round(s.x), y: Math.round(s.y), id: n })) });
}

/** A point on the d-pad: its centre moved 34% of its side in a direction. */
async function padSpot(p: Player, dir: 'up' | 'down' | 'left' | 'right'): Promise<Spot> {
  const box = (await p.page.locator(ctl('pad')).boundingBox())!;
  const by = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] as [number, number];
  return { x: box.x + box.width / 2 + by[0] * box.width * 0.34, y: box.y + box.height / 2 + by[1] * box.height * 0.34 };
}

const poseOf = (p: Player, side: 'out' | 'in') => p.page.evaluate((s) => ({ ...window.__cubic.state!.players[s].pose }), side);

/** One step: a short tap on an arm of the d-pad. */
async function step(p: Player, dir: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  const at = await padSpot(p, dir);
  await finger(p, 1, at, 'touchStart');
  await sleep(40);
  await finger(p, 1, null, 'touchEnd');
  await sleep(170);
}

// ---------- the rules of the layout ----------
type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** The page never scrolls and never zooms. */
async function checkPage(p: Player, when: string): Promise<void> {
  const m = await p.page.evaluate(() => ({ x: scrollX, y: scrollY, top: document.scrollingElement?.scrollTop ?? 0, scale: visualViewport?.scale ?? 1, w: document.documentElement.scrollWidth, iw: innerWidth, h: document.documentElement.scrollHeight, ih: innerHeight }));
  if (m.x || m.y || m.top) fail(`${p.tag}: the page scrolled (${when})`);
  if (m.scale !== 1) fail(`${p.tag}: the page zoomed to ${m.scale} (${when})`);
  if (m.w > m.iw || m.h > m.ih) fail(`${p.tag}: the page is larger than the screen, ${m.w}x${m.h} in ${m.iw}x${m.ih} (${when})`);
}

/** In game: the zoom, whole device pixels, nothing cut off, no control on the view. */
async function checkGame(p: Player, device: { viewport: { width: number; height: number }; dpr: number }): Promise<void> {
  const { width, height } = device.viewport;
  const d = { touch: true, dpr: device.dpr };
  const mode = layoutMode(width, height, d);
  const m = await p.page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el || (el as HTMLElement).offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const cu = document.querySelector<HTMLElement>('.cu')!;
    const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!;
    const named = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => ({ name: el.dataset.m ?? el.id ?? el.className, box: box(el) }));
    return {
      touch: cu.dataset.touch,
      z: Number(cu.style.getPropertyValue('--z')),
      u: Number(cu.style.getPropertyValue('--u')),
      canvas: box(canvas)!,
      canvasPx: canvas.width,
      controls: named('.cu-m-pad, .cu-m-acts > .cu-m-btn, .cu-m-info'),
      texts: named('.cu-m-glance, #cu-et, #cu-eb, #cu-el, #cu-er, .cu-col, .cu-top'),
      // text that does not fit its box
      clipped: [...document.querySelectorAll<HTMLElement>('.cu-m-btn, .cu-m-glance .cu-face, .cu-m-glance .cu-prog')].filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1).map((el) => el.dataset.m ?? el.className),
      objective: document.querySelector<HTMLElement>(cu.dataset.touch === 'compact' ? '[data-m="obj"]' : '#cu-obj')?.textContent ?? '',
      glance: box(document.querySelector('[data-m="glance"]')),
      obj: box(document.querySelector('[data-m="obj"]')),
      progress: document.querySelector<HTMLElement>(cu.dataset.touch === 'compact' ? '[data-m="progn"]' : '#cu-progn')?.textContent ?? '',
    };
  });
  if (m.touch !== mode) fail(`${p.tag}: the layout is "${m.touch}", wanted "${mode}"`);
  const want = viewZoomFor(width, height, d);
  if (Math.abs(m.z - want) > 1e-6) fail(`${p.tag}: zoom is x${m.z}, wanted x${want}`);
  // whole pixels: an art pixel is a whole number of device pixels, and the canvas starts on one
  const perArt = m.z * device.dpr;
  if (Math.abs(perArt - Math.round(perArt)) > 1e-6) fail(`${p.tag}: an art pixel is ${perArt} device pixels: not a whole number`);
  const side = m.canvas.right - m.canvas.left;
  if (Math.abs(side - VIEW.px * want) > 0.01 || Math.abs(m.canvas.bottom - m.canvas.top - side) > 0.01) fail(`${p.tag}: the canvas is ${side}px, wanted ${VIEW.px * want}`);
  for (const [name, v] of Object.entries({ left: m.canvas.left, top: m.canvas.top })) {
    const px = v * device.dpr;
    // (the browser reports positions in 64ths of a CSS pixel)
    if (Math.abs(px - Math.round(px)) > 0.05) fail(`${p.tag}: the canvas is between two device pixels (${name} ${v})`);
  }
  if (m.canvasPx !== VIEW.px) fail(`${p.tag}: the canvas draws ${m.canvasPx} pixels, not ${VIEW.px}`);
  const size = mode === 'compact' ? compactLayout(width, height, d).view.size : VIEW.px * wideLayout(width, height, d).z;
  if (mode === 'compact' && size < height * 0.8) fail(`${p.tag}: the view is ${size}px of a ${height}px high screen`);
  const screen: Box = { left: 0, top: 0, right: width, bottom: height };
  const inside = (b: Box) => b.left >= -0.5 && b.top >= -0.5 && b.right <= screen.right + 0.5 && b.bottom <= screen.bottom + 0.5;
  for (const c of m.controls) {
    if (!c.box) {
      if (c.name !== 'info' || mode === 'compact') fail(`${p.tag}: the ${c.name} control is not on screen`);
      continue;
    }
    if (!inside(c.box)) fail(`${p.tag}: the ${c.name} control is cut off by the screen (${JSON.stringify(c.box)})`);
    if (overlap(c.box, m.canvas)) fail(`${p.tag}: the ${c.name} control is over the game view (the player can stand under it)`);
    const [w, h] = [c.box.right - c.box.left, c.box.bottom - c.box.top];
    if (w < 44 - 0.5 || h < 44 - 0.5) fail(`${p.tag}: the ${c.name} control is ${w}x${h}: smaller than a thumb (44)`);
    if (c.name === 'pad' && w < 100) fail(`${p.tag}: the d-pad is only ${w}px`);
  }
  for (let i = 0; i < m.controls.length; i++) for (let j = i + 1; j < m.controls.length; j++) if (m.controls[i]!.box && m.controls[j]!.box && overlap(m.controls[i]!.box!, m.controls[j]!.box!)) fail(`${p.tag}: ${m.controls[i]!.name} and ${m.controls[j]!.name} overlap`);
  for (const t of m.texts) {
    if (!t.box) continue; // (folded away on a phone)
    if (!inside(t.box)) fail(`${p.tag}: ${t.name} is cut off by the screen (${JSON.stringify(t.box)})`);
    for (const c of m.controls) if (c.box && overlap(c.box, t.box)) fail(`${p.tag}: the ${c.name} control is over ${t.name}`);
  }
  if (m.clipped.length) fail(`${p.tag}: text is cut off in ${m.clipped.join(', ')}`);
  // what to do and how far along: readable without opening anything
  if (m.objective.length < 8) fail(`${p.tag}: the objective is not in sight ("${m.objective}")`);
  if (!/^\d+\/\d+$/.test(m.progress)) fail(`${p.tag}: the puzzle progress is not in sight ("${m.progress}")`);
  if (mode === 'compact' && (!m.glance || !m.obj || m.obj.bottom > m.glance.bottom + 0.5)) fail(`${p.tag}: the objective does not fit its card`);
  await checkPage(p, 'in game');
}

// ---------- one device, two players ----------
async function play(browser: Browser, dev: (typeof DEVICES)[number]): Promise<void> {
  const { defaultBrowserType: _engine, ...descriptor } = devices[dev.name]!;
  const device = { viewport: descriptor.viewport, dpr: descriptor.deviceScaleFactor };
  const q = `?renderer=${dev.renderer}`;
  console.log(`\n${dev.id}: ${dev.name}, ${device.viewport.width}x${device.viewport.height} @${device.dpr}, ${dev.renderer}`);
  // a: the host, outside, who has never allowed the microphone. b: the guest, inside, who has.
  const ctxA = await browser.newContext({ ...descriptor });
  const ctxB = await browser.newContext({ ...descriptor, permissions: ['microphone'] });
  const a = await open(ctxA, q, `${dev.id}-out`);
  const b = await open(ctxB, q, `${dev.id}-in`);
  const pic = (p: Player, name: string) => shot(p, `${dev.id}-${name}`);

  // title: a touch device, nothing scrolls, and no sound before the first tap
  for (const p of [a, b]) {
    const m = await p.page.evaluate(() => ({ touch: document.documentElement.hasAttribute('data-touch'), coarse: matchMedia('(pointer: coarse)').matches, unlocked: window.__cubicAudio.unlocked, mic: window.__cubicVoice.snapshot(0).mic }));
    if (!m.coarse || !m.touch) fail(`${p.tag}: not seen as a touch device (coarse ${m.coarse}, layer ${m.touch})`);
    if (m.unlocked) fail(`${p.tag}: the audio is unlocked before any tap`);
    if (m.mic !== 'off') fail(`${p.tag}: the mic is "${m.mic}" on the title screen`);
    await checkPage(p, 'title');
  }
  await pic(a, '01-start');

  // settings by finger: a tap on a DOM button unlocks the audio and never reaches the canvas
  await tap(a, '#cu-gear');
  await a.page.waitForSelector('#cu-settings.on');
  if (!(await a.page.evaluate(() => window.__cubicAudio.unlocked))) fail(`${a.tag}: a tap on a DOM button did not unlock the audio`);
  const before = await a.page.evaluate(() => window.__cubicStage().lastDown);
  const motion = '#cu-settings .cu-toggle[data-key="reduceMotion"]';
  await tap(a, '#cu-settings [data-tab="access"]'); // the tabs by finger too
  await a.page.locator(motion).scrollIntoViewIfNeeded();
  await tap(a, motion);
  if (!(await a.page.evaluate((s) => document.querySelector(s)!.classList.contains('on'), motion))) fail(`${a.tag}: a tap did not flip a settings switch`);
  await tap(a, motion);
  await sleep(200);
  await pic(a, '02-settings');
  const panel = await a.page.evaluate(() => {
    const r = document.querySelector('#cu-settings .cu-panel')!.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  if (!panel) fail(`${a.tag}: the settings panel leaves the screen`);
  await a.page.locator('#cu-settings [data-close]').scrollIntoViewIfNeeded();
  await tap(a, '#cu-settings [data-close]');
  await sleep(400);
  if (await a.page.evaluate(() => !!document.querySelector('#cu-settings.on'))) fail(`${a.tag}: Done did not close the settings`);
  if ((await a.page.evaluate(() => window.__cubicStage().lastDown)) !== before) fail(`${a.tag}: a tap in the settings reached the canvas behind`);
  if (!(await buttons(a)).some((x) => x.label === 'PLAY')) fail(`${a.tag}: the title changed behind the settings`);

  // Play: a tap on a CANVAS button works, and it unlocks the audio too
  await tapCanvas(b, 'PLAY');
  if (!(await b.page.evaluate(() => window.__cubicAudio.unlocked))) fail(`${b.tag}: a tap on the canvas did not unlock the audio`);
  await tapCanvas(a, 'PLAY');
  await sleep(1800);
  await pic(a, '03-mode');
  await tapCanvas(a, 'CREATE LOBBY');
  await a.page.waitForFunction(() => !!window.__cubic.code);
  const code = (await net(a, (c) => c.code))!;

  // join: the room code on the letter keys
  await tapCanvas(b, 'JOIN LOBBY');
  await b.page.waitForSelector('.cu-m-code.on');
  await sleep(400);
  for (const letter of code) await tap(b, ctl(`key-${letter}`));
  await tap(b, ctl('key-Z'));
  await tap(b, ctl('key-Backspace')); // a fifth letter is not taken, and Delete removes the last
  for (const letter of code.slice(-1)) await tap(b, ctl(`key-${letter}`));
  await pic(b, '04-join-code');
  const keys = await b.page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.cu-m-code .cu-m-btn')].map((el) => el.getBoundingClientRect());
    return { n: boxes.length, small: boxes.filter((r) => r.width < 40 || r.height < 44).length, off: boxes.filter((r) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight).length };
  });
  if (keys.n !== 27 || keys.small || keys.off) fail(`${b.tag}: the code keys are wrong: ${JSON.stringify(keys)}`);
  await tapCanvas(b, 'JOIN');
  await b.page.waitForFunction(() => window.__cubic.room?.phase === 'lobby', undefined, { timeout: 8000 }).catch(() => fail(`${b.tag}: could not join ${code} with the letter keys`));
  if (await b.page.evaluate(() => !!document.querySelector('.cu-m-code.on'))) fail(`${b.tag}: the code keys stayed up in the lobby`);

  // the mic comes back by itself only now, in the room, for the player who allowed it before
  await sleep(600);
  if ((await b.page.evaluate(() => window.__cubicVoice.snapshot(0).mic)) !== 'on') fail(`${b.tag}: the mic did not come back in the room`);
  if ((await a.page.evaluate(() => window.__cubicVoice.snapshot(0).mic)) !== 'off') fail(`${a.tag}: the mic opened without being asked`);

  // side select: tap your cube, ready, start
  await sleep(900);
  for (const [p, side] of [[a, 'out'], [b, 'in']] as const) {
    const hero = await p.page.evaluate((s) => window.__cubicHeroes()[s], side);
    const at = await onStage(p, hero.x, hero.y - 6);
    await p.page.touchscreen.tap(at.x, at.y);
    await sleep(500);
  }
  await pic(a, '05-side-select');
  await tapCanvas(b, (await buttons(b)).find((x) => /READY/.test(x.label))?.label ?? 'READY');
  await sleep(400);
  await tapCanvas(a, 'START');
  for (const p of [a, b]) await p.page.waitForSelector('.cu[data-screen="game"] #game canvas');
  if ((await net(a, (c) => c.side)) !== 'out' || (await net(b, (c) => c.side)) !== 'in') fail(`${dev.id}: the sides were not picked by tapping the cubes`);
  await sleep(1500);
  await pic(a, '06-game-out-intro');
  // (the pictures after this are of the layout: no onboarding card over it)
  for (const p of [a, b]) await p.page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  await sleep(500);
  for (const p of [a, b]) await checkGame(p, device);
  await pic(a, '07-game-out');
  await pic(b, '07-game-in');

  // walk to the rose with the d-pad, one tap a step
  const rose = await net(a, (c) => Object.values(c.state!.items).find((i) => i.side === 'out' && i.face === 1)!);
  for (let i = 0; i < 40; i++) {
    const at = await poseOf(a, 'out');
    if (at.face !== 1) break;
    if (at.y !== rose.y) await step(a, at.y < rose.y ? 'down' : 'up');
    else if (at.x !== rose.x) await step(a, at.x < rose.x ? 'right' : 'left');
    else break;
  }
  let at = await poseOf(a, 'out');
  if (at.x !== rose.x || at.y !== rose.y) fail(`${a.tag}: the d-pad did not walk to the item (at ${at.x},${at.y}, item ${rose.x},${rose.y})`);
  await tap(a, ctl('interact'));
  await sleep(300);
  if ((await net(a, (c) => c.state!.players.out.carrying)) !== rose.id) fail(`${a.tag}: USE did not pick the item up`);
  if (await a.page.evaluate(() => document.querySelector('[data-m="drop"]')!.classList.contains('idle'))) fail(`${a.tag}: DROP is not lit while carrying`);
  await pic(a, '08-carrying');
  await step(a, 'right');
  await tap(a, ctl('drop'));
  await sleep(300);
  if (await net(a, (c) => c.state!.players.out.carrying)) fail(`${a.tag}: DROP did not put the item down`);

  // hold the d-pad: keep walking, slide to another direction, press a button with the other thumb
  at = await poseOf(a, 'out');
  await finger(a, 1, await padSpot(a, 'up'), 'touchStart');
  await sleep(450);
  const walked = await poseOf(a, 'out');
  if (at.y - walked.y < 2) fail(`${a.tag}: holding the d-pad did not keep walking (${at.y} to ${walked.y})`);
  await finger(a, 1, await padSpot(a, 'left'), 'touchMove'); // slide, finger still down
  await sleep(120);
  if ((await a.page.evaluate(() => document.querySelector<HTMLElement>('[data-m="pad"]')!.dataset.dir)) !== 'left') fail(`${a.tag}: sliding on the d-pad did not change the direction`);
  await finger(a, 2, await middle(a, ctl('interact')), 'touchStart'); // a second finger
  await sleep(120);
  const both = await a.page.evaluate(() => ({ dir: document.querySelector<HTMLElement>('[data-m="pad"]')!.dataset.dir, use: document.querySelector('[data-m="interact"]')!.classList.contains('on') }));
  if (both.dir !== 'left' || !both.use) fail(`${a.tag}: two fingers at once do not work (${JSON.stringify(both)})`);
  await finger(a, 2, null, 'touchEnd');
  // ... and on over the left edge of the face (a tree on the far side can block a row: try the next one)
  const crossed = () => a.page.waitForFunction(() => window.__cubic.state!.players.out.pose.face !== 1, undefined, { timeout: 1500 }).then(() => true, () => false);
  let over = await crossed();
  for (let row = 0; row < 8 && !over; row++) {
    await finger(a, 1, null, 'touchEnd');
    await step(a, 'down');
    await finger(a, 1, await padSpot(a, 'left'), 'touchStart');
    over = await crossed();
  }
  if (!over) fail(`${a.tag}: holding left did not walk over the edge (${JSON.stringify(await poseOf(a, 'out'))})`);
  await sleep(200);
  await pic(a, '09-over-the-edge');
  await sleep(700);
  await finger(a, 1, null, 'touchEnd');
  await sleep(300);
  const stopped = await poseOf(a, 'out');
  await sleep(400);
  const later = await poseOf(a, 'out');
  if (stopped.x !== later.x || stopped.y !== later.y || stopped.face !== later.face) fail(`${a.tag}: the player kept walking after the finger lifted`);
  await checkGame(a, device);

  // talk: the first press asks for the mic (from a tap), after that it is hold to talk
  await tap(a, ctl('talk'));
  await a.page.waitForFunction(() => window.__cubicVoice.snapshot(0).mic === 'on', undefined, { timeout: 5000 }).catch(() => fail(`${a.tag}: TALK did not ask for the mic`));
  await sleep(300);
  await finger(a, 1, await middle(a, ctl('talk')), 'touchStart');
  await sleep(300);
  if (!(await a.page.evaluate(() => window.__cubicVoice.snapshot(0).talking))) fail(`${a.tag}: holding TALK does not transmit`);
  await pic(a, '10-talking');
  await finger(a, 1, null, 'touchEnd');
  await sleep(200);
  if (await a.page.evaluate(() => window.__cubicVoice.snapshot(0).talking)) fail(`${a.tag}: still transmitting after TALK was let go`);

  // the map: a switch; the d-pad turns the cube and the player stays put
  await tap(a, ctl('map'));
  await a.page.waitForSelector('.cu-cubemap.on');
  const held = await poseOf(a, 'out');
  await step(a, 'left');
  await step(a, 'up');
  await sleep(300);
  const mapBox = await a.page.evaluate(() => {
    const r = document.querySelector('.cu-cubemap .cu-panel')!.getBoundingClientRect();
    const v = document.querySelector('#game canvas')!.getBoundingClientRect();
    return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, off: Math.abs((r.left + r.right) / 2 - (v.left + v.right) / 2) };
  });
  if (!mapBox.inside || mapBox.off > 2) fail(`${a.tag}: the cube map is cut off or off the view (${JSON.stringify(mapBox)})`);
  const still = await poseOf(a, 'out');
  if (still.x !== held.x || still.y !== held.y) fail(`${a.tag}: the player walked while the map was up`);
  await pic(a, '11-map');
  await tap(a, ctl('map'));
  await sleep(200);
  if (await a.page.evaluate(() => !!document.querySelector('.cu-cubemap.on'))) fail(`${a.tag}: MAP did not close the map`);

  // chat: the field at the top, the keyboard would cover the rest
  await tap(a, ctl('chat'));
  if (!(await a.page.evaluate(() => document.activeElement === document.querySelector('[data-m="field"]')))) fail(`${a.tag}: CHAT did not put the cursor in the field`);
  await a.page.keyboard.type('The rose is by the west edge.');
  await sleep(150);
  await pic(a, '12-chat');
  const chatBox = await a.page.evaluate(() => document.querySelector('.cu-m-chat')!.getBoundingClientRect().bottom);
  if (chatBox > device.viewport.height * 0.45) fail(`${a.tag}: the chat field reaches ${chatBox}px down: the on-screen keyboard would cover it`);
  await tap(a, ctl('send'));
  await b.page.waitForFunction(() => window.__cubic.chat.some((m) => m.text === 'The rose is by the west edge.'), undefined, { timeout: 4000 }).catch(() => fail(`${a.tag}: the chat line did not arrive`));
  if (await a.page.evaluate(() => document.querySelector('.cu-m-chat')!.classList.contains('on'))) fail(`${a.tag}: the chat field stayed open after Send`);
  await sleep(300);
  await pic(b, '13-chat-arrives');
  if (layoutMode(device.viewport.width, device.viewport.height, { touch: true, dpr: device.dpr }) === 'compact') {
    const cap = await b.page.evaluate(() => document.querySelector('#cu-caption')!.textContent);
    if (!cap?.includes('The rose is by the west edge.')) fail(`${b.tag}: the partner's line is not shown with the chat folded away ("${cap}")`);
  }
  // quick chat: one tap, from the same sheet
  await tap(b, ctl('chat'));
  await pic(b, '14-quick-chat-buttons');
  await tap(b, ctl('quick2'));
  await b.page.waitForSelector('.cu-bubble.mine', { timeout: 3000 }).catch(() => fail(`${b.tag}: the quick-chat button said nothing`));
  await pic(b, '15-quick-chat');
  await checkPage(b, 'after chat');

  // the HUD panel on a phone: the whole column, one tap away
  if ((await a.page.evaluate(() => document.querySelector<HTMLElement>('.cu')!.dataset.touch)) === 'compact') {
    await tap(a, ctl('info'));
    await sleep(250);
    const col = await a.page.evaluate(() => {
      const parts = [...document.querySelectorAll('.cu-col > *, .cu-top')].map((el) => el.getBoundingClientRect());
      return { n: parts.filter((r) => r.width > 0).length, off: parts.filter((r) => r.width > 0 && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)).length, log: document.querySelector('#cu-log')!.textContent };
    });
    if (col.n < 4 || col.off) fail(`${a.tag}: the HUD panel is incomplete or cut off (${JSON.stringify(col)})`);
    if (!col.log?.includes('west edge')) fail(`${a.tag}: the chat log is not in the HUD panel`);
    await pic(a, '16-hud-panel');
    await tap(a, ctl('info'));
    await sleep(200);
    if (await a.page.evaluate(() => document.querySelector<HTMLElement>('.cu-col')!.offsetParent !== null)) fail(`${a.tag}: the HUD panel did not close`);
  }

  // the menu: pause, settings from it, back, resume. All by finger.
  await tap(a, ctl('pause'));
  await a.page.waitForSelector('#cu-pause.on');
  await sleep(300);
  await pic(a, '17-menu');
  const small = await a.page.evaluate(() => [...document.querySelectorAll('#cu-pause button')].filter((x) => x.getBoundingClientRect().height < 44).length);
  if (small) fail(`${a.tag}: ${small} pause menu buttons are smaller than a thumb`);
  await tap(a, '#cu-pause [data-act="settings"]');
  await a.page.waitForSelector('#cu-settings.on');
  await sleep(300);
  await pic(a, '18-settings-in-game');
  await a.page.locator('#cu-settings [data-close]').scrollIntoViewIfNeeded();
  await tap(a, '#cu-settings [data-close]');
  await a.page.waitForSelector('#cu-pause.on');
  await tap(a, '#cu-pause [data-act="resume"]');
  await sleep(300);
  if (await a.page.evaluate(() => !!document.querySelector('.cu-modal.on'))) fail(`${a.tag}: a panel is still open after Resume`);
  // and the game takes input again
  const pre = await poseOf(a, 'out');
  let post = pre;
  for (const dir of ['up', 'down', 'left', 'right'] as const) {
    await step(a, dir);
    post = await poseOf(a, 'out');
    if (pre.x !== post.x || pre.y !== post.y || pre.face !== post.face) break;
  }
  if (pre.x === post.x && pre.y === post.y && pre.face === post.face) fail(`${a.tag}: the d-pad is dead after the menu`);

  // a swipe and a double tap on the view: the page neither scrolls nor zooms
  const v = await middle(a, '#game canvas');
  await finger(a, 1, v, 'touchStart');
  for (let i = 1; i <= 6; i++) await finger(a, 1, { x: v.x, y: v.y - i * 20 }, 'touchMove');
  await finger(a, 1, null, 'touchEnd');
  await a.page.touchscreen.tap(v.x, v.y);
  await a.page.touchscreen.tap(v.x, v.y);
  await sleep(300);
  for (const p of [a, b]) await checkGame(p, device);

  await ctxA.close();
  await ctxB.close();
}

// ---------- held upright, and a desktop that must not change ----------
async function extra(browser: Browser): Promise<void> {
  console.log('\nextra: portrait, a narrow desktop window, ?touch');
  const { defaultBrowserType: _engine, ...phone } = devices['iPhone 14']!;
  const ctx = await browser.newContext({ ...phone });
  const p = await open(ctx, '?mock=game&side=out&renderer=canvas', 'portrait');
  const card = await p.page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.cu-m-rotate')!;
    const r = el.querySelector('.cu-panel')!.getBoundingClientRect();
    return { on: el.classList.contains('on'), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, top: document.elementFromPoint(innerWidth / 2, innerHeight - 40)?.closest('.cu-m-rotate') !== null, text: el.textContent };
  });
  if (!card.on || !card.inside || !card.top || !/Rotate your device/i.test(card.text ?? '')) fail(`portrait: no rotate card (${JSON.stringify(card)})`);
  // the game takes no input under the card
  const before = await poseOf(p, 'out');
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowLeft']) await p.page.keyboard.press(key);
  await sleep(300);
  const after = await poseOf(p, 'out');
  if (before.x !== after.x || before.y !== after.y) fail('portrait: the player walked under the rotate card');
  await checkPage(p, 'portrait');
  await shot(p, 'portrait-rotate-card');
  // turned sideways: the card goes and the game is back
  await p.page.setViewportSize({ width: 750, height: 340 });
  await sleep(600);
  if (await p.page.evaluate(() => document.querySelector('.cu-m-rotate')!.classList.contains('on'))) fail('portrait: the rotate card stayed after turning the device');
  await p.page.keyboard.press('ArrowLeft');
  await sleep(300);
  if ((await poseOf(p, 'out')).x === after.x) fail('portrait: no input after turning the device');
  await ctx.close();

  // a narrow DESKTOP window (mouse): no card, no touch layer, the layout it always had
  for (const size of [{ width: 390, height: 664 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport: size });
    await page.goto(`${BASE}/?mock=game&side=out&renderer=canvas`);
    await page.waitForSelector('.cu[data-screen="game"] #game canvas');
    await sleep(800);
    const m = await page.evaluate(() => {
      const cu = document.querySelector<HTMLElement>('.cu')!;
      return { layer: !!document.querySelector('.cu-m'), touch: cu.dataset.touch ?? null, html: document.documentElement.hasAttribute('data-touch'), z: Number(cu.style.getPropertyValue('--z')), card: !!document.querySelector('.cu-m-rotate.on') };
    });
    if (m.layer || m.touch !== null || m.html || m.card) fail(`desktop ${size.width}x${size.height}: the touch layer is there (${JSON.stringify(m)})`);
    if (m.z !== viewZoomFor(size.width, size.height, DESKTOP)) fail(`desktop ${size.width}x${size.height}: the zoom changed to x${m.z}`);
    await page.close();
  }

  // ?touch on a desktop: the touch layout with a mouse, for trying it out
  const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
  await page.goto(`${BASE}/?mock=game&side=in&renderer=canvas&touch`);
  await page.waitForSelector('.cu[data-screen="game"] #game canvas');
  await sleep(1200);
  await page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  if ((await page.evaluate(() => document.querySelector<HTMLElement>('.cu')!.dataset.touch)) !== 'compact') fail('?touch: no touch layout');
  const from = await page.evaluate(() => window.__cubic.state!.players.in.pose.x);
  const pad = (await page.locator('[data-m="pad"]').boundingBox())!;
  await page.mouse.move(pad.x + pad.width * 0.84, pad.y + pad.height / 2);
  await page.mouse.down();
  await sleep(450);
  await page.mouse.up();
  const to = await page.evaluate(() => window.__cubic.state!.players.in.pose.x);
  if (to === from) fail('?touch: the d-pad does not work with a mouse');
  await page.screenshot({ path: `${OUT}desktop-touch-flag.png` });
  await page.close();
}

// one phone by default; name the others (pixel, ipad, extra) to run them too
const only = process.argv.length > 2 ? process.argv.slice(2) : ['iphone'];
// the microphone is a fake one, and its permission prompt is answered yes
const browser = await chromium.launch({ args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  for (const dev of DEVICES) if (!only.length || only.includes(dev.id)) await play(browser, dev);
  if (!only.length || only.includes('extra')) await extra(browser);
} catch (e) {
  fail(`stopped: ${(e as Error).message}`);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nMobile: all checks passed. Screenshots in docs/screens/mobile/');
