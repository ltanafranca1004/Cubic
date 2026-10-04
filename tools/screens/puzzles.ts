// Plays the WHOLE game in a real browser: two clients, real keyboard input, every puzzle,
// the portal and the win screen, once per renderer (WebGL and ?renderer=canvas).
// Screenshots of each co-op puzzle from both sides go to docs/screens/puzzles.
//
//   server:  PORT=3360 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3360 npm run dev -w client -- --port 5460
//   then:    cd tools && npx tsx screens/puzzles.ts            (BASE=http://localhost:5460 by default)
//            npx tsx screens/puzzles.ts canvas                 (one renderer only: webgl | canvas)
//
// The steps of each puzzle are plain data (PUZZLE_STEPS): who moves, and where to or which
// keys. Where a step depends on what a player SEES (the sign on the tablet, the stepping
// stones), it says whose view to read, and the script reads exactly that view
// (visibleObjects for that side), never the puzzle's own state.
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { defaultEnv, objectsOn, pathTo, visibleObjects, type FaceId, type GameState, type Side, type TileRef } from '../../shared/src/index';

const BASE = process.env.BASE ?? 'http://localhost:5460';
const OUT = new URL('../../docs/screens/puzzles/', import.meta.url).pathname;
const SIZE = { width: 1280, height: 720 };
mkdirSync(OUT, { recursive: true });

// ---------- the steps, as data ----------

/** A thing on the map, by side, face, type and (optionally) name. */
interface Thing {
  side: Side;
  face: FaceId;
  type: string;
  name?: string;
  /** Tiles to add to its position (e.g. the dry tile next to a bridge). */
  dx?: number;
  dy?: number;
}
/** What one player sees: objects of `type` on `face`, as drawn for `by`. */
interface Sight {
  by: Side;
  face: FaceId;
  type: string;
}

export type Step =
  /** Walk to a tile. */
  | { who: Side; tile: TileRef }
  /** Walk to a map object (or the tile an item lies on). */
  | { who: Side; thing: Thing }
  | { who: Side; item: string }
  /** Press these keys, one after another. */
  | { who: Side; keys: string[] }
  /** Read the state of what `read` shows, then walk onto the object in `among` with that state. */
  | { who: Side; read: Sight; among: Sight }
  /** Walk onto everything `follow` shows, in the order it is listed. */
  | { who: Side; follow: Sight }
  /** Screenshot both players as `<name>-out` and `<name>-in`. */
  | { shot: string }
  /** The face must (not) be solved here. */
  | { solved: FaceId; is: boolean };

const sign: Step = { who: 'out', read: { by: 'in', face: 3, type: 'tablet' }, among: { by: 'out', face: 3, type: 'glyph' } };

export const PUZZLE_STEPS: { id: string; face: FaceId; steps: Step[] }[] = [
  {
    id: 'plate-door',
    face: 1,
    steps: [
      { who: 'in', thing: { side: 'in', face: 1, type: 'plate' } },
      { who: 'out', thing: { side: 'out', face: 1, type: 'crystal' } },
    ],
  },
  {
    // Inside reads the tablet from the plate, outside steps on the stone with that sign. Four times.
    id: 'glyph-code',
    face: 3,
    steps: [
      { who: 'out', tile: { face: 3, x: 5, y: 5 } },
      { who: 'in', tile: { face: 3, x: 5, y: 8 } },
      { shot: 'code-1-asleep' },
      { who: 'in', thing: { side: 'in', face: 3, type: 'plate' } },
      { shot: 'code-2-awake' },
      sign,
      sign,
      { shot: 'code-3-halfway' },
      { solved: 3, is: false },
      sign,
      sign,
      { shot: 'code-4-solved' },
    ],
  },
  {
    // Outside reads the stepping stones, inside walks exactly those tiles.
    id: 'mirror-maze',
    face: 4,
    steps: [
      { who: 'out', tile: { face: 4, x: 5, y: 10 } },
      { who: 'in', thing: { side: 'in', face: 4, type: 'entry' } },
      { shot: 'maze-1-start' },
      // one deliberate wrong step: a strike, back to the doorway, and the stones move
      { who: 'in', keys: ['fall'] },
      { shot: 'maze-2-after-fall' },
      { solved: 4, is: false },
      { who: 'in', follow: { by: 'out', face: 4, type: 'trail' } },
      { shot: 'maze-3-solved' },
    ],
  },
  {
    // Outside holds pane a, inside crosses to the dry ring; outside moves to pane b, inside takes the crystal.
    id: 'skylight',
    face: 5,
    steps: [
      { who: 'out', tile: { face: 5, x: 6, y: 9 } },
      { who: 'in', thing: { side: 'in', face: 5, type: 'bridge', name: 'a', dx: -1 } },
      { shot: 'skylight-1-dark' },
      { who: 'out', thing: { side: 'out', face: 5, type: 'skylight', name: 'a' } },
      { shot: 'skylight-2-pane-a' },
      { who: 'in', thing: { side: 'in', face: 5, type: 'bridge', name: 'b', dx: 1 } },
      { who: 'out', thing: { side: 'out', face: 5, type: 'skylight', name: 'b' } },
      { shot: 'skylight-3-pane-b' },
      { solved: 5, is: false },
      { who: 'in', thing: { side: 'in', face: 5, type: 'crystal' } },
      { shot: 'skylight-4-solved' },
    ],
  },
  {
    id: 'rose-pot',
    face: 6,
    steps: [
      { who: 'out', item: 'rose' },
      { who: 'out', keys: ['e'] },
      { who: 'out', thing: { side: 'out', face: 6, type: 'target' } },
      { who: 'out', keys: ['e'] },
    ],
  },
];

