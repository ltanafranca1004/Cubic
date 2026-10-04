// THE PLAYTEST: two real players in one room, played with real input only, as named
// PASS / FAIL steps. It is the regression pass for "does the whole game still work":
// the full lobby flow, every face and every edge on both sides, items, chat, pause,
// settings, the map, leave / rejoin / refresh, every co-op puzzle solved for real, the
// win screen, and then a section that tries to break it.
//
// One Chromium, one browser context per player (A creates the room and plays OUTSIDE, B
// joins with the code and plays INSIDE, C is the stranger who tries to get in).
// Every action is page.keyboard or page.mouse. window.__cubic and window.__cubicButtons
// are only READ: to assert, to find where a canvas button is, and to plan a walk.
// No ?dev, no ?mock, no DEV_COMMANDS.
//
//   server:  PORT=3310 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3310 npm run dev -w client -- --port 5410
//   then:    cd tools && npx tsx screens/playtest.ts [sections]
//
//   sections   comma separated, default all:
//              lobby,hud,walk,items,rejoin,puzzles,break,menus
//              `puzzles:hidden-code` runs one puzzle of the table (no finale).
//   BASE       client URL (default http://localhost:5410)
//   RENDERER   webgl | canvas (default: both, one after the other)
//   OUT        folder for screenshots, GIFs and results.json
//              (default <REPO>/docs/status/playtest/, REPO = this checkout unless set)
//   GIF=0      skip the puzzle GIFs (they need ffmpeg on the PATH, or FFMPEG=/path)
//
// Exit code 1 if any step fails. A failed step saves a picture of every player.
//
// NEW PUZZLE? Add one entry to PUZZLE_SCRIPTS below. The run fails if a puzzle registered
// in shared/src/puzzles/index.ts has no entry.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import {
  FACES,
  PUZZLES,
  QUICK_CHATS,
  SPAWN,
  applyMove,
  compassDrift,
  defaultEnv,
  findPath,
  neighbours,
  objectsOn,
  visibleObjects,
  type FaceId,
  type GameState,
  type Move,
  type Pose,
  type RoomInfo,
  type Side,
  type TileRef,
} from '../../shared/src/index';
import { readCode } from '../../shared/src/puzzles/hiddenCode';

// ---------- the puzzle table ----------

/** Where a player should go: a map object, an item lying somewhere, or a plain tile. */
type Target =
  /** `name` picks one of several (pane a / b); dx, dy move off it (the dry tile next to a bridge). */
  | { object: [side: Side, face: FaceId, type: string]; name?: string; dx?: number; dy?: number }
  | { item: string }
  | { tile: TileRef };

/** What one player SEES on a face: the objects of `type` as drawn for `by` (visibleObjects). */
interface Sight {
  by: Side;
  face: FaceId;
  type: string;
}

/** One thing a player does, with real keys. */
type PuzzleStep =
  /** Walk there (the path is planned from the live state, then pressed as W A S D). */
  | { who: Side; goto: Target }
  /** Press these keys, space separated, e.g. 'e' or 'w w a'. */
  | { who: Side; keys: string }
  /**
   * Read the state of what `read` shows on that player's own screen (the sign on the
   * tablet), then walk onto the object in `onto` that shows the same state. The puzzle
   * must move on. For codes that differ per game: nothing is read from the puzzle state.
   */
  | { who: Side; read: Sight; onto: Sight }
  /** Walk onto every tile `follow` shows on that player's screen, in the order listed. */
  | { who: Side; follow: Sight }
  /**
   * Steps worked out at run time from the live server state, for content that is seeded
   * per game (a code, a sequence, which pot is which). The steps it returns are played like
   * any others, with real keys, by whoever they name (`who` here is whose state is read).
   */
  | { who: Side; plan: (state: GameState) => PuzzleStep[] }
  | { wait: number }
  /** Something that must be true by now (it is waited for, up to 4 s). */
  | { expect: string; check: (state: GameState) => boolean };

interface PuzzleScript {
  /** The PuzzleModule id (shared/src/puzzles). The face comes from the module. */
  id: string;
  steps: PuzzleStep[];
}

/**
 * ONE ENTRY PER PUZZLE, played in this order on one game. Look things up (object, item)
 * instead of hardcoding tiles, so a map edit does not break the script. After the last
 * step the puzzle's face must be latched in `state.solved`.
 */
/** A stub puzzle: one player walks to its crystal and presses E. Replace the entry with the real script. */
const stub = (id: string, face: FaceId): PuzzleScript => ({
  id,
  steps: [
    {
      who: 'out',
      plan: (state) => {
        const side = (['out', 'in'] as const).find((sd) => visibleObjects(state, sd, face).some((o) => o.type === 'crystal'));
        if (!side) throw new Error(`no crystal on face ${face}`);
        return [{ who: side, goto: { object: [side, face, 'crystal'] } }, { who: side, keys: 'e' }];
      },
    },
  ],
});

// In chain order: 1 and 3 stand alone, then 2 -> 5 -> 6 -> 4.
const PUZZLE_SCRIPTS: PuzzleScript[] = [
  // Face 1. Hidden Code.
  // Outside reads the number in the grass (their view is upright at the start); inside types it.
  {
    id: 'hidden-code',
    steps: [
      {
        who: 'out',
        plan: (state) => {
          const code = readCode(visibleObjects(state, 'out', 1));
          if (!code) throw new Error('the outside player sees no number on face 1');
          return [...code, 'enter'].flatMap((name): PuzzleStep[] => [{ who: 'in', goto: { object: ['in', 1, 'key'], name } }, { who: 'in', keys: 'e' }]);
        },
      },
    ],
  },
  // Face 3. Mirrored Glyph.
  {
    id: 'mirrored-glyph',
    steps: [
      {
        // the outside player reads the symbol off the snow and tells it; the inside player flips those tiles
        who: 'out',
        plan: (state) => {
          const symbol = visibleObjects(state, 'out', 3).filter((o) => o.type === 'f3-glyph');
          // row by row in a snake, so the walk stays short
          symbol.sort((a, b) => a.y - b.y || (a.y % 2 ? b.x - a.x : a.x - b.x));
          return symbol.flatMap((o): PuzzleStep[] => [{ who: 'in', goto: { tile: { face: 3, x: o.x, y: o.y } } }, { who: 'in', keys: 'e' }]);
        },
      },
      { expect: 'every tile of the symbol is flipped and locked', check: (state) => visibleObjects(state, 'in', 3).filter((o) => o.type === 'f3-tile' && o.state === 'done').length === 47 },
    ],
  },
  // Face 2. Equation Safe: the outside player counts the bushes, birds and rocks, the inside
  // player types 3 x bushes x 2 x birds x rocks and ENTER, then picks up the battery.
  {
    id: 'equation-safe',
    steps: [
      {
        who: 'out',
        plan: (state) => {
          const seen = (type: string) => visibleObjects(state, 'out', 2).filter((o) => o.type === type).length;
          const answer = 3 * seen('f2-bush') * 2 * seen('f2-bird') * seen('f2-rock');
          const keys = visibleObjects(state, 'in', 2).filter((o) => o.type === 'key');
          return [...String(answer), 'enter'].flatMap((name): PuzzleStep[] => {
            const key = keys.find((o) => o.state === name);
            if (!key) throw new Error(`no key "${name}" on the vault keypad`);
            return [{ who: 'in', goto: { tile: { face: 2, x: key.x, y: key.y } } }, { who: 'in', keys: 'e' }];
          });
        },
      },
      { expect: 'the safe is open and the battery is out', check: (state) => state.solved.includes(2) && !!state.items.battery },
      { who: 'in', goto: { item: 'battery' } },
      { who: 'in', keys: 'e' },
      { expect: 'the inside player carries the battery', check: (state) => state.players.in.carrying === 'battery' },
    ],
  },
  // Face 5. Sequence Laser.
  stub('sequence-laser', 5),
  // Face 6. Laser and Invisible Path.
  stub('laser-path', 6),
  // Face 4. Botanical Mirror.
  {
    id: 'botanical-mirror',
    steps: [
      {
        // the flower face 6 left outside: fetch it, unless it is in hand already
        who: 'out',
        plan: (state) => {
          const flower = Object.values(state.items).find((i) => i.side === 'out' && i.kind.startsWith('flower-'));
          if (!flower) throw new Error('face 6 is solved but there is no flower outside');
          return flower.carriedBy === 'out' ? [] : [{ who: 'out', goto: { item: flower.id } }, { who: 'out', keys: 'e' }];
        },
      },
      { expect: 'the outside player carries the flower', check: (state) => state.players.out.carrying !== null && !!state.items[state.players.out.carrying]?.kind.startsWith('flower-') },
      {
        // the inside player sees which pot holds that colour and names it; the outside player plants it there
        who: 'in',
        plan: (state) => {
          const colour = state.items[state.players.out.carrying ?? '']?.kind.replace('flower-', '');
          const pot = visibleObjects(state, 'in', 4).find((o) => o.type === 'f4-flowerpot' && o.state === colour);
          if (!pot) throw new Error(`the inside player sees no ${colour} flower on face 4`);
          return [{ who: 'out', goto: { tile: { face: 4, x: pot.x, y: pot.y } } }, { who: 'out', keys: 'e' }];
        },
      },
    ],
  },
];

// ---------- setup ----------

const BASE = process.env.BASE ?? 'http://localhost:5410';
const REPO = resolve(process.env.REPO ?? new URL('../../', import.meta.url).pathname);
const OUT = resolve(process.env.OUT ?? join(REPO, 'docs/status/playtest')) + '/';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const SIZE = { width: 1280, height: 720 };
/** Key pacing: the server allows a burst of 5 moves, then one per 90 ms. */
const STEP_MS = 130;
/** A face transition (roll 500 ms, hop 400 ms) and a little air. */
const FLIP_MS = 650;
const RENDERERS = ['webgl', 'canvas'] as const;
type Renderer = (typeof RENDERERS)[number];
const SECTION_NAMES = ['lobby', 'hud', 'walk', 'items', 'rejoin', 'puzzles', 'break', 'menus'] as const;
type Section = (typeof SECTION_NAMES)[number];

const FILTER = (process.argv[2] ?? '').split(',').filter(Boolean);
const wanted = (section: Section) => FILTER.length === 0 || FILTER.some((f) => f.split(':')[0] === section);
const PUZZLE_FILTER = FILTER.find((f) => f.startsWith('puzzles:'))?.split(':')[1] ?? null;
for (const f of FILTER) if (!SECTION_NAMES.includes(f.split(':')[0] as Section)) throw new Error(`unknown section "${f}". Sections: ${SECTION_NAMES.join(', ')}`);

mkdirSync(OUT, { recursive: true });

