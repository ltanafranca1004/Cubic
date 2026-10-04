// THE SIDE SELECT, STATE BY STATE: idle, the mouse over OUTSIDE, over INSIDE, OUTSIDE
// picked, INSIDE picked. Two players in one lobby; the pictures are player A's screen.
// Every state is also MEASURED in the running scene (window.__cubicSide, dev builds): the
// turtle's bounding box must be whole inside the face it stands on (the grass outside, the
// room inside) and its centre within 2 px of the face's centre. Then one re-fit while
// hovering (1280x720 -> 1000x640), the same once in WebGL, and a touch screen (no hover).
//
//   server:  PORT=3422 AI_FAKE=1 TTS_MODE=browser npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3422 npm run dev -w client -- --port 5522
//   then:    cd tools && BASE=http://localhost:5522 npx tsx screens/side-select.ts
//
//   BASE   client URL (default http://localhost:5522)
//   OUT    folder for the PNGs and log.txt (default <repo>/docs/status/side-select/)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { click, has, js, press, sleep, snap, toMode, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5522';
const OUT = resolve(process.env.OUT ?? join(new URL('../../', import.meta.url).pathname, 'docs/status/side-select')) + '/';
mkdirSync(OUT, { recursive: true });

type Side = 'out' | 'in';
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Seen {
  state: 'idle' | 'hover' | 'selected';
  alpha: number;
  cube: Box;
  face: Box;
  turtle: Box;
}
interface Probe {
  width: number;
  height: number;
  zoom: number;
  hover: Side | null;
  touch: boolean;
  out: Seen;
  in: Seen;
}
interface Size {
  width: number;
  height: number;
}

const lines: string[] = [];
let failed = 0;
const log = (line: string) => {
  lines.push(line);
  console.log(line);
};
const probe = (page: Page) => js<Probe>(page, `window.__cubicSide()`);
const name = (s: Size) => `${s.width}x${s.height}`;

