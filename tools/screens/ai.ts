// PLAY SOLO, in a real browser: one human (this script, with real keys, a real mouse and
// a touch screen) and the AI partner on the server. It checks everything about the AI
// partner that does not depend on which puzzles the game has:
//   - the mode screen offers PLAY SOLO, and the side popup works by keyboard, mouse and touch;
//   - the AI takes the other side, greets, and what it says shows up as a caption;
//   - its voice arrives (a clip from the committed bank, or the browser voice);
//   - it follows the human to another face, obeys "wait" and "go", and answers chat.
// Once per renderer (WebGL and ?renderer=canvas). Screenshots go to docs/screens/ai/.
//
//   server:  PORT=3390 AI_FAKE=1 npm run dev -w server          (scripted partner, no API)
//            PORT=3390 TTS_MODE=elevenlabs npm run dev -w server (real Gemini + ElevenLabs, needs server/.env)
//   client:  VITE_SERVER_URL=http://localhost:3390 npm run dev -w client -- --port 5490
//   then:    cd tools && npx tsx screens/ai.ts            (BASE=http://localhost:5490 by default)
//            npx tsx screens/ai.ts canvas                 (one renderer only: webgl | canvas)
//            SIZE=1920x1080 npx tsx screens/ai.ts webgl      (another window size)
//            CHAT="how are you doing in there?" npx tsx screens/ai.ts webgl   (also send a free-form line)
//
// The steps are plain data (STEPS). Nothing in them names a puzzle.
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { FACES, faceDistance, findPath, type FaceId, type GameState, type Side } from '../../shared/src/index';

const BASE = process.env.BASE ?? 'http://localhost:5490';
const OUT = new URL('../../docs/screens/ai/', import.meta.url).pathname;
const [W, H] = (process.env.SIZE ?? '1280x720').split('x').map(Number);
const SIZE = { width: W!, height: H! };
const FREE_CHAT = process.env.CHAT ?? '';
mkdirSync(OUT, { recursive: true });

// ---------- the steps, as data ----------

type How = 'keyboard' | 'mouse' | 'touch';
export type Step =
  /** From the title: Play, PLAY SOLO, pick a side. */
  | { start: Side; how: How }
  /** Open the side popup and close it again without picking (Esc, or Cancel). */
  | { cancelPopup: How }
  /** The AI has said at least this many lines, and the latest is on screen as a caption. */
  | { aiSpoke: number }
  /** Its voice arrived: a clip (bank or ElevenLabs) or a line for the browser voice. */
  | { voice: true }
  /** Walk the human, with arrow keys, to a face this far from where they stand (1 = next, 2 = far side). */
  | { walkToFaceAt: 1 | 2 }
  /** The AI stands on the human's face. */
  | { aiArrives: true }
  /** Type a chat line (Enter, text, Enter). */
  | { say: string }
  /** Press a quick-chat key. */
  | { quick: '1' | '2' | '3' | '4' }
  /** The AI does not take a step for this long. */
  | { aiStill: number }
  /** The AI answers with a new line within this long. */
  | { aiAnswers: number }
  | { shot: string };

const session = (side: Side, how: How): Step[] => [
  { cancelPopup: how },
  { start: side, how },
  { aiSpoke: 1 },
  { voice: true },
  { shot: `${side}-1-hello` },
  { walkToFaceAt: 1 },
  { aiArrives: true },
  { walkToFaceAt: 2 },
  { quick: '2' }, // Wait
  { aiStill: 2500 },
  { say: 'go' },
  { aiArrives: true },
  { shot: `${side}-2-followed` },
  ...(FREE_CHAT ? ([{ say: FREE_CHAT }, { aiAnswers: 9000 }, { shot: `${side}-3-chat` }] as Step[]) : []),
];

/** One session per side, and between them every way of pressing a button. */
export const STEPS: { name: string; touch?: boolean; steps: Step[] }[] = [
  { name: 'human outside, keyboard', steps: session('out', 'keyboard') },
  { name: 'human inside, mouse', steps: session('in', 'mouse') },
  { name: 'human inside, touch', touch: true, steps: [{ cancelPopup: 'touch' }, { start: 'in', how: 'touch' }, { aiSpoke: 1 }, { shot: 'touch-1-hello' }] },
];

// ---------- the browser ----------

