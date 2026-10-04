// HELPERS FOR THE SCREENSHOT SCRIPTS THAT PLAY A REAL TWO-PLAYER GAME (screens/cubes.ts,
// screens/submission.ts). The same approach as screens/faces.ts, as a module: nothing runs
// when it is imported. Menus are clicked like a player would, the game is played with real
// keys, and the page is only ever read (window.__cubic, dev builds).
import type { Browser, Page } from 'playwright';
import { STEP_MS as PACE_MS, defaultEnv, findPath, stepPose, visibleObjects, type FaceId, type GameState, type Move, type Pose, type Side, type TileRef } from '../../shared/src/index';

/** The wait after a key tap: one step of the walking pace (shared/src/pace.ts), so the scripts follow the knob. */
export const STEP_MS = PACE_MS;
export const FLIP_MS = 650;
/** The face whose lava is deadly while face 5 is solved and it is not. */
export const LAVA: FaceId = 6;

export interface Snap {
  online: boolean;
  code: string | null;
  side: Side | null;
  state: GameState | null;
  pending: number;
  screen: string;
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const js = <T>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;

export async function until(what: string, cond: () => Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await sleep(60);
  }
}

export const snap = (page: Page) =>
  js<Snap>(
    page,
    `(() => {
      const c = window.__cubic;
      return { online: c.online, code: c.code, side: c.side, state: c.state, pending: c.pending.length, screen: document.querySelector('.cu')?.dataset.screen ?? '' };
    })()`,
  );
const buttons = (page: Page) => js<ButtonProbe[]>(page, `typeof window.__cubicButtons === 'function' ? window.__cubicButtons() : []`);
const button = async (page: Page, label: string) => (await buttons(page)).find((b) => b.label === label) ?? null;
export const has = async (page: Page, label: string) => !!(await button(page, label));
export const stateOf = async (page: Page): Promise<GameState> => {
  const s = (await snap(page)).state;
  if (!s) throw new Error('not in a game');
  return s;
};

export async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(STEP_MS);
  }
}

/** Click a menu button (the Phaser stage) by its label, once it can be clicked. */
export async function click(page: Page, label: string): Promise<void> {
  await until(`a "${label}" button that can be clicked`, async () => {
    const b = await button(page, label);
    return !!b && b.enabled && b.alpha >= 0.99;
  }, 8000);
  const b = (await button(page, label))!;
  const s = await js<{ left: number; top: number; scale: number }>(
    page,
    `(() => { const c = document.querySelector('#cu-stage canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, scale: r.width / c.width }; })()`,
  );
  const [x, y] = [s.left + (b.x + b.width / 2) * s.scale, s.top + (b.y + b.height / 2) * s.scale];
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
}

/** A new page on the title screen, connected. `query` is added to the URL (e.g. `?renderer=canvas`). */
export async function openTitle(browser: Browser, base: string, size: { width: number; height: number }, query = '?renderer=canvas'): Promise<Page> {
  const page = await (await browser.newContext({ viewport: size })).newPage();
  await page.goto(`${base}/${query}`);
  await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
  await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
  return page;
}

/** PLAY: from the title to the mode screen. */
export async function toMode(page: Page): Promise<void> {
  await click(page, 'PLAY');
  await until('the mode screen', async () => {
    const b = await button(page, 'CREATE LOBBY');
    return !!b && b.enabled && b.alpha >= 0.99 && !(await has(page, 'PLAY'));
  }, 8000);
}

/** Both on the side select screen of one lobby: A (host) has picked outside, B inside, B is ready. */
export async function toLobby(a: Page, b: Page): Promise<void> {
  await click(a, 'CREATE LOBBY');
  await until('the side select screen', () => has(a, 'LEAVE'), 6000);
  const code = (await snap(a)).code!;
  await click(b, 'JOIN LOBBY');
  await until('the join popup', () => has(b, 'CANCEL'));
  await b.waitForTimeout(350);
  await b.keyboard.type(code, { delay: 50 });
  await b.waitForTimeout(150);
  await click(b, 'JOIN');
  await until('B on the side select screen', () => has(b, 'READY'), 6000);
  await press(a, 'a');
  await press(b, 'd');
  await until('sides picked', async () => (await snap(a)).side === 'out' && (await snap(b)).side === 'in');
  await click(b, 'READY');
}