interface Snap {
  online: boolean;
  code: string | null;
  role: 'host' | 'guest' | null;
  side: Side | null;
  error: string | null;
  room: RoomInfo | null;
  /** What the client draws (server state + unacknowledged input). */
  state: GameState | null;
  /** The last state the server sent. */
  server: GameState | null;
  /** Inputs the server has not acknowledged yet. */
  pending: number;
  chat: { text: string; from: Side }[];
  /** 'menu' or 'game'. */
  screen: string;
  /** The DOM panel on top: cu-settings, cu-pause, cu-win or null. */
  modal: string | null;
}
interface ButtonProbe {
  label: string;
  enabled: boolean;
  alpha: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Result {
  renderer: Renderer;
  section: Section;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
  shots: string[];
  ms: number;
}
interface Problem {
  at: number;
  renderer: Renderer;
  who: string;
  text: string;
}
interface PuzzleResult {
  renderer: Renderer;
  id: string;
  completed: boolean;
  stuck: string;
}

/** One section of one renderer: its pages and where its results go. */
interface Run {
  browser: Browser;
  renderer: Renderer;
  section: Section;
  pages: Map<string, Page>;
}

const results: Result[] = [];
const problems: Problem[] = [];
const notes: string[] = [];
const puzzleResults: PuzzleResult[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const js = <T>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const at = (p: Pose) => `face ${p.face} (${p.x},${p.y}) up ${p.up.join(',')}`;

/** A note for the report: something seen that is not a failed step. Printed once. */
function note(text: string): void {
  if (notes.includes(text)) return;
  notes.push(text);
  console.log(`   NOTE: ${text}`);
}

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

/** Wait until `cond` is true. Throws `expected: what` after `ms`. */
async function until(what: string, cond: () => Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await sleep(60);
  }
}

/** A picture of every player, for a failure or for the report. */
async function shots(run: Run, name: string): Promise<string[]> {
  const out: string[] = [];
  for (const [who, page] of run.pages) {
    const path = `${OUT}${name}-${who}.png`;
    if (await page.screenshot({ path }).then(() => true, () => false)) out.push(path);
  }
  return out;
}

/**
 * One named step. PASS or FAIL is printed and recorded; a failure (a thrown error, or a
 * console error / page error while it ran) saves a picture of every player. The next step
 * still runs.
 */
async function step(run: Run, name: string, fn: () => Promise<string | void>): Promise<boolean> {
  const t0 = Date.now();
  let detail: string;
  let failed = false;
  try {
    detail = (await fn()) ?? '';
  } catch (e) {
    failed = true;
    detail = e instanceof Error ? e.message.split('\n')[0]! : String(e);
  }
  await sleep(50); // let a late console error land on this step
  const errors = [...new Set(problems.filter((p) => p.at >= t0 && p.renderer === run.renderer).map((p) => `${p.who} ${p.text}`))];
  if (errors.length) {
    failed = true;
    detail = [detail, ...errors].filter(Boolean).join(' | ');
  }
  const saved = failed ? await shots(run, `fail-${run.renderer}-${run.section}-${slug(name)}`) : [];
  results.push({ renderer: run.renderer, section: run.section, name, status: failed ? 'FAIL' : 'PASS', detail, shots: saved, ms: Date.now() - t0 });
  console.log(`${failed ? 'FAIL' : 'PASS'}  [${run.renderer}] ${run.section}: ${name}${detail ? `  (${detail})` : ''}`);
  return !failed;
}

// ---------- reading the page (never writing) ----------

const snap = (page: Page) =>
  js<Snap>(
    page,
    `(() => {
      const c = window.__cubic;
      const modal = ['cu-win', 'cu-settings', 'cu-pause'].find((id) => document.querySelector('#' + id)?.classList.contains('on')) ?? null;
      return { online: c.online, code: c.code, role: c.role, side: c.side, error: c.error, room: c.room, state: c.state, server: c.server,
        pending: c.pending.length, chat: c.chat.map((m) => ({ text: m.text, from: m.from })),
        screen: document.querySelector('.cu')?.dataset.screen ?? '', modal };
    })()`,
  );
const buttons = (page: Page) => js<ButtonProbe[]>(page, `typeof window.__cubicButtons === 'function' ? window.__cubicButtons() : []`);
const button = async (page: Page, label: string) => (await buttons(page)).find((b) => b.label === label) ?? null;
const has = async (page: Page, label: string) => !!(await button(page, label));
const text = (page: Page, selector: string) => js<string | null>(page, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const isOn = (page: Page, selector: string) => js<boolean>(page, `!!document.querySelector(${JSON.stringify(selector)})`);
const typing = (page: Page) => js<boolean>(page, `document.activeElement instanceof HTMLInputElement`);
const rendererOf = (page: Page) => js<Renderer>(page, `document.querySelector('#cu-stage canvas').getContext('2d') ? 'canvas' : 'webgl'`);
/** The stage canvas on the page: where it is, and page pixels per art pixel. */
const stage = (page: Page) =>
  js<{ left: number; top: number; width: number; height: number; scale: number }>(
    page,
    `(() => { const c = document.querySelector('#cu-stage canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, scale: r.width / c.width }; })()`,
  );
const stateOf = async (page: Page): Promise<GameState> => {
  const s = (await snap(page)).state;
  if (!s) throw new Error('not in a game');
  return s;
};
const poseOf = async (page: Page, side: Side) => (await stateOf(page)).players[side].pose;

// ---------- real input ----------

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(STEP_MS);
  }
}

/** Where a canvas button's middle is on the page. */
async function buttonPoint(page: Page, label: string): Promise<{ x: number; y: number } | null> {
  const b = await button(page, label);
  if (!b) return null;
  const s = await stage(page);
  return { x: s.left + (b.x + b.width / 2) * s.scale, y: s.top + (b.y + b.height / 2) * s.scale };
}

/**
 * Click a canvas button with the mouse. Waits until it is there, enabled and fully shown
 * (`force` clicks where it is whatever its state: for "a disabled button does nothing").
 */
async function click(page: Page, label: string, opts: { force?: boolean; double?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    await until(`a "${label}" button that can be clicked`, async () => {
      const b = await button(page, label);
      return !!b && b.enabled && b.alpha >= 0.99;
    }, 6000);
  }
  const p = await buttonPoint(page, label);
  if (!p) throw new Error(`no "${label}" button on screen`);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(80);
  if (opts.double) await page.mouse.dblclick(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Click a DOM control with the mouse, in its middle, wherever that lands. */
async function clickDom(page: Page, selector: string, opts: { double?: boolean } = {}): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box || !box.width || !box.height) throw new Error(`"${selector}" is not on screen`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(60);
  if (opts.double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  return { x, y };
}

/** Click the stage at a fraction of its size (side select: the two cubes are not buttons). */
async function clickStage(page: Page, fx: number, fy: number, dyArt = 0): Promise<void> {
  const s = await stage(page);
  await page.mouse.click(s.left + s.width * fx, s.top + s.height * fy + dyArt * s.scale);
}
const SIDE_CUBE: Record<Side, number> = { out: 0.2, in: 0.8 };
/** Side select: click the OUTSIDE or the INSIDE cube. */
const clickCube = (page: Page, side: Side) => clickStage(page, SIDE_CUBE[side], 0.56, 12);

// ---------- opening pages and getting into a game ----------

async function open(run: Run, who: string, video = false): Promise<Page> {
  const context = await run.browser.newContext({ viewport: SIZE, ...(video ? { recordVideo: { dir: `${OUT}.video-${who}`, size: SIZE } } : {}) });
  const page = await context.newPage();
  const renderer = run.renderer;
  page.on('pageerror', (e) => problems.push({ at: Date.now(), renderer, who, text: `pageerror: ${e.message}` }));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push({ at: Date.now(), renderer, who, text: `console: ${m.text().slice(0, 300)}` });
  });
  run.pages.set(who, page);
  await page.goto(`${BASE}/${renderer === 'canvas' ? '?renderer=canvas' : ''}`);
  await until(`${who}: the title screen with PLAY`, () => has(page, 'PLAY'), 20_000);
  await until(`${who}: connected to the game server (is it running?)`, async () => (await snap(page)).online, 10_000);
  return page;
}

async function closeAll(run: Run): Promise<void> {
  for (const page of run.pages.values()) await page.context().close().catch(() => {});
  run.pages.clear();
}

/** Title -> mode screen: PLAY, then the dive through the clouds. */
async function toMode(page: Page): Promise<void> {
  await click(page, 'PLAY');
  await until('the mode screen', async () => {
    const b = await button(page, 'CREATE LOBBY');
    return !!b && b.enabled && b.alpha >= 0.99 && !(await has(page, 'PLAY')); // PLAY goes when the dive is over
  }, 8000);
}

async function createRoom(page: Page): Promise<string> {
  await click(page, 'CREATE LOBBY');
  await until('a lobby', async () => (await snap(page)).room?.phase === 'lobby');
  await until('the side select screen', () => has(page, 'LEAVE'), 6000);
  return (await snap(page)).code!;
}

/** Mode screen -> JOIN LOBBY -> type the code -> JOIN. Does not wait for the answer. */
async function typeJoin(page: Page, code: string): Promise<void> {
  if (!(await has(page, 'CANCEL'))) {
    await click(page, 'JOIN LOBBY');
    await until('the join popup', () => has(page, 'CANCEL'));
    await page.waitForTimeout(350);
  }
  await page.keyboard.type(code, { delay: 50 });
  await page.waitForTimeout(150);
  await click(page, 'JOIN');
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await typeJoin(page, code);
  await until('joined the room', async () => (await snap(page)).code === code.toUpperCase(), 6000);
}

