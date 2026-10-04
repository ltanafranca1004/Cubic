// The face transitions, checked live and recorded as GIFs into docs/screens/transitions.
//
//  live:  two real clients in one room, in WebGL and again in Phaser's Canvas fallback.
//         Both players cross all four edges with the keyboard. Asserts: the transition
//         plays, keys pressed during it are applied after it (none dropped), the partner's
//         moves keep arriving meanwhile, client and server agree afterwards, the partner's
//         footsteps are heard only on the same face number and their ding never.
//  frames: the inside hop over all four edges with the page clock stepped by hand: one
//         sheet per direction (hop-frames-*.png), and WebGL and Canvas must match pixel
//         for pixel at every step, also from the top row with an item carried.
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
/** SIZE=1920x1080 runs at another window size. */
const [SIZE_W, SIZE_H] = (process.env.SIZE ?? '1280x720').split('x').map(Number);
const SIZE = { width: SIZE_W!, height: SIZE_H! };
const ONLY = process.argv[2]; // live | gifs
/** RENDERER=webgl (or canvas) runs one renderer only. */
const RENDERERS = (['webgl', 'canvas'] as const).filter((r) => !process.env.RENDERER || process.env.RENDERER === r);
type Renderer = 'webgl' | 'canvas';

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
/** The recordings show the game view alone: no first-run cards or captions on top of it. */
const bare = (page: Page) => page.addStyleTag({ content: '.cu-onb, #cu-caption { display: none !important; }' });

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
  // The checks come before the screenshot, and the partner update is watched inside the
  // page: a slow screenshot or round trip can outlast the roll.
  ok((await pose(a, 'out')).x === 0, 'keys pressed during the roll are held back until it ends');
  const seenAt = (await a.evaluate(`new Promise((done) => { const t0 = performance.now(); const tick = () => { const p = window.__cubic.state.players; if (p.in.steps > ${stepsBefore}) done(p.out.pose.x); else if (performance.now() - t0 > 400) done(null); else setTimeout(tick, 10); }; tick(); })`)) as number | null;
  ok(seenAt !== null, 'the partner update arrives while the roll is still playing');
  ok(seenAt === 0, 'still rolling when the partner update arrived');
  await a.screenshot({ path: `${OUT}roll-mid-${renderer}.png` });
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
  // Read the pose before the screenshot: a slow screenshot can outlast the hop.
  const landed = await pose(b, 'in');
  await b.waitForTimeout(100);
  await b.screenshot({ path: `${OUT}hop-mid-${renderer}.png` });
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
  await bare(page);
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
  // the view, or the view and the HUD column to its right
  const x = even(view[0]!);
  const y = even(view[1]!);
  const w = even((clip === 'hud' ? col[2]! : view[2]!) - x);
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

/** How many pixels differ between two PNGs of the same size (-1: the sizes differ), and where. */
async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<{ n: number; box: number[] }> {
  const urls = [a, b].map((png) => `data:image/png;base64,${png.toString('base64')}`);
  return page.evaluate(`(async () => {
    const data = await Promise.all(${JSON.stringify(urls)}.map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height);
    }));
    const [p, q] = data;
    if (p.width !== q.width || p.height !== q.height) return { n: -1, box: [] };
    let n = 0;
    const box = [p.width, p.height, -1, -1];
    for (let i = 0; i < p.data.length; i += 4) {
      if (p.data[i] === q.data[i] && p.data[i + 1] === q.data[i + 1] && p.data[i + 2] === q.data[i + 2]) continue;
      const [x, y] = [(i / 4) % p.width, Math.floor(i / 4 / p.width)];
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      n++;
    }
    return { n, box };
  })()`) as Promise<{ n: number; box: number[] }>;
}

/**
 * The inside hop, frame by frame: the page clock is stepped by hand, so every renderer is
 * caught at the very same moments of the hop over each of the four edges. Writes one sheet
 * per direction and asserts that WebGL and Canvas draw the same pixels.
 */
