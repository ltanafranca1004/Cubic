// The DOM overlays at every text size, with high contrast, in both Phaser renderers and at
// two window sizes: the HUD, the settings (each tab, and a key button waiting for a key),
// the pause menu, the side card and the lobby's COPY button. Screenshots go to
// docs/screens/overlays/, and every state is MEASURED: the run fails if any text leaves
// its box, any box leaves the window, or two boxes of the top bar or the column overlap.
//
// It also checks, with a real mouse and keyboard: the settings never show below full
// opacity (rapid toggles, from the pause menu, during a face transition), no click on an
// overlay reaches a control under it, text size / high contrast / reduce motion change
// what they say they change, the side card's three ways out, and the cursor.
//
//   needs:  a client dev server; no game server (it uses ?mock=game and ?mock=lobby)
//           npm run dev -w client -- --port 5500
//   run:    cd tools && BASE=http://localhost:5500 npx tsx screens/overlays.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5500';
const OUT = new URL('../../docs/screens/overlays/', import.meta.url).pathname;
const STORAGE_KEY = 'cubic.settings.v1';
mkdirSync(OUT, { recursive: true });

type Size = { width: number; height: number };
type TextSize = 's' | 'm' | 'l';
const SIZES: Size[] = [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }];

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};
const ok = (msg: string) => console.log('   ok:', msg);

async function open(browser: Browser, size: Size, query: string, tag: string, saved: Record<string, unknown> = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: size, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`${tag}: console error: ${m.text().slice(0, 200)}`);
  });
  await page.addInitScript('globalThis.__name = (f) => f'); // (tsx names the functions it sends to the page)
  // the settings are saved in the browser: start each page from the ones under test
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key!)) localStorage.setItem(key!, value!);
  }, [STORAGE_KEY, JSON.stringify(saved)]);
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1500);
  return page;
}

/**
 * MEASURE the DOM UI as it is on screen. Returns one line per problem:
 * a text wider than the box that holds it, a box outside the window, two boxes of the top
 * bar or of the HUD column on top of each other, a panel taller or wider than the window.
 */
