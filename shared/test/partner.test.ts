import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CANON_UP,
  CORE_LINES,
  FACES,
  FACE_SIZE,
  PUZZLE_SCRIPTS,
  applyInteract,
  applyMove,
  canonToScreen,
  createGame,
  decide,
  defaultEnv,
  devSolve,
  devTeleport,
  faceDistance,
  findPath,
  hazardAvoid,
  hazardTiles,
  isPuzzleLine,
  lineKeys,
  newMind,
  nextStep,
  objectsOn,
  observe,
  parseAction,
  parseHuman,
  parseStringMap,
  planAction,
  seedOf,
  visibleObjects,
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
import { readCode } from '../src/puzzles/hiddenCode';
import { safePath } from '../src/puzzles/laserPath';
import { play, type HumanScript } from './partnerSim';

// THE PARTNER CORE, on a cube of its own: blank faces and made-up puzzles. Nothing in the
// first part knows the real puzzles, how many there are, or which faces they are on: that is
// the point. The last part is the body on the real cube: pressing E ("use") and hot lava.
// A real puzzle script gets its own test file, driven by play() in ./partnerSim.ts.

const T0 = 1_700_000_000_000;
const STEP = 200;
const other = (s: Side): Side => (s === 'out' ? 'in' : 'out');
const BLANK = Array<string>(FACE_SIZE).fill('.'.repeat(FACE_SIZE));

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

/** A blank cube with the given puzzles. No portal: the last solve wins. */
function world(puzzles: PuzzleModule<{ done: boolean }>[]): GameEnv {
  const w = { out: {}, in: {} } as World;
  for (const side of ['out', 'in'] as const) for (const f of FACES) w[side][f] = parseStringMap(side, f, BLANK);
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
  const env = world([mystery('a', 2)]);
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
  const env = world([mystery('a', 2)]);
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
  const env = world([mystery('a', 2)]);
  const r = start(env, 'in');
  r.go(3);
  assert.deepEqual(r.lines, ['hello.in', 'next']); // and that there is more to solve somewhere
  const out = start(env, 'out');
  devTeleport(out.state, 'in', FACES.find((f) => faceDistance(1, f) === 2)!, T0, env);
  out.go(2);
  assert.deepEqual(out.lines, ['hello.out', 'follow.far']);
});

// ---------- the end of the game ----------

test('the last solve wins the game: "solved" for each one before it, then "win", and nowhere left to walk', () => {
  const env = world([mystery('a', 2), mystery('b', 4)]);
  const r = start(env, 'in');
  const goals: FaceId[] = [2, 4];
  r.go(1500, (s) => {
    const next = goals.find((f) => !s.solved.includes(f));
    if (next !== undefined) walk(s, env, 'out', { face: next, x: 3, y: 3 });
  });
  assert.notEqual(r.state.wonAt, null);
  assert.equal(r.lines.filter((l) => l === 'solved').length, 1); // the last solve is the win
  assert.ok(r.lines.indexOf('solved') < r.lines.indexOf('win'));
  const after = decide(r.mind, observe(r.state, 'in', env), [], T0 + 1e7);
  assert.deepEqual([after.action, after.say], [null, []]);
});

// ---------- a puzzle it has no script for ----------

test('a puzzle with no script: it says so, keeps off everything it can see there, and does not stall', () => {
  const env = world([mystery('never-heard-of-it', 2)]);
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
    // The game still ends once the human solves that puzzle alone.
    r.go(1500, (s) => walk(s, env, 'out', { face: 2, x: 3, y: 3 }));
    if (ai === 'in') assert.notEqual(r.state.wonAt, null);
  }
});

// ---------- the registry ----------

