// Screenshots of every screen and every face, plus the cloud dive as a GIF, into
// docs/screens. It drives two real clients through the whole lobby flow against a running
// server, and fails loudly if a step does not end where it should: it is the visual
// check AND an end-to-end test of create / join / pick / ready / start.
//
//   server:  PORT=3106 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3106 npm run dev -w client -- --port 5206
//   then:    cd tools && npm run screens            (BASE=http://localhost:5206 by default)
//
// The dive GIF needs ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5206';
const OUT = new URL('../../docs/screens/', import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SIZE = { width: 1280, height: 720 };
const ONLY = process.argv[2]; // run one part: flow | faces | ai | gif

mkdirSync(OUT, { recursive: true });

interface Cubic {
  code: string | null;
  role: string | null;
  side: string | null;
  error: string | null;
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null; ready: boolean; connected: boolean } | null> } | null;
  state: { players: Record<string, { pose: { face: number; up: number[]; x: number; y: number } }>; solved: number[]; wonAt: number | null } | null;
  move(dx: number, dy: number): void;
}
declare const window: { __cubic: Cubic };

const problems: string[] = [];
async function open(browser: Browser, query = ''): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZE });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1200);
  return page;
}
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('  ', name);
};
const press = async (page: Page, ...keys: string[]) => {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(120);
  }
};
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
async function expect(what: string, cond: () => Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('   ok:', what);
}
const screenOf = (page: Page) => page.evaluate(() => (document.querySelector('.cu') as HTMLElement).dataset.screen);

/** Title -> mode screen. Enter is Play; the dive takes 1.2s. */
async function toMode(page: Page): Promise<void> {
  await press(page, 'Enter');
  await page.waitForTimeout(1900);
}

