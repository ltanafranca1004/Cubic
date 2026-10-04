// A WHOLE SOLO GAME in a real browser: PLAY SOLO as OUTSIDE through the mode screen and the
// side popup, then the six puzzles to the win screen with the AI partner INSIDE, played as
// a person would: arrow keys to walk, E to use / pick up / plant, and the chat box for
// everything the human tells the AI. The order is 1, 3, 2, 5, 6, 4 (the chain is 2 -> 5 ->
// 6 -> 4).
//
// What the driver knows: only what the OUTSIDE player's own screen shows (observe(state,
// 'out') and visibleObjects(state, 'out', face) on the dev hook's state) and the chat lines
// the AI sends. It answers the AI's questions by their LINE KEY (ChatMessage.key, e.g.
// "laser-path.in.tile"), never by their words, so it also plays against a server whose
// lines are reworded. Only an answer is read from the words: a relay line, which is
// vocabulary pieces ("the pot is row three column nine").
//
// It starts no server and reads no env but its own:
//   servers (never with real keys):
//     AI_FAKE=1 TTS_MODE=browser GEMINI_ENABLED=false ELEVENLABS_ENABLED=false PORT=3415 npm run dev -w server
//     VITE_SERVER_URL=http://localhost:3415 npm run dev -w client -- --port 5515
//   run:  cd tools && npx tsx screens/solo-game.ts
//
//   BASE   client URL (default http://localhost:5515)
//   OUT    folder for solo-game.log and the screenshots (default docs/status/puzzles/solo-game/)
//   LIE=1  read a wrong code out first on face 1 (one strike), to see the recovery
//
// Per puzzle one PASS / FAIL line with the game time and the strikes, then every chat line.
// It also reports three things only a browser shows: how the AI's lines were voiced (tts,
// tts:chain or the browser voice), what was said after a strike, and whether every caption
// fitted its box. Exit code 1 if the win screen was not reached.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import {
  VEC,
  VOCAB_NUMBERS,
  isPuzzleLine,
  canonOf,
  defaultEnv,
  dirOf,
  findPath,
  mirrorPush,
  observe,
  stepPose,
  throughWall,
  visibleObjects,
  voiceMix,
  type ChatMessage,
  type Dir,
  type FaceId,
  type GameState,
  type Move,
  type Pose,
  type TileRef,
} from '../../shared/src/index';
import { canonDir, partnerCell, runsOf, turnOf } from '../../shared/src/bot/scripts/kit456';
import { beamRoute, opposite } from '../../shared/src/bot/scripts/laserPath';
import { watchShow } from '../../shared/src/bot/scripts/sequenceLaser';
import { readCode } from '../../shared/src/puzzles/hiddenCode';
import { QUIET_ARGS, quiet } from './quiet';

const BASE = process.env.BASE ?? 'http://localhost:5515';
const REPO = resolve(new URL('../../', import.meta.url).pathname);
const OUT = resolve(process.env.OUT ?? join(REPO, 'docs/status/puzzles/solo-game')) + '/';
const LIE = process.env.LIE === '1';
mkdirSync(OUT, { recursive: true });

/** Key pacing: the server allows a burst of 5 moves, then one per 90 ms. */
const STEP_MS = 130;
/** A face transition (the roll is 500 ms) and a little air. */
const FLIP_MS = 650;
/** One line of the AI: its words and its line key (none on a line a model wrote). */
interface Line {
  text: string;
  key: string;
}
/** Is this one of these lines of a puzzle script? `is(l, 'laser-path', 'in.ready', 'in.done')`. */
const is = (l: Line, id: string, ...names: string[]): boolean => names.some((n) => l.key === `${id}.${n}`);
const ARROW: Record<string, string> = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };

interface Snap {
  state: GameState | null;
  chat: ChatMessage[];
  side: string | null;
  mode: string | null;
  pending: number;
  screen: string;
  clock: string;
  caption: string;
  typing: boolean;
  win: boolean;
}
interface CaptionSeen {
  text: string;
  /** How long it stayed up, and how long its length asks for. */
  shownMs: number;
  box: { x: number; y: number; w: number; h: number };
  view: { x: number; y: number; w: number; h: number };
  page: { w: number; h: number };
  /** The text is wider or taller than its own box. */
  cut: boolean;
  lines: number;
}

