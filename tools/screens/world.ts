// The living world (client/src/world/ambience), checked on every face: a screenshot and a
// short GIF per face into docs/screens/world, an fps measurement at 1920x1080 on both
// renderers, and a failure on any console error. Uses the offline game (?mock=game), so
// only the client has to run.
//
//   client:  npm run dev -w client -- --port 5406
//   then:    cd tools && BASE=http://localhost:5406 npx tsx screens/world.ts [shots|gifs|fps|checks]
//
// The GIFs need ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5406';
const OUT = new URL('../../docs/screens/world/', import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const ONLY = process.argv[2];
const SIDES = ['out', 'in'] as const;
const FACES = [1, 2, 3, 4, 5, 6];
const NAMES = ['grass', 'desert', 'snow', 'forest', 'rooftop', 'cave'];
const UP: Record<number, number[]> = { 1: [0, 1, 0], 2: [0, 1, 0], 3: [0, 1, 0], 4: [0, 1, 0], 5: [0, 0, -1], 6: [0, 0, 1] };

mkdirSync(OUT, { recursive: true });

interface Stats {
  key: string | null;
  effects: string[];
  parts: number;
  cap: number;
  decor: number;
  birds: { x: number; y: number }[];
  loop: string | null;
  frameMs: number;
  fps: number;
  renderer: string;
}
interface Cubic {
  state: { players: Record<string, { pose: { face: number; up: number[]; x: number; y: number } }> } | null;
  move(dx: number, dy: number): void;
}
declare const window: { __cubic: Cubic; __cubicAmbience: { stats(): Stats } };

const problems: string[] = [];
function watch(page: Page): void {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
}

/** Put the player in the middle of a face, the way tools/screens/shoot.ts does. */
async function goTo(page: Page, side: string, face: number, x = 5, y = 6): Promise<void> {
  await page.evaluate(
    ({ side, face, up, x, y }) => {
      const c = window.__cubic;
      Object.assign(c.state!.players[side]!.pose, { face, up, x: x - 1, y });
      c.move(1, 0); // a real step, so the view redraws from the game state
    },
    { side, face, up: UP[face]!, x, y },
  );
}
const stats = (page: Page) => page.evaluate(() => window.__cubicAmbience.stats());
const name = (side: string, face: number) => `${side}-${face}-${side === 'out' ? NAMES[face - 1] : 'room'}`;

async function open(browser: Browser, side: string, renderer: string, size = { width: 1280, height: 720 }): Promise<Page> {
  const page = await browser.newPage({ viewport: size });
  watch(page);
  await page.goto(`${BASE}/?mock=game&side=${side}${renderer === 'canvas' ? '&renderer=canvas' : ''}`);
  // the pictures are of the world: no onboarding cards or hints over it
  await page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  await page.waitForTimeout(1500);
  await page.keyboard.press('d'); // the first gesture: unlocks audio, so the loops load too
  return page;
}

/** A walk that leaves footprints and comes near things: a loop around the middle, never over an edge. */
async function walk(page: Page, stepMs = 170): Promise<void> {
  for (const key of 'dddwwwaaaaasssdd') {
    await page.keyboard.press(key);
    await page.waitForTimeout(stepMs);
  }
}

/** Walk up to a bird on the ground, so the clip shows it taking off. */
async function chaseBird(page: Page): Promise<void> {
  const bird = (await stats(page)).birds[0];
  if (!bird) return void problems.push('forest: no bird on the ground to walk up to');
  let fled = false;
  for (let i = 0; i < 14 && !fled; i++) {
    // face 4 is shown with its canonical up here, so screen tiles are canonical tiles
    const me = await page.evaluate(() => window.__cubic.state!.players.out!.pose);
    const dx = bird.x - me.x;
    const dy = bird.y - me.y;
    await page.keyboard.press(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'd' : 'a') : dy > 0 ? 's' : 'w');
    await page.waitForTimeout(170);
    fled = !(await stats(page)).birds.some((b) => b.x === bird.x && b.y === bird.y);
  }
  if (!fled) problems.push('forest: the bird did not flee');
  else console.log('   the bird fled');
}

async function shots(browser: Browser): Promise<void> {
  for (const renderer of ['webgl', 'canvas']) {
    for (const side of SIDES) {
      const page = await open(browser, side, renderer);
      for (const face of FACES) {
        await goTo(page, side, face);
        await page.waitForTimeout(3200);
        const s = await stats(page);
        if (s.renderer !== renderer) problems.push(`${renderer}: the game runs on ${s.renderer}`);
        if (s.parts > s.cap) problems.push(`${name(side, face)}: ${s.parts} parts over the cap of ${s.cap}`);
        if (!s.loop) problems.push(`${name(side, face)} (${renderer}): no ambience loop is playing`);
        await page.locator('#game canvas').screenshot({ path: `${OUT}${name(side, face)}${renderer === 'canvas' ? '-canvas' : ''}.png` });
        console.log('  ', renderer, name(side, face), `parts ${s.parts}/${s.cap}`, `decor ${s.decor}`, `loop ${s.loop}`, s.effects.join(' '));
      }
      await page.close();
    }
  }
}