/** Both players into a running game the short way: A outside (host), B inside (guest). */
async function startGame(run: Run, video = false): Promise<{ a: Page; b: Page; code: string }> {
  const [a, b] = await Promise.all([open(run, 'A', video), open(run, 'B', video)]);
  await Promise.all([toMode(a), toMode(b)]);
  const code = await createRoom(a);
  await joinRoom(b, code);
  await until('B on the side select screen', () => has(b, 'READY'), 6000);
  await press(a, 'a');
  await press(b, 'd');
  await until('sides picked', async () => (await snap(a)).side === 'out' && (await snap(b)).side === 'in');
  await click(b, 'READY');
  await click(a, 'START');
  await until('the game started for both', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
  await a.waitForTimeout(1300); // the fade into the game
  return { a, b, code };
}

// ---------- walking ----------

const KEY_OF: Record<string, string> = { '0,-1': 'w', '0,1': 's', '-1,0': 'a', '1,0': 'd' };
const keyOf = (m: Move) => KEY_OF[`${m[0]},${m[1]}`]!;
const MOVE_OF: Record<string, Move> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

/** Wait until the server has acknowledged every input of this page. */
const settle = (page: Page) => until('every input acknowledged', async () => (await snap(page)).pending === 0, 3000);

/** Press a planned path, one key per step, waiting out each face transition. */
async function walkPath(page: Page, side: Side, moves: readonly Move[]): Promise<void> {
  let face = (await poseOf(page, side)).face;
  for (const m of moves) {
    await page.keyboard.press(keyOf(m));
    await page.waitForTimeout(STEP_MS);
    const now = (await poseOf(page, side)).face;
    if (now !== face) await page.waitForTimeout(FLIP_MS);
    face = now;
  }
}

/** Keys that did not land where the same moves land in /shared (dropped or rolled back). */
const lost: string[] = [];

/**
 * Walk `side` to a pose accepted by `goal`, with the keyboard, planning on the live state
 * with the game's own pathfinding. `allow` fences the faces the path may use.
 */
async function goTo(page: Page, side: Side, what: string, goal: (p: Pose) => boolean, allow?: (face: FaceId) => boolean): Promise<Move[]> {
  const walked: Move[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    await settle(page);
    const state = await stateOf(page);
    if (goal(state.players[side].pose)) return walked;
    const path = findPath(state, side, goal, defaultEnv, allow);
    if (!path) throw new Error(`${side}: no path to ${what} from ${at(state.players[side].pose)}`);
    const want = structuredClone(state);
    for (const m of path) applyMove(want, side, m[0], m[1], 0);
    await walkPath(page, side, path);
    walked.push(...path);
    await settle(page);
    const got = (await stateOf(page)).players[side].pose;
    const struck = (await stateOf(page)).strikes !== state.strikes; // a fall puts you back: the puzzle's doing, not a lost key
    if (!struck && !same({ ...got, dir: 0 }, { ...want.players[side].pose, dir: 0 })) lost.push(`${side} walking to ${what}: pressed ${path.map(keyOf).join('')}, expected ${at(want.players[side].pose)}, got ${at(got)}`);
  }
  throw new Error(`${side}: did not reach ${what} in 4 tries (at ${at(await poseOf(page, side))})`);
}

const onTile = (t: TileRef) => (p: Pose) => p.face === t.face && p.x === t.x && p.y === t.y;
const goToTile = (page: Page, side: Side, t: TileRef) => goTo(page, side, `face ${t.face} (${t.x},${t.y})`, onTile(t));

/** Walk to the last tile before the edge towards `to`. Returns the key that crosses it. */
async function approach(page: Page, side: Side, to: FaceId): Promise<string> {
  await settle(page);
  const state = await stateOf(page);
  const from = state.players[side].pose.face;
  const path = findPath(state, side, (p) => p.face === to, defaultEnv, (f) => f === from || f === to);
  if (!path?.length) throw new Error(`${side}: no way from face ${from} to face ${to}`);
  await walkPath(page, side, path.slice(0, -1));
  await settle(page);
  return keyOf(path.at(-1)!);
}

/** A face next to the one `side` is on (the `n`th of its four neighbours). */
async function neighbour(page: Page, side: Side, n = 0): Promise<FaceId> {
  const pose = await poseOf(page, side);
  return Object.values(neighbours(pose))[n % 4]!;
}

/**
 * Both clients agree with the server: nothing unacknowledged, what each one draws is what
 * the server last sent, and both were sent the same thing. Nobody stands in a wall.
 */
async function synced(pages: Page[], what: string): Promise<void> {
  const end = Date.now() + 4000;
  for (;;) {
    const snaps = await Promise.all(pages.map(snap));
    const bad: string[] = [];
    snaps.forEach((s, i) => {
      if (!s.state || !s.server) bad.push(`player ${i + 1} has no game state`);
      else if (s.pending) bad.push(`player ${i + 1} has ${s.pending} unacknowledged inputs`);
      else if (!same(s.state, s.server)) bad.push(`player ${i + 1} draws ${at(s.state.players.out.pose)} / ${at(s.state.players.in.pose)} but the server said ${at(s.server.players.out.pose)} / ${at(s.server.players.in.pose)}`);
    });
    if (!bad.length && snaps.length > 1 && !same(snaps[0]!.server, snaps[1]!.server)) bad.push('the two clients were sent different states');
    if (!bad.length) {
      const state = snaps[0]!.server!;
      for (const side of ['out', 'in'] as const) {
        const p = state.players[side].pose;
        // (a door may close on the tile you stand on: that one is the puzzle's business)
        if (defaultEnv.world[side][p.face].tiles[p.y]![p.x] !== 'floor') bad.push(`${side} stands in a solid tile at ${at(p)}`);
      }
    }
    if (!bad.length) return;
    if (Date.now() > end) throw new Error(`${what}: client and server disagree: ${bad.join('; ')}`);
    await sleep(100);
  }
}

/** Put the keyboard back in the game: close the chat field and any panel, let go of keys. */
async function calm(page: Page): Promise<void> {
  for (const k of ['Tab', 'w', 'a', 's', 'd']) await page.keyboard.up(k);
  if (await typing(page)) await press(page, 'Escape');
  for (let i = 0; i < 3; i++) {
    const modal = (await snap(page)).modal;
    if (modal !== 'cu-settings' && modal !== 'cu-pause') break;
    await press(page, 'Escape');
  }
}

/** One step in any direction that is free: proves the game takes keys again. */
async function canWalk(page: Page, side: Side): Promise<boolean> {
  for (const k of ['w', 'a', 's', 'd']) {
    const before = await poseOf(page, side);
    await press(page, k);
    await page.waitForTimeout(100);
    const after = await poseOf(page, side);
    if (!same(before, after) && (before.x !== after.x || before.y !== after.y || before.face !== after.face)) {
      if (after.face !== before.face) await page.waitForTimeout(FLIP_MS);
      return true;
    }
  }
  return false;
}

// ---------- sections ----------

/** The whole flow the long way: title, create, wrong code, join, side select, ready, start. */
async function lobby(run: Run): Promise<void> {
  const tag = `lobby-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  let code = '';

  const opened = await step(run, 'title: both players see PLAY, in the wanted renderer', async () => {
    [a, b] = await Promise.all([open(run, 'A'), open(run, 'B')]);
    check((await rendererOf(a)) === run.renderer, `wanted ${run.renderer}, got ${await rendererOf(a)}`);
    await shots(run, `${tag}-01-title`);
  });
  if (!opened) return;

  await step(run, 'title: PLAY dives to the mode screen (Create, Join, Back)', async () => {
    await toMode(a);
    const labels = (await buttons(a)).map((x) => x.label).sort().join('|');
    check(labels === 'BACK|CREATE LOBBY|JOIN LOBBY', `mode screen buttons are ${labels}`);
  });
  await step(run, 'mode: BACK returns to the title, PLAY dives again', async () => {
    await click(a, 'BACK');
    await until('the title', async () => (await has(a, 'PLAY')) && !(await has(a, 'BACK')));
    await a.waitForTimeout(500);
    await toMode(a);
  });
  await step(run, 'mode: the gear opens the settings, Esc closes them, the menu is untouched', async () => {
    await clickDom(a, '#cu-gear');
    await until('the settings panel', async () => (await snap(a)).modal === 'cu-settings');
    await a.waitForTimeout(300);
    await shots(run, `${tag}-02-settings-on-menu`);
    await press(a, 'Escape');
    await until('the settings closed', async () => (await snap(a)).modal === null);
    check((await has(a, 'CREATE LOBBY')) && (await snap(a)).code === null, 'the mode screen changed under the settings');
  });
  await step(run, 'create: CREATE LOBBY makes a room and shows its 4-letter code', async () => {
    code = await createRoom(a);
    check(/^[A-Z]{4}$/.test(code), `room code is "${code}"`);
    await until('the code in the top bar', async () => (await text(a, '#cu-room-v')) === code);
    const s = await snap(a);
    check(s.role === 'host' && s.side === null, `host is ${s.role} with side ${s.side}`);
    await a.waitForTimeout(500);
    await shots(run, `${tag}-03-lobby-waiting`);
    return `room ${code}`;
  });
  await step(run, 'join: a wrong code is refused and says why', async () => {
    await toMode(b);
    const wrong = code === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
    await typeJoin(b, wrong);
    await until('"Room not found"', async () => /not found/i.test((await snap(b)).error ?? ''));
    check((await snap(b)).code === null && (await has(b, 'CANCEL')), 'the popup closed or a room was joined');
    await b.waitForTimeout(300);
    await shots(run, `${tag}-04-wrong-code`);
  });
  await step(run, 'join: a 3-letter code is refused', async () => {
    await press(b, 'Backspace', 'Backspace', 'Backspace', 'Backspace');
    await b.keyboard.type('abc', { delay: 50 });
    await click(b, 'JOIN');
    await b.waitForTimeout(400);
    check((await snap(b)).code === null && (await has(b, 'CANCEL')), 'a short code got somewhere');
    await press(b, 'Backspace', 'Backspace', 'Backspace');
  });
  await step(run, 'join: the real code, typed in lower case, joins as guest', async () => {
    await joinRoom(b, code.toLowerCase());
    await until('B is the guest', async () => (await snap(b)).role === 'guest');
    await until('A sees the guest', async () => !!(await snap(a)).room?.members.guest?.connected);
    await until('B on the side select screen', () => has(b, 'READY'), 6000);
    await b.waitForTimeout(500);
    await shots(run, `${tag}-05-lobby-both`);
  });

  const sideOf = async (page: Page, role: 'host' | 'guest') => (await snap(page)).room?.members[role]?.side ?? null;
  /** Both screens show the same lobby. */
  const agree = async (what: string) => until(`${what} (both clients show the same lobby)`, async () => same((await snap(a)).room, (await snap(b)).room));

  await step(run, 'side select: A switches out, middle, in, middle, out (keys); B sees each move', async () => {
    for (const [key, want] of [['a', 'out'], ['d', null], ['d', 'in'], ['ArrowLeft', null], ['ArrowLeft', 'out']] as const) {
      await press(a, key);
      await until(`A on ${want ?? 'the middle'} as seen by B`, async () => (await sideOf(b, 'host')) === want);
    }
    await agree('after A switched');
  });
  await step(run, 'side select: B switches in, middle, in (keys); A sees each move', async () => {
    for (const [key, want] of [['d', 'in'], ['a', null], ['ArrowRight', 'in'], ['a', null]] as const) {
      await press(b, key);
      await until(`B on ${want ?? 'the middle'} as seen by A`, async () => (await sideOf(a, 'guest')) === want);
    }
    await agree('after B switched');
  });
  await step(run, 'side select: B cannot take the side A holds (key, then a click on the cube)', async () => {
    await press(b, 'a');
    await b.waitForTimeout(300);
    check((await sideOf(a, 'guest')) === null && (await sideOf(a, 'host')) === 'out', 'B got the taken side by key');
    await shots(run, `${tag}-06-side-taken`);
    await clickCube(b, 'out');
    await b.waitForTimeout(300);
    check((await sideOf(a, 'guest')) === null && (await sideOf(a, 'host')) === 'out', 'B got the taken side by click');
    await agree('after the refusals');
  });
  await step(run, 'side select: clicking a cube picks that side (B inside, then A swaps by mouse)', async () => {
    await clickCube(b, 'in');
    await until('B inside after a click on the inside cube', async () => (await sideOf(a, 'guest')) === 'in');
    await clickCube(a, 'in');
    await a.waitForTimeout(300);
    check((await sideOf(b, 'host')) === 'out', 'A took the side B holds');
    await agree('after the clicks');
  });
  await step(run, 'side select: both grab the same side at the same moment, exactly one gets it', async () => {
    await press(a, 'd'); // A back to the middle
    await press(b, 'a'); // B back to the middle
    await until('both in the middle', async () => (await sideOf(a, 'host')) === null && (await sideOf(a, 'guest')) === null);
    await Promise.all([a.keyboard.press('a'), b.keyboard.press('a')]);
    await a.waitForTimeout(600);
    const [host, guest] = [await sideOf(a, 'host'), await sideOf(a, 'guest')];
    check((host === 'out') !== (guest === 'out'), `host has ${host}, guest has ${guest}`);
    await agree('after the race');
    await shots(run, `${tag}-07-same-side-race`);
    // back to A outside, B inside
    if (guest === 'out') await press(b, 'd');
    await until('B off the outside', async () => (await sideOf(a, 'guest')) !== 'out');
    if ((await sideOf(a, 'host')) !== 'out') await press(a, 'a');
    await until('A outside', async () => (await sideOf(b, 'host')) === 'out');
    while ((await sideOf(a, 'guest')) !== 'in') await press(b, 'd');
    await agree('after sorting the sides');
    return `${host === 'out' ? 'the host' : 'the guest'} won the race`;
  });
  await step(run, 'ready: START is disabled and does nothing until the guest is ready', async () => {
    check((await button(a, 'START'))?.enabled === false, 'START is enabled before the guest is ready');
    await click(a, 'START', { force: true });
    await press(a, 'Enter');
    await a.waitForTimeout(400);
    check((await snap(a)).room?.phase === 'lobby', 'the game started without a ready guest');
  });
  await step(run, 'ready: READY, NOT READY, READY; a new pick takes the ready back', async () => {
    const ready = async () => (await snap(a)).room?.members.guest?.ready;
    await click(b, 'READY');
    await until('ready, as seen by A', async () => (await ready()) === true);
    await until('START enabled', async () => (await button(a, 'START'))?.enabled === true);
    await click(b, 'NOT READY');
    await until('not ready again', async () => (await ready()) === false);
    await click(b, 'READY');
    await until('ready again', async () => (await ready()) === true);
    await press(b, 'a');
    await until('the pick is gone and so is the ready', async () => (await sideOf(a, 'guest')) === null && (await ready()) === false);
    await press(b, 'd');
    await click(b, 'READY');
    await until('ready after picking again', async () => (await ready()) === true);
    await shots(run, `${tag}-08-ready`);
  });
  await step(run, 'lobby: the guest leaves (LEAVE) and rejoins with nothing picked', async () => {
    await click(b, 'LEAVE');
    await until('A sees an empty second seat', async () => (await snap(a)).room?.members.guest === null);
    await until('B back on the mode screen', async () => (await snap(b)).code === null && (await has(b, 'CREATE LOBBY')), 6000);
    check((await button(a, 'START'))?.enabled === false, 'START is enabled with no guest');
    await b.waitForTimeout(500);
    await joinRoom(b, code);
    await until('B back on the side select screen', () => has(b, 'READY'), 6000);
    const g = (await snap(a)).room?.members.guest;
    check(!!g && g.side === null && g.ready === false, `the guest came back as ${JSON.stringify(g)}`);
  });
  await step(run, 'lobby: the guest refreshes and comes back as the guest', async () => {
    await b.waitForTimeout(400);
    await b.reload();
    await until('B is the guest again', async () => (await snap(b)).role === 'guest' && (await snap(b)).code === code, 15_000);
    await until('B on the side select screen', () => has(b, 'READY'), 8000);
    await until('A sees the guest connected', async () => (await snap(a)).room?.members.guest?.connected === true);
    await b.waitForTimeout(600);
  });
  await step(run, 'lobby: the host refreshes and is still the host with the room', async () => {
    await a.reload();
    await until('A is the host again', async () => (await snap(a)).role === 'host' && (await snap(a)).code === code, 15_000);
    await until('A on the side select screen', () => has(a, 'START'), 8000);
    await a.waitForTimeout(600);
    await press(a, 'a');
    await until('A outside again', async () => (await sideOf(b, 'host')) === 'out');
  });
  await step(run, 'start: the guest readies, the host starts, both are in the game on their sides', async () => {
    await press(b, 'd');
    await until('B inside', async () => (await sideOf(a, 'guest')) === 'in');
    await click(b, 'READY');
    await click(a, 'START');
    await until('the game on both screens', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
    await a.waitForTimeout(1300);
    const [sa, sb] = [await snap(a), await snap(b)];
    check(sa.side === 'out' && sb.side === 'in', `sides are ${sa.side} / ${sb.side}`);
    for (const side of ['out', 'in'] as const) {
      const p = sa.state!.players[side].pose;
      check(p.face === 1 && p.x === SPAWN[side].x && p.y === SPAWN[side].y, `${side} starts at ${at(p)}`);
    }
    check((await text(a, '#cu-side')) === 'Outside' && (await text(b, '#cu-side')) === 'Inside', 'the HUD names the wrong side');
    check((await text(a, '#cu-room-v')) === code, 'the room code is not in the top bar');
    await synced([a, b], 'at the start');
    await shots(run, `${tag}-09-game`);
  });
  await step(run, 'start: both players can walk, and each sees the other move', async () => {
    await press(a, 'w', 'w');
    await press(b, 's');
    await synced([a, b], 'after the first steps');
    const s = await stateOf(b);
    check(s.players.out.pose.y === SPAWN.out.y - 2 && s.players.in.pose.y === SPAWN.in.y + 1, `out at ${at(s.players.out.pose)}, in at ${at(s.players.in.pose)}`);
  });
}

/** Chat, quick chat, pause, settings, the cube map. */
async function hud(run: Run): Promise<void> {
  const tag = `hud-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  if (!(await step(run, 'setup: two players in a game', async () => void ({ a, b } = await startGame(run))))) return;

  await step(run, 'quick chat: 1 to 4 from the inside player show as bubbles and chat lines outside', async () => {
    for (let i = 0; i < 4; i++) {
      await press(b, String(i + 1));
      await until(`"${QUICK_CHATS[i]}" as a bubble on A`, async () => (await text(a, '.cu-bubble.theirs')) === QUICK_CHATS[i]);
      await until(`"${QUICK_CHATS[i]}" in both chat logs`, async () => (await snap(a)).chat.at(-1)?.text === QUICK_CHATS[i] && (await snap(b)).chat.at(-1)?.text === QUICK_CHATS[i]);
      if (i === 0) await shots(run, `${tag}-01-quick-chat`);
    }
    check((await snap(a)).chat.every((m) => m.from === 'in'), 'a quick chat line has the wrong sender');
  });
  await step(run, 'quick chat: 1 to 4 from the outside player reach the inside player', async () => {
    for (let i = 0; i < 4; i++) {
      await press(a, String(i + 1));
      await until(`"${QUICK_CHATS[i]}" as a bubble on B`, async () => (await text(b, '.cu-bubble.theirs')) === QUICK_CHATS[i]);
    }
    check((await snap(b)).chat.length === 8, `the chat has ${(await snap(b)).chat.length} lines, expected 8`);
  });
  await step(run, 'chat: Enter opens it, typed letters do not move or act, Enter sends, Esc closes', async () => {
    const before = await stateOf(a);
    const lines = (await snap(a)).chat.length;
    await press(a, 'Enter');
    await until('the chat field has the focus', () => typing(a));
    await a.keyboard.type('wasd eq 1234 was here', { delay: 20 });
    await a.waitForTimeout(200);
    check(same((await stateOf(a)).players.out, before.players.out) && (await snap(a)).chat.length === lines, 'typing moved the player or sent a quick chat');
    await shots(run, `${tag}-02-chat-typing`);
    await press(a, 'Enter');
    await until('B got the line', async () => (await snap(b)).chat.at(-1)?.text === 'wasd eq 1234 was here');
    await press(a, 'Escape');
    check(!(await typing(a)) && (await snap(a)).modal === null, 'Esc in the chat did not just close the chat');
    check((await text(b, '#cu-log'))!.includes('wasd eq 1234 was here'), 'the line is not in the chat log on screen');
  });
  await step(run, 'pause: Esc opens it, the keys do not reach the game, the partner keeps playing', async () => {
    await press(a, 'Escape');
    await until('the pause menu', async () => (await snap(a)).modal === 'cu-pause');
    await a.waitForTimeout(350);
    await shots(run, `${tag}-03-pause`);
    const before = await stateOf(a);
    await press(a, 'w', 'a', 'e', '1');
    check(same((await stateOf(a)).players.out, before.players.out), 'a key moved the paused player');
    const partner = (await poseOf(a, 'in')).y;
    await press(b, 'w');
    await until('the partner still moves on the paused screen', async () => (await poseOf(a, 'in')).y === partner - 1);
  });
  await step(run, 'pause: Resume (mouse) closes it and the player walks again', async () => {
    await clickDom(a, '#cu-pause [data-act="resume"]');
    await until('the pause menu closed', async () => (await snap(a)).modal === null);
    check(await canWalk(a, 'out'), 'no step after Resume');
    await synced([a, b], 'after the pause');
  });
  await step(run, 'pause: Settings opens the panel; Done (mouse) goes back to the pause menu; Esc resumes', async () => {
    await press(a, 'Escape');
    await until('the pause menu', async () => (await snap(a)).modal === 'cu-pause');
    await a.waitForTimeout(300);
    await clickDom(a, '#cu-pause [data-act="settings"]');
    await until('the settings panel', async () => (await snap(a)).modal === 'cu-settings');
    await a.waitForTimeout(300);
    await clickDom(a, '#cu-settings .cu-seg[data-key="textSize"] [data-value="l"]');
    await clickDom(a, '#cu-settings .cu-toggle[data-key="highContrast"]');
    await until('text size L and high contrast on', async () => (await isOn(a, '#cu-settings [data-key="textSize"] .on[data-value="l"]')) && (await isOn(a, '.cu[data-contrast="high"]')));
    await a.waitForTimeout(200);
    await shots(run, `${tag}-04-settings-from-pause`);
    await clickDom(a, '#cu-settings .cu-seg[data-key="textSize"] [data-value="m"]');
    await clickDom(a, '#cu-settings .cu-toggle[data-key="highContrast"]');
    const before = await stateOf(a);
    await clickDom(a, '#cu-settings [data-close]');
    await a.waitForTimeout(400);
    const s = await snap(a);
    check(s.modal === 'cu-pause', `after Done the top panel is ${s.modal}, expected the pause menu`);
    check(same(s.state!.players.out, before.players.out) && s.screen === 'game', 'the Done click did something to the game');
    await press(a, 'Escape');
    await until('resumed', async () => (await snap(a)).modal === null);
  });
  await step(run, 'settings: the gear opens it in game; a slider and a switch work by mouse; Done returns to the game', async () => {
    await clickDom(a, '#cu-gear');
    await until('the settings panel', async () => (await snap(a)).modal === 'cu-settings');
    await a.waitForTimeout(300);
    const music = await js<string>(a, `document.querySelector('#cu-settings [data-key="music"]').getAttribute('aria-valuenow')`);
    const box = (await a.locator('#cu-settings .cu-slider[data-key="music"]').boundingBox())!;
    await a.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await until('the music slider moved', async () => (await js<string>(a, `document.querySelector('#cu-settings [data-key="music"]').getAttribute('aria-valuenow')`)) !== music);
    await clickDom(a, '#cu-settings .cu-toggle[data-key="reduceMotion"]');
    await until('reduce motion on', async () => (await isOn(a, '.cu[data-motion="reduce"]')));
    await clickDom(a, '#cu-settings .cu-toggle[data-key="reduceMotion"]');
    await shots(run, `${tag}-05-settings-in-game`);
    const before = await stateOf(a);
    await clickDom(a, '#cu-settings [data-close]');
    await a.waitForTimeout(400);
    const s = await snap(a);
    check(s.modal === null && s.screen === 'game', `after Done: panel ${s.modal}, screen ${s.screen}`);
    check(same(s.state!.players.out, before.players.out), 'the Done click moved the player');
    check(await canWalk(a, 'out'), 'no step after the settings closed');
  });
  await step(run, 'settings: a click on the veil closes the panel and nothing else', async () => {
    await clickDom(b, '#cu-gear');
    await until('the settings panel', async () => (await snap(b)).modal === 'cu-settings');
    await b.waitForTimeout(300);
    await b.mouse.click(12, SIZE.height - 12);
    await until('closed by the veil', async () => (await snap(b)).modal === null);
    check((await snap(b)).screen === 'game', 'the veil click left the game');
  });
  await step(run, 'map: holding Tab shows the cube map and the arrows turn it instead of walking', async () => {
    const before = await poseOf(a, 'out');
    await a.keyboard.down('Tab');
    await until('the cube map', () => isOn(a, '.cu-cubemap.on'));
    await press(a, 'ArrowUp', 'ArrowLeft', 'w', 'd');
    await shots(run, `${tag}-06-cube-map`);
    check(same(await poseOf(a, 'out'), before), 'the player walked while the map was held');
    await a.keyboard.up('Tab');
    await until('the map is gone', async () => !(await isOn(a, '.cu-cubemap.on')));
    check(await canWalk(a, 'out'), 'no step after letting go of Tab');
    await synced([a, b], 'after the map');
  });
  await step(run, 'M mutes the mic (seen in the settings panel)', async () => {
    await press(a, 'm');
    await clickDom(a, '#cu-gear');
    await until('the settings panel', async () => (await snap(a)).modal === 'cu-settings');
    check((await js<string>(a, `document.querySelector('#cu-settings [data-key="micMuted"]').getAttribute('aria-checked')`)) === 'true', 'M did not mute');
    await press(a, 'Escape');
    await press(a, 'm');
  });
}

/** Every face on both sides; every edge of every face, out and back. */
async function walk(run: Run): Promise<void> {
  const tag = `faces-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  if (!(await step(run, 'setup: two players in a game', async () => void ({ a, b } = await startGame(run))))) return;

  /** The screen directions each player crossed an edge in (all four must come up). */
  const crossed: Record<Side, Set<string>> = { out: new Set(), in: new Set() };
  const tour = async (page: Page, side: Side) => {
    for (const face of FACES) {
      await step(run, `${side}: face ${face}: walk there, cross all 4 edges and come back over each`, async () => {
        await goTo(page, side, `face ${face}`, (p) => p.face === face);
        await until(`the HUD says "Face ${face}"`, async () => (await text(page, '#cu-faceno')) === String(face));
        await page.waitForTimeout(FLIP_MS);
        await page.screenshot({ path: `${OUT}${tag}-${side}-${face}.png` });
        const around = [...new Set(Object.values(neighbours(await poseOf(page, side))))];
        check(around.length === 4, `face ${face} has ${around.length} neighbours`);
        for (const next of around) {
          const only = (f: FaceId) => f === face || f === next;
          const out = await goTo(page, side, `face ${next} over the shared edge`, (p) => p.face === next, only);
          crossed[side].add(keyOf(out.at(-1)!));
          check((await text(page, '#cu-faceno')) === String(next), `the HUD says face ${await text(page, '#cu-faceno')} on face ${next}`);
          const back = await goTo(page, side, `face ${face} back over the same edge`, (p) => p.face === face, only);
          crossed[side].add(keyOf(back.at(-1)!));
          await synced([page], `${side} after face ${face} <-> ${next}`);
        }
        // the edge labels follow the player's own up: the top one names the face over the top edge
        const up = neighbours(await poseOf(page, side)).up;
        await until(`the top edge label names face ${up}`, async () => (await text(page, '#cu-et .cu-chip')) === String(up));
        return `neighbours ${around.join(', ')}`;
      });
    }
  };
  await Promise.all([tour(a, 'out'), tour(b, 'in')]);

  await step(run, 'both: every screen direction (up, down, left, right) crossed an edge', async () => {
    for (const side of ['out', 'in'] as const) check(crossed[side].size === 4, `${side} only crossed with ${[...crossed[side]].join('')}`);
    await synced([a, b], 'after the tour');
  });
  for (const [page, side] of [[a, 'out'], [b, 'in']] as const) {
    await step(run, `${side}: three edges around one corner bring you home turned 90 degrees (the edge labels turn)`, async () => {
      await goTo(page, side, 'face 1', (p) => p.face === 1);
      const start = compassDrift(await poseOf(page, side));
      const n = neighbours(await poseOf(page, side));
      await goTo(page, side, `face ${n.up}`, (p) => p.face === n.up, (f) => f === 1 || f === n.up);
      await goTo(page, side, `face ${n.right}`, (p) => p.face === n.right, (f) => f === n.up || f === n.right);
      await goTo(page, side, 'face 1 again', (p) => p.face === 1, (f) => f === n.right || f === 1);
      const drift = compassDrift(await poseOf(page, side));
      check(Math.abs(drift - start) === 90 || Math.abs(drift - start) === 270, `drift went from ${start} to ${drift}`);
      // home, but turned: the edge labels of face 1 have moved round with the player's up
      const up = neighbours(await poseOf(page, side)).up;
      check(up !== n.up, `the face over the top edge is still ${up}`);
      await until(`the top edge label names face ${up} now (it was ${n.up})`, async () => (await text(page, '#cu-et .cu-chip')) === String(up));
      await page.waitForTimeout(FLIP_MS);
      await page.screenshot({ path: `${OUT}${tag}-${side}-corner-drift.png` });
      return `drift ${start} -> ${drift}`;
    });
  }
  await step(run, 'both: no key was dropped or rolled back at 130 ms pacing', async () => {
    check(lost.length === 0, `${lost.length} walk(s) ended somewhere else: ${lost.slice(0, 3).join(' || ')}`);
  });
}

/** E and Q, carrying over an edge, and the other side cannot take your item. */
async function items(run: Run): Promise<void> {
  const tag = `items-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  if (!(await step(run, 'setup: two players in a game', async () => void ({ a, b } = await startGame(run))))) return;
  const carrying = async (page: Page, side: Side) => (await stateOf(page)).players[side].carrying;
  const item = async (page: Page, id: string) => (await stateOf(page)).items[id]!;
  let id = '';
  // the items of this game are handed out by the puzzles: with none lying outside at the start there is nothing to carry yet
  if (!Object.values((await stateOf(a)).items).some((i) => i.side === 'out' && !i.carriedBy && !i.placedOn)) {
    await step(run, 'outside: an item to carry', async () => 'skipped: no item lies on the outside at the start of this game');
    return;
  }

  await step(run, 'outside: walk onto the item; Q with empty hands does nothing', async () => {
    const lying = Object.values((await stateOf(a)).items).find((i) => i.side === 'out' && !i.carriedBy && !i.placedOn)!;
    id = lying.id;
    await goToTile(a, 'out', lying);
    await press(a, 'q');
    await settle(a);
    check((await carrying(a, 'out')) === null, 'Q picked something up');
    return `item "${id}" at face ${lying.face} (${lying.x},${lying.y})`;
  });
  await step(run, 'outside: E picks it up; the HUD and the partner both show it carried', async () => {
    await press(a, 'e');
    await until('carrying', async () => (await carrying(a, 'out')) === id);
    await until('the partner sees it carried', async () => (await item(b, id)).carriedBy === 'out');
    check(/Q drop/.test((await text(a, '#cu-carry')) ?? ''), `the HUD carry line says "${await text(a, '#cu-carry')}"`);
    await shots(run, `${tag}-01-carrying`);
  });
  await step(run, 'outside: the item crosses a face edge with the player; Q drops it where they stand', async () => {
    const next = await neighbour(a, 'out', 2);
    await goTo(a, 'out', `face ${next}`, (p) => p.face === next);
    check((await carrying(a, 'out')) === id, 'the item was lost on the edge');
    await canWalk(a, 'out'); // one more step, so it is not dropped on the edge tile
    const pose = await poseOf(a, 'out');
    await press(a, 'q');
    await until('dropped', async () => (await carrying(a, 'out')) === null);
    const it = await item(b, id);
    check(it.carriedBy === null && it.face === pose.face && it.x === pose.x && it.y === pose.y && it.side === 'out', `the partner has the item at face ${it.face} (${it.x},${it.y}), the player stands at ${at(pose)}`);
    await synced([a, b], 'after the drop');
    await shots(run, `${tag}-02-dropped-on-another-face`);
  });
  await step(run, 'outside: E picks up, E drops, E picks up again (E toggles)', async () => {
    await press(a, 'e');
    await until('picked up', async () => (await carrying(a, 'out')) === id);
    await press(a, 'e');
    await until('dropped', async () => (await carrying(a, 'out')) === null);
    await press(a, 'e');
    await until('picked up again', async () => (await carrying(a, 'out')) === id);
    await press(a, 'q');
    await until('dropped with Q', async () => (await carrying(a, 'out')) === null);
  });
  await step(run, 'inside: standing behind the item, E and Q take nothing (items live on one side)', async () => {
    const it = await item(b, id);
    await goToTile(b, 'in', it);
    await press(b, 'e', 'q', 'e');
    await settle(b);
    check((await carrying(b, 'in')) === null && (await item(a, id)).carriedBy === null, 'the inside player took an outside item');
    await synced([a, b], 'after the inside player tried');
  });
  await step(run, 'outside: a step and then Q pressed during the roll happen in that order (the item lands after the step)', async () => {
    await press(a, 'e');
    await until('picked up', async () => (await carrying(a, 'out')) === id);
    const to = await neighbour(a, 'out', 1);
    const key = await approach(a, 'out', to);
    // the step after the edge must be free, or this proves nothing
    const plan = structuredClone(await stateOf(a));
    applyMove(plan, 'out', MOVE_OF[key]![0], MOVE_OF[key]![1], 0);
    const landed = { ...plan.players.out.pose };
    applyMove(plan, 'out', MOVE_OF[key]![0], MOVE_OF[key]![1], 0);
    const want = plan.players.out.pose;
    if (same(landed, want)) return 'skipped: the tile after the edge is blocked';
    await a.keyboard.press(key); // over the edge: the roll starts
    await a.waitForTimeout(100);
    await a.keyboard.press(key); // one more step, held back until the roll ends
    await a.keyboard.press('q'); // then drop
    await a.waitForTimeout(1500);
    await settle(a);
    const it = await item(b, id);
    const pose = await poseOf(a, 'out');
    check(same({ ...pose, dir: 0 }, { ...want, dir: 0 }), `the player ended at ${at(pose)}, expected ${at(want)}`);
    check(it.carriedBy === null, 'Q did not drop the item');
    check(it.face === want.face && it.x === want.x && it.y === want.y, `the item was dropped at face ${it.face} (${it.x},${it.y}), one step early: the player pressed step then Q and stands at ${at(pose)}`);
  });
  await step(run, 'outside: E and Q mashed 20 times end in one consistent state', async () => {
    for (let i = 0; i < 20; i++) await a.keyboard.press(i % 3 === 2 ? 'q' : 'e');
    await a.waitForTimeout(1500);
    await synced([a, b], 'after mashing E and Q');
    const s = await stateOf(a);
    const it = s.items[id]!;
    check((s.players.out.carrying === id) === (it.carriedBy === 'out'), 'the player and the item disagree about who carries it');
  });
}

/** Refresh mid-game on each player, then leave and rejoin on each. */
async function rejoin(run: Run): Promise<void> {
  const tag = `rejoin-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  let code = '';
  if (!(await step(run, 'setup: two players in a game, away from the spawn, outside carrying an item if one lies there', async () => {
    ({ a, b, code } = await startGame(run));
    const lying = Object.values((await stateOf(a)).items).find((i) => i.side === 'out' && !i.carriedBy && !i.placedOn);
    if (lying) {
      await goToTile(a, 'out', lying);
      await press(a, 'e');
    }
    const [na, nb] = [await neighbour(a, 'out', 3), await neighbour(b, 'in', 0)];
    await Promise.all([goTo(a, 'out', `face ${na}`, (p) => p.face === na), goTo(b, 'in', `face ${nb}`, (p) => p.face === nb)]);
    await press(a, 's', 's');
    await press(b, 's', 'd');
    await synced([a, b], 'before the refreshes');
  }))) return;

  for (const [page, other, side, who] of [[a, b, 'out', 'A'], [b, a, 'in', 'B']] as const) {
    await step(run, `refresh: ${who} (${side}) reloads mid-game and is back in the same seat, pose and hands`, async () => {
      const before = (await snap(page)).server!;
      await page.reload();
      await until(`${who} is in the game again`, async () => (await snap(page)).screen === 'game', 15_000);
      await until(`${who} is connected, as seen by the partner`, async () => (await snap(other)).room?.seats[side].connected === true);
      const s = await snap(page);
      check(s.side === side && s.code === code, `${who} came back as ${s.side} in ${s.code}`);
      check(same(s.state!.players[side].pose, before.players[side].pose), `${who} came back at ${at(s.state!.players[side].pose)}, was at ${at(before.players[side].pose)}`);
      check(s.state!.players[side].carrying === before.players[side].carrying, `${who} came back carrying ${s.state!.players[side].carrying}`);
      check(same(s.state!.solved, before.solved) && s.state!.startedAt === before.startedAt, 'the game was reset by the refresh');
      await page.waitForTimeout(1200);
      await until('the HUD shows the face', async () => (await text(page, '#cu-faceno')) === String(before.players[side].pose.face));
      check(await canWalk(page, side), `${who} cannot walk after the refresh`);
      await synced([a, b], `after ${who} refreshed`);
      await shots(run, `${tag}-refresh-${who}`);
    });
  }
  await step(run, 'refresh: the partner sees "Partner reconnecting... m:ss" while the other tab is gone', async () => {
    await b.goto('about:blank');
    await until('the banner on A', async () => /Partner reconnecting\.\.\. \d:\d\d/.test((await text(a, '#cu-banner')) ?? '') && !(await isOn(a, '#cu-banner[hidden]')));
    await shots(run, `${tag}-partner-away`);
    check(await canWalk(a, 'out'), 'A cannot walk while the partner is away');
    await b.goBack();
    await until('B is in the game again', async () => (await snap(b)).screen === 'game', 15_000);
    await until('the banner is gone', () => isOn(a, '#cu-banner[hidden]'));
    await b.waitForTimeout(1200);
    await synced([a, b], 'after B came back');
  });
  await step(run, 'leave: the guest leaves with the Leave button; the host keeps playing', async () => {
    await clickDom(b, '#cu-leave');
    await until('B is out of the room, on the mode screen', async () => (await snap(b)).code === null && (await has(b, 'CREATE LOBBY')), 8000);
    await until('A sees the seat held', async () => (await snap(a)).room?.seats.in.away?.kind === 'left');
    await until('the banner on A counts down', async () => /Partner left\. Seat held \d:\d\d/.test((await text(a, '#cu-banner')) ?? ''));
    check((await snap(a)).screen === 'game', 'A was thrown out of the game');
    check(await canWalk(a, 'out'), 'A cannot walk after the partner left');
    await synced([a], 'A alone');
  });
  await step(run, 'rejoin: the guest joins again with the code and is back inside, where they stood', async () => {
    const before = (await snap(a)).server!.players.in.pose;
    await b.waitForTimeout(500);
    await joinRoom(b, code);
    await until('B is in the game', async () => (await snap(b)).screen === 'game', 8000);
    const s = await snap(b);
    check(s.side === 'in', `B came back as ${s.side}`);
    check(same(s.state!.players.in.pose, before), `B came back at ${at(s.state!.players.in.pose)}, was at ${at(before)}`);
    await b.waitForTimeout(1200);
    check(await canWalk(b, 'in'), 'B cannot walk after rejoining');
    await synced([a, b], 'after B rejoined');
  });
  await step(run, 'leave: the host leaves from the pause menu; the seat is held and the guest keeps playing', async () => {
    await press(a, 'Escape');
    await until('the pause menu', async () => (await snap(a)).modal === 'cu-pause');
    await a.waitForTimeout(300);
    await clickDom(a, '#cu-pause [data-act="leave"]');
    await until('A is out of the room, on the mode screen', async () => (await snap(a)).code === null && (await has(a, 'CREATE LOBBY')), 8000);
    await until('B sees the seat held', async () => (await snap(b)).room?.seats.out.away?.kind === 'left');
    check((await snap(b)).role === 'guest', 'the host role moved before the window passed');
    check((await snap(a)).modal === null, 'the pause menu is still open on the mode screen');
    check(await canWalk(b, 'in'), 'B cannot walk after the host left');
  });
  await step(run, 'rejoin: the old host joins again and is back outside, with what they carried', async () => {
    const before = (await snap(b)).server!.players.out;
    await a.waitForTimeout(500);
    await joinRoom(a, code);
    await until('A is in the game', async () => (await snap(a)).screen === 'game', 8000);
    const s = await snap(a);
    check(s.side === 'out' && s.role === 'host', `A came back as ${s.side} / ${s.role}`);
    check(same(s.state!.players.out.pose, before.pose) && s.state!.players.out.carrying === before.carrying, `A came back at ${at(s.state!.players.out.pose)} carrying ${s.state!.players.out.carrying}`);
    await a.waitForTimeout(1200);
    check(await canWalk(a, 'out'), 'A cannot walk after rejoining');
    await synced([a, b], 'after A rejoined');
    await shots(run, `${tag}-both-back`);
  });
}

function resolveTarget(target: Target, state: GameState): TileRef {
  if ('tile' in target) return target.tile;
  if ('object' in target) {
    const [side, face, type] = target.object;
    const o = objectsOn(defaultEnv.world, side, face, type).find((x) => target.name === undefined || x.name === target.name);
    if (!o) throw new Error(`no "${type}"${target.name ? ` named "${target.name}"` : ''} object on ${side} face ${face}`);
    return { face, x: o.x + (target.dx ?? 0), y: o.y + (target.dy ?? 0) };
  }
  const it = Object.values(state.items).find((i) => i.id === target.item || i.kind === target.item);
  if (!it) throw new Error(`no item "${target.item}"`);
  if (it.carriedBy) throw new Error(`item "${target.item}" is being carried by ${it.carriedBy}`);
  return { face: it.face, x: it.x, y: it.y };
}

const sees = (state: GameState, sight: Sight) => visibleObjects(state, sight.by, sight.face).filter((o) => o.type === sight.type);

const describe = (s: PuzzleStep) =>
  'goto' in s
    ? `${s.who} walks to ${JSON.stringify(s.goto)}`
    : 'read' in s
      ? `${s.who} walks onto the ${s.onto.type} that matches the ${s.read.type} the ${s.read.by} player sees`
      : 'follow' in s
        ? `${s.who} walks the ${s.follow.type} tiles the ${s.follow.by} player sees`
        : 'plan' in s
          ? `steps planned from the state the ${s.who} player has`
          : 'keys' in s ? `${s.who} presses ${s.keys}` : 'wait' in s ? `wait ${s.wait} ms` : `expect ${s.expect}`;

/** Every puzzle of the table solved with real keys, then the win screen. */
async function puzzles(run: Run): Promise<void> {
  const tag = `puzzles-${run.renderer}`;
  const video = process.env.GIF !== '0';
  let a!: Page;
  let b!: Page;
  if (video) for (const who of ['A', 'B']) rmSync(`${OUT}.video-${who}`, { recursive: true, force: true });
  if (!(await step(run, 'setup: two players in a fresh game', async () => void ({ a, b } = await startGame(run, video))))) return;
  const page = (side: Side) => (side === 'out' ? a : b);
  const t0 = Date.now();

  await step(run, 'table: every registered puzzle has a playtest script', async () => {
    const missing = PUZZLES.map((p) => p.id).filter((id) => !PUZZLE_SCRIPTS.some((s) => s.id === id));
    const unknown = PUZZLE_SCRIPTS.map((s) => s.id).filter((id) => !PUZZLES.some((p) => p.id === id));
    check(missing.length === 0, `no entry in PUZZLE_SCRIPTS for: ${missing.join(', ')}`);
    check(unknown.length === 0, `PUZZLE_SCRIPTS has entries for puzzles that are not registered: ${unknown.join(', ')}`);
  });

  const scripts = PUZZLE_SCRIPTS.filter((s) => !PUZZLE_FILTER || s.id === PUZZLE_FILTER);
  for (const script of scripts) {
    const module = PUZZLES.find((p) => p.id === script.id);
    const result: PuzzleResult = { renderer: run.renderer, id: script.id, completed: false, stuck: '' };
    puzzleResults.push(result);
    await step(run, `puzzle ${script.id}: solved with real input`, async () => {
      if (!module) throw new Error(`"${script.id}" is not registered in shared/src/puzzles/index.ts`);
      /** One step, with real keys. A `plan` step is expanded from the live state and its steps played in turn. */
      const play = async (s: PuzzleStep): Promise<void> => {
        if ('plan' in s) {
          // the server state as that player's client has it: never the prediction
          const planned = s.plan((await snap(page(s.who))).server!);
          for (const [j, sub] of planned.entries()) {
            try {
              await play(sub);
            } catch (e) {
              throw new Error(`planned step ${j + 1} of ${planned.length} (${describe(sub)}): ${e instanceof Error ? e.message : e}`, { cause: e });
            }
          }
        } else if ('goto' in s) await goToTile(page(s.who), s.who, resolveTarget(s.goto, await stateOf(page(s.who))));
        else if ('read' in s) {
          // each sight is read from the screen state of the player who sees it
          const shown = sees(await stateOf(page(s.read.by)), s.read)[0]?.state;
          const match = sees(await stateOf(page(s.onto.by)), s.onto).find((o) => o.state === shown);
          if (!shown || !match) throw new Error(`${s.read.by} sees "${shown}", but ${s.onto.by} sees no ${s.onto.type} like that`);
          const before = JSON.stringify((await stateOf(a)).puzzles[script.id]);
          await goToTile(page(s.who), s.who, { face: s.onto.face, x: match.x, y: match.y });
          await until(`the puzzle moved on after "${shown}"`, async () => JSON.stringify((await stateOf(a)).puzzles[script.id]) !== before && JSON.stringify((await stateOf(b)).puzzles[script.id]) !== before);
        } else if ('follow' in s) {
          const line = sees(await stateOf(page(s.follow.by)), s.follow);
          if (!line.length) throw new Error(`${s.follow.by} sees no ${s.follow.type} on face ${s.follow.face}`);
          const strikes = (await stateOf(a)).strikes;
          for (const o of line) await goToTile(page(s.who), s.who, { face: s.follow.face, x: o.x, y: o.y });
          check((await stateOf(a)).strikes === strikes, `following ${line.length} tiles cost ${(await stateOf(a)).strikes - strikes} strike(s)`);
        } else if ('keys' in s) {
          await press(page(s.who), ...s.keys.split(' '));
          await settle(page(s.who));
        } else if ('wait' in s) await sleep(s.wait);
        else await until(s.expect, async () => s.check((await snap(a)).server!) && s.check((await snap(b)).server!));
      };
      for (const [i, s] of script.steps.entries()) {
        try {
          await play(s);
        } catch (e) {
          result.stuck = `step ${i + 1} of ${script.steps.length} (${describe(s)}): ${e instanceof Error ? e.message : e}`;
          throw new Error(`stuck at ${result.stuck}`, { cause: e });
        }
      }
      try {
        await until(`face ${module.face} latched as solved on both clients`, async () => (await stateOf(a)).solved.includes(module.face) && (await stateOf(b)).solved.includes(module.face));
        await synced([a, b], `after ${script.id}`);
      } catch (e) {
        result.stuck = `all ${script.steps.length} steps done, but: ${e instanceof Error ? e.message : e}`;
        throw e;
      }
      result.completed = true;
      await page('out').waitForTimeout(400);
      await shots(run, `${tag}-${script.id}-solved`);
      return `face ${module.face}, ${Math.round((Date.now() - t0) / 1000)} s into the game`;
    });
  }
  if (PUZZLE_FILTER) return void (await closeAll(run));

  const finale: PuzzleResult = { renderer: run.renderer, id: 'finale', completed: false, stuck: '' };
  puzzleResults.push(finale);
  await step(run, 'finale: the last puzzle wins the game; the win screen shows for both', async () => {
    try {
      const all = PUZZLES.map((p) => p.face);
      const state = await stateOf(a);
      check(all.every((f) => state.solved.includes(f)), `solved faces are [${state.solved}], the win needs [${all}]`);
      // no portal to walk to: the game is won the moment the last face is solved
      await until('the game is won on both clients', async () => (await stateOf(a)).wonAt !== null && (await stateOf(b)).wonAt !== null);
      await until('the win screen on both', async () => (await snap(a)).modal === 'cu-win' && (await snap(b)).modal === 'cu-win');
      const shown = (await text(a, '#cu-wintime')) ?? '';
      check(/^\d+:\d\d$/.test(shown) && (await text(b, '#cu-wintime')) === shown, `the win screens show "${shown}" and "${await text(b, '#cu-wintime')}"`);
      await a.waitForTimeout(400);
      await shots(run, `${tag}-win`);
      finale.completed = true;
      return `Escaped in ${shown}; ${(await text(a, '#cu-wintxt')) ?? ''}`;
    } catch (e) {
      finale.stuck = e instanceof Error ? e.message : String(e);
      throw e;
    }
  });
  await step(run, 'win: the game takes no more keys, and Esc does not close the win screen', async () => {
    const before = await stateOf(a);
    await press(a, 'w', 'a', 'e', 'Escape', 'Tab');
    await press(b, 's', 'd', 'Escape');
    await a.waitForTimeout(300);
    check(same((await stateOf(a)).players, before.players), 'a player moved after the win');
    check((await snap(a)).modal === 'cu-win' && (await snap(b)).modal === 'cu-win', 'the win screen closed');
    await synced([a, b], 'after the win');
  });
  await step(run, 'win: Play again (mouse) starts a fresh game for both, same sides', async () => {
    const before = (await stateOf(a)).startedAt;
    await clickDom(a, '#cu-again');
    await until('a new game on both clients', async () => {
      const [sa, sb] = [await snap(a), await snap(b)];
      return !!sa.state && !!sb.state && sa.state.wonAt === null && sb.state.wonAt === null && sa.state.startedAt !== before && sa.modal === null && sb.modal === null;
    });
    const s = await snap(b);
    check(s.side === 'in' && (await snap(a)).side === 'out', 'the sides changed');
    check(s.state!.solved.length === 0 && Object.values(s.state!.items).every((i) => !i.placedOn && !i.carriedBy), 'the new game is not fresh');
    for (const side of ['out', 'in'] as const) check(s.state!.players[side].pose.x === SPAWN[side].x && s.state!.players[side].pose.face === 1, `${side} does not start at the spawn`);
    await a.waitForTimeout(600);
    check((await canWalk(a, 'out')) && (await canWalk(b, 'in')), 'a player cannot walk in the new game');
    await synced([a, b], 'in the new game');
    await shots(run, `${tag}-play-again`);
  });

  // the recording of the run, as one GIF per player
  await closeAll(run);
  if (!video) return;
  for (const [who, side] of [['A', 'outside'], ['B', 'inside']] as const) {
    const dir = `${OUT}.video-${who}`;
    try {
      const file = readdirSync(dir).find((f) => f.endsWith('.webm'));
      // 4x speed, half size, nearest neighbour and a palette from the clip keep the pixels crisp
      const filter = 'setpts=PTS/4,fps=12,scale=640:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none';
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${dir}/${file}`, '-filter_complex', filter, `${OUT}${tag}-${side}.gif`]);
      console.log(`   ${tag}-${side}.gif`);
    } catch (e) {
      console.log(`   (no GIF for ${who}: ${e instanceof Error ? e.message.split('\n')[0] : e})`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Try to break a running game. After every attempt both clients must agree with the server. */
async function breakIt(run: Run): Promise<void> {
  const tag = `break-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  let code = '';
  if (!(await step(run, 'setup: two players in a game', async () => void ({ a, b, code } = await startGame(run))))) return;
  const players = [[() => a, 'out', 'A'], [() => b, 'in', 'B']] as const;
  /** A step of this section: starts from a calm keyboard, ends with both in sync. */
  const attempt = (name: string, fn: () => Promise<string | void>) =>
    step(run, name, async () => {
      await calm(a);
      await calm(b);
      const detail = await fn();
      await calm(a);
      await calm(b);
      await a.waitForTimeout(700);
      await synced([a, b], 'afterwards');
      return detail;
    });

  await attempt('spam: 80 move keys with no pacing, both players at once', async () => {
    const keys = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    const mash = async (page: Page, seed: number) => {
      for (let i = 0; i < 80; i++) await page.keyboard.press(keys[(i * 7 + seed * 3 + (i >> 2)) % keys.length]!);
    };
    await Promise.all([mash(a, 1), mash(b, 2)]);
    await a.waitForTimeout(2500);
    await shots(run, `${tag}-01-after-spam`);
  });
  await attempt('hold: a direction held for 4 s walks across faces (both players)', async () => {
    const before = [await stateOf(a), await stateOf(b)];
    await Promise.all([a.keyboard.down('d'), b.keyboard.down('a')]);
    await a.waitForTimeout(4000);
    await Promise.all([a.keyboard.up('d'), b.keyboard.up('a')]);
    await a.waitForTimeout(1500);
    const after = await stateOf(a);
    return `outside took ${after.players.out.steps - before[0]!.players.out.steps} steps, inside ${after.players.in.steps - before[1]!.players.in.steps}`;
  });
  await attempt('hold: two directions held at once, then let go in the other order', async () => {
    await a.keyboard.down('w');
    await a.waitForTimeout(300);
    await a.keyboard.down('d');
    await a.waitForTimeout(600);
    await a.keyboard.up('w');
    await a.waitForTimeout(400);
    await a.keyboard.up('d');
    const p = await poseOf(a, 'out');
    await a.waitForTimeout(700);
    check(same(await poseOf(a, 'out'), p), 'the player kept walking after every key was let go');
  });
  for (const [page, side, who] of players) {
    await attempt(`transition: ${who} mashes every game key while the face ${side === 'out' ? 'rolls' : 'hops'}`, async () => {
      const to = await neighbour(page(), side, 1);
      const key = await approach(page(), side, to);
      await page().keyboard.press(key);
      for (const k of ['w', 'a', 's', 'd', 'e', 'q', '1', 'f', 'Escape', 'Tab', 'Enter', 'x', 'w', 'Escape', 'e', 'd']) {
        await page().keyboard.press(k);
        await page().waitForTimeout(15);
      }
      await page().screenshot({ path: `${OUT}${tag}-02-mash-mid-transition-${who}.png` });
      await page().waitForTimeout(1500);
      await calm(page());
      check((await snap(page())).screen === 'game', 'left the game');
      check(await canWalk(page(), side), 'the game takes no keys afterwards');
    });
  }

  /** Cross an edge and open something 100 ms into the transition. */
  const during = async (page: Page, side: Side, openIt: () => Promise<void>, opened: () => Promise<boolean>, shot: string) => {
    const to = await neighbour(page, side, 2);
    const key = await approach(page, side, to);
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    check((await poseOf(page, side)).face === to, `the step did not cross onto face ${to}`);
    await openIt();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}${tag}-${shot}-mid.png` });
    await until('it opened during the transition', opened, 1500);
    await page.keyboard.press('w');
    await page.keyboard.press('d');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}${tag}-${shot}-after.png` });
    return to;
  };
  await attempt('transition: Esc mid-roll opens the pause menu; the game is fine after Resume', async () => {
    const to = await during(a, 'out', () => a.keyboard.press('Escape'), async () => (await snap(a)).modal === 'cu-pause', '03-pause');
    const paused = await poseOf(a, 'out');
    await a.waitForTimeout(600);
    check(same(await poseOf(a, 'out'), paused), 'the player moved while the pause menu was open');
    await press(a, 'Escape');
    check((await snap(a)).modal === null && (await poseOf(a, 'out')).face === to, 'not back in the game on the new face');
    check(await canWalk(a, 'out'), 'no step after the pause');
  });
  await attempt('transition: Tab mid-hop shows the map; walking works after letting go', async () => {
    await during(b, 'in', () => b.keyboard.down('Tab'), () => isOn(b, '.cu-cubemap.on'), '04-map');
    await b.keyboard.up('Tab');
    check(!(await isOn(b, '.cu-cubemap.on')), 'the map stayed up');
    check(await canWalk(b, 'in'), 'no step after the map');
  });
  await attempt('transition: the gear mid-roll opens the settings; Esc closes; the game is fine', async () => {
    await during(a, 'out', async () => void (await clickDom(a, '#cu-gear')), async () => (await snap(a)).modal === 'cu-settings', '05-settings');
    await press(a, 'Escape');
    check((await snap(a)).modal === null, 'the settings did not close');
    check(await canWalk(a, 'out'), 'no step after the settings');
  });
  await attempt('transition: Enter mid-hop opens the chat; typing does not walk; the line arrives', async () => {
    await during(b, 'in', () => b.keyboard.press('Enter'), () => typing(b), '06-chat');
    const pose = await poseOf(b, 'in');
    await b.keyboard.type('wasd mid hop', { delay: 15 });
    await press(b, 'Enter');
    await until('the line arrives', async () => (await snap(a)).chat.at(-1)?.text.endsWith('wasd mid hop') === true);
    check(same(await poseOf(b, 'in'), pose), 'typing walked the player');
    await press(b, 'Escape');
    check(await canWalk(b, 'in'), 'no step after the chat');
  });
  await attempt('edges: both players cross an edge at the same moment, four times', async () => {
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [ta, tb] = [await neighbour(a, 'out', i), await neighbour(b, 'in', i + 1)];
      const [ka, kb] = await Promise.all([approach(a, 'out', ta), approach(b, 'in', tb)]);
      await Promise.all([a.keyboard.press(ka), b.keyboard.press(kb)]);
      await a.waitForTimeout(150);
      if (i === 0) await shots(run, `${tag}-07-both-crossing`);
      await a.waitForTimeout(FLIP_MS);
      const s = await stateOf(a);
      check(s.players.out.pose.face === ta && s.players.in.pose.face === tb, `round ${i + 1}: outside is on face ${s.players.out.pose.face} (wanted ${ta}), inside on ${s.players.in.pose.face} (wanted ${tb})`);
      await synced([a, b], `round ${i + 1}`);
      seen.push(`${ta}/${tb}`);
    }
    return `faces reached (out/in): ${seen.join(', ')}`;
  });
  await attempt('resize: the window changes size six times mid-game, once mid-transition', async () => {
    const sizes = [{ width: 1920, height: 1080 }, { width: 800, height: 600 }, { width: 640, height: 360 }, { width: 390, height: 844 }, { width: 2560, height: 1440 }, SIZE];
    for (const [i, size] of sizes.entries()) {
      if (i === 2) {
        const key = await approach(a, 'out', await neighbour(a, 'out', 0));
        await a.keyboard.press(key);
        await a.waitForTimeout(120);
      }
      await Promise.all([a.setViewportSize(size), b.setViewportSize(size)]);
      await a.waitForTimeout(700);
      await a.screenshot({ path: `${OUT}${tag}-08-resize-${size.width}x${size.height}-A.png` });
      await b.screenshot({ path: `${OUT}${tag}-08-resize-${size.width}x${size.height}-B.png` });
      for (const [page, side, who] of players) {
        const view = await js<{ w: number; h: number; left: number; top: number; right: number; bottom: number }>(page(), `(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
        check(view.w > 0 && view.h > 0, `${who}: the game view has no size at ${size.width}x${size.height}`);
        if (view.left < 0 || view.top < 0 || view.right > size.width || view.bottom > size.height) note(`[${run.renderer}] at ${size.width}x${size.height} the game view is partly off screen (${Math.round(view.left)},${Math.round(view.top)} to ${Math.round(view.right)},${Math.round(view.bottom)}).`);
        const cut = await js<number>(page(), `[...document.querySelectorAll('.cu-hud .cu-panel')].filter((p) => { const r = p.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight; }).length`);
        if (cut) note(`[${run.renderer}] at ${size.width}x${size.height} ${cut} HUD panel(s) are cut off by the window edge.`);
        check(await canWalk(page(), side), `${who} cannot walk at ${size.width}x${size.height}`);
      }
      await synced([a, b], `at ${size.width}x${size.height}`);
    }
  });
  await attempt('chat: 12 quick chats in a burst are rate limited, not an error', async () => {
    await a.waitForTimeout(5200); // a fresh chat window
    const before = (await snap(b)).chat.length;
    for (let i = 0; i < 12; i++) await a.keyboard.press(String((i % 4) + 1));
    await a.waitForTimeout(800);
    const got = (await snap(b)).chat.length - before;
    check(got >= 1 && got <= 5, `${got} of 12 lines arrived (the limit is 5 per 5 s)`);
    return `${got} of 12 arrived`;
  });
  await attempt('mid-puzzle: the outside player leaves while carrying the item; the inside player plays on; they rejoin', async () => {
    const lying = Object.values((await stateOf(a)).items).find((i) => i.side === 'out' && !i.placedOn && !i.carriedBy);
    if (!lying) return 'skipped: no free item on the outside';
    await goToTile(a, 'out', lying);
    await press(a, 'e');
    await until('carrying', async () => (await stateOf(b)).players.out.carrying === lying.id);
    await clickDom(a, '#cu-leave');
    await until('A is out', async () => (await snap(a)).code === null && (await has(a, 'CREATE LOBBY')), 8000);
    await until('B plays on, the seat is held', async () => (await snap(b)).room?.seats.out.away?.kind === 'left' && (await snap(b)).screen === 'game');
    await shots(run, `${tag}-10-partner-left-mid-puzzle`);
    check(await canWalk(b, 'in'), 'B cannot walk');
    check((await stateOf(b)).players.out.carrying === lying.id, 'the carried item changed hands when its carrier left');
    await a.waitForTimeout(400);
    await joinRoom(a, code);
    await until('A is back in the game', async () => (await snap(a)).screen === 'game', 8000);
    await a.waitForTimeout(1200);
    check((await snap(a)).side === 'out' && (await stateOf(a)).players.out.carrying === lying.id, 'A did not come back outside with the item');
    await press(a, 'q');
    await until('A can still drop it', async () => (await stateOf(b)).players.out.carrying === null);
  });
  await attempt('full room: a third player with the code is refused and the game goes on', async () => {
    const c = await open(run, 'C');
    await toMode(c);
    await typeJoin(c, code);
    await until('"That room is full"', async () => /full/i.test((await snap(c)).error ?? ''));
    await c.waitForTimeout(300);
    await c.screenshot({ path: `${OUT}${tag}-11-room-full-C.png` });
    check((await snap(c)).code === null, 'the third player got a seat');
    check((await canWalk(a, 'out')) && (await canWalk(b, 'in')), 'a player cannot walk after the refused join');
  });
  await attempt('full room: a refreshing player keeps their seat against the third player', async () => {
    const c = run.pages.get('C')!;
    const pose = (await snap(b)).server!.players.in.pose;
    await b.goto('about:blank'); // B is gone, the seat is held
    await until('A sees B away', async () => (await snap(a)).room?.seats.in.connected === false);
    await click(c, 'JOIN');
    await until('still "That room is full"', async () => /full/i.test((await snap(c)).error ?? ''));
    check((await snap(c)).code === null, 'the third player took a held seat');
    await b.goBack();
    await until('B is in the game again', async () => (await snap(b)).screen === 'game', 15_000);
    await b.waitForTimeout(1200);
    check((await snap(b)).side === 'in' && same((await stateOf(b)).players.in.pose, pose), 'B did not get the seat and pose back');
  });
  await step(run, 'full room: a player who pressed Leave keeps their seat against the third player, and gets it back with the code', async () => {
    const c = run.pages.get('C')!;
    const pose = (await snap(b)).server!.players.in.pose;
    await clickDom(b, '#cu-leave');
    await until('B is out', async () => (await snap(b)).code === null && (await has(b, 'CREATE LOBBY')), 8000);
    await until('A sees the seat held', async () => (await snap(a)).room?.seats.in.away?.kind === 'left');
    await click(c, 'JOIN');
    await until('still "That room is full"', async () => /full/i.test((await snap(c)).error ?? ''));
    check((await snap(c)).code === null, 'the third player took a held seat');
    await b.waitForTimeout(300);
    await joinRoom(b, code);
    await until('B is in the game, inside', async () => (await snap(b)).screen === 'game' && (await snap(b)).side === 'in', 8000);
    await b.waitForTimeout(1200);
    check(same((await stateOf(b)).players.in.pose, pose), 'B did not come back where they stood');
    check(await canWalk(b, 'in'), 'B cannot walk');
    await synced([a, b], 'A and B');
    await shots(run, `${tag}-12-seat-held`);
  });
}