const out: string[] = [];
const say = (line = '') => {
  out.push(line);
  console.log(line);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const js = <T>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>;

// ---------- reading the page (never writing) ----------

const snap = (page: Page) =>
  js<Snap>(
    page,
    `(() => {
      const c = window.__cubic;
      const cap = document.querySelector('#cu-caption');
      return { state: c.state, chat: c.chat, side: c.side, mode: c.room?.mode ?? null, pending: c.pending.length,
        screen: document.querySelector('.cu')?.dataset.screen ?? '',
        clock: document.querySelector('#cu-clock')?.textContent ?? '',
        caption: cap && !cap.hidden ? cap.textContent ?? '' : '',
        typing: document.activeElement instanceof HTMLInputElement,
        win: !!document.querySelector('#cu-win')?.classList.contains('on') };
    })()`,
  );
const labels = (page: Page) => js<string>(page, `typeof window.__cubicButtons === 'function' ? window.__cubicButtons().map((b) => b.label).sort().join('|') : ''`);

/** Runs in the page before the game: watches the caption box and the browser voice. Reads only. */
const WATCH = `(() => {
  const w = window;
  w.__soloCaptions = [];
  w.__soloSpoken = [];
  w.__soloSpeechErrors = [];
  if (typeof speechSynthesis !== 'undefined') {
    // speak() is already the silent stub of ./quiet.ts (the context's init script runs first):
    // this only records what the app asked the browser voice to say. Nothing is spoken.
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => {
      if (u.text && u.volume > 0) w.__soloSpoken.push(u.text);
      u.addEventListener('error', (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') w.__soloSpeechErrors.push(e.error + ': ' + u.text); });
      return speak(u);
    };
  }
  let last = null;
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  setInterval(() => {
    const cap = document.querySelector('#cu-caption');
    const view = document.querySelector('#cu-view');
    const text = cap && view && !cap.hidden ? cap.textContent : '';
    if (last && last.text !== text) { last.shownMs = Date.now() - last.at; last = null; }
    if (text && !last) {
      const span = cap.querySelector('span');
      const lineH = parseFloat(getComputedStyle(cap).lineHeight) || 1;
      last = { text, at: Date.now(), shownMs: 0, box: box(cap.getBoundingClientRect()), view: box(view.getBoundingClientRect()),
        page: { w: innerWidth, h: innerHeight },
        cut: cap.scrollWidth > cap.clientWidth + 1 || cap.scrollHeight > cap.clientHeight + 1,
        lines: Math.round(span.getBoundingClientRect().height / lineH) };
      w.__soloCaptions.push(last);
    }
  }, 50);
})()`;

// ---------- the player ----------

class Player {
  /** Every chat line in the order it was seen, with the game clock. */
  readonly log: { who: 'YOU' | 'AI'; text: string; key: string; clock: string }[] = [];
  /** AI lines not yet handed to a puzzle. */
  private inbox: Line[] = [];
  private lastId = 0;
  /** What the AI said in the eight seconds after each strike. */
  readonly afterStrike: { strikes: number; puzzle: string; lines: string[]; until: number }[] = [];
  private strikes = 0;
  puzzle = 'start';
  /** One picture per face with the AI's caption on it. */
  private shotOf = new Set<FaceId>();
  wantShot: FaceId | null = null;
  last!: Snap;

  constructor(readonly page: Page) {}

  /** Read the page once: new chat lines go to the log, the AI's also to the inbox. */
  async look(): Promise<Snap> {
    const s = await snap(this.page);
    this.last = s;
    for (const m of s.chat) {
      if (m.id <= this.lastId) continue;
      this.lastId = m.id;
      this.log.push({ who: m.isAI ? 'AI' : 'YOU', text: m.text, key: m.key ?? '', clock: s.clock });
      if (m.isAI) {
        this.inbox.push({ text: m.text, key: m.key ?? '' });
        for (const a of this.afterStrike) if (Date.now() < a.until) a.lines.push(m.text);
      }
    }
    if (s.state && s.state.strikes > this.strikes) {
      this.strikes = s.state.strikes;
      this.afterStrike.push({ strikes: this.strikes, puzzle: this.puzzle, lines: [], until: Date.now() + 8000 });
    }
    // one picture per face: me on that face, with a line of the AI about its puzzle as the caption
    const face = this.wantShot;
    const shown = s.caption.startsWith('AI') ? [...s.chat].reverse().find((m) => m.isAI && s.caption.includes(m.text)) : undefined;
    if (face && !this.shotOf.has(face) && s.state?.players.out.pose.face === face && shown?.key && isPuzzleLine(shown.key)) {
      this.shotOf.add(face);
      await this.page.screenshot({ path: `${OUT}face-${face}.png` });
    }
    return s;
  }

  get state(): GameState {
    if (!this.last.state) throw new Error('not in a game');
    return this.last.state;
  }
  /** What the outside player sees, on their own screen. */
  get o() {
    return observe(this.state, 'out');
  }
  /** The objects of one type the outside player sees on a face (canonical tiles). */
  seen(face: FaceId, type: string) {
    return visibleObjects(this.state, 'out', face).filter((x) => x.type === type);
  }
  solved(face: FaceId): boolean {
    return this.state.solved.includes(face);
  }
  /** The AI is on the other side of this very wall (the signal the HUD shows as full). */
  together(): boolean {
    return voiceMix(this.state).gain >= 1;
  }
  /** The AI lines that came in since the last call. */
  heard(): Line[] {
    return this.inbox.splice(0);
  }

  /** Poll until `done` says so. It is handed the AI's new lines each time. */
  async until(what: string, ms: number, done: (lines: Line[]) => Promise<boolean> | boolean): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      await this.look();
      if (await done(this.heard())) return;
      if (Date.now() > end) throw new Error(`timed out (${Math.round(ms / 1000)} s) waiting for: ${what}`);
      await sleep(120);
    }
  }

  async press(...keys: string[]): Promise<void> {
    for (const k of keys) {
      await this.page.keyboard.press(k);
      await sleep(STEP_MS);
    }
  }

  /** Type one line in the chat box: Enter opens it, Enter sends it, Esc gives the keys back to the game. */
  async tell(text: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = (await this.look()).chat.filter((m) => !m.isAI).length;
      if (!this.last.typing) await this.press('Enter');
      await this.page.keyboard.type(text, { delay: 15 });
      await this.press('Enter', 'Escape');
      const end = Date.now() + 2500;
      while (Date.now() < end) {
        if ((await this.look()).chat.filter((m) => !m.isAI).length > before) return;
        await sleep(100);
      }
      await sleep(1500); // the chat rate limit: five lines in five seconds
    }
    throw new Error(`the chat did not take "${text}"`);
  }

  /** Walk to a pose with the arrow keys, planned on what is on screen with the game's own pathfinding. */
  async goTo(what: string, goal: (p: Pose) => boolean): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.until('every key acknowledged', 4000, () => this.last.pending === 0);
      if (this.last.typing) await this.press('Escape');
      const pose = this.state.players.out.pose;
      if (goal(pose)) return;
      const path: Move[] | null = findPath(this.state, 'out', goal, defaultEnv);
      if (!path) throw new Error(`no way to ${what} from face ${pose.face} (${pose.x},${pose.y})`);
      let face = pose.face;
      for (const m of path) {
        await this.page.keyboard.press(ARROW[`${m[0]},${m[1]}`]!);
        await sleep(STEP_MS);
        const now = (await this.look()).state!.players.out.pose.face;
        if (now !== face) await sleep(FLIP_MS);
        face = now;
      }
    }
    throw new Error(`did not reach ${what} in 5 tries`);
  }
  goToTile(t: TileRef): Promise<void> {
    return this.goTo(`face ${t.face} (${t.x},${t.y})`, (p) => p.face === t.face && p.x === t.x && p.y === t.y);
  }

  /** Walk onto a face and wait for the AI behind the same wall. */
  async meetOn(face: FaceId, ms = 120_000): Promise<void> {
    await this.goTo(`face ${face}`, (p) => p.face === face);
    await this.until(`the AI behind the wall of face ${face}`, ms, () => this.together());
  }
}

