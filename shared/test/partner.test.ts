import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CORE_LINES,
  FACES,
  FACE_SIZE,
  PUZZLE_SCRIPTS,
  applyMove,
  canonToScreen,
  createGame,
  decide,
  defaultEnv,
  devTeleport,
  faceDistance,
  findPath,
  isPuzzleLine,
  lineKeys,
  newMind,
  nextStep,
  observe,
  parseHuman,
  parseStringMap,
  type FaceId,
  type GameEnv,
  type GameState,
  type Heard,
  type Mind,
  type PuzzleModule,
  type PuzzleScript,
  type Side,
  type World,
} from '../src/index';

// THE PARTNER CORE, on a cube of its own: blank faces, a portal, and made-up puzzles. Nothing
// here knows the real puzzles, how many there are, or which faces they are on: that is the
// point. The real puzzle scripts are tested in partnerScripts.test.ts.

const T0 = 1_700_000_000_000;
const STEP = 200;
const other = (s: Side): Side => (s === 'out' ? 'in' : 'out');
const BLANK = Array<string>(FACE_SIZE).fill('.'.repeat(FACE_SIZE));
const withRow = (row: number, text: string) => BLANK.map((r, i) => (i === row ? text.padEnd(FACE_SIZE, '.') : r));

/** A made-up puzzle: a widget both sides can see at 6,6. Solved when the OUTSIDE player stands on 3,3 of its face. */
const mystery = (id: string, face: FaceId): PuzzleModule<{ done: boolean }> => ({
  id,
  face,
  init: () => ({ done: false }),
  onEnter(s, _ctx, side, tile) {
    if (side === 'out' && tile.x === 3 && tile.y === 3) s.done = true;
  },
  isSolved: (s) => s.done,
  visible: () => [{ type: 'widget', x: 6, y: 6, state: 'idle' }],
});

/** A cube with a portal on `portalFace` and the given puzzles. */
function world(portalFace: FaceId, puzzles: PuzzleModule<{ done: boolean }>[]): GameEnv {
  const w = { out: {}, in: {} } as World;
  for (const side of ['out', 'in'] as const) for (const f of FACES) w[side][f] = parseStringMap(side, f, f === portalFace ? withRow(5, '.....OO') : BLANK);
  return { world: w, puzzles };
}

interface Run {
  state: GameState;
  mind: Mind;
  lines: string[];
  statuses: string[];
  /** Tiles the bot stood on: "face:x,y". */
  trodden: string[];
  say(text: string): void;
  /** Advance `ticks` bot steps. `human` acts once per tick. */
  go(ticks: number, human?: (s: GameState) => void): void;
}
function start(env: GameEnv, ai: Side, scripts: readonly PuzzleScript<never>[] = []): Run {
  const state = createGame(T0, env);
  const mind = newMind();
  let now = T0;
  const chat: Heard[] = [];
  const r: Run = {
    state,
    mind,
    lines: [],
    statuses: [],
    trodden: [],
    say: (text) => void chat.push(parseHuman(text)),
    go(ticks, human) {
      for (let i = 0; i < ticks && state.wonAt === null; i++) {
        now += STEP;
        const d = decide(mind, observe(state, ai, env), chat.splice(0), now, scripts);
        r.lines.push(...d.say.map((x) => x.key));
        r.statuses.push(d.status);
        const step = nextStep(state, ai, d, env);
        if (step && step !== 'interact') applyMove(state, ai, step[0], step[1], now, env);
        const p = state.players[ai].pose;
        r.trodden.push(`${p.face}:${p.x},${p.y}`);
        human?.(state);
      }
      if (state.wonAt !== null) r.lines.push(...decide(mind, observe(state, ai, env), [], now + STEP, scripts).say.map((x) => x.key));
    },
  };
  return r;
}
/** One human step towards a face or a tile. */
function walk(state: GameState, env: GameEnv, side: Side, goal: FaceId | { face: FaceId; x: number; y: number }): void {
  const path = findPath(state, side, (p) => (typeof goal === 'number' ? p.face === goal : p.face === goal.face && p.x === goal.x && p.y === goal.y), env);
  if (path?.length) applyMove(state, side, path[0]![0], path[0]![1], T0, env);
}

