// THE ENDING ("Passed cube 1!") in real browsers: pictures of the sequence for both players,
// and the checks of what the playtest does not reach (reduce motion, the Canvas renderer, a
// phone held sideways, a game found already won).
//
// Two players in one real room. The win here comes from the server's dev command (solve,
// six times: the sixth one wins, decided by /shared like any win), so this script needs
// DEV_COMMANDS=1. The pictures of a game that was PLAYED to its win are taken by the
// playtest (screens/playtest.ts puzzles, the "ending" steps), with the same `endingShots`.
//
//   server:  PORT=3600 AI_FAKE=1 DEV_COMMANDS=1 npm start -w server
//   client:  VITE_SERVER_URL=http://localhost:3600 npm run dev -w client -- --port 5700
//   run:     cd tools && BASE=http://localhost:5700 OUT=/some/dir npx tsx screens/ending.ts [runs]
//
//   runs   comma separated, default all: webgl, canvas, reduce, touch, late
//   OUT    default <REPO>/docs/status/ending/
//
// Exit code 1 if a check fails.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { FACES } from '../../shared/src/index';
import { ENDING_CARD_MOMENT, click, endingShots, endingState, has, js, press, sleep, snap, toLobby, toMode, until } from './play';
import { QUIET_ARGS, quiet } from './quiet';

const BASE = process.env.BASE ?? 'http://localhost:5700';
const REPO = resolve(new URL('../../', import.meta.url).pathname);
const OUT = (process.env.OUT ?? `${REPO}/docs/status/ending/`).replace(/\/?$/, '/');
const RUNS = (process.argv[2] ?? 'webgl,canvas,reduce,touch,late').split(',');
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};

interface Variant {
  size: { width: number; height: number };
  query: string;
  /** Saved settings the pages start with (hints are always off: the cards would cover the view). */
  settings?: Record<string, unknown>;
}

/** Two players in a started game: A outside, B inside. */
async function room(browser: Browser, v: Variant): Promise<[Page, Page]> {
  const pages: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: v.size });
    await quiet(context);
    await context.addInitScript(`localStorage.setItem('cubic.settings.v1', ${JSON.stringify(JSON.stringify({ hints: false, ...v.settings }))})`);
    const page = await context.newPage();
    await page.goto(`${BASE}/${v.query}`);
    await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
    await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
    pages.push(page);
  }
  const [a, b] = pages as [Page, Page];
  await Promise.all([toMode(a), toMode(b)]);
  await toLobby(a, b);
  await click(a, 'START');
  await until('the game started for both', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
  await sleep(1500);
  return [a, b];
}

/** Solve every face through the server's dev command: the last one wins the game. */
async function win(page: Page): Promise<void> {
  for (const face of FACES) {
    const res = await js<{ ok: boolean; error?: string }>(page, `window.__cubic.dev({ type: 'solve', face: ${face} })`);
    if (!res.ok) throw new Error(`dev solve refused: ${res.error} (start the server with DEV_COMMANDS=1)`);
  }
}

const card = (page: Page) =>
  js<{ on: boolean; phase: string; title: string; time: string; strikes: string; buttons: string[]; inside: boolean; focus: string }>(
    page,
    `(() => {
      const w = document.querySelector('#cu-win');
      const box = w.querySelector('.cu-win').getBoundingClientRect();
      return { on: w.classList.contains('on'), phase: w.dataset.phase, title: w.querySelector('h2').textContent, time: w.querySelector('#cu-wintime').textContent,
        strikes: w.querySelector('#cu-wintxt').textContent, buttons: [...w.querySelectorAll('button')].map((b) => b.textContent.trim()),
        inside: box.width > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, focus: document.activeElement?.id ?? '' };
    })()`,
  );

async function cardChecks(tag: string, page: Page): Promise<void> {
  const c = await card(page);
  check(c.on && c.phase === 'card' && c.title === 'Passed cube 1!', `${tag}: the title card is up ("${c.title}", phase ${c.phase})`);
  check(/^\d+:\d\d$/.test(c.time) && /^\d+ strikes?$/.test(c.strikes), `${tag}: it shows the time and the strikes ("${c.time}", "${c.strikes}")`);
  check(c.buttons.join('|') === 'Main menu|Play again' && c.focus === 'cu-again', `${tag}: MAIN MENU and PLAY AGAIN, Enter is on PLAY AGAIN (${c.buttons.join(', ')}; focus ${c.focus})`);
  check(c.inside, `${tag}: the card fits the window`);
}