/** Said at most once every `ms`: an answer to a question the AI may ask twice. */
function paced(ms: number) {
  let at = 0;
  return () => (Date.now() - at < ms ? false : ((at = Date.now()), true));
}
const numberOf = (word: string): number => (/^\d+$/.test(word) ? Number(word) : (VOCAB_NUMBERS as readonly string[]).indexOf(word));

// ---------- the six puzzles, as the outside human ----------

/** Face 1: read the number in the grass and type it; the AI types it on the keypad inside. */
async function hiddenCode(p: Player): Promise<void> {
  await p.meetOn(1);
  const code = readCode(p.seen(1, 'code-mark'));
  if (!code) throw new Error('no number to read in the grass of face 1');
  const spaced = (c: string) => [...c].join(' ');
  await p.tell(spaced(LIE ? [...code].map((d) => (Number(d) + 1) % 10).join('') : code));
  const again = paced(4000);
  await p.until('face 1 solved', 90_000, async (lines) => {
    if (p.solved(1)) return true;
    // "What's the first digit?", "That code was wrong. Tell me the three digits again."
    if (lines.some((l) => is(l, 'hidden-code', 'ask.first', 'ask.next', 'wrong')) && again()) await p.tell(spaced(code));
    return false;
  });
}

/** One row of the symbol in the row convention: "row 3 skip 3 flip 1 skip 5 flip 1", counted from my left. */
function rowLine(y: number, xs: number[]): string {
  if (xs.length === 0) return `row ${y + 1} skip`;
  const parts: string[] = [];
  const last = Math.max(...xs);
  for (let x = 0; x <= last; ) {
    const on = xs.includes(x);
    let n = 0;
    while (x <= last && xs.includes(x) === on) [x, n] = [x + 1, n + 1];
    parts.push(`${on ? 'flip' : 'skip'} ${n}`);
  }
  return `row ${y + 1} ${parts.join(' ')}`;
}

