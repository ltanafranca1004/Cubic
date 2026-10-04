// PICTURES OF EVERY FACE, FROM BOTH SIDES: one two-player game on the Canvas renderer,
// played with real keys like the playtest (screens/playtest.ts, whose helpers are copied
// here: that file runs when imported). For each puzzle both players stand ON its face and a
// picture of each is saved before it is solved and again solved or half way.
//
//   server:  PORT=3409 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3409 npm run dev -w client -- --port 5509
//   then:    cd tools && npx tsx screens/faces.ts
//
//   BASE   client URL (default http://localhost:5509)
//   OUT    folder for the PNGs (default <repo>/docs/status/puzzles/)
//
// Files: face<N>-<out|in>-<state>.png, 1280x720. Order: 1, 3 (left one tile short), 2, 5,
// 6, 4, then the last tile of face 3: the game is won the moment the sixth face is solved,
// so whichever comes last has the win screen over it.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { STEP_MS, defaultEnv, findPath, hazardAvoid, linesOn, objectsOn, stepPose, visibleObjects, type FaceId, type GameState, type Move, type Pose, type Side, type TileRef } from '../../shared/src/index';
import { readCode } from '../../shared/src/puzzles/hiddenCode';

const BASE = process.env.BASE ?? 'http://localhost:5509';
const OUT = resolve(process.env.OUT ?? join(new URL('../../', import.meta.url).pathname, 'docs/status/puzzles')) + '/';
const SIZE = { width: 1280, height: 720 };
const FLIP_MS = 650;
const LAVA: FaceId = 6;

mkdirSync(OUT, { recursive: true });

interface Snap {
  online: boolean;
  code: string | null;
  side: Side | null;
  room: { phase: string } | null;
  state: GameState | null;
  server: GameState | null;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const js = <T>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;

async function until(what: string, cond: () => Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond().catch(() => false)) return;
    if (Date.now() > end) throw new Error(`expected: ${what}`);
    await sleep(60);
  }
}

// ---------- reading the page (never writing) ----------

const snap = (page: Page) =>
  js<Snap>(
    page,
    `(() => {
      const c = window.__cubic;
      return { online: c.online, code: c.code, side: c.side, room: c.room, state: c.state, server: c.server, pending: c.pending.length,
        screen: document.querySelector('.cu')?.dataset.screen ?? '' };
    })()`,
  );
const buttons = (page: Page) => js<ButtonProbe[]>(page, `typeof window.__cubicButtons === 'function' ? window.__cubicButtons() : []`);
const button = async (page: Page, label: string) => (await buttons(page)).find((b) => b.label === label) ?? null;
const has = async (page: Page, label: string) => !!(await button(page, label));
const stateOf = async (page: Page): Promise<GameState> => {
  const s = (await snap(page)).state;
  if (!s) throw new Error('not in a game');
  return s;
};

// ---------- real input ----------

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(STEP_MS);
  }
}

