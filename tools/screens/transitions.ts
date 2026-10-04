// The face transitions, checked live and recorded as GIFs into docs/screens/transitions.
//
//  live:  two real clients in one room, in WebGL and again in Phaser's Canvas fallback.
//         Both players cross all four edges with the keyboard. Asserts: the transition
//         plays, keys pressed during it are applied after it (none dropped), the partner's
//         moves keep arriving meanwhile, client and server agree afterwards, the partner's
//         footsteps are heard only on the same face number and their ding never.
//  gifs:  the offline game (?mock=game): four edges and a loop around one corner, outside
//         (roll) and inside (hop), in both renderers, plus the reduce-motion fade.
//
//   server:  PORT=3302 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3302 npm run dev -w client -- --port 5402
//   then:    cd tools && BASE=http://localhost:5402 npx tsx screens/transitions.ts [live|gifs]
//
// The GIFs need ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { FACE_SIZE } from '../../shared/src/index';

const BASE = process.env.BASE ?? 'http://localhost:5402';
const OUT = new URL('../../docs/screens/transitions/', import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SIZE = { width: 1280, height: 720 };
const ONLY = process.argv[2]; // live | gifs
const RENDERERS = ['webgl', 'canvas'] as const;
type Renderer = (typeof RENDERERS)[number];

mkdirSync(OUT, { recursive: true });

interface Pose {
  face: number;
  up: number[];
  x: number;
  y: number;
}
type Side = 'out' | 'in';
interface Cubic {
  code: string | null;
  side: Side | null;
  room: { phase: string } | null;
  state: { players: Record<Side, { pose: Pose; steps: number }> } | null;
  server: { players: Record<Side, { pose: Pose; steps: number }> } | null;
  pending: unknown[];
}
const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};
const ok = (cond: boolean, what: string) => (cond ? console.log('   ok:', what) : fail(what));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function watch(page: Page, tag: string): Page {
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${tag}: console error: ${m.text().slice(0, 200)}`);
  });
  return page;
}
const query = (renderer: Renderer, extra = '') => `?${[extra, renderer === 'canvas' ? 'renderer=canvas' : ''].filter(Boolean).join('&')}`;
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
const pose = (page: Page, side: Side) => page.evaluate(`window.__cubic.state.players.${side}.pose`) as Promise<Pose>;
const serverPose = (page: Page, side: Side) => page.evaluate(`window.__cubic.server.players.${side}.pose`) as Promise<Pose>;
const screenOf = (page: Page) => page.evaluate(`document.querySelector('.cu').dataset.screen`) as Promise<string>;
/** Which Phaser renderer the game view really runs on: a WebGL canvas has no 2D context. */
const rendererOf = (page: Page) => page.evaluate(`document.querySelector('#game canvas').getContext('2d') ? 'canvas' : 'webgl'`) as Promise<Renderer>;
const sfx = (page: Page) => page.evaluate(`window.__sfx.splice(0)`) as Promise<string[]>;
const hookSfx = (page: Page) => page.evaluate(`(() => { const a = window.__cubicAudio; const play = a.playSfx.bind(a); window.__sfx = []; a.playSfx = (id) => { window.__sfx.push(id); play(id); }; })()`);

async function until(what: string, cond: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return fail(`timed out: ${what}`), false;
    await sleep(60);
  }
  return true;
}

/** Walk with `key` until the face changes. Returns the face reached. */
async function cross(page: Page, side: Side, key: string): Promise<number> {
  const from = (await pose(page, side)).face;
  for (let i = 0; i < FACE_SIZE + 2; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const face = (await pose(page, side)).face;
    if (face !== from) return face;
  }
  fail(`${side}: "${key}" never left face ${from}`);
  return from;
}

/** Client prediction and the server agree, and nothing is waiting for an ack. */
async function inSync(page: Page, side: Side, tag: string): Promise<void> {
  await until(`${tag}: every move acknowledged`, async () => (await net(page, (c) => c.pending.length)) === 0);
  const [mine, truth] = [await pose(page, side), await serverPose(page, side)];
  ok(JSON.stringify(mine) === JSON.stringify(truth), `${tag}: client and server agree (face ${truth.face} at ${truth.x},${truth.y})`);
}

async function live(browser: Browser, renderer: Renderer): Promise<void> {
  console.log(`live: two clients, ${renderer}`);
  const open = async (tag: string) => {
    const page = watch(await browser.newPage({ viewport: SIZE }), `${renderer} ${tag}`);
    await page.goto(`${BASE}/${query(renderer)}`);
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); // Play: the dive to the mode screen
    await page.waitForTimeout(1900);
    return page;
  };
  const press = async (page: Page, ...keys: string[]) => {
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.waitForTimeout(150);
    }
  };

  // --- a real room: create, join, pick sides, ready, start
  const a = await open('outside');
  await press(a, 'ArrowDown', 'Enter');
  if (!(await until('the host is in a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby'))) return;
  const code = (await net(a, (c) => c.code))!;
  const b = await open('inside');
  await press(b, 'ArrowDown', 'ArrowDown', 'Enter');
  await b.waitForTimeout(400);
  await b.keyboard.type(code);
  await press(b, 'Enter');
  await until('the guest joined', async () => (await net(b, (c) => c.code)) === code);
  await b.waitForTimeout(700);
  await press(a, 'a');
  await press(b, 'd');
  await until('sides picked', async () => (await net(a, (c) => c.side)) === 'out' && (await net(b, (c) => c.side)) === 'in');
  await b.waitForTimeout(400);
  await press(b, 'Enter');
  await a.waitForTimeout(600);
  await press(a, 'Enter');
  if (!(await until('the game started for both', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game'))) return;
  await a.waitForTimeout(1200);
  ok((await rendererOf(a)) === renderer && (await rendererOf(b)) === renderer, `the game view runs on ${renderer}`);
  await hookSfx(a);
  await hookSfx(b);

  // --- sound: both on face 1, so each hears the other's steps through the wall
  await press(b, 'w');
  await until('the outside player got the step', async () => (await a.evaluate(`window.__cubic.state.players.in.steps`)) === 1);
  ok((await sfx(a)).includes('step'), 'same face: the outside player hears the inside player step');
  await press(a, 'w');
  await until('the inside player got the step', async () => (await b.evaluate(`window.__cubic.state.players.out.steps`)) === 1);
  ok((await sfx(b)).includes('step'), 'same face: the inside player hears the outside player step');
  await press(a, 's');
  await sfx(a);
  await sfx(b);

  // --- outside: walk off the right edge. The roll plays, and input waits for it.
  for (let i = 0; i < FACE_SIZE; i++) {
    if ((await pose(a, 'out')).x === FACE_SIZE - 1) break;
    await press(a, 'd');
  }
  await sfx(a);
  await sfx(b);
  const stepsBefore = (await b.evaluate(`window.__cubic.state.players.in.steps`)) as number;
  await a.keyboard.press('d'); // over the edge
  await a.waitForTimeout(120);
  ok((await pose(a, 'out')).face === 2, 'outside walked off the right edge onto face 2');
  await a.keyboard.press('d');
  await a.keyboard.press('d');
  await a.keyboard.press('d');
  await b.keyboard.press('s'); // the partner moves while the cube rolls
  await a.waitForTimeout(130);
  await a.screenshot({ path: `${OUT}roll-mid-${renderer}.png` });
  ok((await pose(a, 'out')).x === 0, 'keys pressed during the roll are held back until it ends');
  ok(await until('partner update', async () => ((await a.evaluate(`window.__cubic.state.players.in.steps`)) as number) > stepsBefore, 400), 'the partner update arrives while the roll is still playing');
  ok((await pose(a, 'out')).x === 0, 'still rolling when the partner update arrived');
  await a.waitForTimeout(900);
  ok((await pose(a, 'out')).x === 3, `all 3 buffered steps were applied after the roll (x = ${(await pose(a, 'out')).x})`);
  await inSync(a, 'out', 'outside after the roll');
  ok((await sfx(a)).includes('flip'), 'your own face change dings');
  await b.waitForTimeout(300);
  ok(!(await sfx(b)).includes('flip'), "the partner's face change does not ding for you");

  // --- sound: outside on face 2, inside on face 1 = different faces, silent steps
  await press(b, 'w');
  await press(a, 'd');
  await a.waitForTimeout(400);
  const [heardA, heardB] = [await sfx(a), await sfx(b)];
  ok(heardA.filter((id) => id === 'step').length === 1, `other face: the outside player hears only their own step (${heardA.join(',')})`);
  ok(heardB.filter((id) => id === 'step').length === 1, `other face: the inside player hears only their own step (${heardB.join(',')})`);

  // --- outside: the other three edges (left = back to face 1, then top, then bottom)
  ok((await cross(a, 'out', 'a')) === 1, 'outside walked off the left edge, back to face 1');
  await a.waitForTimeout(700);
  await press(a, 'a'); // column 10: the corner tile above is a tree
  ok((await cross(a, 'out', 'w')) === 5, 'outside walked off the top edge onto face 5');
  await a.waitForTimeout(700);
  ok((await cross(a, 'out', 's')) === 1, 'outside walked off the bottom edge, back to face 1');
  await a.waitForTimeout(700);
  await inSync(a, 'out', 'outside after four edges');
  ok(!(await sfx(b)).includes('flip'), 'the inside player never heard the outside player change face');

  // --- inside: the hop, with input held back the same way, then all four edges
  await sfx(a);
  const start = await pose(b, 'in');
  ok(start.face === 1, 'inside starts on face 1');
  const first = await cross(b, 'in', 'd');
  ok(first === 4, `inside walked off the right edge onto face 4 (mirrored): ${first}`);
  await b.keyboard.press('d');
  await b.keyboard.press('d');
  await b.waitForTimeout(100);
  await b.screenshot({ path: `${OUT}hop-mid-${renderer}.png` });
  const landed = await pose(b, 'in');
  await b.waitForTimeout(800);
  const walked = await pose(b, 'in');
  ok(Math.abs(walked.x - landed.x) + Math.abs(walked.y - landed.y) === 2, 'inside: both steps pressed during the hop were applied after it');
  ok((await cross(b, 'in', 'a')) === 1, 'inside walked off the left edge, back to face 1');
  await b.waitForTimeout(600);
  ok((await cross(b, 'in', 'w')) === 5, 'inside walked off the top edge onto face 5');
  await b.waitForTimeout(600);
  ok((await cross(b, 'in', 's')) === 1, 'inside walked off the bottom edge, back to face 1');
  await b.waitForTimeout(600);
  await inSync(b, 'in', 'inside after four edges');
  ok(JSON.stringify(await pose(a, 'in')) === JSON.stringify(await pose(b, 'in')), 'the outside client has the inside player where the server put them');
  ok(!(await sfx(a)).includes('flip'), 'the outside player never heard the inside player change face');

  // --- reduce motion, from the real settings panel
  await a.locator('#cu-gear').click();
  await a.waitForTimeout(300);
  await a.locator('.cu-toggle[data-key="reduceMotion"]').click();
  await a.screenshot({ path: `${OUT}settings-reduce-motion-${renderer}.png` });
  await a.locator('#cu-settings [data-close]').click();
  await a.waitForTimeout(300);
  await press(a, 's'); // off the top row: its corner tile is a tree
  ok((await cross(a, 'out', 'd')) === 2, 'reduce motion: outside crossed to face 2');
  await a.waitForTimeout(60);
  await a.screenshot({ path: `${OUT}fade-mid-${renderer}.png` });
  await a.waitForTimeout(400);
  await inSync(a, 'out', 'outside after the fade');

  await a.close();
  await b.close();
}

/** Record `run` on the offline game and cut it into a GIF of the HUD around `clip`. */
async function gif(browser: Browser, name: string, url: string, clip: 'view' | 'hud', run: (page: Page) => Promise<void>, setup?: (page: Page) => Promise<void>): Promise<void> {
  const dir = `${OUT}.video`;
  rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir, size: SIZE } });
  const page = watch(await context.newPage(), name);
  const t0 = Date.now();
  await page.goto(`${BASE}/${url}`);
  await page.waitForTimeout(1500);
  await setup?.(page);
  await page.waitForTimeout(400);
  const mid = (await page.evaluate(`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }; return [r('.cu-hud > .cu-col'), r('.cu-mid')]; })()`)) as number[][];
  const from = (Date.now() - t0) / 1000;
  await run(page);
  await page.waitForTimeout(500);
  const length = (Date.now() - t0) / 1000 - from;
  await context.close();
  const video = `${dir}/${readdirSync(dir).find((f) => f.endsWith('.webm'))}`;
  const even = (n: number) => Math.round(n / 2) * 2;
  const [col, view] = [mid[0]!, mid[1]!];
  const x = even(clip === 'hud' ? col[0]! : view[0]!);
  const y = even(view[1]!);
  const w = even(view[2]! - x);
  const h = even(view[3]! - y);
  // native pixels and a palette made from the clip keep the art crisp
  const filter = `fps=20,crop=${w}:${h}:${x}:${y},split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', from.toFixed(2), '-t', length.toFixed(2), '-i', video, '-filter_complex', filter, `${OUT}${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
  console.log('  ', `${name}.gif`);
}