interface Btn {
  label: string;
  enabled: boolean;
  focused: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Cubic {
  side: string | null;
  room: { mode: string; seats: Record<Side, { taken: boolean; isAI: boolean }> } | null;
  state: GameState | null;
  chat: { id: number; isAI: boolean; text: string }[];
}
declare const window: { __cubic: Cubic; __cubicButtons(): Btn[]; __heard: string[] };
declare const document: {
  querySelector(s: string): { dataset: Record<string, string>; hidden: boolean; textContent: string | null; getBoundingClientRect(): { left: number; top: number; width: number }; width: number } | null;
  querySelectorAll(s: string): Iterable<{ getContext(kind: string): unknown }>;
};

const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY: Record<string, string> = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };
const net = <T>(page: Page, fn: (c: Cubic) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__cubic)`) as Promise<T>;
const buttons = (page: Page) => page.evaluate(() => window.__cubicButtons());
const labels = async (page: Page) => (await buttons(page)).map((b) => b.label);
const stateOf = async (page: Page) => (await net(page, (c) => c.state))!;
const aiLines = (page: Page) => net(page, (c) => c.chat.filter((m) => m.isAI).map((m) => m.text));
async function expect(what: string, cond: () => Promise<boolean>, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await sleep(100);
  }
  console.log('   ok:', what);
}

/** Press a canvas button the way this session presses things. */
async function pressButton(page: Page, label: string, how: How): Promise<void> {
  const b = (await buttons(page)).find((x) => x.label === label);
  if (!b || !b.enabled) throw new Error(`no enabled button "${label}" (have: ${(await labels(page)).join(', ')})`);
  const at = await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / c.width };
  });
  const x = at.left + (b.x + b.width / 2) * at.scale;
  const y = at.top + (b.y + b.height / 2) * at.scale;
  if (how === 'touch') await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await sleep(40);
    await page.mouse.up();
  }
  await sleep(350);
}
const keys = async (page: Page, ...list: string[]) => {
  for (const k of list) {
    await page.keyboard.press(k);
    await sleep(150);
  }
};

class Session {
  private side: Side = 'out';
  private lines = 0;
  constructor(
    readonly page: Page,
    readonly tag: string,
  ) {}
  private get ai(): Side {
    return this.side === 'out' ? 'in' : 'out';
  }

  /** The side popup is up: PLAY SOLO was chosen from the mode screen. */
  private async openPopup(how: How): Promise<void> {
    const want = 'BACK|CREATE LOBBY|JOIN LOBBY|PLAY SOLO';
    if ((await labels(this.page)).join('|') !== want) throw new Error(`mode screen buttons are [${(await labels(this.page)).join(', ')}], expected [${want}]`);
    if (how === 'keyboard') {
      await keys(this.page, 'ArrowDown', 'ArrowDown', 'ArrowDown');
      const focused = (await buttons(this.page)).find((b) => b.focused)?.label;
      if (focused !== 'PLAY SOLO') throw new Error(`three presses of Down focus "${focused}", not PLAY SOLO`);
      await keys(this.page, 'Enter');
      await sleep(300);
    } else await pressButton(this.page, 'PLAY SOLO', how);
    await expect(`${how}: PLAY SOLO opens the side popup`, async () => {
      const have = await labels(this.page);
      return ['OUTSIDE', 'INSIDE', 'CANCEL'].every((l) => have.includes(l));
    });
    const behind = (await buttons(this.page)).filter((b) => ['CREATE LOBBY', 'JOIN LOBBY', 'PLAY SOLO', 'BACK'].includes(b.label));
    if (behind.some((b) => b.enabled)) throw new Error('the menu behind the side popup is still enabled');
  }

  async run(step: Step): Promise<void> {
    const { page } = this;
    if ('shot' in step) {
      await sleep(500);
      await page.screenshot({ path: `${OUT}${step.shot}${this.tag}.png` });
      return console.log('   shot:', step.shot);
    }
    if ('cancelPopup' in step) {
      await this.openPopup(step.cancelPopup);
      await sleep(300);
      await page.screenshot({ path: `${OUT}popup-${step.cancelPopup}${this.tag}.png` });
      if (step.cancelPopup === 'keyboard') await keys(page, 'Escape');
      else await pressButton(page, 'CANCEL', step.cancelPopup);
      await expect(`${step.cancelPopup}: the popup closes without starting anything`, async () => !(await labels(page)).includes('CANCEL') && (await net(page, (c) => c.room)) === null);
      await sleep(400);
      return;
    }
    if ('start' in step) {
      this.side = step.start;
      await this.openPopup(step.how);
      if (step.how === 'keyboard') {
        // OUTSIDE has the focus; Right moves to INSIDE
        await keys(page, ...(step.start === 'in' ? ['ArrowRight'] : []), 'Enter');
      } else await pressButton(page, step.start === 'out' ? 'OUTSIDE' : 'INSIDE', step.how);
      await expect(`the game starts with the human ${step.start}side and the AI on the other side`, async () => {
        const room = await net(page, (c) => c.room);
        const screen = await page.evaluate(() => document.querySelector('.cu')!.dataset.screen);
        return screen === 'game' && (await net(page, (c) => c.side)) === step.start && room?.mode === 'ai' && !!room.seats[this.ai].isAI && !room.seats[step.start].isAI;
      }, 8000);
      return;
    }
    if ('aiSpoke' in step) {
      await expect(`the AI said something (${step.aiSpoke}+ lines)`, async () => (await aiLines(page)).length >= step.aiSpoke, 8000);
      const said = await aiLines(page);
      this.lines = said.length;
      console.log(`     AI: "${said.join('" / "')}"`);
      await expect('its line is on screen as a caption, tagged AI', async () => {
        const cap = await page.evaluate(() => {
          const n = document.querySelector('#cu-caption');
          return n && !n.hidden ? n.textContent : null;
        });
        return !!cap && cap.startsWith('AI: ') && (await aiLines(page)).some((l) => cap.includes(l));
      }, 5000);
      return;
    }
    if ('voice' in step) {
      await expect('its voice arrived (a clip, or a line for the browser voice)', async () => (await page.evaluate(() => window.__heard.length)) > 0, 6000);
      console.log(`     voice events: ${(await page.evaluate(() => window.__heard)).join(', ')}`);
      return;
    }
    if ('walkToFaceAt' in step) {
      const from = (await stateOf(page)).players[this.side].pose.face;
      const target = FACES.find((f) => faceDistance(from, f) === step.walkToFaceAt)!;
      await this.walk(target);
      return console.log(`   ok: the human walked from face ${from} to face ${target} with the arrow keys`);
    }
    if ('aiArrives' in step) {
      const before = (await stateOf(page)).players[this.ai].steps;
      await expect('the AI comes to the face the human is on', async () => {
        const s = await stateOf(page);
        return s.players.out.pose.face === s.players.in.pose.face;
      }, 60_000);
      const s = await stateOf(page);
      console.log(`     both on face ${s.players[this.side].pose.face}; the AI took ${s.players[this.ai].steps - before} steps`);
      return;
    }
    if ('say' in step) {
      await keys(page, 'Enter');
      await page.keyboard.type(step.say);
      await keys(page, 'Enter');
      this.lines = (await aiLines(page)).length;
      return console.log(`   ok: typed "${step.say}"`);
    }
    if ('quick' in step) {
      this.lines = (await aiLines(page)).length;
      await keys(page, step.quick);
      await expect('the AI answers the quick chat', async () => (await aiLines(page)).length > this.lines, 5000);
      return console.log(`     AI: "${(await aiLines(page)).at(-1)}"`);
    }
    if ('aiStill' in step) {
      await sleep(400);
      const before = (await stateOf(page)).players[this.ai].steps;
      await sleep(step.aiStill);
      const after = (await stateOf(page)).players[this.ai].steps;
      if (after !== before) throw new Error(`told to wait, the AI still took ${after - before} steps`);
      return console.log(`   ok: told to wait, the AI stood still for ${step.aiStill} ms`);
    }
    if ('aiAnswers' in step) {
      const t0 = Date.now();
      await expect('the AI answers the chat line', async () => (await aiLines(page)).length > this.lines, step.aiAnswers);
      return console.log(`     AI, after ${Date.now() - t0} ms: "${(await aiLines(page)).at(-1)}"`);
    }
  }

  /** Walk to a face with arrow keys, re-planning from what the browser shows after every step. */
  private async walk(face: FaceId): Promise<void> {
    for (let guard = 0; guard < 200; guard++) {
      const s = await stateOf(this.page);
      const p = s.players[this.side].pose;
      if (p.face === face) return;
      const path = findPath(s, this.side, (q) => q.face === face);
      if (!path) throw new Error(`no way to face ${face}`);
      const at = `${p.face}:${p.x},${p.y}`;
      await this.page.keyboard.press(KEY[path[0]!.join(',')]!);
      const end = Date.now() + 2500; // an edge crossing plays a transition first
      while (Date.now() < end) {
        const q = (await stateOf(this.page)).players[this.side].pose;
        if (`${q.face}:${q.x},${q.y}` !== at) break;
        await sleep(40);
      }
      await sleep(110);
    }
    throw new Error(`the human never reached face ${face}`);
  }
}

async function open(context: BrowserContext, query: string): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  // Which voice events reach this client: socket.io frames named "tts" (a clip) or "speak" (browser voice).
  await page.addInitScript(() => {
    (window as unknown as { __heard: string[] }).__heard = [];
  });
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      const m = /^\d+-?\["(tts|speak)"/.exec(typeof f.payload === 'string' ? f.payload : '');
      if (m) void page.evaluate((name) => window.__heard.push(name), m[1]!).catch(() => {});
    }),
  );
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1200);
  return page;
}

async function play(browser: Browser, renderer: 'webgl' | 'canvas'): Promise<void> {
  console.log(`\n=== PLAY SOLO (${renderer}) ===`);
  const tag = renderer === 'canvas' ? '-canvas' : '';
  for (const part of STEPS) {
    console.log(` ${part.name}`);
    const context = await browser.newContext({ viewport: SIZE, hasTouch: !!part.touch });
    const page = await open(context, renderer === 'canvas' ? '?renderer=canvas' : '');
    // title -> mode screen (the dive takes 1.2 s)
    if (part.touch) await pressButton(page, 'PLAY', 'touch');
    else await keys(page, 'Enter');
    await page.waitForTimeout(1900);
    const session = new Session(page, tag);
    for (const step of part.steps) await session.run(step);
    const webgl = await page.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => c.getContext('2d') === null));
    if (webgl !== (renderer === 'webgl')) throw new Error(`asked for ${renderer}, the page is drawing with ${webgl ? 'WebGL' : 'Canvas'}`);
    await context.close();
  }
}

const ONLY = process.argv[2]; // webgl | canvas
const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'webgl') await play(browser, 'webgl');
  if (!ONLY || ONLY === 'canvas') await play(browser, 'canvas');
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
