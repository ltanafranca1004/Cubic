// Screenshots and a check of the in-game HUD: the game view on the left at its own
// whole-number zoom, one column on the right. Both sides, both Phaser renderers (WebGL and
// the Canvas fallback), at 1920x1080 and 1280x720, from the offline game (?mock=game) and
// from a real two-client game. It fails if the view is not at the zoom it should have, if
// anything of the HUD overlaps or leaves the window, or on a console error.
//
//   server:  PORT=3330 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server   (dev commands: solving for the portal)
//   client:  VITE_SERVER_URL=http://localhost:3330 npm run dev -w client -- --port 5430
//   run:     cd tools && BASE=http://localhost:5430 npx tsx screens/hud.ts
//
// Screenshots go to docs/screens/hud/.
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { hudScale, viewZoom } from '../../client/src/style/scale';
import { FACE_HUD, VIEW } from '../../client/src/style/tokens';

const BASE = process.env.BASE ?? 'http://localhost:5430';
const OUT = new URL('../../docs/screens/hud/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { width: 1920, height: 1080, zoom: 5 },
  { width: 1280, height: 720, zoom: 3 },
] as const;
const RENDERERS = ['webgl', 'canvas'] as const;
const SIDES = ['out', 'in'] as const;

interface Cubic {
  code: string | null;
  side: string | null;
  room: { phase: string } | null;
  state: { solved: number[]; players: Record<string, { pose: { face: number } }> } | null;
  dev(cmd: object): Promise<{ ok: boolean; error?: string }>;
}
declare const window: { __cubic: Cubic };

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