/**
 * Face 3: read the symbol in the snow out row by row, one row each time the AI says the last
 * is done. After an empty row the AI has nothing to flip and says nothing: the next row
 * follows at once, as a person would say it.
 */
async function mirroredGlyph(p: Player): Promise<void> {
  await p.meetOn(3);
  let y = 0;
  let cleared = false;
  const xs = () => p.seen(3, 'f3-glyph').filter((g) => g.y === y).map((g) => g.x);
  const row = async () => {
    for (;;) {
      const empty = xs().length === 0;
      await p.tell(rowLine(y, xs()));
      if (!empty || y >= 11) return;
      y++;
    }
  };
  await row();
  const again = paced(4000);
  await p.until('face 3 solved', 240_000, async (lines) => {
    if (p.solved(3)) return true;
    for (const l of lines) {
      if (is(l, 'mirrored-glyph', 'in.next')) {
        y++;
        if (y < 12) await row();
        else if (!cleared) {
          // every row said and it is not the symbol: start over once
          cleared = true;
          await p.tell('clear');
        }
      } else if (is(l, 'mirrored-glyph', 'in.cleared')) {
        y = 0;
        await row();
      } else if (is(l, 'mirrored-glyph', 'in.ask') && y < 12 && again()) await row();
    }
    return false;
  });
}

/** Face 2: count the bushes, the birds and the rocks; the AI works out the answer and types it. */
async function equationSafe(p: Player): Promise<void> {
  await p.meetOn(2);
  const n = () => ({ bushes: p.seen(2, 'f2-bush').length, birds: p.seen(2, 'f2-bird').length, rocks: p.seen(2, 'f2-rock').length });
  const all = () => p.tell(`${n().bushes} bushes ${n().birds} birds ${n().rocks} ${n().rocks === 1 ? 'rock' : 'rocks'}`);
  await all();
  const again = paced(4000);
  await p.until('face 2 solved', 90_000, async (lines) => {
    if (p.solved(2)) return true;
    for (const l of lines) {
      const asked = (['bushes', 'birds', 'rocks'] as const).find((k) => is(l, 'equation-safe', `ask.${k}`));
      if (asked) await p.tell(String(n()[asked]));
      else if (is(l, 'equation-safe', 'wrong') && again()) await all();
    }
    return false;
  });
}

