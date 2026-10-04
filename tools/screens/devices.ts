// EVERY KIND OF SCREEN, in every engine: phones, foldables, tablets, laptops, desktops and
// odd windows, on WebKit, Chromium and Firefox. Checks that the page fits (canvas never
// stretched or cropped, no white, controls only for fingers and never on the view, the
// rotate card only on a touch screen held upright) and builds one contact sheet per engine.
//
//   needs:  npm run dev   (BASE overrides http://localhost:5173)
//   run:    cd tools && npx tsx screens/devices.ts [webkit chromium firefox]
//   output: docs/status/screens-fix/<engine>.png (+ the single shots in <engine>/)
//
// The game screens are the offline game (?mock=game), so no server and no second player.

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, firefox, webkit, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import { metrics } from './probe-fit';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = new URL('../../docs/status/screens-fix/', import.meta.url).pathname;
const ENGINES = { webkit, chromium, firefox };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Size {
  name: string;
  width: number;
  height: number;
  dpr: number;
  touch: boolean;
  /** the menus too (mode, join, lobby, settings, pause) */
  full?: boolean;
}

const named = (device: string, label = device): Size[] =>
  [`${device} landscape`, device].map((id) => {
    const d = devices[id]!;
    return { name: `${label}${id.endsWith('landscape') ? '' : ' upright'}`, width: d.viewport.width, height: d.viewport.height, dpr: d.deviceScaleFactor, touch: true };
  });
const custom = (name: string, width: number, height: number, dpr: number): Size[] => [
  { name, width, height, dpr, touch: true },
  { name: `${name} upright`, width: height, height: width, dpr, touch: true },
];
const mouse = (name: string, width: number, height: number, dpr = 1): Size => ({ name, width, height, dpr, touch: false });

const SIZES: Size[] = [
  // phones, smallest to largest, iOS and Android
  ...named('iPhone SE'),
  ...named('iPhone SE (3rd gen)', 'iPhone SE 3'),
  ...named('iPhone 14'),
  ...named('iPhone 17 Pro Max'),
  ...named('Galaxy S9+'),
  ...named('Galaxy S24'),
  ...named('Pixel 7'),
  // foldables, folded and unfolded
  ...named('Galaxy Z Fold 7 Cover', 'Z Fold 7 folded'),
  ...named('Galaxy Z Fold 7', 'Z Fold 7 unfolded'),
  ...named('Galaxy Z Fold 6', 'Z Fold 6 unfolded'),
  ...named('Galaxy Z Flip 7', 'Z Flip 7'),
  ...named('Galaxy Z Flip 6 Cover', 'Z Flip 6 cover'),
  // tablets, small to large
  ...named('Nexus 7'),
  ...named('iPad Mini'),
  ...named('iPad (gen 7)', 'iPad 7'),
  ...named('iPad (gen 11)', 'iPad 11'),
  ...named('iPad Pro 11'),
  ...custom('iPad Air Safari', 1180, 746, 2),
  ...custom('iPad Pro 13', 1366, 1024, 2),
  ...named('Galaxy Tab S4'),
  ...named('Galaxy Tab S9'),
  // laptops
  mouse('laptop', 1280, 720),
  mouse('laptop', 1366, 768),
  mouse('laptop', 1440, 900),
  mouse('laptop 125%', 1536, 864, 1.25),
  mouse('MacBook', 1512, 982, 2),
  // desktops
  mouse('desktop', 1920, 1080),
  mouse('desktop', 2560, 1440),
  mouse('ultrawide', 3440, 1440),
  // odd windows
  mouse('short window', 1280, 400),
  mouse('short window', 800, 300),
  mouse('narrow window', 400, 800),
];
for (const s of SIZES) {
  if ((s.width === 568 && s.height === 320) || (s.name === 'iPad Air Safari') || (!s.touch && ((s.width === 1280 && s.height === 720) || s.width === 1920))) s.full = true;
}

const problems: string[] = [];
const WHITE = /rgba?\(255, 255, 255(, 1)?\)/;

interface Rect { 0: number; 1: number; 2: number; 3: number }

