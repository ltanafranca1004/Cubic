// Submission screenshots (Devpost): title, lobby, one game shot per side and a phone shot.
// Canvas renderer, 1920x1080, hints off. One two-player game is played with real keys
// (screens/play.ts, the approach of screens/faces.ts) up to the states worth showing. It
// writes candidates to OUT; pick the best and copy them to docs/submission/:
//
//   title-<n>.png, title-thumb-<n>.png   the title, the cube held at four points of its turn
//   lobby.png                            side select, both seats taken
//   game-inside-keypad.png               face 1 inside: the three digits typed
//   game-inside-vault.png                face 2 inside: the answer typed under the keypad, the safe
//   game-outside.png                     face 6 outside: the beam bent by both mirrors onto the crate
//   game-inside-lava.png                 face 6 inside: half way over the hot lava
//   mobile.png                           a phone held sideways (touch layout), the offline game
//
// docs/submission/ending.png (the title card of the ending, "Passed cube 1!") is not made
// here: a game has to be played to its win for it. It is the outside player's card picture
// of the playtest, at this size and in this renderer:
//   cd tools && RENDERER=canvas SIZE=1920x1080 GIF=0 npx tsx screens/playtest.ts puzzles
//   then copy <OUT>/ending-canvas-outside-6-card.png
//
// In docs/submission/: game-outside.png = game-outside.png, game-inside.png =
// game-inside-vault.png, title.png and title-thumb.png = <n> 3 (grass, rooftop, desert).
//
//   server:  PORT=3414 AI_FAKE=1 DEV_COMMANDS=1 npm run dev -w server   (dev command: solve face 5)
//   client:  VITE_SERVER_URL=http://localhost:3414 npm run dev -w client -- --port 5514
//   run:     cd tools && BASE=http://localhost:5514 OUT=/some/dir npx tsx screens/submission.ts
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { defaultEnv, objectsOn, visibleObjects, type FaceId } from '../../shared/src/index';
import { readCode } from '../../shared/src/puzzles/hiddenCode';
import { LAVA, beamPath, js, openTitle, players, sleep, toGame, toLobby, toMode, until } from './play';

const BASE = process.env.BASE ?? 'http://localhost:5514';
const OUT = (process.env.OUT ?? new URL('../../docs/submission/candidates/', import.meta.url).pathname).replace(/\/?$/, '/');
mkdirSync(OUT, { recursive: true });
const SIZE = { width: 1920, height: 1080 };
/** The narrator's line and the face name caption are gone after this. */
const CAPTION_MS = 6000;