// ---------- finding the human ----------

test('it finds the human on any face by voice alone, and stays on their wall', () => {
  const env = world(6, [mystery('a', 2)]);
  for (const ai of ['out', 'in'] as const) {
    for (const face of FACES) {
      const r = start(env, ai);
      devTeleport(r.state, other(ai), face, T0, env);
      r.go(400);
      assert.equal(r.state.players[ai].pose.face, face, `ai=${ai}: human on face ${face}, bot on ${r.state.players[ai].pose.face}`);
      const steps = r.state.players[ai].steps;
      r.go(50);
      assert.equal(r.state.players[ai].steps, steps, 'it wandered off after finding them');
    }
  }
});

test('"face N" sends it straight there; a face the voice rules out is not believed', () => {
  const env = world(6, [mystery('a', 2)]);
  const state = createGame(T0, env);
  const far = FACES.find((f) => faceDistance(1, f) === 2)!;
  const near = FACES.filter((f) => faceDistance(1, f) === 1);
  devTeleport(state, 'out', near[2]!, T0, env);
  const mind = newMind();
  const d = decide(mind, observe(state, 'in', env), [parseHuman(`face ${near[2]}`)], T0);
  assert.deepEqual(d.action, { type: 'go_face', face: near[2] });
  assert.deepEqual(mind.cands, [near[2]]);
  // The voice is faint, so the human is on a next face: "the far face" cannot be true.
  const lied = decide(newMind(), observe(state, 'in', env), [parseHuman(`face ${far}`)], T0);
  assert.notDeepEqual(lied.action, { type: 'go_face', face: far });
});

test('it says who it is once, and where the human went when it loses them', () => {
  const env = world(6, [mystery('a', 2)]);
  const r = start(env, 'in');
  r.go(3);
  assert.deepEqual(r.lines, ['hello.in', 'next']); // and that there is more to solve somewhere
  const out = start(env, 'out');
  devTeleport(out.state, 'in', FACES.find((f) => faceDistance(1, f) === 2)!, T0, env);
  out.go(2);
  assert.deepEqual(out.lines, ['hello.out', 'follow.far']);
});

// ---------- the portal ----------

test('with every puzzle solved it walks into the portal and waits there: the game is won', () => {
  for (const portalFace of [6, 3] as FaceId[]) {
    const env = world(portalFace, []); // no puzzles at all: the portal is awake from the start
    for (const ai of ['out', 'in'] as const) {
      const r = start(env, ai);
      r.go(600, (s) => walk(s, env, other(ai), { face: portalFace, x: 5, y: 5 }));
      assert.notEqual(r.state.wonAt, null, `ai=${ai} portal on face ${portalFace}`);
      assert.ok(r.lines.includes('portal.in') && r.lines.includes('win'));
    }
  }
});

test('solving the last puzzle wakes the portal: "solved" for each one before, then the portal', () => {
  const env = world(6, [mystery('a', 2), mystery('b', 4)]);
  const r = start(env, 'in');
  const goals: FaceId[] = [2, 4];
  r.go(1500, (s) => {
    const next = goals.find((f) => !s.solved.includes(f));
    if (next !== undefined) walk(s, env, 'out', { face: next, x: 3, y: 3 });
    else walk(s, env, 'out', { face: 6, x: 5, y: 5 });
  });
  assert.notEqual(r.state.wonAt, null);
  assert.equal(r.lines.filter((l) => l === 'solved').length, 1); // the last solve is the portal's moment
  assert.ok(r.lines.indexOf('solved') < r.lines.indexOf('portal.go'));
});

// ---------- a puzzle it has no script for ----------

