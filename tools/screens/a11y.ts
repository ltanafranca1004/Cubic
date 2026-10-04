// Keyboard-only check of the whole game, with screenshots into docs/screens/a11y.
// NO MOUSE: every step is a key press (the script never touches page.mouse or .click()).
// Two real clients go from the title through the lobby into a game, then chat,
// quick chat, hold the cube map, pause, change settings and leave. It fails loudly if a
// step does not end where it should.
//
//   server:  PORT=3303 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3303 npm run dev -w client -- --port 5403
//   then:    cd tools && npx tsx screens/a11y.ts          (BASE=http://localhost:5403 by default)
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5403';
const OUT = new URL('../../docs/screens/a11y/', import.meta.url).pathname;
/** SIZE=1920x1080 runs at another window size. */
const [SIZE_W, SIZE_H] = (process.env.SIZE ?? '1280x720').split('x').map(Number);
const SIZE = { width: SIZE_W!, height: SIZE_H! };
mkdirSync(OUT, { recursive: true });

interface Pose {
  face: number;
  x: number;
  y: number;
}
interface Cubic {
  code: string | null;
  role: string | null;
  side: 'out' | 'in' | null;
  error: string | null;
  chat: { text: string; from: string }[];
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null; ready: boolean } | null> } | null;
  state: { players: Record<'out' | 'in', { pose: Pose; carrying: string | null }> } | null;
}
interface ButtonProbe {
  label: string;
  enabled: boolean;
  focused: boolean;
}
declare const window: { __cubic: Cubic; __cubicButtons(): ButtonProbe[] };
declare const document: {
  activeElement: { id: string; className: string; getAttribute(n: string): string | null; textContent: string | null } | null;
  querySelector(s: string): { dataset: Record<string, string>; hidden: boolean; textContent: string | null; getAttribute(n: string): string | null; classList: { contains(c: string): boolean } } | null;
  querySelectorAll(s: string): { length: number };
};

const problems: string[] = [];
async function open(browser: Browser, query = '', init?: () => void): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZE });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  if (init) await page.addInitScript(init);
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
    await page.waitForTimeout(140);
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
const screenOf = (page: Page) => page.evaluate(() => document.querySelector('.cu')!.dataset.screen);
const buttons = (page: Page) => page.evaluate(() => window.__cubicButtons());
const focusedButton = async (page: Page) => (await buttons(page)).find((b) => b.focused)?.label ?? null;
const has = async (page: Page, label: string) => (await buttons(page)).some((b) => b.label === label);
/** Which DOM panel is open on top, by id, or null. */
const modal = (page: Page) =>
  page.evaluate(() => {
    for (const id of ['cu-settings', 'cu-pause', 'cu-win']) if (document.querySelector(`#${id}`)?.classList.contains('on')) return id;
    return null;
  });
/** What the DOM focus is on: the control's label. */
const domFocus = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? null);
const setting = (page: Page, key: string) =>
  page.evaluate((k) => {
    const node = document.querySelector(`#cu-settings [data-key="${k}"]`)!;
    return node.getAttribute('aria-valuenow') ?? node.getAttribute('aria-checked') ?? document.querySelector(`#cu-settings [data-key="${k}"] .on`)?.dataset.value ?? null;
  }, key);
const pose = (page: Page, side: 'out' | 'in') => net(page, (c) => c.state!.players).then((p) => p[side].pose);

/** Walk the focus down the open panel until it is on `label`. */
async function focusOn(page: Page, label: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await domFocus(page)) === label) return;
    await press(page, 'ArrowDown');
  }
  throw new Error(`could not reach "${label}" with the keyboard`);
}

/** Title -> mode screen. Enter is Play; the dive takes 1.2s. */
async function toMode(page: Page): Promise<void> {
  await press(page, 'Enter');
  await page.waitForTimeout(1900);
}

