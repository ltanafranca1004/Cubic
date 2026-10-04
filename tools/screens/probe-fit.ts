// How the page fits the window, in numbers. Two uses:
//   oracle:  cd tools && npx tsx screens/probe-fit.ts oracle <out.json>
//            the desktop layout at 1920x1080 and 1280x720 (Chromium), to compare before and after a change
//   probe:   cd tools && npx tsx screens/probe-fit.ts probe [base url]
//            an iPad-shaped WebKit window through the changes Safari makes (rotate, toolbars, split view)
// Needs the dev server (`npm run dev`); BASE overrides http://localhost:5173.

import { writeFileSync } from 'node:fs';
import { chromium, webkit, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything that decides the picture: the window as the browser reports it, and every canvas. */
export async function metrics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(`(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
    const cu = document.querySelector('.cu');
    const cs = cu ? getComputedStyle(cu) : null;
    return {
      inner: [innerWidth, innerHeight],
      visual: visualViewport ? [visualViewport.width, visualViewport.height, visualViewport.scale] : null,
      client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
      dpr: devicePixelRatio,
      coarse: matchMedia('(pointer: coarse)').matches,
      touch: cu ? cu.dataset.touch ?? null : null,
      layout: cu ? cu.dataset.layout ?? null : null,
      screen: cu ? cu.dataset.screen : null,
      u: cs ? cs.getPropertyValue('--u') : null,
      z: cs ? cs.getPropertyValue('--z') : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      canvases: [...document.querySelectorAll('.cu-stage canvas, #game canvas')].map((c) => ({ where: c.closest('#game') ? 'game' : 'stage', backing: [c.width, c.height], style: [c.style.width, c.style.height], rect: r(c) })),
      mid: r(document.querySelector('.cu-mid')),
      col: r(document.querySelector('.cu-col')),
      top: r(document.querySelector('.cu-top')),
      view: r(document.querySelector('.cu-view')),
    };
  })()`);
}

const SCREENS = { title: '/', lobby: '/?mock=lobby', 'game-out': '/?mock=game', 'game-in': '/?mock=game&side=in' };

async function oracle(out: string): Promise<void> {
  const browser = await chromium.launch();
  const result: Record<string, unknown> = {};
  for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
    for (const [name, path] of Object.entries(SCREENS)) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(BASE + path);
      await page.waitForSelector('.cu-stage canvas');
      await sleep(1500);
      result[`${w}x${h} ${name}`] = await metrics(page);
      await page.screenshot({ path: out.replace(/\.json$/, `-${w}-${name}.png`) });
      await page.close();
    }
  }
  writeFileSync(out, JSON.stringify(result, null, 1));
  await browser.close();
  console.log(`wrote ${out}`);
}

/** Is every canvas shown at its own aspect, and does the stage cover the window? */
function verdict(m: Record<string, unknown>): string {
  const bad: string[] = [];
  const [vw, vh] = m.inner as number[];
  for (const c of m.canvases as { where: string; backing: number[]; rect: number[] }[]) {
    const [, , w, h] = c.rect;
    if (Math.abs(w / h - c.backing[0] / c.backing[1]) > 0.02) bad.push(`${c.where} stretched (${c.backing} shown ${w}x${h})`);
    if (c.where === 'stage' && (w < vw - 1 || h < vh - 1 || w > vw + 8 || h > vh + 8)) bad.push(`stage ${w}x${h} in window ${vw}x${vh}`);
  }
  return bad.length ? `BAD: ${bad.join('; ')}` : 'ok';
}

async function probe(base: string): Promise<void> {
  const browser = await webkit.launch();
  const steps: [string, number, number][] = [
    ['landscape with toolbars', 1180, 746],
    ['toolbars hidden', 1180, 820],
    ['upright', 820, 1106],
    ['back to landscape', 1180, 746],
    ['split view half', 590, 746],
    ['split view third', 507, 746],
    ['back to full', 1180, 746],
    ['split view two thirds', 694, 746],
    ['back to full again', 1180, 746],
  ];
  for (const start of [[1180, 746], [820, 1106], [507, 746]] as const) {
    const ctx = await browser.newContext({ viewport: { width: start[0], height: start[1] }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('.cu-stage canvas');
    await sleep(1500);
    let m = await metrics(page);
    console.log(`\nloaded at ${start.join('x')}: ${verdict(m)}`);
    console.log(JSON.stringify(m));
    for (const [name, w, h] of steps) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(700);
      m = await metrics(page);
      const v = verdict(m);
      console.log(`  ${name} ${w}x${h}: ${v}`);
      if (v !== 'ok') console.log(`  ${JSON.stringify(m.canvases)} touch=${m.touch} u=${m.u}`);
    }
    await ctx.close();
  }
  await browser.close();
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'oracle') await oracle(arg ?? 'oracle.json');
else if (mode === 'probe') await probe(arg ?? BASE);
