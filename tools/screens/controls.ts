// The key bindings, in the real game with a real keyboard (the offline game, ?mock=game):
// rebind move-up to I and the player moves with I and not with W; a key in use swaps the
// two actions; Esc cancels; the binding is still there after a reload; every place that
// shows a key shows the new one; the gamepad still works whatever is bound; RESET TO
// DEFAULTS brings W back. Other settings survive the reload too.
//
//   needs:  a client dev server (no game server):  npm run dev -w client -- --port 5500
//   run:    cd tools && BASE=http://localhost:5500 npx tsx screens/controls.ts
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5500';
const STORAGE_KEY = 'cubic.settings.v1';

interface Pose {
  face: number;
  x: number;
  y: number;
}
interface Cubic {
  state: { items: Record<string, { face: number; x: number; y: number; side: string }>; players: { out: { pose: Pose; carrying: string | null } } };
}
declare const window: { __cubic: Cubic; __pad: { buttons: number[]; axes: number[] } };

const problems: string[] = [];
async function expect(what: string, cond: () => Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) {
      problems.push(what);
      console.log('   FAIL:', what);
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  console.log('   ok:', what);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text().slice(0, 200)}`));
// a fake standard gamepad (the Gamepad API is polled, so the page only has to report one)
await page.addInitScript(() => {
  const w = globalThis as unknown as { __pad: { buttons: number[]; axes: number[] }; navigator: { getGamepads(): unknown[] } };
  w.__pad = { buttons: [], axes: [0, 0] };
  w.navigator.getGamepads = () => [{ connected: true, mapping: 'standard', axes: w.__pad.axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: w.__pad.buttons.includes(i), value: 0 })) }];
});
const load = async () => {
  await page.goto(`${BASE}/?mock=game`);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); // the side card
  await page.waitForTimeout(300);
};
const pose = () => page.evaluate(() => ({ ...window.__cubic.state.players.out.pose }));
const carrying = () => page.evaluate(() => window.__cubic.state.players.out.carrying);
const press = async (key: string) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(160);
};
const pad = async (buttons: number[]) => {
  await page.evaluate((b) => (window.__pad = { buttons: b, axes: [0, 0] }), buttons);
  await page.waitForTimeout(150);
};
const keyOf = (action: string) => page.locator(`#cu-settings [data-bind="${action}"]`).textContent().then((t) => (t ?? '').trim());
const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as { keys?: Record<string, string>; music?: number; textSize?: string }, STORAGE_KEY);
const openControls = async () => {
  await page.locator('#cu-gear').click();
  await page.locator('#cu-settings [data-tab="controls"]').click();
  await page.waitForTimeout(150);
};
const closeSettings = async () => {
  await page.locator('#cu-settings [data-close]').click();
  await page.waitForTimeout(200);
};
/** Does this key move the player up by one? (Steps back down after, with the arrow.) */
async function movesUp(key: string): Promise<boolean> {
  const before = await pose();
  await press(key);
  const after = await pose();
  const moved = after.y === before.y - 1 && after.x === before.x;
  if (moved) await press('ArrowDown');
  return moved;
}

console.log('rebinding');
await load();
await expect('W moves up before any rebinding', () => movesUp('w'));
await openControls();
await expect('the row shows W', async () => (await keyOf('up')) === 'W');
await page.locator('#cu-settings [data-bind="up"]').click();
await expect('a click on the key says PRESS A KEY...', async () => /^press a key\.\.\.$/i.test(await keyOf('up')));
await press('Escape');
await expect('Esc cancels: still W, and the settings stay open', async () => (await keyOf('up')) === 'W' && (await page.evaluate(() => !!document.querySelector('#cu-settings.on'))));
await page.locator('#cu-settings [data-bind="up"]').focus();
await press('Enter');
await expect('Enter on the key button starts it too', async () => /press a key/i.test(await keyOf('up')));
await press('Enter');
await press('ArrowUp');
await expect('Enter and the arrows are fixed: it keeps waiting', async () => /press a key/i.test(await keyOf('up')));
await press('i');
await expect('the next key is bound: move up is I', async () => (await keyOf('up')) === 'I');
await expect('and it is saved', async () => (await saved()).keys?.up === 'i');