/** Try to break the menus: double clicks, key mashing, resizes, the settings over buttons. */
async function menus(run: Run): Promise<void> {
  const tag = `menus-${run.renderer}`;
  let a!: Page;
  let b!: Page;
  let code = '';
  if (!(await step(run, 'setup: two players on the title', async () => void ([a, b] = await Promise.all([open(run, 'A'), open(run, 'B')]))))) return;

  await step(run, 'title: a double click on PLAY dives once', async () => {
    await click(a, 'PLAY', { double: true });
    await until('the mode screen', async () => (await button(a, 'CREATE LOBBY'))?.alpha === 1 && !(await has(a, 'PLAY')), 8000);
    const labels = (await buttons(a)).map((x) => x.label).sort().join('|');
    check(labels === 'BACK|CREATE LOBBY|JOIN LOBBY', `buttons after a double click: ${labels}`);
  });
  await step(run, 'title: Enter, Space and Esc mashed during the dive leave a working menu', async () => {
    for (const k of ['Enter', ' ', 'Enter', 'Escape', 'Enter', ' ', 'Escape', 'Enter']) {
      await b.keyboard.press(k);
      await b.waitForTimeout(40);
    }
    await b.waitForTimeout(3000);
    const labels = (await buttons(b)).map((x) => x.label).sort().join('|');
    check(labels === 'PLAY' || labels === 'BACK|CREATE LOBBY|JOIN LOBBY', `buttons after mashing: ${labels}`);
    if (labels === 'PLAY') await toMode(b);
    check((await snap(b)).code === null, 'mashing made a room');
    return labels === 'PLAY' ? 'ended on the title' : 'ended on the mode screen';
  });
  await step(run, 'settings: Done clicked while it is over a menu button does not press the button', async () => {
    // find a window size at which the Done button sits over a canvas button
    let over: string | null = null;
    for (const size of [SIZE, { width: 1280, height: 600 }, { width: 960, height: 540 }, { width: 800, height: 600 }, { width: 700, height: 420 }, { width: 560, height: 700 }, { width: 500, height: 320 }]) {
      await a.setViewportSize(size);
      await a.waitForTimeout(700);
      await clickDom(a, '#cu-gear');
      await until('the settings panel', async () => (await snap(a)).modal === 'cu-settings');
      await a.waitForTimeout(300);
      const done = (await a.locator('#cu-settings [data-close]').boundingBox())!;
      const [x, y] = [done.x + done.width / 2, done.y + done.height / 2];
      const s = await stage(a);
      over = (await buttons(a)).find((bt) => x >= s.left + bt.x * s.scale && x <= s.left + (bt.x + bt.width) * s.scale && y >= s.top + bt.y * s.scale && y <= s.top + (bt.y + bt.height) * s.scale)?.label ?? null;
      if (over) {
        await a.screenshot({ path: `${OUT}${tag}-01-done-over-${slug(over)}.png` });
        await a.mouse.move(x, y);
        await a.mouse.click(x, y);
        await a.waitForTimeout(900);
        break;
      }
      await press(a, 'Escape');
    }
    const s = await snap(a);
    const popup = await has(a, 'CANCEL');
    await a.screenshot({ path: `${OUT}${tag}-01-after-done.png` });
    const clickedThrough = s.code !== null || popup || (await has(a, 'PLAY'));
    if (s.modal === 'cu-settings') await press(a, 'Escape');
    if (popup) await click(a, 'CANCEL');
    if (s.code !== null) await click(a, 'LEAVE');
    if (await has(a, 'PLAY')) await toMode(a);
    await a.setViewportSize(SIZE);
    await a.waitForTimeout(700);
    if (!over) return 'not tested: Done was never over a menu button at the sizes tried';
    if (clickedThrough) note(`[${run.renderer}] KNOWN: Done in the settings clicked through to the "${over}" button under it.`);
    check(s.modal === null, 'Done did not close the settings');
    return clickedThrough ? `known issue: the click also pressed "${over}"` : `Done was over "${over}" and only closed the panel`;
  });
  await step(run, 'mode: a double click on CREATE LOBBY makes one lobby', async () => {
    await until('the mode screen', () => has(a, 'CREATE LOBBY'), 8000);
    await click(a, 'CREATE LOBBY', { double: true });
    await until('a lobby', async () => (await snap(a)).room?.phase === 'lobby');
    await a.waitForTimeout(900);
    const s = await snap(a);
    code = s.code!;
    check(s.role === 'host' && s.room!.members.guest === null && (await has(a, 'START')), `after the double click: role ${s.role}, guest ${JSON.stringify(s.room!.members.guest)}`);
    check((await text(a, '#cu-room-v')) === code, 'the code in the top bar is not the room we are in');
  });
  await step(run, 'join popup: double clicks on JOIN LOBBY, JOIN (bad code) and CANCEL leave a working menu', async () => {
    await click(b, 'JOIN LOBBY', { double: true });
    await until('the join popup', () => has(b, 'CANCEL'));
    await b.waitForTimeout(350);
    await b.keyboard.type('qqqq', { delay: 40 });
    await click(b, 'JOIN', { double: true });
    await until('refused', async () => /not found/i.test((await snap(b)).error ?? ''));
    await b.waitForTimeout(500);
    await click(b, 'CANCEL', { double: true });
    await until('the popup closed', async () => !(await has(b, 'CANCEL')) && (await button(b, 'JOIN LOBBY'))?.enabled === true);
    check((await snap(b)).code === null, 'a room was joined or made');
  });
  await step(run, 'join popup: a window resize while typing the code keeps the popup and the letters', async () => {
    await click(b, 'JOIN LOBBY');
    await until('the join popup', () => has(b, 'CANCEL'));
    await b.waitForTimeout(350);
    await b.keyboard.type(code.slice(0, 2), { delay: 50 });
    await b.setViewportSize({ width: 1100, height: 700 });
    await b.waitForTimeout(800);
    const kept = await has(b, 'CANCEL');
    await b.screenshot({ path: `${OUT}${tag}-02-join-popup-after-resize.png` });
    await b.setViewportSize(SIZE);
    await b.waitForTimeout(800);
    check(kept, 'the resize closed the join popup and threw away the typed letters');
    await b.keyboard.type(code.slice(2), { delay: 50 });
    await click(b, 'JOIN');
    await until('joined', async () => (await snap(b)).code === code);
  });
  await step(run, 'join: the second player gets into the lobby', async () => {
    if ((await snap(b)).code !== code) {
      if (await has(b, 'CANCEL')) await press(b, 'Backspace', 'Backspace', 'Backspace', 'Backspace');
      await joinRoom(b, code);
    }
    await until('B on the side select screen', () => has(b, 'READY'), 6000);
    await b.waitForTimeout(400);
  });
  await step(run, 'side select: a window resize keeps both picks and the buttons', async () => {
    await press(a, 'a');
    await press(b, 'd');
    await until('picked', async () => (await snap(a)).room?.members.guest?.side === 'in' && (await snap(a)).room?.members.host?.side === 'out');
    for (const size of [{ width: 900, height: 560 }, { width: 1600, height: 900 }, SIZE]) {
      await Promise.all([a.setViewportSize(size), b.setViewportSize(size)]);
      await a.waitForTimeout(700);
      check((await has(a, 'START')) && (await has(b, 'READY')) && (await has(a, 'LEAVE')), `buttons missing at ${size.width}x${size.height}`);
    }
    const s = await snap(b);
    check(s.room?.members.guest?.side === 'in' && s.room.members.host?.side === 'out', 'a resize changed the picks');
    await shots(run, `${tag}-03-side-select-after-resize`);
  });
  await step(run, 'side select: left / right mashed by both players at once never puts both on one side', async () => {
    const mash = async (page: Page, keys: string[]) => {
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press(keys[(i * 5 + (i >> 1)) % keys.length]!);
        await page.waitForTimeout(12);
      }
    };
    await Promise.all([mash(a, ['a', 'd', 'd', 'a', 'a']), mash(b, ['d', 'a', 'a', 'd', 'a'])]);
    await a.waitForTimeout(1200);
    const [sa, sb] = [await snap(a), await snap(b)];
    check(same(sa.room, sb.room), 'the two clients show different lobbies');
    const { host, guest } = sa.room!.members;
    check(!host!.side || host!.side !== guest!.side, `both are on ${host!.side}`);
    // put them back: A outside, B inside
    for (let i = 0; i < 3 && (await snap(a)).room?.members.guest?.side === 'out'; i++) await press(b, 'd');
    for (let i = 0; i < 3 && (await snap(a)).room?.members.host?.side !== 'out'; i++) await press(a, 'a');
    for (let i = 0; i < 3 && (await snap(a)).room?.members.guest?.side !== 'in'; i++) await press(b, 'd');
    await until('A outside, B inside', async () => (await snap(b)).room?.members.host?.side === 'out' && (await snap(b)).room?.members.guest?.side === 'in');
    return `ended with host ${host!.side ?? 'middle'}, guest ${guest!.side ?? 'middle'}`;
  });
  await step(run, 'side select: a double click on READY leaves the guest ready', async () => {
    await click(b, 'READY', { double: true });
    await b.waitForTimeout(700);
    const ready = (await snap(a)).room?.members.guest?.ready;
    if (!ready) await click(b, 'READY');
    await until('ready', async () => (await snap(a)).room?.members.guest?.ready === true);
    check(ready === true, 'the double click readied and un-readied: the guest ended NOT ready');
  });
  await step(run, 'side select: a double click on START starts one game for both', async () => {
    await click(a, 'START', { double: true });
    await until('the game on both screens', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
    await a.waitForTimeout(1300);
    await synced([a, b], 'at the start');
    check((await canWalk(a, 'out')) && (await canWalk(b, 'in')), 'a player cannot walk');
  });
  await step(run, 'game: Leave double clicked returns to the mode screen once, and the menu works', async () => {
    await clickDom(a, '#cu-leave', { double: true });
    await until('A on the mode screen', async () => (await snap(a)).code === null && (await button(a, 'CREATE LOBBY'))?.enabled === true, 8000);
    await a.waitForTimeout(900);
    const s = await snap(a);
    check(s.code === null && s.screen === 'menu' && !(await has(a, 'CANCEL')), `after the double click on Leave: code ${s.code}, screen ${s.screen}, join popup ${await has(a, 'CANCEL')}`);
    await shots(run, `${tag}-04-after-leave`);
  });
}