async function menus(browser: Browser, renderer: 'webgl' | 'canvas'): Promise<void> {
  console.log(`menus (${renderer})`);
  const tag = renderer === 'canvas' ? '-canvas' : '';
  const a = await open(browser, renderer === 'canvas' ? '?renderer=canvas' : '');

  // the title: any key shows where the focus is
  await press(a, 'ArrowDown');
  await expect('PLAY has the focus outline', async () => (await focusedButton(a)) === 'PLAY');
  await shot(a, `01-start-focus${tag}`);

  // the gear by keyboard: Tab, Enter. Then the panel: up/down rows, left/right values.
  for (let i = 0; i < 3 && (await domFocus(a)) !== 'Settings'; i++) await press(a, 'Tab');
  await expect('Tab reaches the settings gear', async () => (await domFocus(a)) === 'Settings');
  await shot(a, `02-gear-focus${tag}`);
  await press(a, 'Enter');
  await expect('Enter on the gear opens the settings, not Play', async () => (await modal(a)) === 'cu-settings' && (await has(a, 'PLAY')));
  await expect('the focus is inside the panel', async () => (await domFocus(a)) === 'Master volume');
  await focusOn(a, 'Music');
  const before = Number(await setting(a, 'music'));
  await press(a, 'ArrowLeft', 'ArrowLeft', 'a');
  await expect('left / A turn the music slider down', async () => Number(await setting(a, 'music')) === before - 15);
  await press(a, 'ArrowRight', 'd');
  await expect('right / D turn it up', async () => Number(await setting(a, 'music')) === before - 5);
  await focusOn(a, 'Mic mode');
  await press(a, 'ArrowRight');
  await expect('mic mode: push-to-talk', async () => (await setting(a, 'micMode')) === 'ptt');
  await shot(a, `03-settings-keyboard${tag}`);
  await press(a, 'ArrowLeft');
  await expect('mic mode: open mic', async () => (await setting(a, 'micMode')) === 'open');
  await focusOn(a, 'Done');
  await shot(a, `04-settings-done-focus${tag}`);
  await press(a, 'Enter');
  await expect('Done closes the panel and the title is still there', async () => (await modal(a)) === null && (await has(a, 'PLAY')));
  for (let i = 0; i < 3 && (await domFocus(a)) !== 'Settings'; i++) await press(a, 'Tab');
  await press(a, 'Enter');
  await expect('the gear opens it again', async () => (await modal(a)) === 'cu-settings');
  await press(a, 'Escape');
  await expect('Esc closes it and does nothing else', async () => (await modal(a)) === null && (await has(a, 'PLAY')));

  // mode screen: arrows walk the menu and reach Back
  await toMode(a);
  await press(a, 'ArrowDown');
  await expect('the first choice has the focus', async () => (await focusedButton(a)) === 'CREATE LOBBY');
  await shot(a, `05-mode-focus${tag}`);
  await press(a, 's');
  await expect('S moves down', async () => (await focusedButton(a)) === 'JOIN LOBBY');
  for (let i = 0; i < 4 && (await focusedButton(a)) !== 'BACK'; i++) await press(a, 'ArrowDown');
  await expect('down past the menu is Back', async () => (await focusedButton(a)) === 'BACK');
  await shot(a, `06-mode-back-focus${tag}`);
  await press(a, 'Enter');
  await a.waitForTimeout(700);
  await expect('Enter on Back returns to the title', async () => (await has(a, 'PLAY')) && !(await has(a, 'BACK')));
  await toMode(a);
  await expect('and Play dives again', async () => has(a, 'BACK'));
  await press(a, 'Escape');
  await a.waitForTimeout(700);
  await expect('Esc is Back too', async () => (await has(a, 'PLAY')) && !(await has(a, 'BACK')));
  await toMode(a);

  // join popup: type, Backspace, Enter; the arrows reach CANCEL
  await press(a, 'ArrowDown', 'ArrowDown');
  await expect('JOIN LOBBY focused', async () => (await focusedButton(a)) === 'JOIN LOBBY');
  await press(a, ' ');
  await a.waitForTimeout(400);
  await expect('Space opens the join popup', async () => has(a, 'CANCEL'));
  await a.keyboard.type('zwsd');
  await a.waitForTimeout(150);
  await shot(a, `07-join-typed${tag}`);
  await press(a, 'Enter');
  await expect('a wrong code is refused', async () => /not found/i.test((await net(a, (c) => c.error)) ?? ''));
  await a.waitForTimeout(500);
  await press(a, 'Backspace', 'Backspace', 'Backspace', 'Backspace');
  await press(a, 'ArrowDown');
  await expect('down reaches JOIN', async () => (await focusedButton(a)) === 'JOIN');
  await press(a, 'ArrowLeft');
  await expect('left reaches CANCEL', async () => (await focusedButton(a)) === 'CANCEL');
  await shot(a, `08-join-cancel-focus${tag}`);
  await press(a, 'Enter');
  await a.waitForTimeout(400);
  await expect('CANCEL closes the popup', async () => !(await has(a, 'CANCEL')) && (await has(a, 'CREATE LOBBY')));
  await a.close();
}

