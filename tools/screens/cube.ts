// The cube visuals, checked and filmed: the turning cube behind the menus, the dive, and
// the cube in the HUD. Screenshots at 1920x1080 and 1280x720 in WebGL and Canvas, GIFs of
// the spin, the dive and the HUD cube turning over all four edges and round a corner, into
// docs/screens/cube. It fails on a console error, on the two renderers drawing the cube
// differently, on a HUD cube that does not end on the face the player walked onto, and on
// a low frame rate.
//
//   server:  PORT=3305 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3305 npm run dev -w client -- --port 5405
//   then:    cd tools && BASE=http://localhost:5405 npx tsx screens/cube.ts [shots|gifs]
//
// The GIFs need ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { FACE_SIZE, screenToCanon, type FaceId, type Side, type Vec } from '../../shared/src';

const BASE = process.env.BASE ?? 'http://localhost:5405';
const OUT = new URL('../../docs/screens/cube/', import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const ONLY = process.argv[2]; // shots | gifs
const SIZES = [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }];
type Renderer = 'webgl' | 'canvas';
type Dir = 'left' | 'right' | 'up' | 'down';
const STEP: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

mkdirSync(OUT, { recursive: true });

interface Pose {
  face: FaceId;
  up: Vec;
  x: number;
  y: number;
}
interface Cubic {
  state: { players: Record<Side, { pose: Pose }>; solved: number[] } | null;
  move(dx: number, dy: number): void;
}
interface CubeStats {
  bakeMs: number;
  frames: number;
  size: number;
  speed: number;
  hold: number | null;
  mode: string;
}
declare const window: {
  __cubic: Cubic;
  __cubicCube: CubeStats;
  __cubicCubeMap: { show(): void; hide(): void; rotate(dir: Dir): void };
  __cubicHudCube(): { front: number | null; turning: boolean; turns: number; map: number | null };
};
declare const document: { querySelector(sel: string): { getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number }; width: number; getContext(kind: string): unknown } | null };

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};
const ok = (msg: string) => console.log('   ok:', msg);