/** START, then hints off through the settings panel: the cards and hints would cover the face. */
export async function toGame(a: Page, b: Page): Promise<void> {
  await click(a, 'START');
  await until('the game started for both', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
  await a.waitForTimeout(1300); // the fade into the game
  for (const p of [a, b]) {
    await p.locator('#cu-gear').click();
    await p.locator('#cu-settings [data-tab="access"]').click();
    await p.waitForTimeout(300);
    await p.locator('.cu-toggle[data-key="hints"]').click();
    await p.keyboard.press('Escape');
    await until('the settings panel closed', async () => !(await js<boolean>(p, `document.querySelector('#cu-settings')?.classList.contains('on') ?? false`)));
  }
  await sleep(4000); // the narrator's opening line
}

const KEY_OF: Record<string, string> = { '0,-1': 'w', '0,1': 's', '-1,0': 'a', '1,0': 'd' };
const MOVE_OF: Record<string, Move> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const onTile = (t: TileRef) => (p: Pose) => p.face === t.face && p.x === t.x && p.y === t.y;
const hot = (s: GameState) => s.solved.includes(5) && !s.solved.includes(LAVA);

/** Walking and using for the two pages of one game (A outside, B inside), planned with the game's own pathfinding. */
export function players(a: Page, b: Page) {
  const page = (side: Side) => (side === 'out' ? a : b);
  const settle = (side: Side) => until('every input acknowledged', async () => (await snap(page(side))).pending === 0, 3000);
  const state = () => stateOf(a);
  const sees = async (side: Side, face: FaceId, type: string) => visibleObjects(await stateOf(page(side)), side, face).filter((o) => o.type === type);

  async function goTo(side: Side, what: string, goal: (p: Pose) => boolean): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await settle(side);
      const s = await stateOf(page(side));
      if (goal(s.players[side].pose)) return;
      const path = findPath(s, side, goal, defaultEnv, side === 'in' && hot(s) ? (f) => f !== LAVA : undefined);
      if (!path) throw new Error(`${side}: no path to ${what}`);
      let face = s.players[side].pose.face;
      for (const m of path) {
        await page(side).keyboard.press(KEY_OF[`${m[0]},${m[1]}`]!);
        await page(side).waitForTimeout(STEP_MS);
        const now = (await stateOf(page(side))).players[side].pose.face;
        if (now !== face) await page(side).waitForTimeout(FLIP_MS);
        face = now;
      }
    }
    await settle(side);
    if (!goal((await stateOf(page(side))).players[side].pose)) throw new Error(`${side}: did not reach ${what}`);
  }
  const go = (side: Side, face: FaceId, x: number, y: number) => goTo(side, `face ${face} (${x},${y})`, onTile({ face, x, y }));
  const use = async (side: Side) => {
    await press(page(side), 'e');
    await settle(side);
  };
  /** One step onto the tile next to `side`, whichever way their screen is turned. */
  async function stepOnto(side: Side, face: FaceId, x: number, y: number): Promise<void> {
    await settle(side);
    const pose = (await stateOf(page(side))).players[side].pose;
    const key = Object.entries(MOVE_OF).find(([, m]) => onTile({ face, x, y })(stepPose(pose, m[0], m[1]).pose))?.[0];
    if (!key) throw new Error(`${side} at face ${pose.face} ${pose.x},${pose.y} is not next to face ${face} ${x},${y}`);
    await press(page(side), key);
    if (pose.face !== face) await sleep(FLIP_MS + 100);
    await settle(side);
  }
  /** Is `p` on another face, one step from this tile? */
  const beside = (t: TileRef) => (p: Pose) => p.face !== t.face && Object.values(MOVE_OF).some((m) => onTile(t)(stepPose(p, m[0], m[1]).pose));
  const solved = (face: FaceId) => until(`face ${face} solved on both clients`, async () => (await stateOf(a)).solved.includes(face) && (await stateOf(b)).solved.includes(face));
  return { page, state, sees, goTo, go, use, stepOnto, beside, solved };
}
