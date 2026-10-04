// Dev helper: open one URL, wait, save a screenshot and print console errors.
//   tsx screens/probe.ts <url> <out.png> [waitMs] [width] [height] [click x,y ...]
import { chromium } from 'playwright';

const [, , url, out, wait = '1500', w = '1280', h = '720', ...clicks] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url!);
await page.waitForTimeout(Number(wait));
for (const c of clicks) {
  if (c.startsWith('key:')) await page.keyboard.press(c.slice(4));
  else {
    const [x, y] = c.split(',').map(Number);
    await page.mouse.click(x!, y!);
  }
  await page.waitForTimeout(Number(wait));
}
await page.screenshot({ path: out! });
await browser.close();