const audit = (page: Page): Promise<string[]> =>
  page.evaluate(`(() => {
    const out = [];
    const root = document.querySelector('.cu');
    const vw = window.innerWidth, vh = window.innerHeight;
    const shown = (n) => { if (!n.getClientRects().length) return false; const s = getComputedStyle(n); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
    const name = (n) => (n.id ? '#' + n.id : '.' + String(n.className).split(' ').filter(Boolean).join('.')) + ' "' + (n.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28) + '"';
    const BOX = '.cu-btn, .cu-room, .cu-stat, .cu-key, .cu-seg > span, .cu-tabs > span, .cu-kbd, .cu-chipbtn, .cu-chip, .cu-banner, .cu-speaking, .cu-caption, .cu-bubble, .cu-set, .cu-sub, .cu-vrow, .cu-face, .cu-prog, .cu-carry, .cu-help > *, .cu-panel, .cu-edge, .cu-field';
    // 1. every piece of text stays inside the nearest box that holds it, and inside the window
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!shown(el) || el.closest('.cu-stage, #game, .cu-log')) continue;
      let hidden = false;
      for (let p = el; p && p !== root; p = p.parentElement) if (!shown(p)) hidden = true;
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const box = el.closest(BOX);
      if (box) {
        const b = box.getBoundingClientRect();
        const upright = getComputedStyle(box).writingMode.startsWith('vertical'); // (its line box is across, and may be wider than the band)
        if (!upright && (r.left < b.left - 1 || r.right > b.right + 1)) out.push('text wider than its box: ' + name(el) + ' in ' + name(box) + ' (' + Math.round(r.width) + ' in ' + Math.round(b.width) + ')');
        const vertical = getComputedStyle(box).writingMode.startsWith('vertical');
        if (vertical && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) out.push('text longer than its box: ' + name(el));
      }
      // (the font's cell has three empty rows of sixteen above its capitals and below its tails)
      const slack = parseFloat(getComputedStyle(el).fontSize) * 3 / 16;
      if (r.left < -1 || r.right > vw + 1 || r.top + slack < -1 || r.bottom - slack > vh + 1) out.push('text outside the window: ' + name(el));
    }
    // 2. every box is inside the window, and inside the panel it belongs to
    for (const b of root.querySelectorAll(BOX + ', .cu-gear, .cu-toggle, .cu-slider, .cu-cube-box, .cu-ico, .cu-view')) {
      if (!shown(b) || b.closest('.cu-log')) continue;
      let hidden = false;
      for (let p = b; p && p !== root; p = p.parentElement) if (!shown(p)) hidden = true;
      if (hidden) continue;
      const r = b.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) out.push('outside the window: ' + name(b) + ' [' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ']');
      const panel = b.parentElement && b.parentElement.closest('.cu-panel');
      if (panel && !b.matches('.cu-bubble')) {
        const p = panel.getBoundingClientRect();
        if (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1) out.push('outside its panel: ' + name(b) + ' in ' + name(panel));
      }
    }
    // 3. the boxes of the top bar, of the column and of a row do not overlap each other
    const apart = (list, what) => {
      const rs = list.filter(shown).map((n) => [n, n.getBoundingClientRect()]);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i][1], b = rs[j][1];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(what + ' overlap: ' + name(rs[i][0]) + ' and ' + name(rs[j][0]));
      }
    };
    apart([...root.querySelectorAll('#cu-leave, #cu-room, #cu-copy, .cu-stat, #cu-gear')], 'top bar');
    apart([...root.querySelectorAll('.cu-col > *')], 'column');
    apart([...root.querySelectorAll('.cu-edge, .cu-view')], 'view');
    for (const row of root.querySelectorAll('.cu-set, .cu-vrow, .cu-face, .cu-prog, .cu-carry, .cu-vbtns, .cu-actions, .cu-tabs, .cu-onb-card header')) if (shown(row)) apart([...row.children], 'row');
    for (const col of root.querySelectorAll('.cu-setgrid.on .cu-setcol, .cu-id, .cu-pausebtns')) if (shown(col)) apart([...col.children], 'rows');
    apart([...root.querySelectorAll('.cu-help > span')], 'table');
    // 4. the column fits the window's height (the chat takes what is left and may not be squeezed to nothing)
    const col = root.querySelector('.cu-col');
    if (col && shown(col)) {
      if (col.scrollHeight > col.clientHeight + 1) out.push('the column is taller than the window (' + col.scrollHeight + ' in ' + col.clientHeight + ')');
      const log = root.querySelector('.cu-log');
      const line = parseFloat(getComputedStyle(log).lineHeight);
      if (log.clientHeight < line * 2 - 1) out.push('the chat log has room for less than two lines (' + log.clientHeight + 'px)');
    }
    return [...new Set(out)];
  })()`) as Promise<string[]>;

async function measured(page: Page, what: string): Promise<void> {
  const found = await audit(page);
  for (const f of found) fail(`${what}: ${f}`);
}

const opacityOfSettings = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('#cu-settings.on > .cu-panel');
    if (!panel) return null;
    let o = 1;
    for (let n: Element | null = panel; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });
const isOn = (page: Page, id: string) => page.evaluate((i) => !!document.querySelector(`#${i}.on`), id);
const middle = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/** A real mouse click: move there, press, let go. */
async function mouseClick(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}
const cursorAt = (page: Page, at: { x: number; y: number }) =>
  page.evaluate((p) => {
    const hit = document.elementFromPoint(p.x, p.y);
    return hit ? getComputedStyle(hit).cursor : '';
  }, at);
const textPx = (page: Page, selector: string) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize), selector);