async function frames(browser: Browser): Promise<void> {
  console.log('frames: the hop, stepped');
  // ms into the 400 ms hop. Whole frames of the stepped clock (16 ms), so every run lands on the same moments.
  const AT = [16, 64, 112, 160, 192, 240, 288, 336, 384];
  const HOPS = [
    { name: 'right', walk: ['d', 'd'], key: 'd', face: 4 },
    { name: 'left', walk: [], key: 'a', face: 1 },
    { name: 'up', walk: ['a', 'w'], key: 'w', face: 5 },
    { name: 'down', walk: [], key: 's', face: 1 },
  ];
  const dir = `${OUT}.frames/`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shots: Record<string, Buffer[]> = {};
  for (const renderer of RENDERERS) {
    for (const carry of [false, true]) {
      const tag = `${renderer}${carry ? '-carry' : ''}`;
      const page = watch(await browser.newPage({ viewport: SIZE }), `frames ${tag}`);
      await page.clock.install({ time: 0 });
      await page.goto(`${BASE}/${query(renderer, 'mock=game&side=in')}`);
      await page.waitForTimeout(1500);
      await bare(page);
      // Face 1, canonical up, near the right edge: one tile under the top edge (as in the GIFs),
      // or right on the top row when carrying, where the hop has to stay in view.
      await page.evaluate(`(() => { const c = window.__cubic; Object.assign(c.state.players.in.pose, { face: 1, up: [0, 1, 0], x: ${FACE_SIZE - 1 - 9}, y: 0 });${carry ? ` const id = Object.keys(c.state.items)[0]; if (id) { c.state.players.in.carrying = id; Object.assign(c.state.items[id], { side: 'in', carriedBy: 'in' }); }` : ''} c.move(0, 1);${carry ? ' c.move(0, -1);' : ''} })()`);
      await page.waitForTimeout(400);
      await page.clock.pauseAt(Math.ceil((((await page.evaluate('Date.now()')) as number) + 200) / 16) * 16);
      const box = (await page.evaluate(`(() => { const b = document.querySelector('.cu-view').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`)) as number[];
      const clip = { x: Math.round(box[0]!), y: Math.round(box[1]!), width: Math.round(box[2]!), height: Math.round(box[3]!) };
      shots[tag] = [];
      if (carry) ok(!!(await page.evaluate(`window.__cubic.state.players.in.carrying`)), `frames ${tag}: the inside player carries an item`);
      for (const hop of HOPS) {
        for (const k of hop.walk) {
          if (carry && k === 'w') continue; // already on the top row
          await page.keyboard.press(k);
          await page.clock.runFor(240);
        }
        await page.clock.runFor(96);
        await page.keyboard.press(hop.key);
        ok((await pose(page, 'in')).face === hop.face, `frames ${tag}: hop ${hop.name} onto face ${hop.face}`);
        let now = 0;
        for (const [i, at] of AT.entries()) {
          await page.clock.runFor(at - now);
          now = at;
          const png = await page.screenshot({ clip, path: renderer !== 'canvas' ? undefined : `${dir}${carry ? 'carry-' : ''}${hop.name}-${String(i).padStart(2, '0')}.png` });
          shots[tag]!.push(png);
        }
        await page.clock.runFor(608);
      }
      if (renderer === 'webgl') {
        await page.close();
        continue;
      }
      const other = shots[`webgl${carry ? '-carry' : ''}`]!;
      let same = 0;
      for (const [i, png] of shots[tag]!.entries()) {
        const diff = await pixelDiff(page, png, other[i]!);
        if (diff.n === 0) same++;
        else fail(`frames${carry ? ' (carrying)' : ''}: hop ${HOPS[Math.floor(i / AT.length)]!.name} at ${AT[i % AT.length]} ms differs between WebGL and Canvas (${diff.n} px, box ${diff.box.join(',')})`);
      }
      ok(same === HOPS.length * AT.length, `frames${carry ? ' (carrying)' : ''}: WebGL and Canvas are pixel-identical on ${same}/${HOPS.length * AT.length} mid-hop frames`);
      // A frame that is all one moment would prove nothing: the hop must actually move.
      ok((await pixelDiff(page, shots[tag]![0]!, shots[tag]![4]!)).n > 1000, `frames${carry ? ' (carrying)' : ''}: the frames differ over time`);
      await page.close();
    }
  }
  for (const name of [...HOPS.map((hop) => hop.name), 'carry-right']) {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${dir}${name}-%02d.png`, '-vf', 'tile=3x3:padding=4:color=white', '-frames:v', '1', '-update', '1', `${OUT}hop-frames-${name}.png`]);
    console.log('  ', `hop-frames-${name}.png`);
  }
  rmSync(dir, { recursive: true, force: true });
}

const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  if (!ONLY || ONLY === 'live') for (const renderer of RENDERERS) await live(browser, renderer);
  if (!ONLY || ONLY === 'frames') await frames(browser);
  if (!ONLY || ONLY === 'gifs') await gifs(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}`);
  process.exit(1);
}
console.log('\nall transition checks passed');