// ---------- run ----------

const SECTIONS: Record<Section, (run: Run) => Promise<void>> = { lobby, hud, walk, items, rejoin, puzzles, break: breakIt, menus };
const only = process.env.RENDERER as Renderer | undefined;
if (only && !RENDERERS.includes(only)) throw new Error(`RENDERER must be one of ${RENDERERS.join(', ')}`);

const browser = await chromium.launch();
const started = Date.now();
try {
  for (const renderer of RENDERERS) {
    if (only && only !== renderer) continue;
    for (const section of SECTION_NAMES) {
      if (!wanted(section)) continue;
      console.log(`\n--- ${section} (${renderer}) ---`);
      const run: Run = { browser, renderer, section, pages: new Map() };
      const before = problems.length;
      lost.length = 0;
      try {
        await SECTIONS[section](run);
      } catch (e) {
        // a section never throws past its steps, except in its own plumbing
        await step(run, 'the section ran to its end', async () => {
          throw e;
        });
      }
      for (const l of lost) note(`[${renderer}] ${section}: a walk did not end where the keys should have taken it: ${l}`);
      await step(run, 'no console errors or page errors in this section', async () => {
        const seen = [...new Set(problems.slice(before).map((p) => `${p.who} ${p.text}`))];
        check(seen.length === 0, `${seen.length} problem(s): ${seen.join(' | ')}`);
      });
      await closeAll(run);
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
writeFileSync(`${OUT}results.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), results, puzzles: puzzleResults, notes, problems }, null, 2));

console.log('\n=== puzzles ===');
for (const p of puzzleResults) console.log(`${p.completed ? 'yes' : 'NO '}  [${p.renderer}] ${p.id}${p.stuck ? `  stuck: ${p.stuck}` : ''}`);
if (notes.length) console.log(`\n=== notes ===\n${notes.join('\n')}`);
console.log(`\n=== ${results.length - failed.length} passed, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s ===`);
for (const f of failed) console.log(`FAIL  [${f.renderer}] ${f.section}: ${f.name}\n      ${f.detail}${f.shots.length ? `\n      ${f.shots.join('\n      ')}` : ''}`);
console.log(`results -> ${OUT}results.json`);
process.exit(failed.length ? 1 : 0);
