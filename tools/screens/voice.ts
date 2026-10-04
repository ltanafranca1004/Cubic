// The voice call's life, checked with two real clients and Chromium's fake microphone:
// it connects when the game starts, is hung up (and the microphone let go) on both sides
// when a player leaves for good, comes back when someone joins again, and survives a
// refresh. No screenshots.
//
//   server:  PORT=3380 AI_FAKE=1 npm run dev -w server
//   client:  VITE_SERVER_URL=http://localhost:3380 npm run dev -w client -- --port 5480
//   then:    cd tools && BASE=http://localhost:5480 npx tsx screens/voice.ts
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIZE = { width: 1280, height: 720 };

interface Probe {
  link: string;
  pc: string | null;
  mic: string;
  track: string | null;
}
interface Hooks {
  __cubic: {
    code: string | null;
    side: string | null;
    room: { phase: string } | null;
    createRoom(): void;
    joinRoom(code: string): void;
    pickSide(side: string): void;
    setReady(ready: boolean): void;
    startGame(): void;
  };
  __cubicVoice: { link: string; mic: string; pc: { connectionState: string } | null; micStream: { getAudioTracks(): { readyState: string }[] } | null; enableMic(): Promise<void> };
}
declare const window: Hooks;

const problems: string[] = [];
const fail = (msg: string) => {
  problems.push(msg);
  console.log('   FAIL:', msg);
};

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const v = window.__cubicVoice;
    return { link: v.link, pc: v.pc?.connectionState ?? null, mic: v.mic, track: v.micStream?.getAudioTracks()[0]?.readyState ?? null };
  });

async function expect(what: string, cond: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return fail(`expected ${what}`), false;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('   ok:', what);
  return true;
}

const inCall = async (page: Page) => {
  const p = await probe(page);
  return p.link === 'direct' && p.pc === 'connected' && p.track === 'live';
};
const hungUp = async (page: Page, micToo: boolean) => {
  const p = await probe(page);
  return p.link === 'none' && p.pc === null && (!micToo || p.track === null);
};

const browser = await chromium.launch({ args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ viewport: SIZE, permissions: ['microphone'] });
  const open = async (who: string) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => fail(`${who}: page error: ${e.message}`));
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.__cubicVoice);
    await page.waitForTimeout(800);
    return page;
  };
  const a = await open('host');
  const b = await open('guest');

  await a.evaluate(() => window.__cubic.createRoom());
  await a.waitForFunction(() => !!window.__cubic.code);
  const code = (await a.evaluate(() => window.__cubic.code))!;
  await b.evaluate((c) => window.__cubic.joinRoom(c), code);
  await b.waitForFunction(() => !!window.__cubic.code);
  await a.evaluate(() => window.__cubic.pickSide('out'));
  await b.evaluate(() => window.__cubic.pickSide('in'));
  await b.waitForFunction(() => window.__cubic.side === 'in');
  await b.evaluate(() => window.__cubic.setReady(true));
  await a.waitForTimeout(300);
  for (const page of [a, b]) await page.evaluate(() => window.__cubicVoice.enableMic());
  await a.evaluate(() => window.__cubic.startGame());
  await expect('the call connects when the game starts, both microphones live', async () => (await inCall(a)) && (await inCall(b)));

  // the host leaves through the pause menu
  await a.waitForTimeout(800);
  await a.keyboard.press('Escape');
  await a.locator('#cu-pause [data-act="leave"]').click();
  await expect('the one who left has hung up and let go of the microphone', () => hungUp(a, true), 5000);
  await expect('the one left behind has hung up and let go of the microphone', () => hungUp(b, true), 5000);
  console.log('   after the leave:', JSON.stringify({ a: await probe(a), b: await probe(b) }));

  // someone joins the room again: the call and the microphones come back
  await a.evaluate((c) => window.__cubic.joinRoom(c), code);
  await expect('the call comes back when a player joins again, both microphones live', async () => (await inCall(a)) && (await inCall(b)));

  // a refresh: the seat is held, the one waiting hangs up but keeps the microphone, then the call restarts
  await b.reload();
  await expect('the one waiting hangs up while the seat is held', async () => (await probe(a)).pc !== 'connected', 5000);
  await b.waitForFunction(() => !!window.__cubicVoice);
  await expect('the call restarts after the refresh', async () => (await inCall(a)) && (await probe(b)).link === 'direct');
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nall clean');