function check(engine: string, size: Size, screen: string, m: Record<string, unknown>, extra: { pad: boolean; padRect: number[] | null; actsRect: number[] | null; rotate: boolean }): void {
  const at = `${engine} ${size.name} ${size.width}x${size.height} ${screen}`;
  const bad = (what: string) => problems.push(`${at}: ${what}`);
  const [vw, vh] = m.inner as number[];
  const [sw, sh] = m.scroll as number[];
  if (sw > vw + 1 || sh > vh + 1) bad(`the page scrolls (${sw}x${sh})`);
  if (WHITE.test(m.bodyBg as string)) bad('white page background');
  const upright = size.touch && size.height > size.width;
  if (extra.rotate !== upright) bad(upright ? 'no rotate card' : 'rotate card on a screen that is not a touch screen held upright');
  for (const c of m.canvases as { where: string; backing: number[]; rect: Rect }[]) {
    const w = c.rect[2];
    const h = c.rect[3];
    if (c.where === 'game' && !screen.startsWith('game')) continue;
    if (!w || !h) continue;
    if (Math.abs(w / h - c.backing[0] / c.backing[1]) > 0.02) bad(`${c.where} canvas stretched: ${c.backing.join('x')} shown at ${w}x${h}`);
    if (c.where === 'stage' && (w < vw - 1 || h < vh - 1 || w > vw + 12 || h > vh + 12)) bad(`stage canvas is ${w}x${h} in a ${vw}x${vh} window`);
    if (c.where === 'game' && !upright && (c.rect[0] < -0.5 || c.rect[1] < -0.5 || c.rect[0] + w > vw + 0.5 || c.rect[1] + h > vh + 0.5) && Math.min(vw, vh) >= 192) bad(`game view cut off: ${[c.rect[0], c.rect[1], w, h].join(',')}`);
    if (c.where === 'game' && !upright) {
      for (const [name, r] of [['d-pad', extra.padRect], ['buttons', extra.actsRect]] as const) {
        if (r && r[2] > 0 && r[0] < c.rect[0] + w - 1 && r[0] + r[2] > c.rect[0] + 1 && r[1] < c.rect[1] + h - 1 && r[1] + r[3] > c.rect[1] + 1) bad(`${name} over the game view`);
      }
    }
  }
  if (screen.startsWith('game') && !upright && extra.pad !== size.touch) bad(size.touch ? 'no touch controls' : 'touch controls with a mouse');
}

async function extras(page: Page) {
  return page.evaluate(`(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
    const pad = r('.cu-m-pad');
    return { pad: !!pad && pad[2] > 0, padRect: pad, actsRect: r('.cu-m-acts'), rotate: !!document.querySelector('.cu-m-rotate.on') };
  })()`) as Promise<{ pad: boolean; padRect: number[] | null; actsRect: number[] | null; rotate: boolean }>;
}

async function clickCanvas(page: Page, label: string): Promise<void> {
  const deadline = Date.now() + 6000;
  for (;;) {
    const at = (await page.evaluate(`(() => {
      const b = window.__cubicButtons().find((x) => x.label === ${JSON.stringify(label)} && x.enabled);
      if (!b) return null;
      const c = document.querySelector('#cu-stage canvas'); const r = c.getBoundingClientRect(); const s = r.width / c.width;
      return { x: r.left + (b.x + b.width / 2) * s, y: r.top + (b.y + b.height / 2) * s };
    })()`)) as { x: number; y: number } | null;
    if (at) {
      await page.mouse.click(at.x, at.y);
      return;
    }
    if (Date.now() > deadline) throw new Error(`no button ${label}`);
    await sleep(150);
  }
}

interface Row { size: Size; shots: Record<string, string> }