async function flow(browser: Browser): Promise<void> {
  console.log('flow: two clients');
  const a = await open(browser);
  await shot(a, '01-start');
  await a.locator('#cu-gear').click();
  await a.waitForTimeout(400);
  await shot(a, '02-settings-on-start');
  // settings apply at once and stay for the session
  await a.locator('.cu-slider[data-key="music"]').click({ position: { x: 20, y: 10 } });
  await a.locator('.cu-toggle[data-key="micMuted"]').click();
  await a.waitForTimeout(200);
  await shot(a, '03-settings-changed');
  await press(a, 'Escape');

  await toMode(a);
  await shot(a, '04-mode');

  // a wrong code: the popup shakes and says why
  await press(a, 'ArrowRight', 'ArrowRight', 'Enter');
  await a.waitForTimeout(500);
  await shot(a, '05-join-popup');
  await a.keyboard.type('zz9z!q'); // digits and symbols are ignored, letters are upper-cased
  await a.waitForTimeout(200);
  await shot(a, '06-join-typed');
  await press(a, 'Enter');
  await expect('a wrong code is refused', async () => /not found/i.test((await net(a, (c) => c.error)) ?? ''));
  await a.waitForTimeout(150);
  await shot(a, '07-join-wrong-code');
  await a.waitForTimeout(500);
  await press(a, 'Backspace', 'Backspace', 'Backspace', 'Enter');
  await a.waitForTimeout(350);
  await shot(a, '08-join-too-short');
  await press(a, 'Escape');
  await a.waitForTimeout(300);

  // host creates
  await press(a, 'ArrowLeft', 'Enter');
  await expect('the host is in a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  const code = (await net(a, (c) => c.code))!;
  await a.waitForTimeout(700);
  await shot(a, '09-lobby-waiting-host');

  // guest joins with the code
  const b = await open(browser);
  await toMode(b);
  await press(b, 'ArrowRight', 'ArrowRight', 'Enter');
  await b.waitForTimeout(400);
  await b.keyboard.type(code.toLowerCase());
  await press(b, 'Enter');
  await expect('the guest joined the same room', async () => (await net(b, (c) => c.code)) === code && (await net(b, (c) => c.role)) === 'guest');
  await b.waitForTimeout(700);
  await shot(a, '10-lobby-both-host');
  await shot(b, '10-lobby-both-guest');

  // picks: the host goes outside; the guest tries the same side and is refused
  await press(a, 'a');
  await expect('host picked outside (seen by the guest)', async () => (await net(b, (c) => c.room?.members.host?.side)) === 'out');
  await press(b, 'a');
  await b.waitForTimeout(150);
  await shot(b, '11-lobby-side-taken-guest');
  await expect('the guest did not get the taken side', async () => (await net(a, (c) => c.room?.members.guest?.side)) === null);
  const startDisabled = await net(a, (c) => c.room?.phase);
  if (startDisabled !== 'lobby') throw new Error('still in the lobby expected');
  await press(a, 'Enter'); // Start is disabled: nothing happens
  await a.waitForTimeout(300);
  await expect('start does nothing before the guest is ready', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  await press(b, 'd');
  await expect('guest picked inside (seen by the host)', async () => (await net(a, (c) => c.room?.members.guest?.side)) === 'in');
  await b.waitForTimeout(400);
  await shot(a, '12-lobby-picked-host');
  await shot(b, '12-lobby-picked-guest');
  await press(b, 'Enter');
  await expect('guest ready (seen by the host)', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(400);
  await shot(a, '13-lobby-ready-host');
  await shot(b, '13-lobby-ready-guest');

  // the guest leaves: ready and side reset on the host's screen; then rejoins
  await b.mouse.click(80, 682); // LEAVE, bottom left
  await expect('guest left: the host sees an empty second seat', async () => (await net(a, (c) => c.room?.members.guest)) === null);
  await a.waitForTimeout(500);
  await shot(a, '14-lobby-guest-left-host');
  await b.waitForTimeout(700);
  await expect('the guest is back on the mode screen', async () => (await net(b, (c) => c.code)) === null);
  await press(b, 'ArrowRight', 'ArrowRight', 'Enter');
  await b.waitForTimeout(400);
  await b.keyboard.type(code);
  await press(b, 'Enter');
  await expect('the guest rejoined with nothing picked', async () => {
    const g = await net(a, (c) => c.room?.members.guest);
    return !!g && g.side === null && g.ready === false;
  });

  // a refresh in the lobby comes back to the same seat (reconnect by token)
  await b.waitForTimeout(600);
  await b.reload();
  await expect('the guest is back after a refresh', async () => (await net(b, (c) => c.role).catch(() => null)) === 'guest', 8000);
  await b.waitForTimeout(1200);
  await shot(b, '15-lobby-after-refresh-guest');

  await press(b, 'd');
  await expect('guest picked inside again', async () => (await net(a, (c) => c.room?.members.guest?.side)) === 'in');
  await press(b, 'Enter');
  await expect('guest ready again', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(300);
  await press(a, 'Enter');
  await expect('the game started for both', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game');
  await expect('sides are as picked', async () => (await net(a, (c) => c.side)) === 'out' && (await net(b, (c) => c.side)) === 'in');
  await a.waitForTimeout(1200);
  await shot(a, '16-game-outside');
  await shot(b, '16-game-inside');

  // chat, then the settings over the game
  await press(a, 'Enter');
  await a.keyboard.type('I see a door with a crystal behind it.');
  await press(a, 'Enter', 'Escape');
  await press(b, 'Enter');
  await b.keyboard.type('There is a plate on my floor. Top left for me.');
  await press(b, 'Enter', 'Escape');
  await a.waitForTimeout(500);
  await shot(a, '17-game-chat-outside');
  await shot(b, '17-game-chat-inside');
  await b.locator('#cu-gear').click();
  await b.waitForTimeout(400);
  await shot(b, '18-settings-in-game');
  await press(b, 'Escape');

  // moving works for both, and a refresh in the game keeps the seat
  await press(a, 'w', 'w');
  await expect('the outside player walked', async () => (await net(a, (c) => c.state?.players.out?.pose.y)) === 6);
  await a.reload();
  await expect('the host is back in the game after a refresh', async () => (await screenOf(a).catch(() => '')) === 'game', 8000);
  await a.close();
  await b.waitForTimeout(600);
  await shot(b, '19-game-partner-left-inside');
  await b.close();
}

/** Every face, outside and inside, in the offline game (?mock=game), plus the win screen. */
async function faces(browser: Browser): Promise<void> {
  console.log('faces');
  const UP: Record<number, number[]> = { 1: [0, 1, 0], 2: [0, 1, 0], 3: [0, 1, 0], 4: [0, 1, 0], 5: [0, 0, -1], 6: [0, 0, 1] };
  for (const side of ['out', 'in']) {
    const page = await open(browser, `?mock=game&side=${side}`);
    for (let face = 1; face <= 6; face++) {
      await page.evaluate(
        ({ side, face, up }) => {
          const c = window.__cubic;
          const pose = c.state!.players[side]!.pose;
          Object.assign(pose, { face, up, x: 5, y: 6 });
          c.move(1, 0); // a real step, so the view and the HUD redraw from the game state
        },
        { side, face, up: UP[face]! },
      );
      await page.waitForTimeout(700);
      await shot(page, `face-${side}-${face}`);
    }
    if (side === 'out') {
      await page.evaluate(() => {
        const c = window.__cubic;
        c.state!.solved = [1, 2, 3, 4, 5, 6];
        c.move(0, -1);
      });
      await page.waitForTimeout(600);
      await shot(page, '20-game-portal-open');
      await page.evaluate(() => {
        const c = window.__cubic;
        c.state!.wonAt = Date.now();
        c.move(0, -1);
      });
      await page.waitForTimeout(700);
      await shot(page, '21-win');
    }
    await page.close();
  }
}

async function ai(browser: Browser): Promise<void> {
  console.log('ai modes');
  for (const [side, keys] of [['out', ['ArrowRight', 'ArrowDown', 'Enter']], ['in', ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Enter']]] as const) {
    const page = await open(browser);
    await toMode(page);
    await press(page, ...keys);
    await expect(`AI game started with the human ${side}side`, async () => (await screenOf(page)) === 'game' && (await net(page, (c) => c.side)) === side, 6000);
    await page.waitForTimeout(3500); // let the scripted partner say hello
    await shot(page, `22-ai-${side === 'out' ? 'outside' : 'inside'}`);
    await page.close();
  }
}

/** The dive through the clouds, recorded as video and cut into a GIF. */
async function gif(browser: Browser): Promise<void> {
  console.log('dive gif');
  const dir = `${OUT}.video`;
  rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir, size: SIZE } });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/?mock=menu`);
  await page.waitForTimeout(2200);
  const at = (Date.now() - t0) / 1000;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2600);
  await context.close();
  const video = `${dir}/${readdirSync(dir).find((f) => f.endsWith('.webm'))}`;
  const from = Math.max(0, at - 0.6).toFixed(2);
  // nearest-neighbour down to half size and a palette made from the clip keep the pixels crisp
  const filter = 'fps=25,scale=640:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none';
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', from, '-t', '2.6', '-i', video, '-filter_complex', filter, `${OUT}cloud-dive.gif`]);
  renameSync(video, `${OUT}cloud-dive.webm`);
  rmSync(dir, { recursive: true, force: true });
  console.log('   cloud-dive.gif');
}

const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'flow') await flow(browser);
  if (!ONLY || ONLY === 'faces') await faces(browser);
  if (!ONLY || ONLY === 'ai') await ai(browser);
  if (!ONLY || ONLY === 'gif') await gif(browser);
} catch (e) {
  // leave a picture of every open page next to the error
  let n = 0;
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${OUT}_failed-${++n}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(`\n${problems.length} page problem(s):\n${[...new Set(problems)].join('\n')}`);
  process.exit(1);
}
console.log('done ->', OUT);