test('a puzzle with no script: it says so, keeps off everything it can see there, and does not stall', () => {
  const env = world(6, [mystery('never-heard-of-it', 2)]);
  for (const ai of ['out', 'in'] as const) {
    const r = start(env, ai, PUZZLE_SCRIPTS as never); // the real registry: it has no such id
    devTeleport(r.state, other(ai), 2, T0, env);
    r.go(300);
    assert.equal(r.state.players[ai].pose.face, 2);
    assert.ok(r.lines.includes('unknown'), r.lines.join(' '));
    assert.match(r.statuses.at(-1)!, /no script for \(never-heard-of-it\)/);
    // The widget is off limits, in the bot's own screen coordinates.
    const pose = r.state.players[ai].pose;
    const d = decide(r.mind, observe(r.state, ai, env), [], T0 + 1e6, PUZZLE_SCRIPTS);
    assert.deepEqual(d.avoid, [{ col: canonToScreen(ai, 2, pose.up, 6, 6)[0], row: canonToScreen(ai, 2, pose.up, 6, 6)[1] }]);
    // The human walks right across the face and on to the next one: the bot follows, around the widget.
    const far = FACES.find((f) => faceDistance(2, f) === 2)!;
    r.go(600, (s) => walk(s, env, other(ai), far));
    assert.equal(r.state.players[ai].pose.face, far);
    assert.ok(!r.trodden.includes('2:6,6'), 'it stepped on the thing it does not understand');
    // It can still finish the game once the human solves that puzzle alone.
    r.go(1500, (s) => walk(s, env, 'out', s.solved.length ? { face: 6, x: 5, y: 5 } : { face: 2, x: 3, y: 3 }));
    if (ai === 'in') assert.notEqual(r.state.wonAt, null);
  }
});

// ---------- the registry ----------

test('a script for a puzzle that is not in the game is never asked; a script for one that is, is', () => {
  const env = world(6, [mystery('here', 2)]);
  const asked: string[] = [];
  const script = (id: string): PuzzleScript<{ n: number }> => ({
    id,
    lines: [`${id}.hi`],
    init: () => ({ n: 0 }),
    hazards: () => [{ col: 1, row: 1 }, { col: 2, row: 2 }],
    play({ mem, say }) {
      asked.push(id);
      mem.n++;
      say(`${id}.hi`);
      say('some.other.line'); // not one of its own: dropped
      return { action: null, hold: true, allow: [{ col: 1, row: 1 }], status: `${id} ${mem.n}` };
    },
    errand: () => (asked.push(`${id}:errand`), null),
  });
  const scripts = [script('gone'), script('here')] as never;
  const r = start(env, 'in', scripts);
  r.go(5);
  assert.deepEqual(asked.filter((a) => a.startsWith('gone')), []); // not in this game: no play, no errand
  assert.ok(asked.includes('here:errand') && !asked.includes('here')); // an errand is asked on any face
  devTeleport(r.state, 'out', 2, T0, env);
  r.go(200);
  assert.ok(asked.includes('here'));
  assert.ok(r.lines.includes('here.hi') && !r.lines.includes('some.other.line') && !r.lines.includes('unknown'));
  const d = decide(r.mind, observe(r.state, 'in', env), [], T0 + 1e6, scripts);
  assert.deepEqual([d.hold, d.action, d.avoid], [true, null, [{ col: 2, row: 2 }]]); // its hazards, minus what it allowed
  assert.match(d.status, /^here \d+$/);
  // Its memory lasts while the bot stays on the face, and starts over when it comes back.
  const n = (r.mind.scripts.here as { n: number }).n;
  assert.ok(n > 1);
  devTeleport(r.state, 'out', 1, T0, env);
  r.go(200);
  devTeleport(r.state, 'out', 2, T0, env);
  r.go(200);
  assert.ok((r.mind.scripts.here as { n: number }).n < n + 200);
  assert.equal(r.lines.filter((l) => l === 'here.hi').length, 2); // said again on the second visit
});