// a key that is in use: the two swap, and the other row is marked for a moment
await page.locator('#cu-settings [data-bind="drop"]').click();
await press('e');
await expect('binding DROP to E (pick up had it) swaps the two: pick up is Q', async () => (await keyOf('drop')) === 'E' && (await keyOf('interact')) === 'Q');
await expect('the other row is highlighted', () => page.evaluate(() => !!document.querySelector('#cu-settings [data-bind-row="interact"].swap')));
await expect('and the highlight goes', () => page.evaluate(() => !document.querySelector('#cu-settings .swap')), 2500);
await expect('no key is used twice and none is missing', async () => {
  const keys = Object.values((await saved()).keys ?? {});
  return keys.length === 13 && new Set(keys).size === 13;
});
await page.locator('#cu-settings [data-bind="drop"]').click();
await press('q');
await expect('swapped back: drop Q, pick up E', async () => (await keyOf('drop')) === 'Q' && (await keyOf('interact')) === 'E');
// pick up on P and drop on O, to prove the pad does not care
await page.locator('#cu-settings [data-bind="interact"]').click();
await press('p');
await page.locator('#cu-settings [data-bind="drop"]').click();
await press('o');
await page.locator('#cu-settings [data-tab="sound"]').click();
await page.locator('#cu-settings [data-key="music"]').focus();
await press('ArrowLeft');
await closeSettings();

await expect('I moves the player up', () => movesUp('i'));
await expect('W does not move the player any more', async () => !(await movesUp('w')));
await expect('the arrow keys still move', () => movesUp('ArrowUp'));
await press('Escape');
await expect('the pause menu shows the new keys', async () => {
  const text = (await page.locator('#cu-pause .cu-help').textContent()) ?? '';
  return /I\s?A\s?S\s?D \/ Arrows/i.test(text) && /Pick up \/ useP/.test(text) && /DropO/.test(text);
});
await press('Escape');

// the items: the keyboard's new keys, then the pad's own buttons
const onItem = await page.evaluate(() => {
  const c = window.__cubic;
  const item = Object.values(c.state.items).find((i) => i.side === 'out');
  if (!item) return false;
  Object.assign(c.state.players.out.pose, { face: item.face, x: item.x, y: item.y });
  return true;
});
if (onItem) {
  await press('e');
  await expect('E picks nothing up any more', async () => (await carrying()) === null);
  await press('p');
  await expect('P picks up', async () => (await carrying()) !== null);
  await expect('the HUD says "O drop"', async () => /O drop/i.test((await page.locator('#cu-carry').textContent()) ?? ''));
  await press('q');
  await expect('Q drops nothing any more', async () => (await carrying()) !== null);
  await press('o');
  await expect('O drops', async () => (await carrying()) === null);
  await pad([0]);
  await pad([]);
  await expect('gamepad A still picks up (the pad is not rebound)', async () => (await carrying()) !== null);
  await pad([1]);
  await pad([]);
  await expect('gamepad B still drops', async () => (await carrying()) === null);
} else console.log('   SKIPPED: no item on the outside of the default map');
const p0 = await pose();
await pad([12]);
await pad([]);
await expect('the d-pad still moves', async () => (await pose()).y < p0.y);

console.log('after a reload');
await load();
await expect('I still moves up', () => movesUp('i'));
await expect('W still does not', async () => !(await movesUp('w')));
await openControls();
await expect('the controls tab shows I, P and O', async () => (await keyOf('up')) === 'I' && (await keyOf('interact')) === 'P' && (await keyOf('drop')) === 'O');
await expect('the other settings survived too (music one step down)', async () => (await saved()).music === 0.3);

console.log('reset');
await page.locator('#cu-settings [data-reset]').click();
await expect('RESET TO DEFAULTS: W, E and Q are back', async () => (await keyOf('up')) === 'W' && (await keyOf('interact')) === 'E' && (await keyOf('drop')) === 'Q');
await expect('RESET is then disabled (nothing to reset)', () => page.locator('#cu-settings [data-reset]').isDisabled());
await expect('the music setting was not reset with them', async () => (await saved()).music === 0.3);
await closeSettings();
await expect('W moves up again', () => movesUp('w'));
await expect('I does not', async () => !(await movesUp('i')));
await load();
await expect('and after another reload it is still W', () => movesUp('w'));

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nall clean');
