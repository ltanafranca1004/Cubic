// The HUD cube's quarter turn, outside and inside, frame by frame: the little canvas is
// read on every animation frame while the player walks over one edge, then laid out as a
// strip (PNG) and a GIF in docs/status/puzzles. It fails if WebGL and Canvas draw the cube
// differently, or if the cube does not end on the face walked onto.
//
//   client:  VITE_SERVER_URL=http://localhost:3408 npm run dev -w client -- --port 5508
//   then:    cd tools && BASE=http://localhost:5508 npx tsx screens/hud-turn.ts [left|right|up|down]
//
// The GIFs need ffmpeg on the PATH (or FFMPEG=/path/to/ffmpeg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { FACE_SIZE, screenToCanon, type FaceId, type Side, type Vec } from '../../shared/src';

const BASE = process.env.BASE ?? 'http://localhost:5508';
const OUT = new URL('../../docs/status/puzzles/', import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
type Dir = 'left' | 'right' | 'up' | 'down';
const DIR = (process.argv[2] ?? 'right') as Dir;
const STEP: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/** Frames in the strip, pixels per art pixel, and the dark the HUD panel has behind the cube. */
const STRIP = 6;
const ZOOM = 5;
const BACK = [22, 20, 34];

interface Pose {
  face: FaceId;
  up: Vec;
}
declare const window: {
  __cubic: { state: { players: Record<Side, { pose: Pose & { x: number; y: number } }> } | null; move(dx: number, dy: number): void };
  __cubicHudCube(): { front: number | null; turning: boolean; turns: number };
};

mkdirSync(OUT, { recursive: true });
let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log('   FAIL:', msg);
};

/** The HUD canvas on every animation frame of one turn (data URLs), from just before the step. */
const film = (page: Page, step: [number, number]) =>
  page.evaluate(`new Promise((done) => {
    const canvas = document.querySelector('.cu-cube-c');
    const frames = [canvas.toDataURL()];
    window.__cubic.move(${step[0]}, ${step[1]});
    let still = 0;
    const tick = () => {
      frames.push(canvas.toDataURL());
      still = window.__cubicHudCube().turning ? 0 : still + 1;
      if (still > 3 || frames.length > 240) done(frames);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`) as Promise<string[]>;

/** Walk one side's player off the edge in DIR and return the frames of the HUD cube turning. */
async function turn(page: Page, side: Side): Promise<PNG[]> {
  const before = await page.evaluate((s) => window.__cubic.state!.players[s].pose, side);
  const mid = Math.floor(FACE_SIZE / 2);
  for (const t of [0, 1, -1, 2, -2, 3, -3].map((d) => mid + d)) {
    const [sx, sy] = DIR === 'left' ? [0, t] : DIR === 'right' ? [FACE_SIZE - 1, t] : DIR === 'up' ? [t, 0] : [t, FACE_SIZE - 1];
    const [x, y] = screenToCanon(side, before.face, before.up, sx, sy);
    await page.evaluate(({ side, x, y }) => void Object.assign(window.__cubic.state!.players[side].pose, { x, y }), { side, x, y });
    const frames = await film(page, STEP[DIR]);
    const now = await page.evaluate((s) => ({ face: window.__cubic.state!.players[s].pose.face, hud: window.__cubicHudCube() }), side);
    if (now.face === before.face) continue; // a wall at that tile: try the next one along the edge
    if (now.hud.front !== now.face) fail(`${side}: walked ${DIR} onto face ${now.face} but the cube shows ${now.hud.front}`);
    console.log(`   ${side}: walked ${DIR} from face ${before.face} to ${now.face}, ${frames.length} frames`);
    return frames.map((url) => PNG.sync.read(Buffer.from(url.split(',')[1]!, 'base64')));
  }
  fail(`${side}: could not walk ${DIR} off face ${before.face}`);
  return [];
}

/** Frames side by side on the HUD's dark, each art pixel ZOOM pixels. */
function sheet(frames: PNG[]): PNG {
  const n = frames[0]!.width;
  const pad = 2;
  const out = new PNG({ width: frames.length * (n + pad) * ZOOM, height: (n + pad) * ZOOM });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([...BACK, 255], i);
  frames.forEach((f, k) => {
    for (let y = 0; y < n * ZOOM; y++)
      for (let x = 0; x < n * ZOOM; x++) {
        const s = (Math.floor(y / ZOOM) * n + Math.floor(x / ZOOM)) * 4;
        if (!f.data[s + 3]) continue;
        const d = ((y + ZOOM) * out.width + x + (k * (n + pad) + 1) * ZOOM) * 4;
        out.data.set(f.data.subarray(s, s + 4), d);
      }
  });
  return out;
}

const same = (a: PNG, b: PNG) => a.width === b.width && a.data.equals(b.data);

const browser = await chromium.launch({ args: ['--mute-audio', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
for (const side of ['in', 'out'] as Side[]) {
  const last: Partial<Record<string, PNG>> = {};
  for (const renderer of ['canvas', 'webgl']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => fail(`${side} ${renderer}: page error: ${e.message}`));
    await page.goto(`${BASE}/?mock=game&side=${side}${renderer === 'canvas' ? '&renderer=canvas' : ''}`);
    await page.waitForTimeout(2500);
    const actual = await page.evaluate(`document.querySelector('#game canvas, canvas:not(.cu-cube-c)')?.getContext('2d') ? 'canvas' : 'webgl'`);
    console.log(`\n${side} ${renderer} (the game runs on ${actual})`);
    const frames = await turn(page, side);
    await page.close();
    if (!frames.length) continue;
    last[renderer] = frames[frames.length - 1]!;
    if (renderer !== 'canvas') continue;
    // the turn itself: drop the frames after it has come to rest
    let end = frames.length - 1;
    while (end > 1 && same(frames[end - 1]!, frames[end]!)) end--;
    const moving = frames.slice(0, end + 1);
    const picks = Array.from({ length: STRIP }, (_, i) => moving[Math.round((i * (moving.length - 1)) / (STRIP - 1))]!);
    writeFileSync(`${OUT}hud-turn-${side === 'in' ? 'inside' : 'outside'}.png`, PNG.sync.write(sheet(picks)));
    const dir = mkdtempSync(join(tmpdir(), 'hud-turn-'));
    // held on the first and the last frame, so the loop reads as one turn
    const film = [...Array<PNG>(20).fill(moving[0]!), ...moving, ...Array<PNG>(40).fill(moving[end]!)];
    film.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(4, '0')}.png`), PNG.sync.write(sheet([f]))));
    try {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '60', '-i', join(dir, '%04d.png'), '-vf', 'fps=30,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none', `${OUT}hud-turn-${side === 'in' ? 'inside' : 'outside'}.gif`]);
    } catch (e) {
      fail(`ffmpeg: ${(e as Error).message}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (last.canvas && last.webgl) {
    if (same(last.canvas, last.webgl)) console.log(`   ${side}: WebGL and Canvas end on the same pixels`);
    else fail(`${side}: WebGL and Canvas draw the HUD cube differently`);
  }
}
await browser.close();
if (failed) process.exit(1);
console.log('\nok');
