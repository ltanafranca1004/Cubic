// ONE PICTURE PER 3D CUBE VIEW, plus the side select screen (which has no cube): the title
// cube, the cube behind the mode screen, the HUD cube of each side and the cube map (Tab).
// All four are drawn from the same bake (client/src/cube), so they must show the faces as
// the puzzles lay them out.
//
//   server:  PORT=3414 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3414 npm run dev -w client -- --port 5514
//   then:    cd tools && BASE=http://localhost:5514 npx tsx screens/cubes.ts
//
//   BASE   client URL (default http://localhost:5514)
//   OUT    folder for the PNGs (default <repo>/docs/status/puzzles/)
//   HOLD   where in its turn the menu cube is held, 0..1 (default 0.06)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { js, openTitle, sleep, toGame, toLobby, toMode } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5514';
const OUT = resolve(process.env.OUT ?? join(new URL('../../', import.meta.url).pathname, 'docs/status/puzzles')) + '/';
const HOLD = Number(process.env.HOLD ?? 0.06);
const SIZE = { width: 1280, height: 720 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const [a, b] = await Promise.all([openTitle(browser, BASE, SIZE), openTitle(browser, BASE, SIZE)]);
  // the cube turns: hold it where three faces show well
  for (const p of [a, b]) await js(p, `window.__cubicCube.hold = ${HOLD}`);
  await sleep(1500);
  await a.screenshot({ path: `${OUT}cube-title.png` });
  await Promise.all([toMode(a), toMode(b)]);
  await sleep(1200);
  await a.screenshot({ path: `${OUT}cube-backdrop-mode.png` });
  await toLobby(a, b);
  await sleep(1200);
  await a.screenshot({ path: `${OUT}side-select.png` });
  await toGame(a, b);
  await sleep(1500);
  await a.screenshot({ path: `${OUT}cube-hud-outside.png` });
  await b.screenshot({ path: `${OUT}cube-hud-inside.png` });
  // the cube map: Tab held, turned once so a face with a puzzle the HUD may show is in front
  await a.keyboard.down('Tab');
  await sleep(400);
  await a.keyboard.press('ArrowRight');
  await sleep(1200);
  await a.screenshot({ path: `${OUT}cube-map-tab.png` });
  await a.keyboard.up('Tab');
  console.log('done:', OUT);
} finally {
  await browser.close();
}