// ---------- the browser ----------

interface Cubic {
  code: string | null;
  room: { phase: string; members: Record<'host' | 'guest', { side: string | null; ready: boolean } | null> } | null;
  state: GameState | null;
}
declare const window: { __cubic: Cubic };
declare const document: {
  querySelector(s: string): { dataset: Record<string, string>; classList: { contains(c: string): boolean }; textContent: string | null } | null;
  querySelectorAll(s: string): Iterable<{ getContext(kind: string): unknown }>;
};

const problems: string[] = [];
const KEY: Record<string, string> = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(browser: Browser, query: string): Promise<Page> {
  // one context per player: separate storage, like two people on two machines
  const context = await browser.newContext({ viewport: SIZE });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1200);
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
    await sleep(80);
  }
  console.log('   ok:', what);
}
const stateOf = async (page: Page): Promise<GameState> => (await net(page, (c) => c.state))!;
const at = (s: GameState, side: Side) => {
  const p = s.players[side].pose;
  return `${p.face}:${p.x},${p.y}`;
};
const sees = (s: GameState, sight: Sight) => visibleObjects(s, sight.by, sight.face).filter((o) => o.type === sight.type);

class Game {
  private strikes = 0;
  constructor(
    readonly pages: Record<Side, Page>,
    readonly tag: string,
  ) {}

  /** Both browsers have caught up with the server: they agree on where both players are and what is solved. */
  async settled(): Promise<GameState> {
    for (let i = 0; i < 60; i++) {
      const [a, b] = await Promise.all([stateOf(this.pages.out), stateOf(this.pages.in)]);
      const sig = (s: GameState) => `${at(s, 'out')} ${at(s, 'in')} ${s.solved.join()} ${s.strikes} ${JSON.stringify(s.puzzles)}`;
      if (sig(a) === sig(b)) return a;
      await sleep(60);
    }
    throw new Error('the two clients never agreed on the game state');
  }

  /** One real key press that should move `who`; waits until their own screen shows the step. */
  private async stepKey(who: Side, key: string): Promise<void> {
    const page = this.pages[who];
    const before = at(await stateOf(page), who);
    await page.keyboard.press(key);
    const end = Date.now() + 2500; // an edge crossing plays a transition first
    while (at(await stateOf(page), who) === before && Date.now() < end) await sleep(40);
    await sleep(110); // stay under the server's move budget
  }

  /** Walk with arrow keys, re-planning from what the browser shows after every step. */
  async walk(who: Side, target: TileRef): Promise<void> {
    for (let guard = 0; guard < 500; guard++) {
      const s = await this.settled();
      const p = s.players[who].pose;
      if (p.face === target.face && p.x === target.x && p.y === target.y) return;
      const path = pathTo(s, who, target);
      if (!path) throw new Error(`${who}: no way to face ${target.face} ${target.x},${target.y} from ${at(s, who)}`);
      await this.stepKey(who, KEY[path[0]!.join(',')]!);
    }
    throw new Error(`${who} never arrived at face ${target.face} ${target.x},${target.y}`);
  }