test('the real registry: one script per id, every line named after its puzzle, no clash with the core', () => {
  const ids = PUZZLE_SCRIPTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of PUZZLE_SCRIPTS) for (const line of s.lines) assert.ok(line.startsWith(`${s.id}.`), `${s.id}: ${line}`);
  const keys = lineKeys();
  assert.equal(new Set(keys).size, keys.length);
  for (const key of CORE_LINES) assert.equal(isPuzzleLine(key), false);
  for (const s of PUZZLE_SCRIPTS) for (const line of s.lines) assert.equal(isPuzzleLine(line), true);
  // On the real cube every decision still works for puzzles with and without a script.
  for (const side of ['out', 'in'] as const) {
    for (const face of FACES) {
      const s = createGame(T0);
      devTeleport(s, 'out', face, T0);
      devTeleport(s, 'in', face, T0);
      const d = decide(newMind(), observe(s, side), [], T0, []); // no scripts at all
      const puzzle = defaultEnv.puzzles.find((p) => p.face === face);
      assert.equal(d.say.some((x) => x.key === 'unknown'), !!puzzle, `face ${face}`);
      assert.equal(d.action, null);
    }
  }
});

// ---------- the words ----------

test('"wait" stops it where it is, "go" releases it', () => {
  const env = world(6, [mystery('a', 2)]);
  const s = createGame(T0, env);
  devTeleport(s, 'out', FACES.find((f) => faceDistance(1, f) === 1)!, T0, env); // the human is one face away
  const mind = newMind();
  assert.equal(decide(mind, observe(s, 'in', env), [], T0).action?.type, 'go_face');
  const paused = decide(mind, observe(s, 'in', env), [parseHuman('Wait')], T0 + 200);
  assert.deepEqual([paused.action, paused.hold, paused.say.map((x) => x.key)], [null, true, ['wait.ok']]);
  assert.equal(decide(mind, observe(s, 'in', env), [], T0 + 5000).action, null);
  assert.equal(decide(mind, observe(s, 'in', env), [parseHuman('go')], T0 + 5200).action?.type, 'go_face');
});

test('parseHuman: the protocol words, counts, quick chat, and what is plain', () => {
  const tokens = (text: string) => parseHuman(text).tokens;
  assert.deepEqual(tokens('moon'), [{ t: 'sign', sign: 'moon' }]);
  assert.deepEqual(tokens('It shows a MOON!'), [{ t: 'sign', sign: 'moon' }]);
  assert.deepEqual(tokens('up left'), [
    { t: 'dir', dir: 'up', n: 1 },
    { t: 'dir', dir: 'left', n: 1 },
  ]);
  assert.deepEqual(tokens('up 3'), [{ t: 'dir', dir: 'up', n: 3 }]);
  assert.deepEqual(tokens('3 up'), [{ t: 'dir', dir: 'up', n: 3 }]);
  assert.deepEqual(tokens('left x2, down'), [
    { t: 'dir', dir: 'left', n: 2 },
    { t: 'dir', dir: 'down', n: 1 },
  ]);
  assert.deepEqual(tokens('face 3'), [{ t: 'face', face: 3 }]);
  assert.deepEqual(tokens('face 9'), []);
  // quick chat, keys 1 to 4
  assert.deepEqual(['Here!', 'Wait', 'Yes', 'No'].map((q) => tokens(q)[0]!.t), ['yes', 'wait', 'yes', 'no']);
  assert.deepEqual(tokens('go')[0], { t: 'go' });
  assert.deepEqual(tokens('?')[0], { t: 'again' });
  for (const plain of ['moon', 'the moon stone', 'it is a moon', 'up 2', 'yes', 'ok go', 'I am across']) assert.equal(parseHuman(plain).plain, true, plain);
  for (const free of ['I think it shows a moon', 'hello there', 'what do you see?', '']) assert.equal(parseHuman(free).plain, false, free);
  assert.deepEqual(tokens('hello there'), []);
});