/** A page on the title screen, connected. Silent: no speech reaches the speakers. */
async function open(browser: Browser, size: Size, query: string): Promise<Page> {
  const context = await browser.newContext({ viewport: size });
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

/** A creates a lobby; B (if there is one) joins it. Nobody has picked a side. */
async function lobby(a: Page, b: Page | null): Promise<void> {
  await toMode(a);
  await click(a, 'CREATE LOBBY');
  await until('the side select screen', () => has(a, 'LEAVE'), 6000);
  if (!b) return;
  await toMode(b);
  const code = (await snap(a)).code!;
  await click(b, 'JOIN LOBBY');
  await until('the join popup', () => has(b, 'CANCEL'));
  await b.waitForTimeout(350);
  await b.keyboard.type(code, { delay: 50 });
  await b.waitForTimeout(150);
  await click(b, 'JOIN');
  await until('B on the side select screen', () => has(b, 'READY'), 6000);
}

/** Put the mouse on the middle of a side's cube (or in a corner of the sky: on nothing). */
async function point(page: Page, side: Side | null): Promise<void> {
  const p = await probe(page);
  const s = await js<{ left: number; top: number; scale: number }>(
    page,
    `(() => { const c = document.querySelector('#cu-stage canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, scale: r.width / c.width }; })()`,
  );
  const [x, y] = side ? [p[side].cube.x + p[side].cube.w / 2, p[side].cube.y + p[side].cube.h * 0.5] : [p.width * 0.35, p.height * 0.3];
  await page.mouse.move(s.left + x * s.scale, s.top + y * s.scale, { steps: 4 });
  await page.waitForTimeout(250);
}

/** Measure one side in the running scene: PASS when the turtle is whole on its face, in the middle, in the state we expect. */
async function check(page: Page, tag: string, side: Side, want: Seen['state']): Promise<void> {
  const p = await probe(page);
  const { face, turtle, state, alpha } = p[side];
  const within = turtle.x >= face.x && turtle.y >= face.y && turtle.x + turtle.w <= face.x + face.w && turtle.y + turtle.h <= face.y + face.h;
  const dx = turtle.x + turtle.w / 2 - (face.x + face.w / 2);
  const dy = turtle.y + turtle.h / 2 - (face.y + face.h / 2);
  const whole = [turtle.x, turtle.y, face.x, face.y].every(Number.isInteger);
  const ok = within && Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && state === want && whole;
  if (!ok) failed++;
  log(
    `${ok ? 'PASS' : 'FAIL'}  ${tag.padEnd(34)} ${side.padEnd(3)} state=${state}${state === want ? '' : ` (want ${want})`} alpha=${alpha} x${p.zoom} ` +
      `face=[${face.x},${face.y} ${face.w}x${face.h}] turtle=[${turtle.x},${turtle.y} ${turtle.w}x${turtle.h}] inside=${within} centre offset=(${dx}, ${dy}) whole=${whole}`,
  );
}

/** The five states at one window size, on player A's screen. */
async function states(browser: Browser, size: Size, query: string, shots: boolean, label = name(size)): Promise<{ a: Page; b: Page }> {
  const [a, b] = await Promise.all([open(browser, size, query), open(browser, size, query)]);
  await lobby(a, b);
  await sleep(900); // the fade in
  const shot = async (state: string) => {
    if (shots) await a.screenshot({ path: `${OUT}${name(size)}-${state}.png` });
  };

  await point(a, null);
  await check(a, `${label} idle`, 'out', 'idle');
  await check(a, `${label} idle`, 'in', 'idle');
  await shot('idle');

  await point(a, 'out');
  await check(a, `${label} hover outside`, 'out', 'hover');
  await shot('hover-outside');
  await point(a, 'in');
  await check(a, `${label} hover inside`, 'in', 'hover');
  await shot('hover-inside');

  await point(a, null);
  await press(a, 'a');
  await until('A picked outside', async () => (await probe(a)).out.state === 'selected');
  await sleep(700); // the arrow glides, the turtle hops and lands
  await check(a, `${label} selected outside`, 'out', 'selected');
  await check(b, `${label} selected outside (B's screen)`, 'out', 'selected');
  await shot('selected-outside');

  await press(a, 'd', 'd');
  await until('A picked inside', async () => (await probe(a)).in.state === 'selected');
  await sleep(700);
  await check(a, `${label} selected inside`, 'in', 'selected');
  await check(b, `${label} selected inside (B's screen)`, 'in', 'selected');
  await shot('selected-inside');
  return { a, b };
}

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  log(`side select, ${BASE}, Chromium, canvas renderer unless said otherwise`);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const { a, b } = await states(browser, size, '?renderer=canvas', true);
    if (size.width === 1280) {
      // a re-fit under a mouse that does not move: back to the middle, hover OUTSIDE, shrink the window
      await press(a, 'a');
      await until('A back in the middle', async () => (await probe(a)).in.state === 'idle');
      await point(a, 'out');
      await check(a, '1280x720 hover outside (before)', 'out', 'hover');
      await a.setViewportSize({ width: 1000, height: 640 });
      await until('the re-fit', async () => (await probe(a)).width === 500, 4000);
      await sleep(500);
      await check(a, 'resize -> 1000x640 hover outside', 'out', 'hover');
      await check(a, 'resize -> 1000x640 (inside, idle)', 'in', 'idle');
      await a.screenshot({ path: `${OUT}resize-1000x640-hover-outside.png` });
      await point(a, 'in');
      await check(a, 'resize -> 1000x640 hover inside', 'in', 'hover');
      await a.screenshot({ path: `${OUT}resize-1000x640-hover-inside.png` });
    }
    await a.context().close();
    await b.context().close();
  }

  // the same numbers in WebGL (headless Chromium), one size
  {
    const size = { width: 1280, height: 720 };
    const { a, b } = await states(browser, size, '?renderer=webgl', false, 'webgl 1280x720');
    const kind = await js<string>(a, `document.querySelector('#cu-stage canvas').getContext('2d') ? 'canvas' : 'webgl'`);
    log(`      (that run's stage renderer: ${kind})`);
    await a.screenshot({ path: `${OUT}webgl-1280x720-selected-inside.png` });
    await a.context().close();
    await b.context().close();
  }

  // a touch screen has no hover: the pointer over a cube changes nothing
  {
    const a = await open(browser, { width: 844, height: 390 }, '?renderer=canvas&touch');
    await lobby(a, null);
    await sleep(900);
    await point(a, 'out');
    const p = await probe(a);
    log(`      (touch=${p.touch}, logical ${p.width}x${p.height})`);
    await check(a, 'touch 844x390 pointer over outside', 'out', 'idle');
    await point(a, 'in');
    await check(a, 'touch 844x390 pointer over inside', 'in', 'idle');
    await a.screenshot({ path: `${OUT}touch-844x390-idle.png` });
    await press(a, 'a');
    await until('picked outside', async () => (await probe(a)).out.state === 'selected');
    await sleep(700);
    await check(a, 'touch 844x390 selected outside', 'out', 'selected');
    await a.screenshot({ path: `${OUT}touch-844x390-selected-outside.png` });
    await a.context().close();
  }
  log(failed ? `${failed} FAILED` : 'ALL PASS');
} finally {
  writeFileSync(`${OUT}log.txt`, lines.join('\n') + '\n');
  await browser.close();
}
process.exit(failed ? 1 : 0);
