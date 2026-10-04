// THE LAVA ROOM (inside face 6), in a real browser: is the lava there, and does it bite?
// Two players in one room, the inside one is put on face 6 with the dev commands, and the
// painted face is read back pixel by pixel.
//
//   server:  PORT=3600 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3600 npm run dev -w client -- --port 5700
//   cd tools && LABEL=after npx tsx screens/lava.ts
//
//   BASE    client URL (default http://localhost:5700)
//   OUT     output folder (default docs/status/lava/)
//   LABEL   file name prefix, e.g. "before" / "after" (default "after")
//   STRICT  0 = only report (for a build that is known to be wrong); default: exit 1 on a failed check
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { FACE_SIZE, TILE_PX, canonToScreen, visibleObjects, type GameState } from '../../shared/src/index';
import { PATH_START, RESPAWN } from '../../shared/src/puzzles/laserPath';
import { C } from '../../client/src/style/tokens';
import { js, openTitle, players, sleep, snap, stateOf, toGame, toLobby, toMode, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5700';
const OUT = process.env.OUT ?? new URL('../../docs/status/lava/', import.meta.url).pathname;
const LABEL = process.env.LABEL ?? 'after';
const STRICT = process.env.STRICT !== '0';
const FACE = 6;
/** Where the inside player stands for the pictures: a ring tile, not the one a fall puts you back on. */
const STAND = { x: 5, y: FACE_SIZE - 1 };
/** The colours only lava is drawn in (the floor, the button and the turtle use none of them). */
const LAVA_COLOURS = [C.maroon, C.brick, C.vermilion, C.red, C.orange, C.amberDark, C.amber, C.lemon];
/** A tile "is lava" when at least this share of its pixels is one of those colours, exactly. */
const LAVA_SHARE = 0.9;

mkdirSync(OUT, { recursive: true });
const problems: string[] = [];
const facts: Record<string, unknown> = { base: BASE, label: LABEL };
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

/** The painted face (no turtle, no HUD) as a PNG and as the share of lava pixels per screen tile. */
async function face(page: Page, name: string): Promise<{ share: number[][]; hash: string }> {
  const got = await js<{ png: string; share: number[][]; hash: string }>(
    page,
    `(() => {
      const c = window.__cubicFace();
      const T = ${TILE_PX}, N = ${FACE_SIZE};
      const lava = new Set(${JSON.stringify(LAVA_COLOURS)});
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const hex = (i) => '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      const share = [];
      let h = 0;
      for (let ty = 0; ty < N; ty++) {
        const row = [];
        for (let tx = 0; tx < N; tx++) {
          let n = 0;
          for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
            const i = ((ty * T + y) * c.width + tx * T + x) * 4;
            if (lava.has(hex(i))) n++;
            h = (h * 31 + d[i] * 65536 + d[i + 1] * 256 + d[i + 2]) | 0;
          }
          row.push(n / (T * T));
        }
        share.push(row);
      }
      return { png: c.toDataURL('image/png'), share, hash: String(h) };
    })()`,
  );
  writeFileSync(`${OUT}${LABEL}-${name}-face.png`, Buffer.from(got.png.split(',')[1]!, 'base64'));
  await page.screenshot({ path: `${OUT}${LABEL}-${name}.png` });
  return got;
}

/** Count the lava tiles: the interior but the button, and the ring. */
function count(state: GameState, share: number[][]): { interior: number; ring: number; min: number } {
  const pose = state.players.in.pose;
  const button = visibleObjects(state, 'in', FACE).find((o) => o.type === 'button');
  let interior = 0;
  let ring = 0;
  let min = 1;
  for (let y = 0; y < FACE_SIZE; y++)
    for (let x = 0; x < FACE_SIZE; x++) {
      if (button && button.x === x && button.y === y) continue;
      const [sx, sy] = canonToScreen('in', FACE, pose.up, x, y);
      const s = share[sy]![sx]!;
      const onRing = x === 0 || y === 0 || x === FACE_SIZE - 1 || y === FACE_SIZE - 1;
      if (onRing) ring += s > 0 ? 1 : 0;
      else {
        interior += s >= LAVA_SHARE ? 1 : 0;
        min = Math.min(min, s);
      }
    }
  return { interior, ring, min };
}

const dev = (page: Page, cmd: object) => js<{ ok: boolean; error?: string }>(page, `window.__cubic.dev(${JSON.stringify(cmd)})`);

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

  const ping = await dev(b, { type: 'ping' });
  if (!ping.ok) throw new Error(`dev commands are off: ${ping.error} (start the server with DEV_COMMANDS=1)`);
  await dev(b, { type: 'teleport', side: 'in', face: FACE });
  await until('the inside player on face 6', async () => (await stateOf(b)).players.in.pose.face === FACE);
  // onto the ring while the lava is cold (the dev teleport lands in the middle of it)
  await game.go('in', FACE, STAND.x, STAND.y);
  await sleep(700);

  // ---- COLD: face 5 not solved yet ----
  let state = await stateOf(b);
  let lava = visibleObjects(state, 'in', FACE).filter((o) => o.type === 'f6-lava');
  facts.cold = { lavaObjects: lava.length, states: [...new Set(lava.map((o) => o.state))] };
  check(lava.length === 99, `cold: the client's state has 99 f6-lava objects for the inside player (${lava.length})`);
  check(!visibleObjects(state, 'in', FACE).some((o) => o.type === 'f6-path'), 'cold: no f6-path object for the inside player');
  const cold = await face(b, 'cold');
  const coldCount = count(state, cold.share);
  Object.assign(facts.cold as object, coldCount);
  check(coldCount.interior === 99, `cold: 99 interior tiles are painted in lava colours (${coldCount.interior}, lowest share ${coldCount.min.toFixed(2)})`);
  check(coldCount.ring === 0, `cold: no lava colour on the ring (${coldCount.ring} tiles)`);

  // ---- HOT: face 5 solved ----
  await dev(b, { type: 'solve', face: 5 });
  await until('face 5 solved', async () => (await stateOf(b)).solved.includes(5));
  await sleep(700);
  state = await stateOf(b);
  lava = visibleObjects(state, 'in', FACE).filter((o) => o.type === 'f6-lava');
  facts.hot = { lavaObjects: lava.length, states: [...new Set(lava.map((o) => o.state))] };
  check(lava.length === 99 && lava.every((o) => o.state === 'hot'), `hot: 99 f6-lava objects, all "hot" (${lava.length})`);
  const hot = await face(b, 'hot');
  const hotCount = count(state, hot.share);
  Object.assign(facts.hot as object, hotCount);
  check(hotCount.interior === 99, `hot: 99 interior tiles are painted in lava colours (${hotCount.interior}, lowest share ${hotCount.min.toFixed(2)})`);
  check(hotCount.ring === 0, `hot: no lava colour on the ring (${hotCount.ring} tiles)`);
  check(hot.hash !== cold.hash, 'hot lava is painted differently from cold lava');
  const hashes = new Set([hot.hash]);
  for (let i = 0; i < 6; i++) {
    await sleep(130);
    hashes.add((await face(b, 'hot')).hash);
  }
  (facts.hot as Record<string, unknown>).frames = hashes.size;
  check(hashes.size > 1, `hot lava is animated (${hashes.size} different frames in 0.8 s)`);

  // the outside player: no path yet (the crate is whole), and never any lava
  const outSees = visibleObjects(await stateOf(a), 'out', FACE).map((o) => o.type);
  check(!outSees.includes('f6-lava') && !outSees.includes('f6-path'), 'outside: no lava, and no path before the crate burns');

  // ---- one step into the hot lava ----
  const before = await stateOf(b);
  const p = before.players.in.pose;
  const inward = { x: STAND.x, y: STAND.y - 1 };
  facts.step = { from: { x: p.x, y: p.y }, into: inward, strikesBefore: before.strikes };
  await game.stepOnto('in', FACE, inward.x, inward.y);
  await sleep(500);
  const after = await stateOf(b);
  const q = after.players.in.pose;
  Object.assign(facts.step as object, { at: { face: q.face, x: q.x, y: q.y }, strikesAfter: after.strikes, respawn: RESPAWN, pathStart: PATH_START });
  check(q.face === FACE && q.x === RESPAWN.x && q.y === RESPAWN.y, `stepping into hot lava at ${inward.x},${inward.y} puts the inside player on the respawn tile ${RESPAWN.x},${RESPAWN.y} beside the path start (now ${q.x},${q.y})`);
  check(after.strikes === before.strikes + 1, `one strike more (${before.strikes} -> ${after.strikes})`);
  check((await snap(a)).state!.strikes === after.strikes, 'the outside client has the same strike count');
  await face(b, 'fell');
} catch (e) {
  problems.push(String(e));
  console.error(e);
} finally {
  await real.close();
}

writeFileSync(`${OUT}${LABEL}-facts.json`, JSON.stringify({ ...facts, problems }, null, 2) + '\n');
console.log(problems.length ? `${problems.length} problem(s)` : 'lava: all checks passed');
process.exit(problems.length && STRICT ? 1 : 0);