async function open(browser: Browser, size: { width: number; height: number }, query: string, tag: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fail(`${tag}: console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  await page.addInitScript('window.__name = (f) => f'); // tsx names the functions it sends to the page
  await page.goto(`${BASE}/${query}`);
  // the pictures are of the HUD: no onboarding card or hint over it
  await page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  return page;
}

/** The layout rules: zoom, whole pixels, nothing over anything else, nothing off the window. */
async function checkLayout(page: Page, tag: string, size: { width: number; height: number; zoom?: number }): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (s: string) => {
      const el = document.querySelector<HTMLElement>(s);
      if (!el || el.offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const canvas = document.querySelector<HTMLCanvasElement>('#game canvas')!;
    const cu = document.querySelector<HTMLElement>('.cu')!;
    return {
      canvas: box('#game canvas'),
      canvasPx: canvas.width,
      u: Number(cu.style.getPropertyValue('--u')),
      z: Number(cu.style.getPropertyValue('--z')),
      view: box('#cu-view'),
      mid: box('.cu-mid'),
      col: box('.cu-col'),
      top: box('.cu-top'),
      edges: ['#cu-et', '#cu-eb', '#cu-el', '#cu-er'].map(box),
      panels: [...document.querySelectorAll<HTMLElement>('.cu-col > *')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
      // text that is cut off inside the column
      clipped: [...document.querySelectorAll<HTMLElement>('.cu-col .cu-face, .cu-col .cu-prog, .cu-col .cu-vrow, .cu-col .cu-side, .cu-col .cu-vbtns, .cu-col .cu-stats')].filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
      strikes: box('#cu-strikebox') !== null,
      drift: document.body.innerText.toLowerCase().includes('drift'),
      hero: !!document.querySelector('.cu-hero'),
    };
  });
  const want = size.zoom ?? viewZoom(size.width, size.height);
  if (m.z !== want) fail(`${tag}: zoom is x${m.z}, wanted x${want}`);
  if (m.u !== hudScale(size.width, size.height)) fail(`${tag}: HUD scale is ${m.u}, wanted ${hudScale(size.width, size.height)}`);
  if (!m.canvas || !m.view || !m.mid || !m.col || !m.top) return void fail(`${tag}: a part of the HUD is missing`);
  const side = m.canvas.right - m.canvas.left;
  if (side !== VIEW.px * want || m.canvas.bottom - m.canvas.top !== side) fail(`${tag}: the canvas is ${side}px, wanted ${VIEW.px * want}`);
  for (const [name, v] of Object.entries({ left: m.canvas.left, top: m.canvas.top })) if (!Number.isInteger(v)) fail(`${tag}: the canvas is on a fraction of a pixel (${name} ${v})`);
  const all: [string, Box][] = [['view block', m.mid], ['column', m.col], ['top bar', m.top], ...m.edges.map((e, i): [string, Box] => [`edge label ${i}`, e!])];
  for (const [name, b] of all) if (b.left < 0 || b.top < 0 || b.right > size.width || b.bottom > size.height) fail(`${tag}: the ${name} leaves the window (${JSON.stringify(b)})`);
  if (overlap(m.mid, m.col)) fail(`${tag}: the column overlaps the view`);
  if (overlap(m.mid, m.top)) fail(`${tag}: the top bar overlaps the view`);
  if (m.mid.right > m.col.left) fail(`${tag}: the view is not left of the column`);
  for (const e of m.edges) if (!e || overlap(e, m.view)) fail(`${tag}: an edge label is missing or over the view`);
  const stack = [m.top, ...m.panels];
  for (let i = 1; i < stack.length; i++) {
    if (stack[i]!.top < stack[i - 1]!.bottom - 0.5) fail(`${tag}: column part ${i} overlaps the one above it`);
    if (i > 1 && (stack[i]!.left !== stack[1]!.left || stack[i]!.right !== stack[1]!.right)) fail(`${tag}: column part ${i} is not as wide as the first`);
  }
  if (m.top.left !== m.col.left || m.top.right !== m.col.right) fail(`${tag}: the top bar is not the width of the column`);
  if (m.clipped.length) fail(`${tag}: text is cut off in ${m.clipped.join(', ')}`);
  if (m.drift) fail(`${tag}: the Drift row is still there`);
  if (m.hero) fail(`${tag}: the striped icon is still there`);
  if (m.strikes) fail(`${tag}: strikes are shown with none`);
}

/** The six HUD colours of a side are six different colours, and the chips on screen use them. */
async function checkColours(page: Page, tag: string, side: 'out' | 'in'): Promise<void> {
  const want = [1, 2, 3, 4, 5, 6].map((f) => FACE_HUD[f as 1][side]);
  if (new Set(want).size !== 6) fail(`${tag}: two faces share a HUD colour`);
  const got = await page.evaluate(() => {
    const hex = (rgb: string) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return [...document.querySelectorAll<HTMLElement>('.cu-chip[data-face]')].map((el) => [Number(el.dataset.face), hex(getComputedStyle(el).backgroundColor)] as const);
  });
  if (got.length < 9) fail(`${tag}: only ${got.length} face chips on screen (4 on the view, 4 on the cube, 1 by the name)`);
  for (const [face, colour] of got) if (colour !== want[face - 1]) fail(`${tag}: a chip of face ${face} is ${colour}, wanted ${want[face - 1]}`);
}

async function mock(browser: Browser): Promise<void> {
  for (const size of SIZES)
    for (const renderer of RENDERERS)
      for (const side of SIDES) {
        const tag = `mock-${side}-${size.width}x${size.height}-${renderer}`;
        console.log(tag);
        const page = await open(browser, size, `?mock=game&side=${side}&renderer=${renderer}`, tag);
        await page.waitForSelector('.cu[data-screen="game"] #game canvas');
        await sleep(900);
        await checkLayout(page, tag, size);
        await checkColours(page, tag, side);
        await page.screenshot({ path: `${OUT}${tag}.png` });
        if (size.width === 1280 && renderer === 'canvas') {
          // quick chat still works, and its bubble sits on the player in the view's own pixels
          await page.keyboard.press('1');
          await page.waitForSelector('.cu-bubble.mine');
          const ok = await page.evaluate(() => {
            const b = document.querySelector('.cu-bubble')!.getBoundingClientRect();
            const v = document.querySelector('#game canvas')!.getBoundingClientRect();
            return b.left >= v.left && b.right <= v.right && b.top >= v.top && b.bottom <= v.bottom;
          });
          if (!ok) fail(`${tag}: the quick-chat bubble is not inside the view`);
          // Tab: the cube map is centred on the view
          await page.keyboard.down('Tab');
          await sleep(200);
          const off = await page.evaluate(() => {
            const p = document.querySelector('.cu-cubemap .cu-panel')!.getBoundingClientRect();
            const v = document.querySelector('#cu-view')!.getBoundingClientRect();
            return Math.abs((p.left + p.right) / 2 - (v.left + v.right) / 2);
          });
          if (off > 1) fail(`${tag}: the cube map is ${off}px off the middle of the view`);
          await page.screenshot({ path: `${OUT}${tag}-quick-and-map.png` });
          await page.keyboard.up('Tab');
        }
        if (size.width === 1280 && renderer === 'canvas') {
          // every face solved: the six pips show the six colours of this side, the portal is open
          await page.evaluate(() => {
            const c = window.__cubic as unknown as { state: { solved: number[]; wonAt: number | null }; move(dx: number, dy: number): void };
            c.state.solved = [1, 2, 3, 4, 5, 6];
            c.move(0, -1);
          });
          await sleep(500);
          const pips = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#cu-pips > i')].map((el) => getComputedStyle(el).backgroundColor));
          await page.addStyleTag({ content: '#cu-prog.open .cu-pips { display: flex !important; } #cu-portal { display: none !important; }' }); // (the pips give way to PORTAL OPEN: show them for the picture)
          await sleep(100);
          const shown = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#cu-pips > i')].slice(0, 5).map((el) => getComputedStyle(el).backgroundColor));
          if (new Set(shown).size !== 5 || pips.length !== 6) fail(`${tag}: the solved pips are not all different (${shown.join(' ')})`);
          await page.screenshot({ path: `${OUT}${tag}-six-colours.png` });
          // the win screen: the title, the time, leave or play again
          await page.evaluate(() => {
            const c = window.__cubic as unknown as { state: { wonAt: number | null }; move(dx: number, dy: number): void };
            c.state.wonAt = Date.now();
            c.move(0, -1);
          });
          await page.waitForSelector('#cu-win.on');
          await sleep(500);
          const win = await page.evaluate(() => {
            const w = document.querySelector<HTMLElement>('#cu-win .cu-win')!;
            const r = w.getBoundingClientRect();
            return { title: w.querySelector('h2')!.textContent, time: w.querySelector('#cu-wintime')!.textContent, text: w.querySelector('#cu-wintxt')!.textContent, buttons: [...w.querySelectorAll('button')].map((b) => b.textContent!.trim()), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, clipped: w.scrollWidth > w.clientWidth + 1 };
          });
          if (win.title !== 'The cube opens' || !/^\d+:\d\d$/.test(win.time ?? '') || win.buttons.join('|') !== 'Leave|Play again' || !win.inside || win.clipped || /strike/.test(win.text ?? '')) fail(`${tag}: the win screen is wrong: ${JSON.stringify(win)}`);
          await page.screenshot({ path: `${OUT}${tag}-win.png` });
        }
        await page.close();
      }
  // a phone held sideways: nothing may leave the window (the mobile layout refines it)
  const phone = { width: 844, height: 390 };
  for (const side of SIDES) {
    const tag = `mock-${side}-844x390`;
    console.log(tag);
    const page = await open(browser, phone, `?mock=game&side=${side}&renderer=canvas`, tag);
    await page.waitForSelector('.cu[data-screen="game"] #game canvas');
    await sleep(900);
    await checkLayout(page, tag, phone);
    await page.screenshot({ path: `${OUT}${tag}.png` });
    await page.close();
  }
}

async function real(browser: Browser): Promise<void> {
  for (const size of SIZES)
    for (const renderer of RENDERERS) {
      const tag = `real-${size.width}x${size.height}-${renderer}`;
      console.log(tag);
      const a = await open(browser, size, `?renderer=${renderer}`, `${tag}-out`);
      const b = await open(browser, size, `?renderer=${renderer}`, `${tag}-in`);
      // two keyboards: create and join by code, pick sides, ready, start
      await a.waitForFunction(() => !!window.__cubic);
      await a.evaluate(() => (window.__cubic as unknown as { createRoom(): void }).createRoom());
      await a.waitForFunction(() => !!window.__cubic.code);
      const code = (await a.evaluate(() => window.__cubic.code))!;
      await b.waitForFunction(() => !!window.__cubic);
      await b.evaluate((c) => (window.__cubic as unknown as { joinRoom(c: string): void }).joinRoom(c), code);
      await b.waitForFunction(() => window.__cubic.room?.phase === 'lobby');
      await a.evaluate(() => (window.__cubic as unknown as { pickSide(s: string): void }).pickSide('out'));
      await b.evaluate(() => (window.__cubic as unknown as { pickSide(s: string): void }).pickSide('in'));
      await sleep(200);
      await b.evaluate(() => (window.__cubic as unknown as { setReady(r: boolean): void }).setReady(true));
      await sleep(200);
      await a.evaluate(() => (window.__cubic as unknown as { startGame(): void }).startGame());
      for (const p of [a, b]) await p.waitForSelector('.cu[data-screen="game"] #game canvas');
      await sleep(1500);
      await a.keyboard.press('Enter');
      await a.keyboard.type('I see a door with a crystal behind it.');
      await a.keyboard.press('Enter');
      await b.keyboard.press('2');
      await sleep(400);
      for (const [page, side] of [[a, 'out'], [b, 'in']] as const) {
        await checkLayout(page, `${tag}-${side}`, size);
        await checkColours(page, `${tag}-${side}`, side);
        await page.screenshot({ path: `${OUT}${tag}-${side}.png` });
      }
      if (size.width === 1920 && renderer === 'canvas') {
        // progress and the win screen: solve every puzzle through the dev command, then win
        const total = await a.evaluate(() => Number(document.querySelector('#cu-progn')!.textContent!.split('/')[1]));
        const faces = [1, 2, 3, 4, 5, 6];
        let solved = 0;
        for (const face of faces) {
          const res = await a.evaluate((f) => window.__cubic.dev({ type: 'solve', face: f }), face);
          if (!res.ok) continue;
          await sleep(150);
          const now = await a.evaluate(() => window.__cubic.state!.solved.length);
          if (now > solved) {
            solved = now;
            const text = await a.evaluate(() => document.querySelector('#cu-progn')!.textContent);
            if (text !== `${solved}/${total}`) fail(`${tag}: progress says ${text} with ${solved} of ${total} solved`);
          }
        }
        if (solved !== total) fail(`${tag}: could solve ${solved} of ${total} puzzles with the dev command`);
        else {
          await sleep(300);
          const portal = await a.evaluate(() => !document.querySelector<HTMLElement>('#cu-portal')!.hidden && document.querySelector('#cu-portal')!.textContent);
          if (portal !== 'Portal open') fail(`${tag}: no PORTAL OPEN with every puzzle solved (${portal})`);
          await a.screenshot({ path: `${OUT}${tag}-portal-open-out.png` });
          await b.screenshot({ path: `${OUT}${tag}-portal-open-in.png` });
        }
      }
      await a.close();
      await b.close();
    }
}

const browser = await chromium.launch();
try {
  if (process.argv[2] !== 'real') await mock(browser);
  if (process.argv[2] !== 'mock') await real(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nHUD: all checks passed. Screenshots in docs/screens/hud/');