async function runSize(engine: keyof typeof ENGINES, browser: Browser, size: Size, index: number): Promise<Row> {
  const opts: BrowserContextOptions = { viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr };
  // Firefox has no mobile emulation: the touch layout is asked for with ?touch there
  if (size.touch) Object.assign(opts, engine === 'firefox' ? { hasTouch: true } : { hasTouch: true, isMobile: true });
  const flag = size.touch ? 'touch=1' : 'touch=0';
  const url = (query: string) => `${BASE}/?${[query, engine === 'firefox' || !size.touch ? flag : ''].filter(Boolean).join('&')}`;
  const ctx = await browser.newContext(opts);
  const dir = `${OUT}${engine}/`;
  const row: Row = { size, shots: {} };
  const upright = size.touch && size.height > size.width;
  const shoot = async (page: Page, screen: string) => {
    const file = `${dir}${String(index).padStart(2, '0')}-${screen}.png`;
    await page.screenshot({ path: file, scale: 'css' });
    row.shots[screen] = file;
    check(engine, size, screen, await metrics(page), await extras(page));
  };
  const open = async (query: string, wait = 1400) => {
    const page = await ctx.newPage();
    await page.goto(url(query));
    await page.waitForSelector('#cu-stage canvas', { timeout: 20000 });
    await sleep(wait);
    return page;
  };
  try {
    const title = await open('');
    await shoot(title, 'title');
    if (size.full && !upright) {
      await title.click('#cu-gear');
      await title.waitForSelector('#cu-settings.on');
      await sleep(400);
      await shoot(title, 'settings');
      await title.click('#cu-settings [data-close]');
      await sleep(300);
      await clickCanvas(title, 'PLAY');
      await sleep(2200);
      await shoot(title, 'mode');
      await clickCanvas(title, 'JOIN LOBBY');
      await sleep(900);
      await shoot(title, 'join');
      const lobby = await open('mock=lobby');
      await shoot(lobby, 'lobby');
      await lobby.close();
    }
    await title.close();
    for (const side of upright ? (['out'] as const) : (['out', 'in'] as const)) {
      const page = await open(`mock=game&side=${side}`, 2200);
      await shoot(page, `game-${side}`);
      if (size.full && side === 'out') {
        // (the first Escape puts away the first-run card, the next one pauses)
        for (let i = 0; i < 4 && !(await page.$('#cu-pause.on')); i++) {
          await sleep(1500);
          await page.keyboard.press('Escape');
          await sleep(400);
        }
        await page.waitForSelector('#cu-pause.on', { timeout: 4000 });
        await sleep(400);
        await shoot(page, 'pause');
      }
      await page.close();
    }
  } catch (e) {
    problems.push(`${engine} ${size.name} ${size.width}x${size.height}: ${(e as Error).message.split('\n')[0]}`);
  }
  await ctx.close();
  return row;
}

async function sheet(engine: string, rows: Row[]): Promise<void> {
  const img = (file?: string) => (file ? `<img src="file://${file}">` : '<i></i>');
  const cell = (r: Row) => `<figure><figcaption>${r.size.name} &middot; ${r.size.width}x${r.size.height} @${r.size.dpr}${r.size.touch ? ' touch' : ''}</figcaption><div>${img(r.shots.title)}${img(r.shots['game-out'])}${img(r.shots['game-in'])}</div></figure>`;
  const menus = rows.filter((r) => r.shots.mode || r.shots.settings).map((r) => `<figure><figcaption>${r.size.name} &middot; ${r.size.width}x${r.size.height}: settings, mode, join, lobby, pause</figcaption><div>${['settings', 'mode', 'join', 'lobby', 'pause'].map((s) => img(r.shots[s])).join('')}</div></figure>`);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #1b1b1f; color: #eee; font: 13px/1.3 -apple-system, sans-serif; width: 2300px; }
    h1 { font-size: 20px; margin: 0 0 12px; } h2 { font-size: 15px; margin: 18px 0 8px; }
    section { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: flex-end; }
    figure { margin: 0; } figcaption { margin-bottom: 4px; color: #ffd866; }
    figure div { display: flex; gap: 4px; align-items: flex-start; }
    img { height: 150px; width: auto; display: block; outline: 1px solid #555; image-rendering: auto; }
    i { display: block; width: 60px; height: 150px; }
  </style><h1>${engine}: title, in game outside, in game inside (upright touch screens: title and outside, both the rotate card)</h1>
  <section>${rows.map(cell).join('')}</section><h2>Menus on four sizes</h2><section>${menus.join('')}</section>`;
  const file = `${OUT}${engine}.html`;
  writeFileSync(file, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2332, height: 1000 } });
  await page.goto(`file://${file}`);
  await sleep(800);
  await page.screenshot({ path: `${OUT}${engine}.png`, fullPage: true });
  await browser.close();
}

const wanted = (process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENGINES)) as (keyof typeof ENGINES)[];
for (const engine of wanted) {
  mkdirSync(`${OUT}${engine}`, { recursive: true });
  const browser = await ENGINES[engine].launch();
  const rows: Row[] = new Array(SIZES.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < SIZES.length) {
      const i = next++;
      rows[i] = await runSize(engine, browser, SIZES[i]!, i);
    }
  }));
  await browser.close();
  await sheet(engine, rows);
  console.log(`${engine}: ${SIZES.length} sizes, sheet ${OUT}${engine}.png`);
}
writeFileSync(`${OUT}problems.${wanted.join('-')}.txt`, problems.join('\n'));
console.log(problems.length ? `\n${problems.length} problems:\n${problems.join('\n')}` : '\nno problems');
