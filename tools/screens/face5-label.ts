// THE SYMBOL LABEL OF FACE 5, in a real browser: two players in one room, both put on face
// 5 with the dev commands and walked onto the same symbol. Each sees the name over their
// OWN turtle only, the same word on both sides of the wall, and none once they step off.
//
//   server:  PORT=3687 AI_FAKE=1 DEV_COMMANDS=1 npm start -w server
//   client:  VITE_SERVER_URL=http://localhost:3687 npm run dev -w client -- --port 5787
//   cd tools && npx tsx screens/face5-label.ts
//
//   BASE    client URL (default http://localhost:5787)
//   OUT     output folder (default docs/status/)
//   SYMBOL  which symbol to stand on (default "bolt")
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { SYMBOL_NAMES, SYMBOL_OBJECT, symbolLabelText, visibleObjects, type Side } from '../../shared/src/index';
import { js, openTitle, players, sleep, stateOf, toGame, toLobby, toMode, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5787';
const OUT = process.env.OUT ?? new URL('../../docs/status/', import.meta.url).pathname;
const SYMBOL = process.env.SYMBOL ?? 'bolt';
const FACE = 5;

mkdirSync(OUT, { recursive: true });
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

const dev = (page: Page, cmd: object) => js<{ ok: boolean; error?: string }>(page, `window.__cubic.dev(${JSON.stringify(cmd)})`);
/** The labels on a page: their words and where they are, against the game view and the turtle's tile. */
const labels = (page: Page) =>
  js<{ text: string; box: number[]; view: number[] }[]>(
    page,
    `[...document.querySelectorAll('.cu-label')].map((n) => {
      const r = n.getBoundingClientRect(), v = document.querySelector('.cu-over').getBoundingClientRect();
      return { text: n.textContent, box: [r.left, r.top, r.right, r.bottom], view: [v.left, v.top, v.right, v.bottom] };
    })`,
  );

const real = await chromium.launch({ args: ['--mute-audio'] });
// every page: no speech (the narrator and the captions would talk through the speakers)
const browser = {
  newContext: async (o: Parameters<Browser['newContext']>[0]) => {
    const ctx = await real.newContext(o);
    await ctx.addInitScript(`(() => {
      const quiet = { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {}, speaking: false, pending: false, paused: false };
      try { Object.defineProperty(window, 'speechSynthesis', { value: quiet, configurable: true }); } catch {}
    })()`);
    return ctx;
  },
} as unknown as Browser;

try {
  const size = { width: 1280, height: 800 };
  const a = await openTitle(browser, BASE, size);
  const b = await openTitle(browser, BASE, size);
  await toMode(a);
  await toMode(b);
  await toLobby(a, b);
  await toGame(a, b);
  const game = players(a, b);
  const page = (side: Side) => (side === 'out' ? a : b);

  const ping = await dev(a, { type: 'ping' });
  if (!ping.ok) throw new Error(`dev commands are off: ${ping.error} (start the server with DEV_COMMANDS=1)`);
  const index = (SYMBOL_NAMES as readonly string[]).indexOf(SYMBOL);
  if (index < 0) throw new Error(`no symbol called ${SYMBOL}`);
  const want = symbolLabelText(SYMBOL_NAMES[index]!);

  for (const side of ['out', 'in'] as const) {
    await dev(page(side), { type: 'teleport', side, face: FACE });
    await until(`the ${side}side player on face ${FACE}`, async () => (await stateOf(page(side))).players[side].pose.face === FACE);
  }
  await sleep(900);
  for (const side of ['out', 'in'] as const) {
    const tile = visibleObjects(await stateOf(page(side)), side, FACE).filter((o) => o.type === SYMBOL_OBJECT)[index]!;
    await game.go(side, FACE, tile.x, tile.y);
  }
  await sleep(900);
  for (const side of ['out', 'in'] as const) {
    const seen = await labels(page(side));
    check(seen.length === 1 && seen[0]!.text === want, `${side}: one label, "${want}" (${JSON.stringify(seen.map((l) => l.text))}): the partner on the same tile adds none`);
    const l = seen[0];
    if (l) check(l.box[0]! >= l.view[0]! && l.box[1]! >= l.view[1]! && l.box[2]! <= l.view[2]! && l.box[3]! <= l.view[3]!, `${side}: the label is inside the game view`);
    await page(side).screenshot({ path: `${OUT}face5-label-${side === 'out' ? 'outside' : 'inside'}.png` });
  }
  // stepping off takes it away
  for (const side of ['out', 'in'] as const) {
    const pose = (await stateOf(page(side))).players[side].pose;
    await game.go(side, FACE, pose.x, pose.y + 1);
    await sleep(300);
    check((await labels(page(side))).length === 0, `${side}: no label after stepping off the symbol`);
  }
} catch (e) {
  problems.push(String(e));
  console.error(e);
} finally {
  await real.close();
}

console.log(problems.length ? `${problems.length} problem(s)` : 'face 5 label: all checks passed');
process.exit(problems.length ? 1 : 0);