/** Face 5: wait for power, press REPLAY, watch the symbols light up, type the order. */
async function sequenceLaser(p: Player): Promise<void> {
  await p.goTo('face 5', (q) => q.face === 5);
  const replay = () => p.seen(5, 'f5-replay')[0];
  // the AI is carrying the battery from the safe of face 2 to the emitter under this roof
  await p.until('the laser of face 5 to have power (the AI carries the battery)', 180_000, () => replay()?.state === 'on');
  let order: string[] | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    await p.goToTile({ face: 5, x: replay()!.x, y: replay()!.y });
    await p.press('e');
    const watch = { at: Date.now(), seen: [] as string[] };
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      await p.look();
      const got = watchShow(watch, p.seen(5, 'f5-symbol').map((s) => s.state), Date.now());
      if (got === 'again') break;
      if (got) order = got;
      if (order) break;
      await sleep(50);
    }
  }
  if (!order) throw new Error('could not watch a whole show on face 5');
  await p.until('the AI behind the wall of face 5', 120_000, () => p.together());
  const all = async () => {
    await p.tell(order.slice(0, 3).join(' '));
    await p.tell(order.slice(3).join(' '));
  };
  p.heard(); // what it said on the way is not a question about the order
  await all();
  const again = paced(6000);
  await p.until('face 5 solved', 150_000, async (lines) => {
    if (p.solved(5)) return true;
    // "What is the first symbol?", "What is next?", "Tell me the order again from the start."
    if (lines.some((l) => is(l, 'sequence-laser', 'in.first', 'in.next', 'in.strike')) && again()) await all();
    return false;
  });
}

/** Face 6: push the mirrors until the crate burns, take the flower, then talk the AI over the lava. */
async function laserPath(p: Player): Promise<void> {
  await p.goTo('face 6', (q) => q.face === 6);
  const one = (type: string, state?: string) => p.seen(6, type).find((x) => state === undefined || x.state === state);
  const reset = async () => {
    const r = one('reset');
    if (!r) throw new Error('no RESET on face 6');
    await p.goToTile({ face: 6, x: r.x, y: r.y });
    await p.press('e');
  };
  for (let n = 0; one('f6-crate')?.state !== 'burnt'; n++) {
    if (n > 60) throw new Error('the crate of face 6 does not burn');
    const push = mirrorPush(one('f6-mirror', 'fwd'), one('f6-mirror', 'back'), one('f6-source'), one('f6-crate'));
    if (push === null) throw new Error('face 6 shows no mirrors');
    if (push === 'reset') await reset();
    else if (push !== 'set') {
      await p.goToTile({ face: 6, ...push.stand });
      const d = VEC[canonDir(p.o, push.dx, push.dy)];
      await p.press(ARROW[`${d.col},${d.row}`]!);
    }
    await sleep(300);
    await p.look();
  }
  // the mirrors are locked now and the beam I see is the path: from the edge tile where the
  // crate stood, back along the beam to its source
  const drawn = () => beamRoute(p.o.objects);
  if (!drawn()) throw new Error('the crate of face 6 is burnt, but I cannot read the beam off my screen');
  const flower = p.o.items.find((i) => i.kind.startsWith('flower-'));
  if (!p.o.carrying && flower) {
    await p.goToTile({ face: 6, ...canonOf(p.o, flower) });
    await p.press('e');
    await p.until('the flower in my hands', 4000, () => !!p.o.carrying?.startsWith('flower-'));
  }
  await p.until('the AI behind the wall of face 6', 120_000, () => p.together());

  // I stand still from here: every direction below is turned from MY screen to THEIRS by k.
  const path = drawn()!;
  const inward = path.steps[0]!;
  const side = `face ${p.o.edges[opposite(dirOf(inward)!)].face}`;
  let k = 0;
  let i = 0;
  let chunk = 0;
  let tile = '';
  const steps = async () => {
    const dirs: Dir[] = path.steps.map((v) => dirOf(throughWall(v, k))!);
    const runs = runsOf(dirs.slice(i)).slice(0, 2);
    chunk = runs.reduce((n, r) => n + r[1], 0);
    i += chunk;
    await p.tell(runs.map(([d, n]) => `${d} ${n}`).join(' then ') + (i >= dirs.length ? ' then press' : ''));
  };
  p.heard();
  await p.tell(side);
  const sideAgain = paced(6000);
  const tileAgain = paced(6000);
  await p.until('face 6 solved', 300_000, async (lines) => {
    if (p.solved(6)) return true;
    for (const l of lines) {
      const lava = (['up', 'down', 'left', 'right'] as const).find((d) => is(l, 'laser-path', `in.lava.${d}`));
      if (lava) {
        // the same step on my screen and on theirs: now I know how their screen is turned
        const said: Dir = lava;
        k = turnOf(inward, said);
        const theirs = partnerCell(path.ring, k);
        tile = said === 'left' || said === 'right' ? `row ${theirs.row + 1}` : `column ${theirs.col + 1}`;
        i = 0;
        tileAgain();
        await p.tell(tile);
      } else if (is(l, 'laser-path', 'in.side')) {
        if (sideAgain()) await p.tell(side);
      } else if (is(l, 'laser-path', 'in.tile')) {
        if (tile && tileAgain()) await p.tell(tile);
      } else if (is(l, 'laser-path', 'in.fell')) {
        i = 0;
        await steps();
      } else if (is(l, 'laser-path', 'in.ready', 'in.done')) {
        if (i < path.steps.length) await steps();
      } else if (is(l, 'laser-path', 'in.ask') && chunk) {
        // it heard nothing it could walk: the last line once more
        i -= chunk;
        await steps();
      }
    }
    return false;
  });
}