const browser = await chromium.launch({ args: QUIET_ARGS });
try {
  for (const run of RUNS) {
    console.log(`\n== ${run}`);
    if (run === 'webgl' || run === 'canvas') {
      const [a, b] = await room(browser, { size: { width: 1920, height: 1080 }, query: run === 'canvas' ? '?renderer=canvas' : '' });
      await win(a);
      await until('the ending started for both', async () => (await endingState(a)).run !== null && (await endingState(b)).run !== null, 4000);
      const [ea, eb] = [await endingState(a), await endingState(b)];
      check(ea.phase !== 'card' && eb.phase !== 'card' && Math.abs(ea.t! - eb.t!) < 400, `${run}: the sequence plays for both, in step (outside ${Math.round(ea.t!)} ms, inside ${Math.round(eb.t!)} ms, read one after the other)`);
      check(ea.faces === 'game' && eb.faces === 'game', `${run}: the cube is made of the game's own faces`);
      for (const [page, side] of [[a, 'outside'], [b, 'inside']] as const) await endingShots(page, (name) => `${OUT}${run}-${side}-${name}.png`);
      // let it play to the card by itself on A; B skips with a key
      await js(b, 'window.__cubicEndingReplay()');
      await js(a, 'window.__cubicEndingReplay()');
      await sleep(900);
      await press(b, 'Enter');
      check((await card(b)).phase === 'play', `${run}: a key in the first two seconds does not skip`);
      await sleep(1400);
      await press(b, ' ');
      await sleep(200);
      check((await card(b)).phase === 'card', `${run}: a key after two seconds skips to the title card`);
      await until('the card on A by itself', async () => (await card(a)).phase === 'card', 9000);
      await sleep(900);
      await cardChecks(`${run} outside`, a);
      await cardChecks(`${run} inside`, b);
      for (const [page, side] of [[a, 'outside'], [b, 'inside']] as const) {
        await js(page, `window.__cubicEndingHold(${ENDING_CARD_MOMENT})`);
        await sleep(300);
        await page.screenshot({ path: `${OUT}${run}-${side}-6-card.png` });
        await js(page, 'window.__cubicEndingHold(null)');
      }
      // Enter = play again, for both
      const before = (await snap(a)).state!.startedAt;
      await press(a, 'Enter');
      await until('a new game for both', async () => {
        const [sa, sb] = [await snap(a), await snap(b)];
        return sa.state?.wonAt === null && sb.state?.wonAt === null && sa.state.startedAt !== before && !(await card(a)).on && !(await card(b)).on;
      }, 5000);
      check((await endingState(a)).run === null, `${run}: Enter plays again: a fresh game for both, the ending is gone`);
      await a.screenshot({ path: `${OUT}${run}-outside-7-play-again.png` });
      await Promise.all([a.context().close(), b.context().close()]);
    } else if (run === 'reduce') {
      const [a, b] = await room(browser, { size: { width: 1920, height: 1080 }, query: '', settings: { reduceMotion: true } });
      await win(a);
      await until('the card at once', async () => (await card(a)).phase === 'card' && (await card(b)).phase === 'card', 2500);
      await sleep(500);
      const e = await endingState(a);
      check(e.phase === 'card', `reduce motion: no unfold and no jump, straight to the flat cube and the card (phase ${e.phase})`);
      await cardChecks('reduce motion outside', a);
      await a.screenshot({ path: `${OUT}reduce-outside-card.png` });
      await b.screenshot({ path: `${OUT}reduce-inside-card.png` });
      await Promise.all([a.context().close(), b.context().close()]);
    } else if (run === 'touch') {
      const [a, b] = await room(browser, { size: { width: 844, height: 390 }, query: '?touch' });
      await win(a);
      await until('the ending started', async () => (await endingState(a)).run !== null, 4000);
      await endingShots(a, (name) => `${OUT}touch-outside-${name}.png`);
      await js(a, 'window.__cubicEndingReplay()');
      await sleep(2300);
      await a.touchscreen.tap(422, 300).catch(() => a.mouse.click(422, 300));
      await sleep(900);
      check((await card(a)).phase === 'card', 'touch: a tap after two seconds skips to the title card');
      await cardChecks('touch outside', a);
      const layout = await js<string>(a, `document.querySelector('.cu').dataset.layout`);
      await a.screenshot({ path: `${OUT}touch-outside-6-card.png` });
      await until('the card on B', async () => (await card(b)).phase === 'card', 9000);
      await sleep(900);
      await b.screenshot({ path: `${OUT}touch-inside-6-card.png` });
      console.log(`      layout: ${layout}`);
      // MAIN MENU by a tap: back on the mode screen
      const box = await a.locator('#cu-winleave').boundingBox();
      await a.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await until('A back on the menu', async () => (await snap(a)).screen !== 'game', 5000);
      check(true, 'touch: MAIN MENU leaves the room');
      await Promise.all([a.context().close(), b.context().close()]);
    } else if (run === 'late') {
      // a game found already won (a reload after the win): no sequence to sit through again
      const [a, b] = await room(browser, { size: { width: 1280, height: 720 }, query: '' });
      await win(a);
      await until('the ending started', async () => (await endingState(b)).run !== null, 4000);
      await b.reload();
      await until('B is back in the won game', async () => (await snap(b)).state?.wonAt != null && (await card(b)).on, 15_000);
      await sleep(600);
      check((await card(b)).phase === 'card', 'a reload into a won game goes straight to the title card');
      await b.screenshot({ path: `${OUT}late-inside-card.png` });
      await Promise.all([a.context().close(), b.context().close()]);
    } else console.log(`(no such run: ${run})`);
  }
} finally {
  await browser.close();
}
console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}; pictures in ${OUT}`);
process.exit(failed ? 1 : 0);