async function shots(browser: Browser, size: Size, renderer: 'webgl' | 'canvas'): Promise<void> {
  const tag = `${size.width}x${size.height} ${renderer}`;
  const r = renderer === 'canvas' ? '&renderer=canvas' : '';
  const shot = async (page: Page, name: string) => {
    await page.waitForTimeout(350); // a panel drops in over 200 ms
    await page.screenshot({ path: `${OUT}${size.width}-${renderer}-${name}.png` });
  };
  console.log(`\n${tag}`);

  // ---------- the HUD and the panels over it, at each text size ----------
  for (const text of ['s', 'm', 'l'] as TextSize[]) {
    const page = await open(browser, size, `?mock=game${r}`, `${tag} ${text}`, { textSize: text });
    const T = text.toUpperCase();
    // the side card: up at the start, with its GOT IT button (and the controls hint and the narrator)
    if (!(await page.evaluate(() => !!document.querySelector('.cu-onb-card.on')))) fail(`${tag} ${T}: the side card is not up at the start of a game`);
    await measured(page, `${tag} side card text ${T}`);
    await shot(page, `card-${text}`);
    await page.keyboard.press('Escape'); // Esc closes the card first
    await page.waitForTimeout(500);
    if (await isOn(page, 'cu-pause')) fail(`${tag} ${T}: the first Esc opened the pause menu instead of closing the side card`);
    if (await page.evaluate(() => !!document.querySelector('.cu-onb-card.on'))) fail(`${tag} ${T}: Esc did not close the side card`);
    // the HUD by itself: the hints off (they are measured above and in tools/screens/onboarding.ts)
    await page.evaluate(async () => {
      const m = (await import(/* @vite-ignore */ `${'/src/style/settings.ts'}`)) as { setSetting(k: string, v: unknown): void };
      m.setSetting('hints', false);
    });
    await page.waitForTimeout(5800); // the narrator's first line goes
    await measured(page, `${tag} HUD text ${T}`);
    await shot(page, `hud-${text}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!(await isOn(page, 'cu-pause'))) fail(`${tag} ${T}: Esc did not pause`);
    await measured(page, `${tag} pause text ${T}`);
    await shot(page, `pause-${text}`);
    await page.keyboard.press('Escape');

    await page.locator('#cu-gear').click();
    await page.waitForTimeout(300);
    const boxes: string[] = [];
    for (const tab of ['sound', 'access', 'controls']) {
      await page.locator(`#cu-settings [data-tab="${tab}"]`).click();
      await page.waitForTimeout(120);
      await measured(page, `${tag} settings ${tab} text ${T}`);
      const b = (await page.locator('#cu-settings > .cu-panel').boundingBox())!;
      boxes.push(`${b.width}x${b.height}`);
      await shot(page, `settings-${tab}-${text}`);
    }
    if (new Set(boxes).size !== 1) fail(`${tag} ${T}: the settings box changes size between tabs (${boxes.join(', ')})`);
    await page.locator('#cu-settings [data-bind="up"]').click();
    await page.waitForTimeout(120);
    if (!/press a key/i.test((await page.locator('#cu-settings [data-bind="up"]').textContent()) ?? '')) fail(`${tag} ${T}: the key button does not say PRESS A KEY...`);
    await measured(page, `${tag} settings key capture text ${T}`);
    await shot(page, `settings-capture-${text}`);
    await page.keyboard.press('Escape');
    await page.close();
  }

  // ---------- high contrast: outside and inside ----------
  for (const side of ['out', 'in'] as const) {
    const page = await open(browser, size, `?mock=game&side=${side}${r}`, `${tag} contrast ${side}`, { highContrast: true });
    await measured(page, `${tag} side card high contrast ${side}`);
    await shot(page, `card-contrast-${side}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await measured(page, `${tag} HUD high contrast ${side}`);
    await shot(page, `hud-contrast-${side}`);
    if (side === 'out') {
      await page.locator('#cu-gear').click();
      await page.locator('#cu-settings [data-tab="access"]').click();
      await shot(page, 'settings-contrast');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await shot(page, 'pause-contrast');
    }
    await page.close();
  }

  // ---------- the lobby: COPY next to the room code ----------
  const lobby = await open(browser, size, `?mock=lobby${r}`, `${tag} lobby`);
  await measured(lobby, `${tag} lobby`);
  await shot(lobby, 'lobby-copy');
  await mouseClick(lobby, await middle(lobby, '#cu-copy'));
  await lobby.waitForTimeout(200);
  if (!/copied/i.test((await lobby.locator('#cu-copy').textContent()) ?? '')) fail(`${tag}: COPY does not say COPIED`);
  if ((await lobby.evaluate(() => navigator.clipboard.readText())) !== 'QZKP') fail(`${tag}: COPY did not put the room code on the clipboard`);
  await measured(lobby, `${tag} lobby copied`);
  await shot(lobby, 'lobby-copied');
  await lobby.waitForTimeout(1700);
  if (!/copy/i.test((await lobby.locator('#cu-copy').textContent()) ?? '') || /copied/i.test((await lobby.locator('#cu-copy').textContent()) ?? '')) fail(`${tag}: COPIED does not go back to COPY`);
  await lobby.evaluate(() => navigator.clipboard.writeText(''));
  await lobby.keyboard.press('c');
  await lobby.waitForTimeout(200);
  if ((await lobby.evaluate(() => navigator.clipboard.readText())) !== 'QZKP') fail(`${tag}: C on the side select does not copy the room code`);
  await lobby.evaluate(() => navigator.clipboard.writeText(''));
  await lobby.locator('#cu-copy').tap().catch(() => lobby.locator('#cu-copy').dispatchEvent('click'));
  await lobby.close();
  ok('HUD, pause, settings (3 tabs, key capture), side card and lobby measured at S, M and L');
}

/** What the three accessibility settings change, measured, and the things that must never happen. */
async function behaviour(browser: Browser, size: Size, renderer: 'webgl' | 'canvas'): Promise<void> {
  const tag = `${size.width}x${size.height} ${renderer}`;
  const r = renderer === 'canvas' ? '&renderer=canvas' : '';
  console.log(`\n${tag}: behaviour`);
  const page = await open(browser, size, `?mock=game${r}`, tag);

  // ----- the side card: GOT IT (mouse), and it never takes a movement key -----
  const pose = () => page.evaluate(() => (window as unknown as { __cubic: { state: { players: { out: { pose: { x: number; y: number } } } } } }).__cubic.state.players.out.pose);
  const cardUp = () => page.evaluate(() => !!document.querySelector('.cu-onb-card.on'));
  const before = await pose();
  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  const after = await pose();
  if (after.x === before.x && after.y === before.y) fail(`${tag}: a movement key did not move the player while the side card was up`);
  if (!(await cardUp())) fail(`${tag}: the side card went away on the first step`);
  const cardCursor = await cursorAt(page, await middle(page, '.cu-onb-card button'));
  if (!/cursor-hand/.test(cardCursor)) fail(`${tag}: GOT IT does not show the hand cursor (${cardCursor})`);
  await mouseClick(page, await middle(page, '.cu-onb-card button'));
  await page.waitForTimeout(500);
  if (await cardUp()) fail(`${tag}: GOT IT did not close the side card`);
  ok('side card: movement keys pass, GOT IT closes it');

  // ----- text size: every kind of text changes size, S < M < L -----
  const TEXTS = ['#cu-side', '#cu-face', '#cu-obj', '.cu-vrow', '#cu-clock', '#cu-leave', '#cu-room', '.cu-edge.t', '#cu-chat', '#cu-log', '.cu-bubble', '#cu-settings label', '#cu-settings .cu-key', '#cu-settings .cu-tabs', '#cu-pause .cu-help', '#cu-pause .cu-btn', '#cu-win h2', '#cu-win .cu-btn', '.cu-onb-card p', '.cu-onb-keys', '.cu-caption', '.cu-cubemap .cu-panel'];
  const setText = async (v: TextSize) => {
    await page.evaluate(async (value) => {
      const m = (await import(/* @vite-ignore */ `${'/src/style/settings.ts'}`)) as { setSetting(k: string, v: unknown): void };
      m.setSetting('textSize', value);
    }, v);
    await page.waitForTimeout(80);
  };
  // (a quick-chat bubble has to exist to be measured)
  await page.evaluate(() => {
    if (document.querySelector('.cu-bubble')) return;
    const b = document.createElement('div');
    b.className = 'cu-bubble theirs';
    b.textContent = 'Here!';
    b.style.cssText = 'left: 50%; top: 50%';
    document.querySelector('#cu-over')!.append(b);
  });
  const sizes: Record<string, number[]> = {};
  for (const v of ['s', 'm', 'l'] as TextSize[]) {
    await setText(v);
    for (const sel of TEXTS) (sizes[sel] ??= []).push(await textPx(page, sel));
  }
  for (const [sel, [s, m, l]] of Object.entries(sizes)) if (!(s! < m! && m! < l!)) fail(`${tag}: text size does not scale ${sel} (S ${s}, M ${m}, L ${l})`);
  await setText('m');
  ok(`text size scales ${TEXTS.length} kinds of text (S < M < L)`);

  // ----- reduce motion: no DOM animation or transition is left running -----
  const moving = () =>
    page.evaluate(() => {
      const names = new Set<string>();
      for (const n of document.querySelectorAll('.cu, .cu *')) {
        const s = getComputedStyle(n);
        if (s.animationName !== 'none') names.add(`animation ${s.animationName}`);
        if (s.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) names.add(`transition on .${String((n as HTMLElement).className).split(' ')[0]}`);
      }
      return [...names];
    });
  await page.locator('#cu-gear').click();
  await page.waitForTimeout(100);
  if (!(await moving()).some((m) => m.includes('cu-drop'))) fail(`${tag}: the settings panel has no drop animation with motion on (the check below would prove nothing)`);
  await page.locator('#cu-settings [data-tab="access"]').click();
  await page.locator('#cu-settings [data-key="reduceMotion"]').click();
  await page.waitForTimeout(100);
  const still = await moving();
  if (still.length) fail(`${tag}: with reduce motion on, the DOM still animates: ${still.join(', ')}`);
  await page.locator('#cu-settings [data-key="reduceMotion"]').click();
  ok('reduce motion stops every DOM animation and transition');

  // ----- high contrast: every listed element changes -----
  const LOOKS: [string, string[]][] = [
    ['.cu-where', ['outlineStyle', 'outlineWidth']],
    ['#cu-side', ['color']],
    ['#cu-room', ['outlineStyle', 'outlineWidth']],
    ['#cu-room .v', ['color']],
    ['.cu-stat', ['outlineStyle', 'outlineWidth']],
    ['.cu-view', ['outlineStyle', 'outlineWidth']],
    ['.cu-chip', ['outlineStyle', 'outlineWidth']],
    ['.cu-pips > i', ['outlineStyle', 'outlineWidth']],
    ['.cu-dot', ['outlineStyle', 'outlineWidth']],
    ['#cu-gear', ['outlineStyle', 'outlineWidth']],
    ['.cu-bubble', ['outlineStyle', 'outlineWidth']],
    ['.cu-caption', ['outlineStyle', 'outlineWidth']],
    ['.cu-speaking', ['outlineStyle', 'outlineWidth']],
    ['#cu-chat', ['--ph']],
    ['.cu-note, .cu-vrow .cu-dim', ['color']],
    ['#cu-settings', ['backgroundColor']],
    ['#cu-settings .cu-panel', ['outlineStyle', 'outlineWidth']],
    ['#cu-settings .cu-state', ['color']],
    ['#cu-settings .cu-sub', ['color']],
    ['#cu-settings .cu-seg span:not(.on)', ['color']],
    ['#cu-settings .cu-tabs > span:not(.on)', ['color']],
    ['#cu-settings .cu-key', ['outlineStyle', 'outlineWidth']],
    ['#cu-settings .cu-credit', ['color']],
    ['#cu-pause .cu-panel', ['outlineStyle', 'outlineWidth']],
    ['#cu-pause .cu-lead', ['color']],
    ['#cu-pause .cu-help > .h', ['color']],
    ['#cu-win .cu-panel', ['outlineStyle', 'outlineWidth']],
    ['#cu-win h2', ['color']],
    ['.cu-onb-card', ['outlineStyle', 'outlineWidth']],
    ['.cu-onb-card p', ['color']],
    ['.cu-onb-card h3 b', ['color']],
    ['.cu-kbd', ['outlineStyle', 'outlineWidth']],
    ['.cu-cubemap .cu-panel', ['outlineStyle', 'outlineWidth']],
  ];
  const looks = () =>
    page.evaluate((list) => {
      const out: Record<string, string> = {};
      for (const [sel, props] of list) {
        const n = document.querySelector(sel);
        if (!n) {
          out[sel] = 'MISSING';
          continue;
        }
        const s = getComputedStyle(n);
        out[sel] = props.map((p) => (p === '--ph' ? getComputedStyle(n, '::placeholder').color : s.getPropertyValue(p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)))).join('|');
      }
      return out;
    }, LOOKS);
  // (a caption and the speaking tag have to be on screen to be measured)
  await page.evaluate(async () => {
    const c = (await import(/* @vite-ignore */ `${'/src/ui/captions.ts'}`)) as { showCaption(t: string, o?: { ms?: number; speaker?: string }): void; setPartnerLevel(l: number): void };
    c.showCaption('The wall is thin here.', { ms: 60_000, speaker: 'AI' });
  });
  const plain = await looks();
  await page.locator('#cu-settings [data-key="highContrast"]').click();
  await page.waitForTimeout(100);
  const high = await looks();
  let changed = 0;
  for (const [sel] of LOOKS) {
    if (plain[sel] === 'MISSING') fail(`${tag}: high contrast: nothing matches ${sel}`);
    else if (plain[sel] === high[sel]) fail(`${tag}: high contrast changes nothing on ${sel} (${plain[sel]})`);
    else changed++;
  }
  await page.locator('#cu-settings [data-key="highContrast"]').click();
  ok(`high contrast changes ${changed} of ${LOOKS.length} kinds of element`);

  // ----- settings opacity: never below 1, however it is opened -----
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const lowest = { value: 1, when: '' };
  const sample = async (when: string, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const o = await opacityOfSettings(page);
      if (o !== null && o < lowest.value) Object.assign(lowest, { value: o, when });
    }
  };
  const gear = await middle(page, '#cu-gear');
  for (let i = 0; i < 12; i++) {
    await page.mouse.click(gear.x, gear.y); // the gear is under the veil: every second click lands on the veil
    await sample('rapid clicks on the gear', 45);
  }
  if (await isOn(page, 'cu-settings')) await page.keyboard.press('Escape');
  for (let i = 0; i < 6; i++) {
    await page.locator('#cu-gear').focus();
    await page.keyboard.press('Enter');
    await sample('rapid keyboard toggles', 60);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#cu-pause [data-act="settings"]').click();
  await sample('opened from the pause menu', 400);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // during a face transition: walk off the nearest edge, open in the middle of the roll
  await page.evaluate(() => {
    const c = (window as unknown as { __cubic: { state: { players: { out: { pose: { x: number; y: number } } } } } }).__cubic;
    Object.assign(c.state.players.out.pose, { x: 11, y: 5 });
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  await page.mouse.click(gear.x, gear.y);
  await sample('opened during a face transition', 500);
  if (!(await isOn(page, 'cu-settings'))) fail(`${tag}: the gear did not open the settings during a face transition`);
  if (lowest.value < 1) fail(`${tag}: the settings panel was seen at opacity ${lowest.value} (${lowest.when})`);
  else ok('the settings panel is never below full opacity (rapid toggles, from pause, during a face transition)');

  // ----- no click passes through an overlay to a DOM control under it -----
  // the veil over the gear: the click that closes the settings must not open them again
  await page.mouse.move(gear.x, gear.y);
  await page.mouse.down();
  await page.waitForTimeout(40);
  if (!(await isOn(page, 'cu-settings'))) fail(`${tag}: the settings closed on the press, before the click was over (the release would land under the veil)`);
  await page.mouse.up();
  await page.waitForTimeout(150);
  if (await isOn(page, 'cu-settings')) fail(`${tag}: a click on the veil over the gear closed the settings and opened them again`);
  // the veil over LEAVE: closes the settings, does not leave
  await page.mouse.click(gear.x, gear.y);
  await page.waitForTimeout(150);
  const screenOf = () => page.evaluate(() => (document.querySelector('.cu') as HTMLElement).dataset.screen);
  for (const under of ['#cu-leave', '#cu-chat', '.cu-vbtns button']) {
    if (!(await isOn(page, 'cu-settings'))) await page.keyboard.press('Escape').then(() => page.mouse.click(gear.x, gear.y));
    await page.waitForTimeout(150);
    const focusBefore = await page.evaluate(() => document.activeElement?.id ?? '');
    const at = await page.evaluate((s) => {
      const b = document.querySelector(s)!.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, under);
    const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id ?? '', at);
    if (hit !== 'cu-settings') {
      console.log(`   (skipped ${under}: the panel itself covers it)`);
      continue;
    }
    await mouseClick(page, at);
    await page.waitForTimeout(200);
    if ((await screenOf()) !== 'game') fail(`${tag}: a click on the veil over ${under} went through to it (left the game)`);
    if (under === '#cu-chat' && (await page.evaluate(() => document.activeElement?.id)) === 'cu-chat') fail(`${tag}: a click on the veil focused the chat field under it`);
    void focusBefore;
  }
  if (await isOn(page, 'cu-settings')) await page.keyboard.press('Escape');
  // the pause veil over the gear and LEAVE: nothing happens
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  for (const under of ['#cu-gear', '#cu-leave']) {
    const at = await page.evaluate((s) => {
      const b = document.querySelector(s)!.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, under);
    await mouseClick(page, at);
    await page.waitForTimeout(150);
    if (!(await isOn(page, 'cu-pause')) || (await isOn(page, 'cu-settings')) || (await screenOf()) !== 'game') fail(`${tag}: a click on the pause veil over ${under} went through to it`);
  }
  // DONE over whatever is under it
  await mouseClick(page, await middle(page, '#cu-pause [data-act="settings"]'));
  await page.waitForTimeout(250);
  await mouseClick(page, await middle(page, '#cu-settings [data-close]'));
  await page.waitForTimeout(250);
  if ((await isOn(page, 'cu-settings')) || !(await isOn(page, 'cu-pause')) || (await screenOf()) !== 'game') fail(`${tag}: DONE in the settings (opened from pause) did more than go back to the pause menu`);
  await mouseClick(page, await middle(page, '#cu-pause [data-act="resume"]'));
  await page.waitForTimeout(250);
  if ((await isOn(page, 'cu-pause')) || (await screenOf()) !== 'game') fail(`${tag}: RESUME did more than resume`);
  ok('no click passes through the settings or pause veil to the gear, LEAVE, the chat or a voice button');

  // ----- the cursor: the arrow by default, the hand on what can be clicked -----
  const cursors = await page.evaluate(() => {
    const wrong: string[] = [];
    const clickable = 'button:not(:disabled), [role="slider"], [role="radio"], [role="tab"], .cu-click';
    for (const n of document.querySelectorAll<HTMLElement>('.cu, .cu *')) {
      const c = getComputedStyle(n).cursor;
      const hand = /cursor-hand/.test(c);
      const arrow = /cursor-\d/.test(c);
      const wants = !!n.closest(clickable) && !n.closest('.off');
      if (!hand && !arrow) wrong.push(`system cursor (${c}) on ${n.tagName}.${n.className}`);
      else if (hand !== wants) wrong.push(`${hand ? 'hand' : 'arrow'} on ${n.tagName}.${n.className}`);
    }
    return [...new Set(wrong)];
  });
  for (const c of cursors.slice(0, 12)) fail(`${tag}: cursor: ${c}`);
  if (!cursors.length) ok('cursor: the pixel arrow everywhere, the pixel hand on every clickable, no system cursor in the DOM');
  await page.close();

  // ----- the canvas buttons use the same hand; a click outside the card closes it -----
  const menu = await open(browser, size, `?mock=menu${r.replace('&', '&')}`, `${tag} menu`);
  const play = await menu.evaluate(() => {
    const b = (window as unknown as { __cubicButtons(): { label: string; x: number; y: number; width: number; height: number }[] }).__cubicButtons().find((x) => x.label === 'PLAY')!;
    const c = document.querySelector('canvas')!;
    const box = c.getBoundingClientRect();
    const s = box.width / c.width;
    return { x: box.left + (b.x + b.width / 2) * s, y: box.top + (b.y + b.height / 2) * s };
  });
  await menu.mouse.move(play.x, play.y);
  await menu.waitForTimeout(200);
  const over = await menu.evaluate(() => document.querySelector('canvas')!.style.cursor);
  await menu.mouse.move(play.x, 30);
  await menu.waitForTimeout(200);
  const off = await menu.evaluate(() => getComputedStyle(document.querySelector('canvas')!).cursor);
  if (!/cursor-hand/.test(over)) fail(`${tag}: the canvas does not show the hand over PLAY (${over})`);
  if (!/cursor-\d/.test(off) || /cursor-hand/.test(off)) fail(`${tag}: the canvas does not go back to the arrow off PLAY (${off})`);
  else ok('canvas: the hand over a button, the arrow beside it');
  await menu.close();

  const tap = await open(browser, size, `?mock=game${r}`, `${tag} card`);
  await mouseClick(tap, { x: size.width - 40, y: size.height - 40 });
  await tap.waitForTimeout(500);
  if (await tap.evaluate(() => !!document.querySelector('.cu-onb-card.on'))) fail(`${tag}: a click outside the side card did not close it`);
  else ok('a click outside the side card closes it');
  await tap.close();

  // GOT IT with the focus on it: Enter, and Space, press it (in game Tab is the cube map, so
  // the keyboard's own way to the card is Esc; the focus gets here from a screen reader or a switch)
  for (const press of ['Enter', ' ']) {
    const kb = await open(browser, size, `?mock=game${r}`, `${tag} card keys`);
    await kb.locator('.cu-onb-card button').focus();
    await kb.keyboard.press(press);
    await kb.waitForTimeout(500);
    const what = press === ' ' ? 'Space' : press;
    if (await kb.evaluate(() => !!document.querySelector('.cu-onb-card.on'))) fail(`${tag}: ${what} on GOT IT did not close the side card`);
    else if (await kb.evaluate(() => document.activeElement?.id === 'cu-chat' || !!document.querySelector('.cu-modal.on'))) fail(`${tag}: ${what} on GOT IT did more than close the card`);
    else ok(`${what} on the focused GOT IT closes the card and nothing else`);
    await kb.close();
  }
}

async function touch(browser: Browser): Promise<void> {
  console.log('\ntouch');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => fail(`touch: page error: ${e.message}`));
  await page.goto(`${BASE}/?mock=game`);
  await page.waitForTimeout(1500);
  await page.locator('.cu-onb-card button').tap();
  await page.waitForTimeout(500);
  if (await page.evaluate(() => !!document.querySelector('.cu-onb-card.on'))) fail('touch: a tap on GOT IT did not close the side card');
  else ok('a tap on GOT IT closes the side card');
  await page.locator('#cu-gear').tap();
  await page.locator('#cu-settings [data-tab="controls"]').tap();
  await page.locator('#cu-settings [data-bind="drop"]').tap();
  if (!/press a key/i.test((await page.locator('#cu-settings [data-bind="drop"]').textContent()) ?? '')) fail('touch: a tap on a key button does not start the capture');
  await page.locator('#cu-settings [data-bind="drop"]').tap();
  if (/press a key/i.test((await page.locator('#cu-settings [data-bind="drop"]').textContent()) ?? '')) fail('touch: a second tap does not cancel the capture');
  else ok('the controls tab works by touch (tap starts the capture, tap again cancels)');
  await context.close();
  const lobby = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const lp = await lobby.newPage();
  await lp.goto(`${BASE}/?mock=lobby`);
  await lp.waitForTimeout(1500);
  await lp.locator('#cu-copy').tap();
  await lp.waitForTimeout(200);
  if ((await lp.evaluate(() => navigator.clipboard.readText())) !== 'QZKP') fail('touch: a tap on COPY did not copy the room code');
  else ok('a tap on COPY copies the room code');
  await lobby.close();
}

const ONLY = process.argv[2]; // shots | behaviour | touch
const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  for (const size of SIZES) {
    if (process.env.SIZE && Number(process.env.SIZE) !== size.width) continue; // SIZE=1280 RENDERER=canvas: one of the four
    for (const renderer of ['webgl', 'canvas'] as const) {
      if (process.env.RENDERER && process.env.RENDERER !== renderer) continue;
      if (!ONLY || ONLY === 'shots') await shots(browser, size, renderer);
      if (!ONLY || ONLY === 'behaviour') await behaviour(browser, size, renderer);
    }
  }
  if (!ONLY || ONLY === 'touch') await touch(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\nall clean ->', OUT);