/**
 * Face 4: five flowers (the crate's in my hands, four lying on faces 1, 2, 3 and 5) go into five
 * solid pots. The AI names every pot with the colour of its twin inside ("the pot is row three
 * column nine the flower is pink"); each flower is planted from the tile next to its pot, facing it.
 */
async function botanicalMirror(p: Player): Promise<void> {
  if (!p.o.carrying?.startsWith('flower-')) throw new Error('no flower to carry to face 4');
  p.heard();
  await p.meetOn(4);
  /** colour -> the pot's canonical tile, from the AI's relay lines */
  const pots = new Map<string, TileRef>();
  const again = paced(8000);
  let asked = false;
  await p.until('the AI to name every pot', 120_000, async (lines) => {
    for (const l of lines) {
      if (!is(l, 'botanical-mirror', 'relay')) continue;
      for (const m of l.text.matchAll(/pot is row (\w+) column (\w+)\W+the flower is (\w+)/gi))
        pots.set(m[3]!.toLowerCase(), { face: 4, x: numberOf(m[2]!.toLowerCase()) - 1, y: numberOf(m[1]!.toLowerCase()) - 1 });
    }
    if (pots.size >= 5) return true;
    if (!asked && again()) {
      asked = true;
      await p.tell('again');
    }
    return false;
  });
  const loose = () => Object.values(p.state.items).filter((i) => i.side === 'out' && i.kind.startsWith('flower-') && !i.placedOn && !i.carriedBy);
  /** The key that steps from `pose` into the tile without leaving the face (a bump when it is solid). */
  const into = (pose: Pose, t: TileRef) => Object.entries(ARROW).find(([d]) => ((to) => !to.crossed && to.pose.face === t.face && to.pose.x === t.x && to.pose.y === t.y)(stepPose(pose, ...(d.split(',').map(Number) as [number, number]))))?.[1];
  for (let n = 0; n < 5; n++) {
    await p.look();
    if (!p.state.players.out.carrying) {
      const flower = loose()[0];
      if (!flower) throw new Error(`no flower left to fetch (${n} planted)`);
      await p.goToTile({ face: flower.face, x: flower.x, y: flower.y });
      await p.press('e');
      await p.until('the flower in my hands', 4000, () => !!p.state.players.out.carrying);
    }
    const id = p.state.players.out.carrying!;
    const colour = p.state.items[id]!.kind.slice('flower-'.length);
    const pot = pots.get(colour);
    if (!pot) throw new Error(`the AI named no pot for the ${colour} flower`);
    await p.goTo(`next to the ${colour} pot`, (q) => q.face === 4 && !!into(q, pot));
    await p.press(into(p.state.players.out.pose, pot)!); // face the pot
    await p.press('e');
    await p.until(`the ${colour} flower planted`, 6000, () => !!p.state.items[id]?.placedOn);
  }
  await p.until('face 4 solved', 30_000, () => p.solved(4));
}

const CHAIN: { face: FaceId; id: string; play: (p: Player) => Promise<void> }[] = [
  { face: 1, id: 'hidden-code', play: hiddenCode },
  { face: 3, id: 'mirrored-glyph', play: mirroredGlyph },
  { face: 2, id: 'equation-safe', play: equationSafe },
  { face: 5, id: 'sequence-laser', play: sequenceLaser },
  { face: 6, id: 'laser-path', play: laserPath },
  { face: 4, id: 'botanical-mirror', play: botanicalMirror },
];

// ---------- the run ----------