  async shot(name: string): Promise<void> {
    await sleep(700); // let a transition and the HUD settle
    for (const side of ['out', 'in'] as const) await this.pages[side].screenshot({ path: `${OUT}${name}-${side}${this.tag}.png` });
    console.log('   shot:', name);
  }

  async run(step: Step): Promise<void> {
    if ('shot' in step) return this.shot(step.shot);
    if ('solved' in step) {
      const s = await this.settled();
      if (s.solved.includes(step.solved) !== step.is) throw new Error(`face ${step.solved} solved should be ${step.is}`);
      return;
    }
    if ('tile' in step) return this.walk(step.who, step.tile);
    if ('thing' in step) {
      const t = step.thing;
      const o = objectsOn(defaultEnv.world, t.side, t.face, t.type).find((x) => t.name === undefined || x.name === t.name);
      if (!o) throw new Error(`no ${t.type} on ${t.side} face ${t.face}`);
      return this.walk(step.who, { face: t.face, x: o.x + (t.dx ?? 0), y: o.y + (t.dy ?? 0) });
    }
    if ('item' in step) {
      const item = (await this.settled()).items[step.item]!;
      return this.walk(step.who, { face: item.face, x: item.x, y: item.y });
    }
    if ('read' in step) {
      const s = await this.settled();
      const shown = sees(s, step.read)[0]?.state;
      const stone = sees(s, step.among).find((o) => o.state === shown);
      if (!stone) throw new Error(`${step.read.by} sees "${shown}", but ${step.among.by} sees no ${step.among.type} like that`);
      console.log(`     ${step.read.by} reads "${shown}", ${step.who} walks to it`);
      const progress = JSON.stringify(s.puzzles);
      await this.walk(step.who, { face: step.among.face, x: stone.x, y: stone.y });
      await expect('the puzzle moved on', async () => JSON.stringify((await this.settled()).puzzles) !== progress);
      return;
    }
    if ('follow' in step) {
      const line = sees(await this.settled(), step.follow);
      console.log(`     ${step.follow.by} sees ${line.length} ${step.follow.type} tiles, ${step.who} walks them in order`);
      for (const o of line) await this.walk(step.who, { face: step.follow.face, x: o.x, y: o.y });
      return;
    }
    if (step.keys[0] === 'fall') return this.fall(step.who);
    await press(this.pages[step.who], ...step.keys);
    await sleep(250);
  }

  /** In the maze doorway: step in, then onto a tile that is NOT a stepping stone. */
  private async fall(who: Side): Promise<void> {
    let s = await this.settled();
    const line = visibleObjects(s, 'out', 4).filter((o) => o.type === 'trail');
    await this.walk(who, { face: 4, x: line[0]!.x, y: line[0]!.y });
    s = await this.settled();
    const safe = new Set(line.map((o) => `${o.x},${o.y}`));
    const here = s.players[who].pose;
    const wrong = [[1, 0], [-1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ face: 4 as FaceId, x: here.x + dx!, y: here.y + dy! })).find((t) => !safe.has(`${t.x},${t.y}`) && pathTo(s, who, t)?.length === 1);
    if (!wrong) throw new Error('no wrong tile next to the first stone');
    const before = s.strikes;
    await this.stepKey(who, KEY[pathTo(s, who, wrong)![0]!.join(',')]!);
    await expect('a wrong tile is a strike and puts the inside player back in the doorway', async () => {
      const now = await this.settled();
      const entry = objectsOn(defaultEnv.world, 'in', 4, 'entry')[0]!;
      return now.strikes === before + 1 && at(now, who) === `4:${entry.x},${entry.y}`;
    });
    this.strikes++;
    const moved = visibleObjects(await this.settled(), 'out', 4).filter((o) => o.type === 'trail');
    console.log(`     the stones ${moved.map((o) => `${o.x},${o.y}`).join(' ') === [...safe].join(' ') ? 'did NOT move' : 'moved'} (${line.length} -> ${moved.length} tiles)`);
  }

  get expectedStrikes(): number {
    return this.strikes;
  }
}