async function gifs(browser: Browser): Promise<void> {
  console.log('gifs');
  /** Put the shown player on a screen tile of face 1 (canonical up; the inside is mirrored). */
  const place = (side: Side, sx: number, sy: number) => async (page: Page) => {
    const x = side === 'out' ? sx : FACE_SIZE - 1 - sx;
    await page.evaluate(`(() => { const c = window.__cubic; Object.assign(c.state.players.${side}.pose, { face: 1, up: [0, 1, 0], x: ${x}, y: ${sy} }); c.move(0, 1); })()`);
  };
  const keys = (list: string, gap = 230) => async (page: Page) => {
    for (const k of list.split(' ')) {
      if (k === '-') await page.waitForTimeout(450);
      else {
        await page.keyboard.press(k);
        await page.waitForTimeout(gap);
      }
    }
  };
  const faceIs = async (page: Page, side: Side, face: number, what: string) => ok((await pose(page, side)).face === face, `${what}: ended on face ${face}`);

  for (const renderer of RENDERERS) {
    for (const side of ['out', 'in'] as const) {
      const kind = side === 'out' ? 'roll' : 'hop';
      const url = query(renderer, `mock=game&side=${side}`);
      // Right edge and back over the left edge, then the top edge and back over the bottom edge.
      await gif(
        browser,
        `${kind}-edges-${renderer}`,
        url,
        'view',
        async (page) => {
          await keys('d d d - a - a w w - s -')(page);
          await faceIs(page, side, 1, `${kind} edges ${renderer}`);
        },
        place(side, 9, 0),
      );
      // Around one corner: up, right, down. Three edges and we are home, turned 90 degrees.
      // (One extra step right on the second face: the corner tile of face 1 is a tree.)
      await gif(
        browser,
        `${kind}-corner-${renderer}`,
        url,
        'hud',
        async (page) => {
          await keys('w w - w d d - d d s s - s -')(page);
          await faceIs(page, side, 1, `${kind} corner ${renderer}`);
          const up = (await pose(page, side)).up;
          ok(JSON.stringify(up) !== JSON.stringify([0, 1, 0]), `${kind} corner ${renderer}: back on face 1 with the compass turned (up ${up.join(',')})`);
        },
        place(side, 9, 0),
      );
    }
  }
  // Reduce motion: the same walk with the toggle on (set through the real panel).
  for (const side of ['out', 'in'] as const) {
    const before = place(side, 9, 0);
    await gif(browser, `fade-edges-${side}`, query('webgl', `mock=game&side=${side}`), 'view', keys('d d d - a - a w w - s -', 200), async (page) => {
      await page.locator('#cu-gear').click();
      await page.waitForTimeout(300);
      await page.locator('.cu-toggle[data-key="reduceMotion"]').click();
      await page.locator('#cu-settings [data-close]').click();
      await before(page);
    });
  }
}

const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'live') for (const renderer of RENDERERS) await live(browser, renderer);
  if (!ONLY || ONLY === 'gifs') await gifs(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}`);
  process.exit(1);
}
console.log('\nall transition checks passed');