function watch(page: Page, tag: string): Page {
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${tag}: console error: ${m.text().slice(0, 200)}`);
  });
  return page;
}

async function open(browser: Browser, size: { width: number; height: number }, query: string, tag: string): Promise<Page> {
  const page = watch(await browser.newPage({ viewport: size }), tag);
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1500);
  return page;
}

const q = (renderer: Renderer, query: string) => `?${query}${renderer === 'canvas' ? '&renderer=canvas' : ''}`;

/** Frames per second the page manages over a second and a half. (A string: tsx would wrap a named function.) */
const fps = (page: Page) =>
  page.evaluate(`new Promise((done) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => {
      n++;
      if (performance.now() - t0 >= 1500) done((n * 1000) / (performance.now() - t0));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`) as Promise<number>;

/** The share of pixels that differ by more than a little between two PNGs of the same size. */
function differing(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return 1;
  let bad = 0;
  for (let i = 0; i < pa.data.length; i += 4) if (Math.abs(pa.data[i]! - pb.data[i]!) + Math.abs(pa.data[i + 1]! - pb.data[i + 1]!) + Math.abs(pa.data[i + 2]! - pb.data[i + 2]!) > 12) bad++;
  return bad / (pa.data.length / 4);
}

/** How many colours are in a PNG: a blurred (smoothed) cube has thousands. */
function colours(png: Buffer): number {
  const p = PNG.sync.read(png);
  const seen = new Set<number>();
  for (let i = 0; i < p.data.length; i += 4) seen.add((p.data[i]! << 16) | (p.data[i + 1]! << 8) | p.data[i + 2]!);
  return seen.size;
}

/** Where the HUD cube is on the page. */
const cubeBox = async (page: Page) => {
  const r = await page.evaluate(() => document.querySelector('#cu-cube')!.getBoundingClientRect());
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/** Stand on the middle of a screen edge (or the nearest tile that lets you through) and walk off it. */
async function cross(page: Page, side: Side, dir: Dir): Promise<boolean> {
  const before = await page.evaluate((s) => window.__cubic.state!.players[s].pose, side);
  const mid = Math.floor(FACE_SIZE / 2);
  const along = [0, 1, -1, 2, -2, 3, -3].map((d) => mid + d);
  for (const t of along) {
    const [sx, sy] = dir === 'left' ? [0, t] : dir === 'right' ? [FACE_SIZE - 1, t] : dir === 'up' ? [t, 0] : [t, FACE_SIZE - 1];
    const [x, y] = screenToCanon(side, before.face, before.up, sx, sy);
    const after = await page.evaluate(
      ({ side, x, y, step }) => {
        const c = window.__cubic;
        Object.assign(c.state!.players[side].pose, { x, y });
        c.move(step[0], step[1]);
        return c.state!.players[side].pose.face;
      },
      { side, x, y, step: STEP[dir] },
    );
    if (after !== before.face) return true;
  }
  return false;
}

async function shots(browser: Browser): Promise<void> {
  const crops = new Map<string, Buffer>();
  for (const size of SIZES) {
    for (const renderer of ['webgl', 'canvas'] as Renderer[]) {
      const tag = `${size.width}x${size.height} ${renderer}`;
      const name = (what: string) => `${OUT}${what}-${size.width}-${renderer}.png`;
      console.log(`\n${tag}`);

      // title -> dive -> mode -> join popup
      const page = await open(browser, size, q(renderer, 'mock=menu'), tag);
      const actual = await page.evaluate(() => (document.querySelector('canvas')!.getContext('2d') ? 'canvas' : 'webgl'));
      if (actual !== renderer) fail(`${tag}: wanted the ${renderer} renderer, got ${actual}`);
      const stats = await page.evaluate(() => ({ ...window.__cubicCube }));
      if (!stats.frames) fail(`${tag}: the cube was not baked`);
      else if (stats.bakeMs > 300) fail(`${tag}: baking the spin took ${stats.bakeMs} ms (budget 300)`);
      else ok(`${stats.frames} frames of ${stats.size}px baked in ${stats.bakeMs} ms`);
      const rate = await fps(page);
      if (rate < 45) fail(`${tag}: title screen runs at ${rate.toFixed(0)} fps`);
      else ok(`title screen at ${rate.toFixed(0)} fps`);
      await page.evaluate(() => (window.__cubicCube.hold = 0.07));
      await page.waitForTimeout(200);
      await page.screenshot({ path: name('start') });
      await page.evaluate(() => (window.__cubicCube.hold = null));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(560);
      await page.screenshot({ path: name('dive') });
      await page.waitForTimeout(1800);
      if ((await page.evaluate(() => window.__cubicCube.mode)) !== 'mode') fail(`${tag}: the cube is not behind the mode screen after the dive`);
      await page.evaluate(() => (window.__cubicCube.hold = 0.07));
      await page.waitForTimeout(200);
      await page.screenshot({ path: name('mode') });
      // the cube alone, on the white of the mode screen: the two renderers must agree
      const scale = Math.max(1, Math.floor(Math.min(size.width / 480, size.height / 270)));
      const crop = { x: Math.round(size.width * 0.73) - 60 * scale, y: Math.round(size.height * 0.5) - 60 * scale, width: 120 * scale, height: 120 * scale };
      const cube = await page.screenshot({ clip: crop });
      crops.set(`${size.width}-${renderer}`, cube);
      const n = colours(cube);
      if (n > 400) fail(`${tag}: the cube has ${n} colours: it is being smoothed`);
      else ok(`the cube is crisp (${n} colours in the crop)`);
      await page.evaluate(() => (window.__cubicCube.hold = null));
      for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
      await page.screenshot({ path: name('join') });
      await page.close();

      const lobby = await open(browser, size, q(renderer, 'mock=lobby'), tag);
      await lobby.screenshot({ path: name('side') });
      await lobby.close();

      // the HUD cube, both sides, and the cube map
      for (const side of ['out', 'in'] as Side[]) {
        const game = await open(browser, size, q(renderer, `mock=game&side=${side}`), `${tag} ${side}`);
        await game.waitForTimeout(600);
        await game.screenshot({ path: name(`hud-${side}`) });
        await game.screenshot({ path: name(`hud-cube-${side}`), clip: await cubeBox(game) });
        if (!(await cross(game, side, 'right'))) fail(`${tag} ${side}: could not walk off the right edge`);
        await game.waitForTimeout(180);
        await game.screenshot({ path: name(`hud-cube-${side}-turning`), clip: await cubeBox(game) });
        await game.waitForTimeout(700);
        const now = await game.evaluate((s) => ({ face: window.__cubic.state!.players[s].pose.face, hud: window.__cubicHudCube() }), side);
        if (now.hud.front !== now.face || now.hud.turning) fail(`${tag} ${side}: the HUD cube shows face ${now.hud.front}, the player is on ${now.face}`);
        await game.evaluate(() => window.__cubicCubeMap.show());
        await game.waitForTimeout(200);
        await game.evaluate(() => window.__cubicCubeMap.rotate('up'));
        await game.waitForTimeout(700);
        await game.screenshot({ path: name(`cubemap-${side}`) });
        await game.close();
      }
    }
    const same = differing(crops.get(`${size.width}-webgl`)!, crops.get(`${size.width}-canvas`)!);
    if (same > 0.002) fail(`${size.width}: the cube differs between WebGL and Canvas in ${(same * 100).toFixed(2)}% of its pixels`);
    else ok(`${size.width}: WebGL and Canvas draw the same cube (${(same * 100).toFixed(3)}% of pixels differ)`);
  }
}

/** Record `run` and cut it into a GIF. Nearest-neighbour scaling and no dither keep the pixels crisp. */
async function gif(browser: Browser, name: string, query: string, run: (page: Page) => Promise<{ from: number; seconds: number; crop?: { x: number; y: number; width: number; height: number } }>, width = 640, colors = 96, rate = 20): Promise<void> {
  const size = SIZES[1]!;
  const dir = `${OUT}.video`;
  rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
  const page = watch(await context.newPage(), name);
  const t0 = Date.now();
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1800);
  const cut = await run(page);
  const started = (cut.from - t0) / 1000;
  await context.close();
  const video = `${dir}/${readdirSync(dir).find((f) => f.endsWith('.webm'))}`;
  const crop = cut.crop ? `crop=${cut.crop.width}:${cut.crop.height}:${cut.crop.x}:${cut.crop.y},` : '';
  const filter = `fps=${rate},${crop}scale=${width}:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=${colors}[p];[b][p]paletteuse=dither=none`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', Math.max(0, started).toFixed(2), '-t', cut.seconds.toFixed(2), '-i', video, '-filter_complex', filter, `${OUT}${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
  console.log('  ', `${name}.gif`);
}

async function gifs(browser: Browser): Promise<void> {
  console.log('\ngifs');
  // the title as it is: eight seconds of the real, slow turn
  await gif(browser, 'menu-spin', '?mock=menu', async (page) => {
    const from = Date.now();
    await page.waitForTimeout(8000);
    return { from, seconds: 8 };
  });
  // one whole turn, eight times faster than life, so all six faces come past in six seconds
  await gif(browser, 'menu-full-turn-x8', '?mock=menu', async (page) => {
    await page.evaluate(() => (window.__cubicCube.speed = 8));
    const from = Date.now();
    await page.waitForTimeout(6200);
    return { from, seconds: 6 };
  });
  // the dive: Play, through the clouds, the cube settles behind the mode screen; then Back and Join
  await gif(browser, 'dive', '?mock=menu', async (page) => {
    const from = Date.now();
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2600);
    return { from, seconds: 3.2 };
  });
  await gif(browser, 'mode-join-back', '?mock=menu', async (page) => {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2200);
    const from = Date.now();
    for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape'); // Back to the title: the cube glides back under the sky
    await page.waitForTimeout(1500);
    return { from, seconds: 4.4 };
  });

  // the HUD cube: off each of the four edges and back, then round a corner (up, left, down)
  for (const side of ['out', 'in'] as Side[]) {
    await gif(
      browser,
      `hud-turns-${side}`,
      `?mock=game&side=${side}`,
      async (page) => {
        const box = async (sel: string) => page.evaluate((s) => document.querySelector(s)!.getBoundingClientRect(), sel);
        const hud = await box('.cu-col');
        const view = await box('.cu-mid');
        const crop = { x: Math.floor(hud.left) - 8, y: Math.floor(hud.top) - 8, width: Math.ceil(view.right - hud.left) + 16, height: Math.ceil(hud.bottom - hud.top) + 16 };
        crop.width -= crop.width % 2;
        crop.height -= crop.height % 2;
        const from = Date.now();
        await page.waitForTimeout(700);
        const walk = async (dir: Dir) => {
          const face = await page.evaluate((s) => window.__cubic.state!.players[s].pose.face, side);
          const turns = await page.evaluate(() => window.__cubicHudCube().turns);
          if (!(await cross(page, side, dir))) return fail(`hud ${side}: could not walk ${dir} off face ${face}`);
          await page.waitForTimeout(1000);
          if ((await page.evaluate(() => window.__cubicHudCube().turns)) !== turns + 1) fail(`hud ${side}: the cube did not make one turn when walking ${dir}`);
          const now = await page.evaluate((s) => ({ face: window.__cubic.state!.players[s].pose.face, hud: window.__cubicHudCube() }), side);
          if (now.hud.front !== now.face) fail(`hud ${side}: walked ${dir} onto face ${now.face} but the cube shows ${now.hud.front}`);
          else ok(`${side}: walked ${dir} from face ${face} to ${now.face}; the cube turned to it`);
        };
        for (const [there, back] of [['right', 'left'], ['left', 'right'], ['up', 'down'], ['down', 'up']] as [Dir, Dir][]) {
          await walk(there);
          await walk(back);
        }
        for (const dir of ['up', 'left', 'down'] as Dir[]) await walk(dir);
        const end = await page.evaluate((s) => window.__cubic.state!.players[s].pose, side);
        if (end.face !== 1 || end.up.join() === '0,1,0') fail(`hud ${side}: the corner loop ended on face ${end.face} with up ${end.up.join()}`);
        else ok(`${side}: three crossings round the corner: back on face 1, now with up ${end.up.join()}`);
        await page.waitForTimeout(900);
        return { from, seconds: (Date.now() - from) / 1000, crop };
      },
      560,
      96,
      15,
    );
  }

  // the cube map: opened, turned through every face
  await gif(
    browser,
    'cube-map',
    '?mock=game&side=out',
    async (page) => {
      const from = Date.now();
      await page.evaluate(() => window.__cubicCubeMap.show());
      await page.waitForTimeout(700);
      for (const dir of ['right', 'right', 'up', 'left', 'down', 'down'] as Dir[]) {
        await page.evaluate((d) => window.__cubicCubeMap.rotate(d), dir);
        await page.waitForTimeout(750);
      }
      await page.evaluate(() => window.__cubicCubeMap.hide());
      await page.waitForTimeout(400);
      return { from, seconds: (Date.now() - from) / 1000 };
    },
    640,
    128,
  );
}

const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'shots') await shots(browser);
  if (!ONLY || ONLY === 'gifs') await gifs(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\nall clean ->', OUT);
