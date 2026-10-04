// THE TITLE SCREEN, as docs/submission/ has it (the title section of screens/submission.ts
// on its own): title.png at 1920x1080 and title-thumb.png, the same frame cut to 3:2
// (1620x1080), with the cube held at the point of its turn the submission uses. Canvas
// renderer, headless, silent.
//
//   server:  PORT=3422 AI_FAKE=1 TTS_MODE=browser npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3422 npm run dev -w client -- --port 5522
//   run:     cd tools && BASE=http://localhost:5522 npx tsx screens/title.ts
//
//   BASE   client URL (default http://localhost:5522)
//   OUT    folder (default <repo>/docs/submission/)
//   ONE    a single picture instead: "<width>x<height>:<file name>" (no thumb)
//   HOLD   where in its turn the cube is held, 0..1 (default 0.81: grass, rooftop, desert)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { has, js, sleep, snap, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5522';
const OUT = resolve(process.env.OUT ?? join(new URL('../../', import.meta.url).pathname, 'docs/submission')) + '/';
const HOLD = Number(process.env.HOLD ?? 0.81);
const one = process.env.ONE?.match(/^(\d+)x(\d+):(.+)$/);
const SIZE = one ? { width: Number(one[1]), height: Number(one[2]) } : { width: 1920, height: 1080 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: SIZE });
  await context.addInitScript(() => {
    const s = window.speechSynthesis;
    if (s) {
      s.speak = () => {};
      s.cancel = () => {};
    }
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?renderer=canvas`);
  await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
  await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
  await sleep(2000);
  await js(page, `window.__cubicCube.hold = ${HOLD}`);
  await sleep(700);
  if (one) await page.screenshot({ path: `${OUT}${one[3]}` });
  else {
    await page.screenshot({ path: `${OUT}title.png` });
    await page.screenshot({ path: `${OUT}title-thumb.png`, clip: { x: (SIZE.width - 1620) / 2, y: 0, width: 1620, height: 1080 } });
  }
  console.log('done:', OUT);
} finally {
  await browser.close();
}
