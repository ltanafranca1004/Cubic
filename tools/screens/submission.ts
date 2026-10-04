// Submission screenshots (Devpost): title, lobby, one game shot per side and a phone shot.
// WebGL, 1920x1080, no dev overlay, hints off. It writes candidates to OUT (several moments
// of the turning cube, several faces per side); pick the best and copy them to docs/submission/.
//
//   server:  PORT=3420 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server   (dev commands: teleport)
//   client:  VITE_SERVER_URL=http://localhost:3420 npm run dev -w client -- --port 5520
//   run:     cd tools && BASE=http://localhost:5520 OUT=/some/dir npx tsx screens/submission.ts
import { mkdirSync } from 'node:fs';
import { chromium, devices, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5520';
const OUT = (process.env.OUT ?? new URL('../../docs/submission/candidates/', import.meta.url).pathname).replace(/\/?$/, '/');
mkdirSync(OUT, { recursive: true });
const SIZE = { width: 1920, height: 1080 };

interface Cubic {
  code: string | null;
  room: { phase: string } | null;
  createRoom(): void;
  joinRoom(code: string): void;
  pickSide(side: string): void;
  setReady(ready: boolean): void;
  startGame(): void;
  dev(cmd: object): Promise<{ ok: boolean; error?: string }>;
}
declare const window: { __cubic: Cubic };
declare const document: { fonts: { ready: Promise<unknown> } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(browser: Browser, query = ''): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZE });
  await page.addInitScript('window.__name = (f) => f'); // tsx names the functions it sends to the page
  await page.goto(`${BASE}/${query}`);
  await page.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  return page;
}

const browser = await chromium.launch();
try {
  // title: the cube turns, so take it at several moments; the thumb is the same frame cut to 3:2
  const title = await open(browser);
  await sleep(2500);
  for (let i = 0; i < 8; i++) {
    await title.screenshot({ path: `${OUT}title-${i}.png` });
    await title.screenshot({ path: `${OUT}title-thumb-${i}.png`, clip: { x: (SIZE.width - 1620) / 2, y: 0, width: 1620, height: 1080 } });
    await sleep(1500);
  }
  await title.close();

  // lobby and game: two players in one room
  const a = await open(browser);
  const b = await open(browser);
  await a.waitForFunction(() => !!window.__cubic);
  await a.evaluate(() => window.__cubic.createRoom());
  await a.waitForFunction(() => !!window.__cubic.code);
  const code = (await a.evaluate(() => window.__cubic.code))!;
  await b.waitForFunction(() => !!window.__cubic);
  await b.evaluate((c) => window.__cubic.joinRoom(c), code);
  await b.waitForFunction(() => window.__cubic.room?.phase === 'lobby');
  await a.evaluate(() => window.__cubic.pickSide('out'));
  await b.evaluate(() => window.__cubic.pickSide('in'));
  await sleep(300);
  await b.evaluate(() => window.__cubic.setReady(true));
  await sleep(1500);
  await a.screenshot({ path: `${OUT}lobby.png` });
  await a.evaluate(() => window.__cubic.startGame());
  for (const p of [a, b]) await p.waitForSelector('.cu[data-screen="game"] #game canvas');
  await sleep(9000); // the opening captions
  for (const face of [1, 2, 3, 4, 5, 6]) {
    if (face !== 1) {
      await a.evaluate((f) => window.__cubic.dev({ type: 'teleport', side: 'out', face: f }), face);
      await a.evaluate((f) => window.__cubic.dev({ type: 'teleport', side: 'in', face: f }), face);
    }
    await sleep(6000); // the face name caption, the ambience settling
    await a.screenshot({ path: `${OUT}game-outside-${face}.png` });
    await b.screenshot({ path: `${OUT}game-inside-${face}.png` });
  }
  await a.close();
  await b.close();

  // phone: iPhone 14 held sideways, the offline game
  const ctx = await browser.newContext({ ...devices['iPhone 14 landscape'] });
  const phone = await ctx.newPage();
  await phone.addInitScript('window.__name = (f) => f');
  await phone.goto(`${BASE}/?mock=game`);
  await phone.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  await phone.evaluate(() => document.fonts.ready);
  await sleep(9000);
  await phone.screenshot({ path: `${OUT}mobile.png` });
  await ctx.close();
} finally {
  await browser.close();
}
console.log('done:', OUT);