const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  // title: the cube turns, so hold it at four points; the thumb is the same frame cut to 3:2
  const [a, b] = await Promise.all([openTitle(browser, BASE, SIZE), openTitle(browser, BASE, SIZE)]);
  await sleep(2000);
  for (const [i, hold] of [0.06, 0.31, 0.56, 0.81].entries()) {
    await js(a, `window.__cubicCube.hold = ${hold}`);
    await sleep(700);
    await a.screenshot({ path: `${OUT}title-${i}.png` });
    await a.screenshot({ path: `${OUT}title-thumb-${i}.png`, clip: { x: (SIZE.width - 1620) / 2, y: 0, width: 1620, height: 1080 } });
  }
  await js(a, `window.__cubicCube.hold = null`);

  // lobby: two players in one room, sides picked, the guest ready
  await Promise.all([toMode(a), toMode(b)]);
  await toLobby(a, b);
  await sleep(1500);
  await a.screenshot({ path: `${OUT}lobby.png` });
  await toGame(a, b);
  const { state, sees, goTo, go, use, stepOnto, beside, solved } = players(a, b);

  // face 1, inside: the three digits the outside player reads in the grass, typed
  console.log('face 1');
  {
    const code = readCode(visibleObjects(await state(), 'out', 1));
    if (!code) throw new Error('the outside player sees no number on face 1');
    const key = (name: string) => objectsOn(defaultEnv.world, 'in', 1, 'key').find((o) => o.name === name)!;
    for (const name of code) {
      const k = key(name);
      await go('in', 1, k.x, k.y);
      await use('in');
    }
    await sleep(CAPTION_MS);
    await b.screenshot({ path: `${OUT}game-inside-keypad.png` });
    await go('in', 1, key('enter').x, key('enter').y);
    await use('in');
    await solved(1);
  }

  // face 2, inside: 3 x bushes x 2 x birds x rocks typed, the safe still shut
  console.log('face 2');
  {
    await go('out', 2, 6, 10);
    await go('in', 2, 8, 7);
    const count = async (type: string) => (await sees('out', 2, type)).length;
    const answer = String(3 * (await count('f2-bush')) * 2 * (await count('f2-bird')) * (await count('f2-rock')));
    const key = async (name: string) => (await sees('in', 2, 'key')).find((o) => o.state === name)!;
    for (const name of answer) {
      const k = await key(name);
      await go('in', 2, k.x, k.y);
      await use('in');
    }
    await sleep(CAPTION_MS);
    await b.screenshot({ path: `${OUT}game-inside-vault.png` });
    const enter = await key('enter');
    await go('in', 2, enter.x, enter.y);
    await use('in');
    await solved(2);
  }

  // face 5 is not in any picture: the dev command solves it, which turns the laser on
  const dev = await js<{ ok: boolean; error?: string }>(a, `window.__cubic.dev({ type: 'solve', face: 5 })`);
  if (!dev.ok) throw new Error(`dev solve: ${dev.error} (the server needs DEV_COMMANDS=1)`);
  await solved(5);

  // face 6: the mirrors bend the beam onto the crate (outside), then the path over the lava (inside)
  console.log('face 6');
  {
    const face: FaceId = LAVA;
    const reset = objectsOn(defaultEnv.world, 'out', face, 'reset')[0]!;
    const ring = { face, x: 0, y: 5 };
    await go('out', face, reset.x, reset.y);
    await goTo('in', 'the tile next to the ring of face 6', beside(ring));
    await stepOnto('in', face, ring.x, ring.y);
    await use('out'); // RESET: the mirrors at their start
    for (const [from, box] of [[[3, 2], [4, 2]], [[9, 5], [9, 4]], [[9, 4], [9, 3]]] as const) {
      await go('out', face, from[0], from[1]);
      await stepOnto('out', face, box[0], box[1]);
    }
    await until('the crate burnt and the flower is out', async () => (await sees('out', face, 'f6-crate')).some((o) => o.state === 'burnt') && (await state()).items.flower?.side === 'out');
    await go('out', face, 6, 5);
    await sleep(CAPTION_MS);
    await a.screenshot({ path: `${OUT}game-outside.png` });
    await go('out', face, 2, 7);
    // the beam is the path: from the edge tile where the crate stood, back along the beam
    const [start, ...line] = beamPath(await state());
    if (!start || line.length < 2) throw new Error('the outside player sees no beam on face 6');
    await go('in', face, start.x, start.y); // round the ring
    for (const o of line.slice(0, Math.ceil(line.length / 2))) await stepOnto('in', face, o.x, o.y);
    await sleep(1500);
    await b.screenshot({ path: `${OUT}game-inside-lava.png` });
  }
  const end = await state();
  console.log(`solved [${end.solved}], strikes ${end.strikes}`);

  // phone: iPhone 14 held sideways, the offline game (the number of face 1 in the grass)
  const ctx = await browser.newContext({ ...devices['iPhone 14 landscape'] });
  const phone = await ctx.newPage();
  await phone.goto(`${BASE}/?mock=game&renderer=canvas`);
  await phone.evaluate(`import('/src/style/settings.ts').then((m) => m.setSetting('hints', false))`);
  await phone.evaluate(`document.fonts.ready`);
  await sleep(9000);
  await phone.screenshot({ path: `${OUT}mobile.png` });
  await ctx.close();
} finally {
  await browser.close();
}
console.log('done:', OUT);