async function click(page: Page, label: string): Promise<void> {
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

// ---------- into a game: A outside (host), B inside (guest) ----------

const browser = await chromium.launch({ args: ['--mute-audio'] });

async function open(): Promise<Page> {
  const page = await (await browser.newContext({ viewport: SIZE })).newPage();
  await page.goto(`${BASE}/?renderer=canvas`);
  await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
  await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
  await click(page, 'PLAY');
  await until('the mode screen', async () => {
    const b = await button(page, 'CREATE LOBBY');
    return !!b && b.enabled && b.alpha >= 0.99 && !(await has(page, 'PLAY'));
  }, 8000);
  return page;
}

async function startGame(): Promise<{ a: Page; b: Page }> {
  const [a, b] = await Promise.all([open(), open()]);
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
  await click(a, 'START');
  await until('the game started for both', async () => (await snap(a)).screen === 'game' && (await snap(b)).screen === 'game', 8000);
  await a.waitForTimeout(1300); // the fade into the game
  return { a, b };
}

const { a, b } = await startGame();
// Hints off, through the settings panel like a player would: the side card, the controls
// strip and the context hints would cover the face in every picture.
for (const p of [a, b]) {
  await p.locator('#cu-gear').click();
  await p.locator('#cu-settings [data-tab="access"]').click();
  await p.waitForTimeout(300);
  await p.locator('.cu-toggle[data-key="hints"]').click();
  await p.keyboard.press('Escape');
  await until('the settings panel closed', async () => !(await js<boolean>(p, `document.querySelector('#cu-settings')?.classList.contains('on') ?? false`)));
}
await sleep(4000); // the narrator's opening line
const page = (side: Side) => (side === 'out' ? a : b);

// ---------- walking ----------

const KEY_OF: Record<string, string> = { '0,-1': 'w', '0,1': 's', '-1,0': 'a', '1,0': 'd' };
const MOVE_OF: Record<string, Move> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const settle = (side: Side) => until('every input acknowledged', async () => (await snap(page(side))).pending === 0, 3000);
const onTile = (t: TileRef) => (p: Pose) => p.face === t.face && p.x === t.x && p.y === t.y;
const state = () => stateOf(a);
const sees = async (side: Side, face: FaceId, type: string) => visibleObjects(await stateOf(page(side)), side, face).filter((o) => o.type === type);

/** Walk `side` to a pose accepted by `goal`, planned on the live state with the game's own pathfinding. */
async function goTo(side: Side, what: string, goal: (p: Pose) => boolean): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await settle(side);
    const s = await stateOf(page(side));
    if (goal(s.players[side].pose)) return;
    // never through a deadly tile: the lava inside face 6 is hot from the start of the game
    const path = findPath(s, side, goal, defaultEnv, undefined, hazardAvoid(s, side));
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
const objectTile = (side: Side, face: FaceId, type: string, name?: string) => {
  const o = objectsOn(defaultEnv.world, side, face, type).find((x) => name === undefined || x.name === name);
  if (!o) throw new Error(`no "${type}" on ${side} face ${face}`);
  return o;
};

// ---------- pictures ----------

const saved: string[] = [];
async function shot(face: FaceId, label: string, sides: readonly Side[] = ['out', 'in'], waitMs = 900): Promise<void> {
  await sleep(waitMs); // a face transition, a hop, a chime
  for (const side of sides) {
    const pose = (await stateOf(page(side))).players[side].pose;
    if (pose.face !== face) throw new Error(`${side} is on face ${pose.face}, not on face ${face}, for "${label}"`);
    const name = `face${face}-${side}-${label}.png`;
    await page(side).screenshot({ path: OUT + name });
    saved.push(name);
    console.log(`   ${name}`);
  }
}
const solved = (face: FaceId) => until(`face ${face} solved on both clients`, async () => (await stateOf(a)).solved.includes(face) && (await stateOf(b)).solved.includes(face));

// ---------- face 1: hidden code ----------
// Both start here, the outside player upright (drift 0): the number reads right.
console.log('face 1');
await shot(1, 'unsolved');
{
  const code = readCode(visibleObjects(await state(), 'out', 1));
  if (!code) throw new Error('the outside player sees no number on face 1');
  for (const name of [...code, 'enter']) {
    const k = objectTile('in', 1, 'key', name);
    await go('in', 1, k.x, k.y);
    await use('in');
  }
  await solved(1);
  await go('in', 1, 3, 9);
  await shot(1, 'solved');
}

// ---------- face 3: mirrored glyph (the last tile is left for the very end) ----------
console.log('face 3');
await go('out', 3, 5, 1);
await go('in', 3, 0, 0);
await shot(3, 'unsolved');
const symbol = await sees('out', 3, 'f3-glyph');
symbol.sort((p, q) => p.y - q.y || (p.y % 2 ? q.x - p.x : p.x - q.x));
const lastTile = symbol.pop()!;
for (const [i, o] of symbol.entries()) {
  await go('in', 3, o.x, o.y);
  await use('in');
  if (i === Math.floor(symbol.length / 2)) await shot(3, 'half', ['in'], 300);
}
await shot(3, 'one-short', ['in'], 300);

// ---------- face 2: equation safe ----------
console.log('face 2');
await go('out', 2, 6, 10);
await go('in', 2, 8, 7);
await shot(2, 'unsolved');
{
  const count = async (type: string) => (await sees('out', 2, type)).length;
  const answer = 3 * (await count('f2-bush')) * 2 * (await count('f2-bird')) * (await count('f2-rock'));
  for (const [i, name] of [...String(answer), 'enter'].entries()) {
    const k = (await sees('in', 2, 'key')).find((o) => o.state === name)!;
    await go('in', 2, k.x, k.y);
    await use('in');
    if (i === String(answer).length - 1) await shot(2, 'typed', ['in'], 300);
  }
  await solved(2);
  await go('in', 2, 8, 7);
  await shot(2, 'solved'); // the safe is open, the battery lies in front of it
  const battery = (await state()).items.battery!;
  await go('in', 2, battery.x, battery.y);
  await use('in');
}

// ---------- face 5: sequence laser ----------
console.log('face 5');
await go('out', 5, 6, 10);
{
  const emitter = objectTile('in', 5, 'target', 'f5-emitter');
  await go('in', 5, emitter.x, emitter.y + 2);
  await shot(5, 'unsolved'); // dark symbols, a dead emitter, the battery in hand
  await go('in', 5, emitter.x, emitter.y);
  await use('in'); // the battery goes in: the outside symbols start to light up
  await shot(5, 'lit', ['out'], 700);
  await go('in', 5, emitter.x, emitter.y + 2);
  await shot(5, 'powered', ['in'], 300);
  // outside: E on REPLAY, then watch all seven (0.5 s each)
  const replay = objectTile('out', 5, 'f5-replay');
  await sleep(3500);
  await go('out', 5, replay.x, replay.y);
  await use('out');
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const lit = (await sees('out', 5, 'f5-symbol')).find((o) => o.state?.endsWith('-lit'))?.state?.slice(0, -4);
    if (lit && !seen.includes(lit)) seen.push(lit);
    await sleep(110);
  }
  if (seen.length !== 7) throw new Error(`the outside player saw ${seen.length} symbols light up (${seen.join(', ')})`);
  await go('out', 5, 6, 10);
  for (const [i, name] of seen.entries()) {
    const s = (await sees('in', 5, 'f5-symbol')).find((o) => o.state === name)!;
    await go('in', 5, s.x, s.y);
    await use('in');
    if (i === 3) await shot(5, 'half', ['in'], 300);
  }
  await solved(5);
  await go('in', 5, emitter.x, emitter.y + 2);
  await shot(5, 'solved');
}