async function game(browser: Browser): Promise<void> {
  console.log('game: two clients, keyboard only');
  const a = await open(browser);
  const b = await open(browser);
  await toMode(a);
  await press(a, 'ArrowDown', 'Enter');
  await expect('the host made a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  const code = (await net(a, (c) => c.code))!;
  await toMode(b);
  await press(b, 'ArrowDown', 'ArrowDown', 'Enter');
  await b.waitForTimeout(400);
  await b.keyboard.type(code.toLowerCase());
  await press(b, 'Enter');
  await expect('the guest joined by typing the code', async () => (await net(b, (c) => c.code)) === code);
  await b.waitForTimeout(700);

  // side select: left/right pick, up/down reach LEAVE, Enter is the main action
  await press(a, 'ArrowLeft');
  await press(b, 'd');
  await expect('both picked a side', async () => (await net(a, (c) => c.room?.members.host?.side)) === 'out' && (await net(a, (c) => c.room?.members.guest?.side)) === 'in');
  await expect('the main action has the focus', async () => (await focusedButton(b)) === 'READY');
  await a.waitForTimeout(300);
  await shot(b, '09-side-select-focus');
  await press(a, 'ArrowUp');
  await expect('up moves the focus to LEAVE', async () => (await focusedButton(a)) === 'LEAVE');
  await shot(a, '10-side-select-leave-focus');
  await press(a, 'ArrowDown');
  await expect('and back to START', async () => (await focusedButton(a)) === 'START');
  await press(b, 'Enter');
  await expect('the guest is ready', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(300);
  await press(a, ' ');
  await expect('the game started for both', async () => (await screenOf(a)) === 'game' && (await screenOf(b)) === 'game');
  await a.waitForTimeout(1300);

  // moving, and chat: Enter opens, the game does not move while typing, Enter sends, Esc closes
  const start = await pose(a, 'out');
  await press(a, 'w');
  await expect('W walks', async () => (await pose(a, 'out')).y === start.y - 1);
  await press(a, 'Enter');
  await expect('Enter opens the chat', async () => (await domFocus(a)) === 'Chat message');
  await a.keyboard.type('was 1 here, saw 4 doors');
  await a.waitForTimeout(100);
  await expect('typing does not move or quick-chat', async () => (await pose(a, 'out')).y === start.y - 1 && (await net(a, (c) => c.chat.length)) === 0);
  await shot(a, '11-chat-typing');
  await press(a, 'Enter');
  await expect('Enter sends', async () => (await net(b, (c) => c.chat.at(-1)?.text)) === 'was 1 here, saw 4 doors');
  await press(a, 'Escape');
  await expect('Esc closes the chat (and does not pause)', async () => (await domFocus(a)) !== 'Chat message' && (await modal(a)) === null);

  // quick chat: 1 to 4
  await press(b, '1');
  await expect('the partner sees the bubble', async () => (await a.evaluate(() => document.querySelector('.cu-bubble.theirs')?.textContent)) === 'Here!');
  await expect('and the line is in both chat logs', async () => (await net(a, (c) => c.chat.at(-1)?.text)) === 'Here!' && (await net(b, (c) => c.chat.at(-1)?.text)) === 'Here!');
  await press(a, '3');
  await expect('3 is Yes', async () => (await b.evaluate(() => document.querySelector('.cu-bubble.theirs')?.textContent)) === 'Yes');
  await a.waitForTimeout(150);
  await shot(a, '13-quick-chat-outside');
  await shot(b, '13-quick-chat-inside');
  await press(a, '2');
  await press(b, '4');
  await expect('2 is Wait, 4 is No', async () => {
    const texts = await net(a, (c) => c.chat.map((m) => m.text));
    return texts.includes('Wait') && texts.includes('No');
  });

  // Tab holds the cube map: while it is down the arrows turn the map, they do not walk
  const held = await pose(a, 'out');
  await a.keyboard.down('Tab');
  await press(a, 'ArrowUp', 'w');
  await expect('no step while Tab is held', async () => (await pose(a, 'out')).y === held.y);
  await a.keyboard.up('Tab');
  await press(a, 'ArrowUp');
  await expect('steps again after Tab is let go', async () => (await pose(a, 'out')).y !== held.y || (await pose(a, 'out')).face !== held.face);

  // pause: Esc. The game does not take keys; the partner keeps playing.
  await press(a, 'Escape');
  await expect('Esc opens the pause menu on Resume', async () => (await modal(a)) === 'cu-pause' && (await domFocus(a)) === 'Resume');
  await a.waitForTimeout(350); // the panel drops in
  await shot(a, '15-pause-controls');
  const paused = await pose(a, 'out');
  await press(a, '1');
  await press(a, 'ArrowDown');
  await expect('down moves the focus, not the player', async () => (await domFocus(a)) === 'Settings' && (await pose(a, 'out')).y === paused.y);
  await press(a, 'Enter');
  await expect('Settings opens from the pause menu', async () => (await modal(a)) === 'cu-settings');
  // the tabs: left / right on them; the keyboard reaches every tab and every row
  await focusOn(a, 'Settings sections');
  await press(a, 'ArrowRight', 'ArrowRight');
  await focusOn(a, 'Move up: W. Press to change');
  await press(a, 'Enter');
  await expect('Enter on a key button waits for a key', async () => /press a key/i.test((await domFocus(a)) ?? ''));
  await press(a, 'i');
  await expect('the key pressed is the new binding', async () => (await domFocus(a)) === 'Move up: I. Press to change');
  await press(a, 'Enter', 'Escape');
  await expect('Esc cancels a waiting key button and leaves the panel open', async () => (await domFocus(a)) === 'Move up: I. Press to change' && (await modal(a)) === 'cu-settings');
  await a.waitForTimeout(250);
  await shot(a, '16b-settings-controls');
  await focusOn(a, 'Reset to defaults');
  await press(a, 'Enter');
  await focusOn(a, 'Move up: W. Press to change');
  await focusOn(a, 'Settings sections');
  await press(a, 'ArrowLeft');
  await focusOn(a, 'Text size');
  await press(a, 'ArrowRight');
  await focusOn(a, 'High contrast');
  await press(a, 'Enter');
  await focusOn(a, 'Screen shake');
  await press(a, ' ');
  await expect('text size L, high contrast on, screen shake off', async () => (await setting(a, 'textSize')) === 'l' && (await setting(a, 'highContrast')) === 'true' && (await setting(a, 'screenShake')) === 'false');
  await shot(a, '16-settings-accessibility');
  await press(a, 'Escape');
  await expect('Esc goes back to the pause menu', async () => (await modal(a)) === 'cu-pause');
  await press(a, 'Escape');
  await expect('Esc again resumes', async () => (await modal(a)) === null && (await screenOf(a)) === 'game');
  await press(b, '1');
  await a.waitForTimeout(300);
  await shot(a, '17-high-contrast-large-text');

  // M mutes the mic (the setting flips; seen in the panel)
  await press(a, 'm', 'Escape', 'ArrowDown', 'Enter');
  await expect('M muted the mic', async () => (await setting(a, 'micMuted')) === 'true');
  await press(a, 'Escape', 'Escape');

  // captions and the "Partner speaking" tag (the stores the narrator and the voice feed)
  await b.evaluate(async () => {
    const captions = (await import(/* @vite-ignore */ `${'/src/ui/captions.ts'}`)) as { showCaption(t: string, o?: { ms: number }): void; setPartnerLevel(l: number): void };
    captions.showCaption('The wall is thin here. You can hear someone breathing on the other side.', { ms: 60_000 });
    setInterval(() => captions.setPartnerLevel(0.6), 20);
  });
  await expect('a caption and the speaking tag show', async () => b.evaluate(() => document.querySelector('#cu-caption')!.hidden === false && document.querySelector('#cu-speaking')!.hidden === false));
  await shot(b, '18-caption-partner-speaking');

  // leave from the pause menu
  await press(a, 'Escape');
  await focusOn(a, 'Leave');
  await press(a, 'Enter');
  await expect('Leave goes back to the mode screen', async () => (await net(a, (c) => c.code)) === null && (await screenOf(a)) === 'menu');
  await a.waitForTimeout(900);
  await expect('with Back still there', async () => has(a, 'BACK'));
  await a.close();
  await b.close();
}

/** E picks up and Q drops, in the offline game (?mock=game), standing on the rose. */
async function items(browser: Browser): Promise<void> {
  console.log('items: E and Q');
  const page = await open(browser, '?mock=game');
  const onItem = await page.evaluate(() => {
    const c = window.__cubic as unknown as { state: { items: Record<string, { face: number; x: number; y: number; side: string }>; players: Record<string, { pose: Pose }> }; move(dx: number, dy: number): void };
    const item = Object.values(c.state.items).find((i) => i.side === 'out');
    if (!item) return false;
    Object.assign(c.state.players.out!.pose, { face: item.face, x: item.x, y: item.y });
    return true;
  });
  if (!onItem) {
    console.log('   SKIPPED: no item on the outside of the default map');
    await page.close();
    return;
  }
  await press(page, 'q');
  await expect('Q with empty hands picks nothing up', async () => (await net(page, (c) => c.state!.players.out.carrying)) === null);
  await press(page, 'e');
  await expect('E picks up', async () => (await net(page, (c) => c.state!.players.out.carrying)) !== null);
  await page.waitForTimeout(300);
  await shot(page, '19-carrying-q-to-drop');
  await press(page, 'q');
  await expect('Q drops', async () => (await net(page, (c) => c.state!.players.out.carrying)) === null);
  await page.close();
}

/** A fake standard gamepad (the Gamepad API is polled, so the page only has to report one). */
async function gamepad(browser: Browser): Promise<void> {
  console.log('gamepad (a faked pad: no hardware here)');
  const page = await open(browser, '?mock=game', () => {
    const w = globalThis as unknown as { __pad: { buttons: number[]; axes: number[] }; navigator: { getGamepads(): unknown[] } };
    w.__pad = { buttons: [], axes: [0, 0] };
    w.navigator.getGamepads = () => [{ connected: true, mapping: 'standard', axes: w.__pad.axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: w.__pad.buttons.includes(i), value: 0 })) }];
  });
  const set = async (buttons: number[], axes = [0, 0]) => {
    await page.evaluate((p) => ((globalThis as unknown as { __pad: unknown }).__pad = p), { buttons, axes });
    await page.waitForTimeout(150);
  };
  await press(page, 'Escape'); // the side card: Esc (Start on the pad) closes it before it would pause
  const p0 = await pose(page, 'out');
  // (the game scene takes keys once its art has loaded: give a first press a few tries)
  for (let i = 0; i < 10 && (await pose(page, 'out')).y === p0.y; i++) {
    await set([12]);
    await set([]);
  }
  // a 150 ms hold can reach the key repeat (130 ms), so one press is one or two steps
  await expect('d-pad up walks up', async () => (await pose(page, 'out')).y < p0.y);
  await set([], [0, 1]);
  await set([]);
  await expect('the stick walks back down', async () => (await pose(page, 'out')).y >= p0.y);
  await set([9]);
  await set([]);
  await expect('Start pauses', async () => (await modal(page)) === 'cu-pause');
  await set([13]);
  await set([]);
  await expect('d-pad down moves the focus', async () => (await domFocus(page)) === 'Settings');
  await set([0]);
  await set([]);
  await expect('A selects', async () => (await modal(page)) === 'cu-settings');
  await set([1]);
  await set([]);
  await set([1]);
  await set([]);
  await expect('B backs out, twice, into the game', async () => (await modal(page)) === null);
  await page.close();
}

const ONLY = process.argv[2]; // run one part: menus | game | items | gamepad
const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  if (!ONLY || ONLY === 'menus') {
    if (process.env.RENDERER !== 'canvas') await menus(browser, 'webgl');
    if (process.env.RENDERER !== 'webgl') await menus(browser, 'canvas'); // RENDERER=webgl or canvas: only that one
  }
  if (!ONLY || ONLY === 'game') await game(browser);
  if (!ONLY || ONLY === 'items') await items(browser);
  if (!ONLY || ONLY === 'gamepad') await gamepad(browser);
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
console.log('done ->', OUT);