async function gifs(browser: Browser): Promise<void> {
  const size = { width: 1280, height: 720 };
  for (const side of SIDES) {
    for (const face of FACES) {
      const dir = `${OUT}.video`;
      rmSync(dir, { recursive: true, force: true });
      const context = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
      const page = await context.newPage();
      watch(page);
      const t0 = Date.now();
      await page.goto(`${BASE}/?mock=game&side=${side}`);
      await page.waitForTimeout(1500);
      await goTo(page, side, face);
      await page.waitForTimeout(900);
      const from = (Date.now() - t0) / 1000;
      const box = (await page.locator('#game canvas').boundingBox())!;
      await page.waitForTimeout(2200);
      await walk(page);
      if (side === 'out' && face === 4) await chaseBird(page);
      await page.waitForTimeout(1600);
      const length = (Date.now() - t0) / 1000 - from;
      await context.close();
      const video = `${dir}/${readdirSync(dir).find((f) => f.endsWith('.webm'))}`;
      const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)}`;
      // nearest-neighbour and a palette made from the clip keep the pixels crisp
      const filter = `fps=12,${crop},scale=320:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none`;
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', from.toFixed(2), '-t', length.toFixed(2), '-i', video, '-filter_complex', filter, `${OUT}${name(side, face)}.gif`]);
      rmSync(dir, { recursive: true, force: true });
      console.log('  ', `${name(side, face)}.gif`);
    }
  }
}

/** Walking over an edge, the settings gear, and reduce motion. */
async function checks(browser: Browser): Promise<void> {
  const page = await open(browser, 'out', 'webgl');
  // over the right edge of the grass and back: the layer is rebuilt for each face
  await goTo(page, 'out', 1, 8, 6);
  await page.waitForTimeout(400);
  const before = (await stats(page)).key;
  // however wide the face is: step right until the face changes
  for (let i = 0; i < 8 && (await stats(page)).key === before; i++) {
    await page.keyboard.press('d');
    await page.waitForTimeout(170);
  }
  await page.waitForTimeout(900);
  const after = await stats(page);
  if (after.key === before || !after.key?.startsWith('out:2:')) problems.push(`walking off the grass: ${before} -> ${after.key}`);
  if (after.loop !== 'desert') problems.push(`on the desert the loop is ${after.loop}`);
  console.log('   edge:', before, '->', after.key, 'loop', after.loop);

  await page.locator('#cu-gear').click();
  await page.waitForTimeout(400);
  if (!(await page.locator('#cu-settings .cu-settings').isVisible())) problems.push('the gear did not open the settings');
  await page.keyboard.press('Escape');
  // The panel on this branch has no reduce-motion switch yet: set it in the settings store
  // the game reads (the dev server hands the page the same module instance).
  await page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('reduceMotion', true))`);
  for (const side of ['out']) {
    for (const face of FACES) {
      await goTo(page, side, face);
      await page.waitForTimeout(2500);
      const s = await stats(page);
      if (s.cap !== 16 || s.parts > s.cap) problems.push(`reduce motion ${name(side, face)}: ${s.parts}/${s.cap}`);
      if (s.effects.includes('shimmer')) problems.push('reduce motion still shimmers');
      console.log('   reduce motion', name(side, face), `parts ${s.parts}/${s.cap}`, s.effects.join(' '));
      if (face === 2 || face === 3) await page.locator('#game canvas').screenshot({ path: `${OUT}${name(side, face)}-reduce-motion.png` });
    }
  }
  await page.close();
}

// A string, not a function: tsx wraps named functions in a helper the page does not have.
const MEASURE = `new Promise((done) => {
  const gaps = [];
  let cost = 0;
  let last = performance.now();
  const start = last;
  function tick() {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    cost += window.__cubicAmbience.stats().frameMs;
    if (now - start < 3000) return requestAnimationFrame(tick);
    gaps.sort((a, b) => a - b);
    done({ fps: (gaps.length * 1000) / (now - start), p95: gaps[Math.floor(gaps.length * 0.95)], ambience: cost / gaps.length });
  }
  requestAnimationFrame(tick);
})`;

/** Frames per second over 3 s per face, at 1920x1080, with the effects' own cost per frame. */
async function fps(browser: Browser): Promise<void> {
  const lines = ['renderer side face name fps p95FrameMs ambienceMs parts cap'];
  for (const renderer of ['webgl', 'canvas']) {
    for (const side of SIDES) {
      const page = await open(browser, side, renderer, { width: 1920, height: 1080 });
      for (const face of FACES) {
        await goTo(page, side, face);
        await page.waitForTimeout(1500);
        const m = (await page.evaluate(MEASURE)) as { fps: number; p95: number; ambience: number };
        const s = await stats(page);
        const line = [renderer, side, face, name(side, face), m.fps.toFixed(1), m.p95.toFixed(1), m.ambience.toFixed(3), s.parts, s.cap].join(' ');
        lines.push(line);
        console.log('  ', line);
        if (m.fps < 58) problems.push(`${renderer} ${name(side, face)}: ${m.fps.toFixed(1)} fps`);
      }
      await page.close();
    }
  }
  writeFileSync(`${OUT}fps.txt`, lines.join('\n') + '\n');
}

const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'shots') await shots(browser);
  if (!ONLY || ONLY === 'gifs') await gifs(browser);
  if (!ONLY || ONLY === 'fps') await fps(browser);
  if (!ONLY || ONLY === 'checks') await checks(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}`);
  process.exit(1);
}
console.log('done ->', OUT);