async function start(browser: Browser, renderer: 'webgl' | 'canvas'): Promise<Game> {
  const query = renderer === 'canvas' ? '?renderer=canvas' : '';
  const a = await open(browser, query);
  const b = await open(browser, query);
  // title -> mode -> create lobby / join by code -> pick sides -> ready -> start (all keyboard)
  await press(a, 'Enter');
  await a.waitForTimeout(1900);
  await press(a, 'ArrowDown', 'Enter');
  await expect('the host made a lobby', async () => (await net(a, (c) => c.room?.phase)) === 'lobby');
  const code = (await net(a, (c) => c.code))!;
  await press(b, 'Enter');
  await b.waitForTimeout(1900);
  await press(b, 'ArrowDown', 'ArrowDown', 'Enter');
  await b.waitForTimeout(400);
  await b.keyboard.type(code.toLowerCase());
  await press(b, 'Enter');
  await expect('the guest joined by typing the code', async () => (await net(b, (c) => c.code)) === code);
  await b.waitForTimeout(700);
  await press(a, 'ArrowLeft');
  await press(b, 'd');
  await expect('host is outside, guest is inside', async () => (await net(a, (c) => c.room?.members.host?.side)) === 'out' && (await net(a, (c) => c.room?.members.guest?.side)) === 'in');
  await press(b, 'Enter');
  await expect('the guest is ready', async () => (await net(a, (c) => c.room?.members.guest?.ready)) === true);
  await a.waitForTimeout(300);
  await press(a, ' ');
  const screen = (p: Page) => p.evaluate(() => document.querySelector('.cu')!.dataset.screen);
  await expect('the game started for both', async () => (await screen(a)) === 'game' && (await screen(b)) === 'game');
  await a.waitForTimeout(1500);
  // Which renderer is really drawing: a canvas that refuses a 2d context has a WebGL one.
  const webgl = await a.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => c.getContext('2d') === null));
  console.log(`   renderer in use: ${webgl ? 'WebGL' : 'Canvas'}`);
  if (webgl !== (renderer === 'webgl')) throw new Error(`asked for ${renderer}, the page is drawing with ${webgl ? 'WebGL' : 'Canvas'}`);
  return new Game({ out: a, in: b }, renderer === 'canvas' ? '-canvas' : '');
}

async function play(browser: Browser, renderer: 'webgl' | 'canvas'): Promise<void> {
  console.log(`\n=== whole game, two clients, real keys (${renderer}) ===`);
  const game = await start(browser, renderer);
  for (const puzzle of PUZZLE_STEPS) {
    console.log(` ${puzzle.id} (face ${puzzle.face})`);
    for (const step of puzzle.steps) await game.run(step);
    await expect(`${puzzle.id}: face ${puzzle.face} is solved on both screens`, async () => (await game.settled()).solved.includes(puzzle.face));
  }
  const s = await game.settled();
  console.log(`   solved faces: ${s.solved.join(', ')}; strikes: ${s.strikes}`);
  if (s.solved.join() !== '1,3,4,5,6') throw new Error(`solved ${s.solved.join()}`);
  if (s.strikes !== game.expectedStrikes) throw new Error(`${s.strikes} strikes, expected ${game.expectedStrikes}`);

  console.log(' portal');
  const portal = objectsOn(defaultEnv.world, 'out', 6, 'portal')[0]!;
  await game.walk('out', { face: 6, x: portal.x, y: portal.y });
  await game.shot('portal-open');
  await game.walk('in', { face: 6, x: portal.x, y: portal.y });
  for (const side of ['out', 'in'] as const) {
    const page = game.pages[side];
    await expect(`${side}: the win screen is up`, async () => (await net(page, (c) => c.state?.wonAt ?? null)) !== null && (await page.evaluate(() => !!document.querySelector('#cu-win')?.classList.contains('on'))));
    console.log(`     ${side}: "${await page.evaluate(() => document.querySelector('#cu-wintxt')?.textContent)}"`);
  }
  await game.shot('win');
  for (const page of Object.values(game.pages)) await page.context().close();
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
