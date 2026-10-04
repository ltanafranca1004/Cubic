// Screenshots of every onboarding hint into docs/screens/onboarding, in both Phaser
// renderers (WebGL and the Canvas fallback). Two real clients play a real game against a
// running server; every hint is waited for and checked before its picture is taken, and
// the run fails on any console error or any hint that does not show (or does not go).
//
//   server:  PORT=3307 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server   (dev commands: the first solve)
//   client:  VITE_SERVER_URL=http://localhost:3307 npm run dev -w client -- --port 5407
//   then:    cd tools && BASE=http://localhost:5407 npx tsx screens/onboarding.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { FACE_SIZE } from '../../shared/src/types';

const BASE = process.env.BASE ?? 'http://localhost:5407';
const OUT = new URL('../../docs/screens/onboarding/', import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };
mkdirSync(OUT, { recursive: true });

interface Cubic {
  code: string | null;
  role: string | null;
  side: 'out' | 'in' | null;
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null; ready: boolean } | null> } | null;
  state: { players: Record<string, { pose: { face: number; x: number; y: number } }>; solved: number[] } | null;
  dev(cmd: { type: 'solve'; face: number }): Promise<{ ok: boolean; error?: string }>;
}
declare const window: { __cubic: Cubic };

const problems: string[] = [];
async function open(browser: Browser, query: string, tag: string): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZE });
  page.on('pageerror', (e) => problems.push(`${tag}: pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${tag}: console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1500);
  return page;
}
const press = async (page: Page, ...keys: string[]) => {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(140);
  }
};
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
async function expect(what: string, cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('   ok:', what);
}
const screenOf = (page: Page) => page.evaluate(() => (document.querySelector('.cu') as unknown as { dataset: { screen: string } }).dataset.screen);

/** What the onboarding layer shows right now: the text of each part that is on, else null. */
interface Shown {
  card: string | null;
  keys: string | null;
  hint: string | null;
  cap: string | null;
}
const shown = (page: Page): Promise<Shown> =>
  page.evaluate(`(() => {
    const t = (sel) => { const n = document.querySelector('.cu-onb ' + sel + '.on'); return n ? n.textContent.replace(/\\s+/g, ' ').trim() : null; };
    const c = document.querySelector('#cu-caption'); // the narrator speaks through the game's caption component
    return { card: t('.cu-onb-card'), keys: t('.cu-onb-keys'), hint: t('.cu-onb-hint'), cap: c && !c.hidden ? c.textContent.replace(/\\s+/g, ' ').trim() : null };
  })()`) as Promise<Shown>;
const hintIs = (page: Page, re: RegExp) => async () => re.test((await shown(page)).hint ?? '');
const pose = (page: Page) => net(page, (c) => c.state!.players[c.side!]!.pose);

async function run(browser: Browser, tag: 'webgl' | 'canvas'): Promise<void> {
  console.log(`\n${tag}`);
  const q = tag === 'canvas' ? '?renderer=canvas' : '';
  const shot = async (page: Page, name: string) => {
    await page.waitForTimeout(450); // let the fade finish
    await page.screenshot({ path: `${OUT}${name}-${tag}.png` });
    console.log('  ', `${name}-${tag}`);
  };

  // ---- two clients through the lobby into a game: host outside, guest inside ----
  const a = await open(browser, q, `${tag} out`);
  const b = await open(browser, q, `${tag} in`);
  for (const p of [a, b]) {
    await press(p, 'Enter'); // title -> mode (the dive takes 1.2 s)
    await p.waitForTimeout(1900);
  }
  await press(a, 'ArrowDown', 'Enter'); // Create
  await expect('the host is in a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  const code = (await net(a, (c) => c.code))!;
  await press(b, 'ArrowDown', 'ArrowDown', 'Enter'); // Join
  await b.waitForTimeout(400);
  await b.keyboard.type(code);
  await press(b, 'Enter');
  await expect('the guest joined', async () => (await net(b, (c) => c.role)) === 'guest');
  await b.waitForTimeout(700);
  await press(a, 'a');
  await press(b, 'd');
  await expect('sides picked', async () => (await net(a, (c) => c.room?.members.guest?.side)) === 'in' && (await net(a, (c) => c.room?.members.host?.side)) === 'out');
  await press(b, 'Enter');
  await expect('guest ready', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(300);
  await press(a, 'Enter');
  await expect('the game started for both', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game');

  // ---- game start: side card, controls hint, the narrator's intro line ----
  await expect('outside: side card, controls and narrator are up', async () => {
    const s = await shown(a);
    return /^You're ON the cube ?Your partner is in the same spot on the other side\. Their left is your right\.$/.test(s.card ?? '') && /WASD\/Arrows ?move ?E ?interact ?Q ?drop ?Enter ?chat ?V ?talk ?F ?ping/.test(s.keys ?? '') && !!s.cap && s.hint === null;
  });
  await expect('inside: the card says INSIDE', async () => /^You're INSIDE the cube/.test((await shown(b)).card ?? ''));
  await shot(a, '01-start-card-controls-narrator-out');
  await shot(b, '01-start-card-controls-narrator-in');

  // ---- the card goes by itself, then the cube hint ----
  await expect('outside: the cube hint follows the card', hintIs(a, /^This is the cube\. Your face is the one in front\.$/), 12_000);
  await expect('inside: the cube hint follows the card', hintIs(b, /^This is the cube/), 12_000);
  await expect('the card is gone', async () => (await shown(a)).card === null && (await shown(b)).card === null);
  await shot(a, '02-hint-cube-out');
  await shot(b, '02-hint-cube-in');
  await expect('the cube hint goes', async () => (await shown(a)).hint === null && (await shown(b)).hint === null, 10_000);
  await expect('the narrator line has gone', async () => (await shown(a)).cap === null);
  await shot(b, '03-controls-in');

  // ---- controls: fade after a move and an interact ----
  await press(a, 'w');
  await expect('outside: one step is not enough for the controls hint', async () => (await shown(a)).keys !== null);
  await a.waitForTimeout(300);
  await press(a, 'e');
  await expect('outside: moved and interacted, the controls hint is gone', async () => (await shown(a)).keys === null);
  await shot(a, '04-controls-faded-out');

  // ---- edge: walk to the face edge ----
  const toEdge = async (page: Page, key: string) => {
    for (let i = 0; i < FACE_SIZE; i++) {
      const p = await pose(page);
      if (p.x === 0 || p.y === 0 || p.x === FACE_SIZE - 1 || p.y === FACE_SIZE - 1) return;
      await press(page, key);
      await page.waitForTimeout(120);
    }
    throw new Error(`could not walk to an edge with "${key}"`);
  };
  await toEdge(a, 'a');
  await expect('outside: the edge hint', hintIs(a, /^Walk off the edge to fold onto the next face\.$/));
  await shot(a, '05-hint-edge-out');
  await toEdge(b, 'a');
  await expect('inside: the edge hint', hintIs(b, /^Walk off the edge/));
  await shot(b, '05-hint-edge-in');

  // ---- voice: the outside player folds onto the next face, the partner gets quieter ----
  const face0 = (await pose(a)).face;
  await press(a, 'a', 'a');
  await expect('outside: folded onto another face', async () => (await pose(a)).face !== face0);
  await expect('outside: the edge hint goes when the player folds', async () => !/Walk off/.test((await shown(a)).hint ?? ''));
  await expect('outside: the voice hint', hintIs(a, /^Your partner sounds farther away\. Voice fades by face distance\.$/), 12_000);
  await shot(a, '06-hint-voice-out');
  await expect('inside: the voice hint (after its edge hint)', hintIs(b, /^Your partner sounds farther away/), 12_000);
  await shot(b, '06-hint-voice-in');
  await expect('the voice hint goes', async () => (await shown(a)).hint === null && (await shown(b)).hint === null, 10_000);

  // ---- narrator: the first solve (latched through the server's dev command) ----
  const solved = await a.evaluate(() => window.__cubic.dev({ type: 'solve', face: 1 }));
  if (!solved.ok) throw new Error(`dev solve refused: ${solved.error}`);
  await expect('face 1 is solved', async () => (await net(a, (c) => c.state?.solved.length)) === 1);
  await expect('both: the narrator speaks at the first solve', async () => !!(await shown(a)).cap && (await shown(a)).cap === (await shown(b)).cap);
  console.log('   narrator:', (await shown(a)).cap);
  await shot(a, '07-narrator-first-solve-out');
  await shot(b, '07-narrator-first-solve-in');

  // ---- once per session: nothing comes back ----
  await press(a, 'd', 'd', 'd'); // back over the edge and onto an edge tile again
  await a.waitForTimeout(1500);
  await expect('outside: no hint shows twice', async () => {
    const s = await shown(a);
    return s.hint === null && s.card === null && s.keys === null;
  });

  // ---- the gear still works in the game, and has the Hints row ----
  await a.locator('#cu-gear').click();
  await expect('the settings open over the game', async () => a.locator('#cu-settings.on').isVisible());
  await a.close();
  await b.close();

  // ---- hints off: a fresh session (offline game), the toggle takes everything away ----
  const c = await open(browser, `?mock=game${tag === 'canvas' ? '&renderer=canvas' : ''}`, `${tag} off`);
  await expect('fresh session: card and controls are up', async () => !!(await shown(c)).card && !!(await shown(c)).keys);
  await c.locator('#cu-gear').click();
  await c.waitForTimeout(300);
  await shot(c, '08-settings-hints-row');
  await c.locator('.cu-toggle[data-key="hints"]').click();
  await expect('hints off: card and controls go at once', async () => {
    const s = await shown(c);
    return s.card === null && s.keys === null && s.hint === null;
  }, 1000);
  await press(c, 'Escape');
  await expect('the settings closed', async () => !(await c.locator('#cu-settings.on').isVisible()));
  await c.waitForTimeout(8000); // long enough for a context hint to have come, if it were going to
  await expect('hints off: still nothing', async () => {
    const s = await shown(c);
    return s.card === null && s.keys === null && s.hint === null;
  });
  await shot(c, '09-hints-off');
  await c.locator('#cu-gear').click();
  await c.locator('.cu-toggle[data-key="hints"]').click();
  await press(c, 'Escape');
  await expect('hints back on: the controls hint and the cube hint are still owed', async () => !!(await shown(c)).keys && /This is the cube/.test((await shown(c)).hint ?? ''));
  await expect('but the side card is not shown twice', async () => (await shown(c)).card === null);
  await c.close();
}

const browser = await chromium.launch();
try {
  for (const tag of ['webgl', 'canvas'] as const) await run(browser, tag);
} catch (e) {
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
console.log('\ndone ->', OUT);