// ---------- face 6: laser and lava (the beam is the path) ----------
console.log('face 6');
{
  const reset = objectTile('out', 6, 'reset');
  const RESPAWN = { x: 0, y: 5 };
  await go('out', 6, reset.x, reset.y);
  // inside: round the hot lava to the face next door, then one step onto the ring
  const beside = (p: Pose) => p.face !== LAVA && Object.values(MOVE_OF).some((m) => onTile({ face: LAVA, ...RESPAWN })(stepPose(p, m[0], m[1]).pose));
  await goTo('in', 'the tile next to the ring of face 6', beside);
  await stepOnto('in', LAVA, RESPAWN.x, RESPAWN.y);
  await shot(6, 'unsolved'); // the beam runs north, unbent; the lava is hot
  // outside: mirrors to their start, then three pushes bend the beam onto the crate
  await use('out');
  for (const [from, box] of [[[3, 2], [4, 2]], [[9, 5], [9, 4]], [[9, 4], [9, 3]]] as const) {
    await go('out', 6, from[0], from[1]);
    await stepOnto('out', 6, box[0], box[1]);
  }
  await until('the crate burnt and the flower is out', async () => (await sees('out', 6, 'f6-crate')).some((o) => o.state === 'burnt') && (await state()).items.flower?.side === 'out');
  await go('out', 6, 2, 7);
  await shot(6, 'beam', ['out']); // the beam on the edge where the crate stood, the flower on its tile: the beam is the path
  // the tiles under the beam, backwards: from the crate's edge tile to the source (the button)
  const lines = linesOn(await state(), 'out', 6);
  const tiles = [{ x: lines[0]!.from[0], y: lines[0]!.from[1] }];
  for (const { from, to } of lines) for (let [x, y] = from; x !== to[0] || y !== to[1]; ) tiles.push({ x: (x += Math.sign(to[0] - from[0])), y: (y += Math.sign(to[1] - from[1])) });
  const [start, ...line] = tiles.reverse();
  if (!start || line.length < 2) throw new Error('the outside player sees no beam on face 6');
  await go('in', 6, start.x, start.y); // round the ring
  for (const [i, o] of line.entries()) {
    await stepOnto('in', LAVA, o.x, o.y);
    if (i === Math.floor(line.length / 2)) await shot(6, 'path', ['out', 'in'], 400); // half way over the lava
  }
  if ((await state()).strikes) console.log(`   NOTE: ${(await state()).strikes} strike(s) so far`);
  await use('in');
  await solved(6);
  await shot(6, 'solved'); // the button is pressed, the lava is cold
}

// ---------- face 4: botanical mirror ----------
console.log('face 4');
{
  // five flowers (the crate's and four lying on faces 1, 2, 3, 5), five solid pots: each is planted
  // from the tile next to its pot, facing it (a bump into the pot turns the player)
  const first = (await state()).items.flower!;
  let shown = false;
  for (let n = 0; n < 5; n++) {
    const s = await state();
    const flower = n === 0 ? first : Object.values(s.items).find((i) => i.side === 'out' && i.kind.startsWith('flower-') && !i.placedOn && !i.carriedBy)!;
    await go('out', flower.face, flower.x, flower.y);
    await use('out');
    await go('in', 4, 6, 9);
    if (!shown) {
      shown = true;
      await go('out', 4, 5, 4);
      await shot(4, 'unsolved'); // empty pots outside, a flower in hand; five flowers inside
    }
    const colour = flower.kind.replace('flower-', '');
    const pot = (await sees('in', 4, 'f4-flowerpot')).find((o) => o.state === colour);
    if (!pot) throw new Error(`the inside player sees no ${colour} flower on face 4`);
    const beside = (p: Pose) => p.face === 4 && Object.values(MOVE_OF).some((m) => onTile({ face: 4, x: pot.x, y: pot.y })(stepPose(p, m[0], m[1]).pose));
    await goTo('out', `next to the ${colour} pot`, beside);
    await stepOnto('out', 4, pot.x, pot.y);
    await use('out');
  }
  await solved(4);
  await go('out', 4, 5, 4);
  await shot(4, 'solved');
}

// ---------- back to face 3: the last tile wins the game ----------
console.log('face 3, the last tile');
await go('out', 3, 5, 1);
await go('in', 3, lastTile.x, lastTile.y);
await use('in');
await solved(3);
await shot(3, 'solved', ['out', 'in'], 1500); // the win screen comes up at once, over the face

const end = await state();
console.log(`\n${saved.length} pictures in ${OUT}\nsolved [${end.solved}], strikes ${end.strikes}, won ${end.wonAt !== null}`);
await browser.close();