// headless and silent: no sound from Chromium, and the browser voice is a stub (./quiet.ts)
const browser = await chromium.launch({ headless: true, args: QUIET_ARGS });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await quiet(context);
const page = await context.newPage();
const errors: string[] = [];
const warnings: string[] = [];
/** Socket events that carry the AI's voice, by name. */
const voiced: Record<string, number> = { tts: 0, 'tts:chain': 0, speak: 0 };
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
  else if (m.type() === 'warning' && /\[voice\]/.test(m.text())) warnings.push(m.text().slice(0, 300));
});
page.on('websocket', (ws) =>
  ws.on('framereceived', (f) => {
    const name = /^\d+-?\["([^"]+)"/.exec(typeof f.payload === 'string' ? f.payload : '')?.[1];
    if (name && name in voiced) voiced[name]!++;
  }),
);
await page.addInitScript(WATCH);

const player = new Player(page);
let failed = false;
try {
  // PLAY SOLO as OUTSIDE, by keyboard, through the mode screen and the side popup
  await page.goto(`${BASE}/?renderer=canvas`);
  const waitFor = async (what: string, cond: () => Promise<boolean>, ms = 10_000) => {
    const end = Date.now() + ms;
    while (!(await cond().catch(() => false))) {
      if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
      await sleep(100);
    }
  };
  await waitFor('the title screen (is the client running?)', async () => (await labels(page)) === 'PLAY', 20_000);
  await player.press('Enter');
  await waitFor('the mode screen', async () => (await labels(page)).includes('PLAY SOLO') && !(await labels(page)).includes('OUTSIDE'));
  await sleep(1200); // the choices have landed
  await player.press('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
  await waitFor('the side popup, on OUTSIDE', async () => (await js<{ kind: string; focus: string } | null>(page, 'window.__cubicPopup()'))?.focus === 'out');
  await sleep(400);
  await player.press('Enter');
  await waitFor('a solo game as OUTSIDE (is the server running?)', async () => {
    const s = await snap(page);
    return s.screen === 'game' && s.side === 'out' && s.mode === 'ai' && !!s.state;
  });
  await sleep(1500); // the fade into the game
  await player.look();
  say(`solo game: ${BASE}, outside, seed ${player.state.seed}${LIE ? ', LIE=1 (a wrong code first)' : ''}`);

  for (const step of CHAIN) {
    player.puzzle = step.id;
    player.wantShot = step.face;
    const from = player.log.length;
    let error = '';
    try {
      await step.play(player);
      await player.look();
    } catch (e) {
      error = e instanceof Error ? e.message.split('\n')[0]! : String(e);
      await page.screenshot({ path: `${OUT}fail-face-${step.face}.png` }).catch(() => {});
    }
    const lines = player.log.slice(from);
    say(`${error ? 'FAIL' : 'PASS'}  face ${step.face} ${step.id}  time ${player.last.clock}  strikes ${player.last.state?.strikes ?? '?'}  chat: you ${lines.filter((l) => l.who === 'YOU').length}, AI ${lines.filter((l) => l.who === 'AI').length}${error ? `  (${error})` : ''}`);
    for (const l of lines) say(`      ${l.clock} ${l.who.padEnd(3)} ${l.text}${l.key ? `   [${l.key}]` : ''}`);
    if (error) throw new Error(`face ${step.face} ${step.id}: ${error}`);
  }

  await player.until('the win screen (#cu-win)', 15_000, () => player.last.win && player.state.wonAt !== null);
  await sleep(1200);
  await page.screenshot({ path: `${OUT}win.png` });
  await sleep(4000); // the AI's last words
  await player.look();
  const all = player.log;
  const winTime = await js<string>(page, `document.querySelector('#cu-wintime')?.textContent ?? ''`);
  say(`PASS  the win screen  escaped in ${winTime}  strikes ${player.state.strikes}  chat: you ${all.filter((l) => l.who === 'YOU').length}, AI ${all.filter((l) => l.who === 'AI').length}`);
} catch (e) {
  failed = true;
  say(`FAIL  ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
}

// ---------- what only the browser shows ----------

const captions = await js<CaptionSeen[]>(page, 'window.__soloCaptions ?? []').catch(() => []);
const spoken = await js<string[]>(page, 'window.__soloSpoken ?? []').catch(() => []);
const speechErrors = await js<string[]>(page, 'window.__soloSpeechErrors ?? []').catch(() => []);
const ai = player.log.filter((l) => l.who === 'AI');
say();
say(`voice: ${ai.length} AI lines; socket events tts ${voiced.tts}, tts:chain ${voiced['tts:chain']}, speak ${voiced.speak}; the browser voice was asked for ${spoken.length} (stubbed: nothing is spoken); voice warnings ${warnings.length}, speech errors ${speechErrors.length}`);
for (const w of [...warnings, ...speechErrors]) say(`      ${w}`);

// A relay line only comes as tts:chain once every vocabulary piece has a banked clip. Until
// then the path is probed here, after the game, the way app.ts calls it: two banked clips
// in a chain, then a chain with a clip that cannot be decoded (it must fall back).
const bank = join(REPO, 'server/tts/bank');
const clips = readdirSync(bank).filter((f) => f.endsWith('.mp3')).slice(0, 2).map((f) => readFileSync(join(bank, f)).toString('base64'));
const before = warnings.length;
const probe = await js<{ ok: boolean; bad: boolean } | string>(
  page,
  `(async () => {
    const voice = window.__cubicVoice;
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const chain = (clips) => ({ chatId: 0, mime: 'audio/mpeg', pieces: clips.map(() => 'row'), clips, gapMs: 90 });
    let ok = true;
    let bad = false;
    await voice.playChain(chain(${JSON.stringify(clips)}.map(bytes)), () => { ok = false; });
    await voice.playChain(chain([bytes(${JSON.stringify(clips[0] ?? '')}), new Uint8Array([1, 2, 3, 4]).buffer]), () => { bad = true; voice.speakText('row one'); });
    return { ok, bad };
  })()`,
).catch((e: unknown) => String(e));
await sleep(300);
const chainOk = typeof probe !== 'string' && probe.ok && probe.bad && clips.length === 2;
say(`tts:chain probe: ${typeof probe === 'string' ? probe : `${clips.length} banked clips in a chain ${probe.ok ? 'played' : 'FELL BACK'}; a clip that cannot be decoded ${probe.bad ? 'fell back to the browser voice' : 'DID NOT fall back'} (${warnings.length - before} warning, expected 1)`}`);

say(`strikes: ${player.afterStrike.length}`);
for (const a of player.afterStrike) {
  say(`      strike ${a.strikes} (${a.puzzle}): the AI then said ${a.lines.length} line(s)`);
  for (const l of a.lines) say(`        AI  ${l}`);
}
const huh = ai.filter((l) => l.key === 'huh');
if (huh.length) say(`not understood: the AI said "I did not get that" ${huh.length} time(s)`);

const aiCaptions = captions.filter((c) => c.text.startsWith('AI'));
const bad = aiCaptions.filter((c) => c.cut || c.box.x < 0 || c.box.y < 0 || c.box.x + c.box.w > c.page.w || c.box.y + c.box.h > c.page.h || c.box.x < c.view.x - 1 || c.box.x + c.box.w > c.view.x + c.view.w + 1);
const longest = [...aiCaptions].sort((a, b) => b.text.length - a.text.length)[0];
const short = aiCaptions.filter((c) => c.shownMs > 0 && c.shownMs < 1200 + (c.text.length - 4) * 65 - 300 && c.shownMs < 8700);
say(`captions: ${aiCaptions.length} AI captions, ${bad.length} outside the game view or cut, at most ${Math.max(0, ...aiCaptions.map((c) => c.lines))} line(s) high; ${short.length} replaced by the next line before their reading time was up`);
if (longest) say(`      longest: ${longest.text.length} characters in a ${longest.box.w}x${longest.box.h} box at (${longest.box.x},${longest.box.y}), ${longest.lines} line(s); the view is ${longest.view.w} wide at x ${longest.view.x}: "${longest.text}"`);
for (const c of bad) say(`      does not fit: box ${JSON.stringify(c.box)} view ${JSON.stringify(c.view)} cut=${c.cut} "${c.text}"`);
if (errors.length) {
  failed = true;
  say(`page errors: ${errors.length}`);
  for (const e of [...new Set(errors)]) say(`      ${e}`);
}
if (bad.length || speechErrors.length || !chainOk) failed = true;

writeFileSync(`${OUT}solo-game.log`, out.join('\n') + '\n');
await browser.close();
console.log(`\nlog: ${OUT}solo-game.log`);
if (failed) process.exit(1);
console.log('solo-game: all good');