test('a script for a puzzle that is not in the game is never asked; a script for one that is, is', () => {
  const env = world([mystery('here', 2)]);
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
  assert.deepEqual([d.hold, d.action, d.avoid, d.soft], [true, null, [{ col: 2, row: 2 }], false]); // its hazards, minus what it allowed
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
  const env = world([mystery('a', 2)]);
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

// ---------- the body on the real cube: pressing E, and hot lava ----------

/** Walk a decision to its end with real moves. Returns the steps taken. */
function carryOut(state: GameState, side: Side, decision: Parameters<typeof nextStep>[2], max = 400): number {
  for (let n = 0; n < max; n++) {
    const step = nextStep(state, side, decision);
    if (!step) return n;
    if (step === 'interact') {
      applyInteract(state, side, T0);
      return n + 1;
    }
    applyMove(state, side, step[0], step[1], T0);
  }
  return max;
}

test('"use": the body walks to a keypad key on face 1 inside and presses it; the right code solves the face', () => {
  const s = createGame(T0);
  const code = readCode(visibleObjects(s, 'out', 1))!;
  assert.match(code, /^\d{3}$/);
  const display = () => observe(s, 'in').objects.filter((o) => o.type === 'display').sort((a, b) => a.col - b.col).map((o) => o.state);
  // by object + state, by tile, and where it stands
  const first = planAction(s, 'in', { type: 'use', object: 'key', state: code[0]! });
  assert.ok('steps' in first && first.steps.at(-1) === 'interact' && first.steps.slice(0, -1).every((x) => x !== 'interact'));
  carryOut(s, 'in', { action: { type: 'use', object: 'key', state: code[0]! }, avoid: [] });
  assert.deepEqual(display(), [code[0], 'empty', 'empty']);
  const key = observe(s, 'in').objects.find((o) => o.type === 'key' && o.state === code[1])!;
  carryOut(s, 'in', { action: { type: 'use', col: key.col, row: key.row }, avoid: [] });
  const last = observe(s, 'in').objects.find((o) => o.type === 'key' && o.state === code[2])!;
  carryOut(s, 'in', { action: { type: 'goto', col: last.col, row: last.row }, avoid: [] });
  carryOut(s, 'in', { action: { type: 'use' }, avoid: [] });
  assert.deepEqual(display(), [...code]);
  carryOut(s, 'in', { action: { type: 'use', object: 'key', state: 'enter' }, avoid: [] });
  assert.deepEqual([s.solved, s.strikes], [[1], 0]);

  // what it refuses: nothing of that kind in sight, full hands, an item underfoot
  assert.match((planAction(s, 'in', { type: 'use', object: 'unicorn' }) as { error: string }).error, /cannot see any "unicorn"/);
  const { face, x, y } = s.players.in.pose;
  s.items.parcel = { id: 'parcel', kind: 'parcel', side: 'in', face, x, y, carriedBy: null, placedOn: null, props: {} };
  assert.match((planAction(s, 'in', { type: 'use' }) as { error: string }).error, /pick it up/);
  applyInteract(s, 'in', T0);
  assert.match((planAction(s, 'in', { type: 'use' }) as { error: string }).error, /hands are full/);
  // a model may ask for it too
  assert.deepEqual(parseAction({ type: 'use', object: 'Key', state: '7' }), { type: 'use', object: 'key', state: '7' });
  assert.deepEqual(parseAction({ type: 'use', args: { col: 3, row: 4 } }), { type: 'use', col: 3, row: 4 });
  assert.deepEqual(parseAction({ type: 'use' }), { type: 'use' });
  assert.equal(parseAction({ type: 'use', col: 12, row: 0 }), null);
});

/** A game with the laser on (face 5 solved) and the inside player on face 6's outer ring, at 0,5. */
function lavaGame(): GameState {
  const s = createGame(T0);
  devSolve(s, 5, T0);
  s.players.in.pose = { ...s.players.in.pose, face: 6, up: CANON_UP[6], x: 0, y: 5 };
  return s;
}
const ringOf6 = (p: { face: FaceId; x: number; y: number }) => p.face !== 6 || p.x === 0 || p.y === 0 || p.x === FACE_SIZE - 1 || p.y === FACE_SIZE - 1;

test('hot lava: with face 5 solved the inside body routes around the inside of face 6', () => {
  const s = lavaGame();
  const across = (p: { face: FaceId; x: number; y: number }) => p.face === 6 && p.x === FACE_SIZE - 1 && p.y === 5;
  assert.equal(hazardTiles(s, 'in', 6).length, 100); // the whole inside of the face, button included
  assert.equal(hazardTiles(createGame(T0), 'in', 6).length, 0); // cold before the laser: plain floor
  assert.equal(hazardTiles(s, 'out', 6).length, 0); // the cave above it is not lava
  // the blind path walks straight through; the careful one is longer and never leaves the ring
  const blind = findPath(s, 'in', across)!;
  const careful = findPath(s, 'in', across, undefined, undefined, hazardAvoid(s, 'in'))!;
  assert.equal(blind.length, FACE_SIZE - 1);
  assert.ok(careful.length > blind.length);

  // the partner's body: nextStep keeps off it on its own, on a goto and on the way to another face
  const [col, row] = canonToScreen('in', 6, s.players.in.pose.up, FACE_SIZE - 1, 5);
  for (let n = 0; n < 200 && !across(s.players.in.pose); n++) {
    const step = nextStep(s, 'in', { action: { type: 'goto', col, row }, avoid: [] });
    assert.ok(step && step !== 'interact');
    applyMove(s, 'in', step[0], step[1], T0);
    assert.ok(ringOf6(s.players.in.pose), `stepped into the lava at ${s.players.in.pose.x},${s.players.in.pose.y}`);
  }
  assert.ok(across(s.players.in.pose));
  assert.equal(s.strikes, 0);
  // a tile in the lava is not walked to, the button is not pressed, a straight line through is refused
  const button = observe(s, 'in').objects.find((o) => o.type === 'button')!;
  assert.equal(nextStep(s, 'in', { action: { type: 'goto', col: button.col, row: button.row }, avoid: [] }), null);
  assert.equal(nextStep(s, 'in', { action: { type: 'use', object: 'button' }, avoid: [] }), null);
  assert.equal(nextStep(s, 'in', { action: { type: 'move', dir: 'left', steps: 3 }, avoid: [] }) === null || ringOf6(s.players.in.pose), true);
});

test('hot lava: the brain with no script follows the human to face 6 and stays on the ring; a told path is walked', () => {
  // the core alone (no scripts): the human stands on face 6, the bot comes and waits on the ring
  const s = createGame(T0);
  devSolve(s, 5, T0);
  devTeleport(s, 'out', 6, T0);
  const mind = newMind();
  for (let n = 0; n < 400; n++) {
    const d = decide(mind, observe(s, 'in'), [], T0 + n * STEP, []);
    const step = nextStep(s, 'in', d);
    if (step && step !== 'interact') applyMove(s, 'in', step[0], step[1], T0);
    assert.ok(ringOf6(s.players.in.pose));
  }
  assert.deepEqual([s.players.in.pose.face, s.strikes], [6, 0]);

  // a script that was told the path lists it in `allow`: the body walks exactly those lava tiles and presses the button
  const g = lavaGame();
  (g.puzzles['laser-path'] as { burnt: boolean }).burnt = true; // the crate is burnt: the path exists
  const path = safePath({ world: defaultEnv.world, seed: seedOf(g), objects: (side, face, type) => objectsOn(defaultEnv.world, side, face, type) });
  const allow = () =>
    path.map((t) => {
      const [col, row] = canonToScreen('in', 6, g.players.in.pose.up, t.x, t.y);
      return { col, row };
    });
  const onPath = (p: { x: number; y: number }) => path.some((t) => t.x === p.x && t.y === p.y);
  for (let n = 0; n < 200 && !g.solved.includes(6); n++) {
    const step = nextStep(g, 'in', { action: { type: 'use', object: 'button' }, avoid: [], allow: allow() });
    assert.ok(step, 'no way along the told path');
    if (step === 'interact') applyInteract(g, 'in', T0);
    else applyMove(g, 'in', step[0], step[1], T0);
    assert.ok(ringOf6(g.players.in.pose) || onPath(g.players.in.pose));
  }
  assert.deepEqual([g.solved.includes(6), g.strikes], [true, 0]);
});

// ---------- the script interface, end to end: relay lines, the raw chat line, "use", the sim ----------

test('a script and a simulated human solve the real face 1 through chat: ask, relay, type, ENTER', () => {
  interface Mem {
    code: string | null;
  }
  /** Test only: the inside half of hidden-code. A real script lives in src/bot/scripts. */
  const typist: PuzzleScript<Mem> = {
    id: 'hidden-code',
    lines: ['hidden-code.ask', 'hidden-code.typing'],
    init: () => ({ code: null }),
    play({ o, mem, heard, objs, say }) {
      if (o.you !== 'in') return null;
      for (const h of heard) mem.code = /^\D*(\d)\D*(\d)\D*(\d)\D*$/.exec(h.text)?.slice(1).join('') ?? mem.code; // the raw line: digits are not protocol words
      if (!mem.code) {
        say('hidden-code.ask', { every: 20_000 });
        return null;
      }
      say('hidden-code.typing', { args: { code: [...mem.code].join(' ') } }); // a relay line
      const typed = objs('display').filter((d) => d.state !== 'empty').length;
      // re-asked before every step: the display says how far it is, so each key is pressed once
      return { action: { type: 'use', object: 'key', state: typed < 3 ? mem.code[typed]! : 'enter' }, status: `typing ${mem.code}, ${typed} in` };
    },
  };
  const reader: HumanScript<null> = {
    id: 'hidden-code',
    init: () => null,
    play({ next, seen, say }) {
      if (next()?.key === 'hidden-code.ask') say(`it says ${[...readCode(seen('code-mark'))!].join(' ')}`);
    },
  };
  const r = play('in', { scripts: [typist], humans: [reader], maxMs: 120_000, until: (s) => s.solved.includes(1) });
  assert.deepEqual([r.state.solved, r.state.strikes], [[1], 0]);
  assert.match(r.human.said[0]!, /^it says \d \d \d$/);
  const relay = r.decisions.flatMap((d) => d.say).find((x) => x.key === 'hidden-code.typing')!;
  assert.equal(relay.args!.code, r.human.said[0]!.slice(8));
  assert.ok(!r.lines.includes('unknown'));
  // with the registry as it is (no script) the same game does not stall: the bot greets, says so, and waits
  const none = play('in', { humans: [reader], maxMs: 20_000 });
  assert.deepEqual(none.lines.slice(0, 2), ['hello.in', 'unknown']);
  assert.equal(none.state.solved.length, 0);
});
