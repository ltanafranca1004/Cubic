// TALL PROPS AND THE WALKING PACE, checked in a real browser. Headless and muted.
//
//   server:  PORT=3423 AI_FAKE=1 TTS_MODE=browser DEV_COMMANDS=1 npm start -w server
//   client:  VITE_SERVER_URL=http://localhost:3423 npm run dev -w client -- --port 5523
//   then:    cd tools && BASE=http://localhost:5523 npx tsx screens/props.ts [shots|item|fade|pace|edge]
//
// shots  the turtle on every side of a tree (Forest, outside face 4) and of a cactus
//        (Desert, outside face 2): a picture of each place into docs/status/props, and a
//        check of what the depth sort says there (client/src/world/biomes/depth.ts).
// item   an item lying under a crown: under it, and the prop faded, wherever the turtle is.
// fade   the fade through a face transition (roll, and the reduce-motion fade), and the
//        instant fade with reduce motion.
// pace   a direction held for 3 s: tiles walked against 1 + floor(3000 / STEP_MS).
// edge   a real two-player game: the outside player holds a direction over a face edge;
//        every pose the client showed must be one step on from the one before (no
//        correction), drawn where the pose says, and the same walk as the partner saw.
//
// shots, item, fade and pace use the offline game (?mock=game): only the client has to run.
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { STEP_MS, canonToScreen, eq, stepPose, type FaceId, type Pose } from '../../shared/src/index';
import { ROLL_MS } from '../../client/src/game/transition';
import { has, js, players, snap, toGame, toLobby, toMode, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5523';
const OUT = new URL('../../docs/status/props/', import.meta.url).pathname;
const ONLY = process.argv[2];
const UP: Record<number, number[]> = { 2: [0, 1, 0], 4: [0, 1, 0] };

mkdirSync(OUT, { recursive: true });

interface PropsProbe {
  lifted: { key: string; sx: number; sy: number; alpha: number }[];
  faded: [string, number][];
  front: boolean;
  transition: string | null;
  hero: { x: number; y: number } | null;
}

const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

/** Every context is silent: no audio device (--mute-audio at launch) and no browser speech. */
async function context(browser: Browser, size = { width: 1280, height: 720 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(() => {
    const s = window.speechSynthesis;
    if (s) {
      s.speak = () => {};
      s.cancel = () => {};
    }
  });
  // tsx names the functions it compiles (__name): the ones sent to the page need it there too
  await ctx.addInitScript('window.__name = (fn) => fn;');
  return ctx;
}

async function openMock(browser: Browser, renderer: 'canvas' | 'webgl', reduceMotion = false): Promise<Page> {
  const page = await (await context(browser)).newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(`${BASE}/?mock=game&side=out${renderer === 'canvas' ? '&renderer=canvas' : ''}`);
  await page.evaluate(`import('/src/style/settings.ts').then((m) => { m.setSetting('hints', false); m.setSetting('reduceMotion', ${reduceMotion}); })`);
  await page.waitForTimeout(1500);
  return page;
}

const probe = (page: Page) => js<PropsProbe>(page, 'window.__cubicProps()');

/** Put the outside player on a tile (the mock game's state is local), with or without an item on its head. */
async function stand(page: Page, face: number, x: number, y: number, carrying = false): Promise<void> {
  await page.evaluate(
    ({ face, up, x, y, carrying }) => {
      const state = (window as unknown as { __cubic: { state: { players: { out: { pose: object; carrying: string | null } }; items: Record<string, object> } } }).__cubic.state;
      Object.assign(state.players.out.pose, { face, up, x, y });
      // a new game has no item on the outside (the puzzles hand them out): the check brings a rose of its own
      if (carrying) state.items.probe = { id: 'probe', kind: 'rose', side: 'out', face, x, y, carriedBy: 'out', placedOn: null, props: {} };
      else delete state.items.probe;
      state.players.out.carrying = carrying ? 'probe' : null;
    },
    { face, up: UP[face]!, x, y, carrying },
  );
  await page.waitForTimeout(700); // past the fade and a repaint
}

/** A picture of the tiles round a prop: 5 wide, 6 high, the prop's base in the fourth row. */
async function shoot(page: Page, name: string, bx: number, by: number): Promise<void> {
  const box = (await page.locator('#game canvas').boundingBox())!;
  const tile = box.width / 12;
  const x0 = Math.max(0, bx - 2);
  const y0 = Math.max(0, by - 3);
  await page.screenshot({ path: `${OUT}${name}.png`, clip: { x: box.x + x0 * tile, y: box.y + y0 * tile, width: Math.min(5, 12 - x0) * tile, height: Math.min(6, 12 - y0) * tile } });
}

interface Prop {
  name: string;
  face: FaceId;
  x: number;
  y: number;
}
/** Canonical up on both faces, so screen tiles are map tiles: an oak with floor all round it, and two cacti. */
const TREE: Prop = { name: 'forest-tree', face: 4, x: 4, y: 10 };
const CACTUS: Prop = { name: 'desert-cactus', face: 2, x: 1, y: 9 };
/** A cactus whose crown is on the top row of the face, so the turtle behind it stands on the edge. */
const EDGE_CACTUS: Prop = { name: 'desert-cactus-edge', face: 2, x: 1, y: 1 };

async function shots(browser: Browser): Promise<void> {
  for (const renderer of ['canvas', 'webgl'] as const) {
    console.log(`shots (${renderer})`);
    const page = await openMock(browser, renderer);
    await page.waitForTimeout(12_000); // the narrator's opening lines lie over the bottom rows
    for (const prop of [TREE, CACTUS, EDGE_CACTUS]) {
      const key = `${prop.face}:${prop.x},${prop.y}`;
      const places: [string, number, number, boolean][] = [
        ['above-behind-crown', 0, -1, true],
        ['two-above', 0, -2, false],
        ['below', 0, 1, false],
        ['left', -1, 0, false],
        ['right', 1, 0, false],
      ];
      for (const [where, dx, dy, behind] of places) {
        if (prop.y + dy < 0) continue; // off the face
        for (const carrying of [false, true]) {
          // the full set on Canvas (what Luis's browser runs); WebGL once per place, empty hands and carrying behind the crown
          if (renderer === 'webgl' && carrying && !behind) continue;
          await stand(page, prop.face, prop.x + dx, prop.y + dy, carrying);
          const p = await probe(page);
          const name = `${prop.name}-${where}${carrying ? '-carrying' : ''}${renderer === 'webgl' ? '-webgl' : ''}`;
          const mine = p.lifted.find((l) => l.key === key);
          if (behind) check(!!mine && mine.alpha === 0.5 && p.front, `${name}: the prop is over the turtle at 50%`);
          else check(p.lifted.length === 0 && !p.front && p.faded.length === 0, `${name}: nothing lifted, nothing faded`);
          await shoot(page, name, prop.x, prop.y);
        }
      }
    }
    await page.context().close();
  }
}

/** An item lying under the tree's crown: it is under the crown and the tree is faded, wherever the turtle is. */
async function item(browser: Browser): Promise<void> {
  const key = `${TREE.face}:${TREE.x},${TREE.y}`;
  for (const renderer of ['canvas', 'webgl'] as const) {
    console.log(`item (${renderer})`);
    const page = await openMock(browser, renderer);
    await page.waitForTimeout(12_000); // the narrator's opening lines lie over the bottom rows
    const lay = (on: boolean) =>
      page.evaluate(
        ({ on, face, x, y }) => {
          const state = (window as unknown as { __cubic: { state: { items: Record<string, object> } } }).__cubic.state;
          if (on) state.items.lying = { id: 'lying', kind: 'rose', side: 'out', face, x, y, carriedBy: null, placedOn: null, props: {} };
          else delete state.items.lying;
        },
        { on, face: TREE.face, x: TREE.x, y: TREE.y - 1 },
      );
    const places: [string, number, number, boolean][] = [
      ['turtle-away', 2, -3, true],
      ['turtle-on-it', 0, -1, true],
      ['turtle-below', 0, 1, false],
      ['turtle-beside', 1, 0, false],
    ];
    await lay(true);
    for (const [where, dx, dy, over] of places) {
      await stand(page, TREE.face, TREE.x + dx, TREE.y + dy);
      const p = await probe(page);
      const alpha = p.faded.find(([k]) => k === key)?.[1];
      const lifted = p.lifted.some((l) => l.key === key);
      const name = `item-under-crown-${where}${renderer === 'webgl' ? '-webgl' : ''}`;
      check(alpha === 0.5, `${name}: the tree is at 50% (${alpha})`);
      check(lifted === over, `${name}: the tree is ${over ? 'over the turtle (it is in front of it)' : 'in the painted face (the turtle is in front of it)'}`);
      await shoot(page, name, TREE.x, TREE.y);
    }
    await lay(false);
    await stand(page, TREE.face, TREE.x + 2, TREE.y - 3);
    const p = await probe(page);
    check(p.faded.length === 0 && p.lifted.length === 0, 'item gone: the tree is back to full');
    await page.context().close();
  }
}

/** Sample the depth probe on every frame for `ms`, in the page. */
async function watchFade(page: Page, ms: number): Promise<{ t: number; faded: [string, number][]; transition: string | null; front: boolean }[]> {
  return page.evaluate(
    (ms) =>
      new Promise<{ t: number; faded: [string, number][]; transition: string | null; front: boolean }[]>((done) => {
        const out: { t: number; faded: [string, number][]; transition: string | null; front: boolean }[] = [];
        const t0 = performance.now();
        const tick = () => {
          const p = (window as unknown as { __cubicProps(): { faded: [string, number][]; transition: string | null; front: boolean } }).__cubicProps();
          out.push({ t: Math.round(performance.now() - t0), faded: p.faded, transition: p.transition, front: p.front });
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else done(out);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

async function fade(browser: Browser): Promise<void> {
  const key = `${EDGE_CACTUS.face}:${EDGE_CACTUS.x},${EDGE_CACTUS.y}`;
  const alphaOf = (f: { faded: [string, number][] }) => f.faded.find(([k]) => k === key)?.[1] ?? 1;
  for (const reduceMotion of [false, true]) {
    console.log(`fade (${reduceMotion ? 'reduce motion: the fade transition' : 'the roll'})`);
    const page = await openMock(browser, 'canvas', reduceMotion);
    // one below the cactus's crown tile is the cactus: come in from the side, on the top row
    await stand(page, 2, EDGE_CACTUS.x + 1, 0);
    let frames = watchFade(page, 500);
    await page.keyboard.press('a'); // one real step: behind the crown
    let seen = await frames;
    const stepped = seen.filter((f) => f.faded.length);
    if (reduceMotion) check(stepped.length > 0 && stepped.every((f) => alphaOf(f) === 0.5), 'reduce motion: the prop is at 50% on the first frame, no tween');
    else {
      const alphas = [...new Set(stepped.map(alphaOf))];
      check(alphas.length > 2 && alphas.every((a, i) => i === 0 || a < alphas[i - 1]!) && alphas.at(-1) === 0.5, `a tween down to 50%: ${alphas.map((a) => a.toFixed(2)).join(' ')}`);
    }
    await page.waitForTimeout(400);
    await shoot(page, `transition-${reduceMotion ? 'fade' : 'roll'}-0-before`, EDGE_CACTUS.x, EDGE_CACTUS.y);

    // off the top of the face: the cactus is now on the face we leave
    frames = watchFade(page, 900);
    await page.keyboard.press('w');
    await page.waitForTimeout(reduceMotion ? 60 : 120);
    await page.locator('#game canvas').screenshot({ path: `${OUT}transition-${reduceMotion ? 'fade' : 'roll'}-1-leaving.png` });
    seen = await frames;
    const during = seen.filter((f) => f.transition);
    const kind = during[0]?.transition;
    check(kind === (reduceMotion ? 'fade' : 'roll'), `the transition is a ${kind}`);
    const back = during.map(alphaOf);
    check(back.every((a, i) => i === 0 || a >= back[i - 1]!), 'leaving: the prop only ever gets more opaque (no pop)');
    check(back.at(-1) === 1 && seen.at(-1)!.faded.length === 0, 'leaving: back to full before the transition ends, nothing left half faded');
    check(during.every((f) => !f.front), 'the layer over the turtle is off during the transition (the fade is painted into the turning face)');
    if (!reduceMotion) {
      const steps = back.filter((a, i) => i > 0 && a !== back[i - 1]).map((a, i, l) => a - (i ? l[i - 1]! : 0.5));
      check(Math.max(...steps) <= 0.2, `leaving: the biggest change in one frame is ${Math.max(...steps).toFixed(2)}`);
    }

    // and back: we arrive behind the crown, so the cactus fades while the cube still turns
    await page.waitForTimeout(300);
    frames = watchFade(page, 1100);
    await page.keyboard.press('s');
    await page.waitForTimeout(reduceMotion ? 60 : 300);
    await page.locator('#game canvas').screenshot({ path: `${OUT}transition-${reduceMotion ? 'fade' : 'roll'}-2-arriving.png` });
    seen = await frames;
    const arriving = seen.filter((f) => f.transition).map(alphaOf);
    const after = seen.filter((f) => !f.transition && f.faded.length);
    check(arriving.length > 0 && arriving.every((a, i) => i === 0 || a <= arriving[i - 1]!) && arriving.at(-1) === 0.5, 'arriving: the prop fades during the transition and is at 50% when it ends');
    check(after.length > 0 && after.every((f) => alphaOf(f) === 0.5 && f.front), 'arriving: after the transition it is over the turtle at the same 50% (no pop)');
    await page.waitForTimeout(300);
    await shoot(page, `transition-${reduceMotion ? 'fade' : 'roll'}-3-arrived`, EDGE_CACTUS.x, EDGE_CACTUS.y);
    await page.context().close();
  }
}

/** Hold a key for `ms` and return when the player's step counter went up, in ms since the first step. */
async function holdAndTime(page: Page, key: string, ms: number, side: 'out' | 'in', wrap: boolean): Promise<number[]> {
  await page.evaluate(
    ({ side, wrap }) => {
      const w = window as unknown as { __cubic: { state: { players: Record<string, { steps: number; pose: { x: number } }> } }; __steps: number[]; __stop?: boolean };
      w.__steps = [];
      w.__stop = false;
      let last = w.__cubic.state.players[side]!.steps;
      const tick = () => {
        const p = w.__cubic.state.players[side]!;
        if (p.steps !== last) {
          for (let i = last; i < p.steps; i++) w.__steps.push(performance.now());
          last = p.steps;
        }
        // an endless corridor: eight tiles back along the same clear row, before the edge
        if (wrap && p.pose.x >= 10) p.pose.x -= 8;
        if (!w.__stop) setTimeout(tick, 2);
      };
      tick();
    },
    { side, wrap },
  );
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
  const times = await page.evaluate(() => {
    const w = window as unknown as { __steps: number[]; __stop?: boolean };
    w.__stop = true;
    return w.__steps;
  });
  return times.map((t) => Math.round(t - times[0]!));
}

async function pace(browser: Browser): Promise<void> {
  console.log('pace');
  const page = await openMock(browser, 'canvas');
  // the bottom row of the forest is clear floor from end to end
  await stand(page, 4, 1, 11);
  const times = await holdAndTime(page, 'd', 3400, 'out', true);
  const expected = 1 + Math.floor(3000 / STEP_MS);
  const measured = times.filter((t) => t <= 3000).length;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  console.log(`   STEP_MS ${STEP_MS}: tiles in 3 s expected ${expected}, measured ${measured}; one step per ${mean.toFixed(1)} ms on average (shortest ${Math.min(...gaps)}, longest ${Math.max(...gaps)}); at the old 130 ms it was ${1 + Math.floor(3000 / 130)}`);
  check(Math.abs(measured - expected) <= 1, `held for 3 s: ${measured} tiles, expected ${expected}`);
  check(times[0] === 0 && Math.abs(mean - STEP_MS) <= 4, `the mean step is ${mean.toFixed(1)} ms`);
  // a tap: the step is in the state within a frame or two of the key going down
  const tap = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const w = window as unknown as { __cubic: { state: { players: { out: { steps: number } } } } };
        const before = w.__cubic.state.players.out.steps;
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        const after = w.__cubic.state.players.out.steps;
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
        done(after > before ? performance.now() - t0 : -1);
      }),
  );
  check(tap >= 0 && tap < 16, `a tap steps inside the key event itself (${tap.toFixed(1)} ms): no initial delay`);
  await page.context().close();
}

interface Frame {
  pose: Pose;
  hero: { x: number; y: number } | null;
  transition: string | null;
  pending: number;
}

/** Record the outside player as this page shows it, on every frame, until told to stop. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __cubic: { state: { players: { out: { pose: object } } }; pending: unknown[] }; __cubicProps?: () => { hero: unknown; transition: unknown }; __frames: unknown[]; __rec: boolean };
    w.__frames = [];
    w.__rec = true;
    const tick = () => {
      const p = w.__cubicProps?.();
      w.__frames.push({ pose: structuredClone(w.__cubic.state.players.out.pose), hero: p?.hero ?? null, transition: p?.transition ?? null, pending: w.__cubic.pending.length });
      if (w.__rec) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: unknown[]; __rec: boolean };
    w.__rec = false;
    return w.__frames;
  }) as Promise<Frame[]>;

const same = (a: Pose, b: Pose) => a.face === b.face && a.x === b.x && a.y === b.y && eq(a.up, b.up);
/** The poses a recording went through, without the repeats. */
const walk = (frames: Frame[]) => frames.map((f) => f.pose).filter((p, i, l) => i === 0 || !same(p, l[i - 1]!));

async function edge(browser: Browser): Promise<void> {
  console.log('edge (two players, a real server)');
  const size = { width: 1280, height: 720 };
  const open = async () => {
    const page = await (await context(browser, size)).newPage();
    await page.goto(`${BASE}/?renderer=canvas`);
    await until('the title screen with PLAY', () => has(page, 'PLAY'), 20_000);
    await until('connected to the game server (is it running?)', async () => (await snap(page)).online, 10_000);
    return page;
  };
  const a = await open();
  const b = await open();
  await toMode(a);
  await toMode(b);
  await toLobby(a, b);
  await toGame(a, b);
  const game = players(a, b);

  const dev = await js<{ ok: boolean; error?: string }>(a, `window.__cubic.dev({ type: 'teleport', side: 'out', face: 4 })`);
  if (!dev.ok) throw new Error(`teleport: ${dev.error} (the server needs DEV_COMMANDS=1)`);
  await a.waitForTimeout(900);
  // the bottom row of the forest: clear floor from end to end, then over the right edge
  await game.go('out', 4, 2, 11);
  await a.waitForTimeout(400);
  const from = (await snap(a)).state!.players.out.pose;
  const steps0 = (await snap(a)).state!.players.out.steps;

  await record(a);
  await record(b);
  await a.keyboard.down('d');
  await a.waitForTimeout(3000);
  await a.keyboard.up('d');
  await until('every input acknowledged', async () => (await snap(a)).pending === 0, 3000);
  await a.waitForTimeout(700);
  const mine = await recorded(a);
  const theirs = await recorded(b);
  await a.locator('#game canvas').screenshot({ path: `${OUT}edge-after-crossing.png` });

  // 1. every pose the client showed is one step right of the one before: it never went back
  const path = walk(mine);
  let corrections = 0;
  for (let i = 1; i < path.length; i++) if (!same(stepPose(path[i - 1]!, 1, 0).pose, path[i]!)) corrections++;
  // 2. the turtle is drawn on the tile of the pose (outside a transition, where it is between two faces)
  let misdrawn = 0;
  for (const f of mine) {
    if (f.transition || !f.hero) continue;
    const [sx, sy] = canonToScreen('out', f.pose.face, f.pose.up, f.pose.x, f.pose.y);
    if (f.hero.x !== sx * 16 || f.hero.y !== sy * 16) misdrawn++;
  }
  // 3. the server (as the partner's client got it) saw the same walk, and ends on the same tile
  const server = walk(theirs);
  const sameWalk = server.length === path.length && server.every((p, i) => same(p, path[i]!));
  const faces = [...new Set(path.map((p) => p.face))];
  // tiles really walked (the step counter also counts the last press into whatever stopped the walk)
  const tiles = path.length - 1;
  const counted = (await snap(a)).state!.players.out.steps - steps0;
  // the walk stops for the roll: the steps before the edge, the roll, then steps again
  const before = 11 - from.x;
  const expected = before + 1 + Math.floor((3000 - before * STEP_MS - ROLL_MS) / STEP_MS);
  console.log(`   held right for 3 s from face ${from.face} (${from.x},${from.y}): ${tiles} tiles over faces ${faces.join(' -> ')}, about ${expected} expected with one ${ROLL_MS} ms roll (step counter +${counted})`);
  console.log(`   corrections ${corrections} (poses that were not one step on), drawn off its tile ${misdrawn} frames, server walk ${sameWalk ? 'identical' : 'DIFFERENT'} (${server.length} poses, client ${path.length})`);
  check(faces.length === 2, `the walk crossed one face edge (${faces.join(' -> ')})`);
  check(corrections === 0, `corrections: ${corrections}`);
  check(misdrawn === 0, `frames with the turtle drawn off its tile: ${misdrawn}`);
  check(sameWalk, 'the server saw the same walk, tile for tile');
  check(same(mine.at(-1)!.pose, theirs.at(-1)!.pose), 'both clients end on the same tile');
  check(Math.abs(tiles - expected) <= 2, `${tiles} tiles in 3 s with one edge (about ${expected})`);
  await a.context().close();
  await b.context().close();
}

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
  if (!ONLY || ONLY === 'shots') await shots(browser);
  if (!ONLY || ONLY === 'item') await item(browser);
  if (!ONLY || ONLY === 'fade') await fade(browser);
  if (!ONLY || ONLY === 'pace') await pace(browser);
  if (!ONLY || ONLY === 'edge') await edge(browser);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nall good');
