import assert from 'node:assert/strict';
import { after, test, type TestContext } from 'node:test';
import { CORE_LINES, FACES, PUZZLE_SCRIPTS, defaultEnv, devTeleport, faceDistance, lineKeys, observe, visibleObjects, type FaceId, type Say, type Side } from '@cubic/shared';
import { HUMAN_SCRIPTS, SimHuman, type HumanOptions } from '../../shared/test/partnerSim';
import { AiPlayer, parseReply, type AiOptions } from '../src/ai/aiPlayer';
import type { Brain } from '../src/ai/gemini';
import { MAX_SAY_CHARS, parsePersona, systemPrompt } from '../src/ai/prompt';
import { allScriptedLines, bankedScriptLines, hasLine, lineText } from '../src/ai/scripted';
import { LIMITS, Rooms, type Room } from '../src/rooms';

// The AI partner on a real Room. The clock is fake and the timings are the real ones:
// a step every 200 ms, one Gemini call per 6 s, a 3 s deadline.
//
// Everything here except the two whole-game tests is independent of the puzzles: the bot is
// only asked to find the human, talk and stay safe. The whole-game tests run only once every
// puzzle of the game has a script (PUZZLE_SCRIPTS) and a simulated human (HUMAN_SCRIPTS in
// shared/test/partnerSim.ts): until then they are skipped.

LIMITS.moveBurst = 1e9;
const rooms = new Rooms();
after(() => rooms.closeAll());

type Reply = string | Error | 'hang' | { text: string; afterMs: number };
const reply = (say: string | null, heard: string | null = null, action: object | null = null) => JSON.stringify({ say, heard, action });
const L = (key: string) => lineText('default', key);
const keyOfLine = new Map(lineKeys().map((k) => [L(k), k]));
const other = (s: Side): Side => (s === 'out' ? 'in' : 'out');
/** The face on the far side of the cube from the start, and the faces next to the start. */
const FAR = FACES.find((f) => faceDistance(1, f) === 2)!;
const NEXT = FACES.filter((f) => faceDistance(1, f) === 1);

/** Fake clock for one test. `pass` moves it and lets promises settle. */
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_700_000_000_000 });
  return async (ms: number, slice = 100) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}

/**
 * A room with a human seat on `human` and the AI on the other side. `replies` = a fake
 * Gemini; null = no key. `humanOn` puts the human on another face first, so the bot has
 * somewhere to walk whatever the puzzles are.
 */
function setup(human: Side, replies: Reply[] | null, opts: AiOptions & { humanOn?: FaceId; bothOn?: FaceId } = {}) {
  const room = rooms.create('ai');
  room.sit(human);
  const prompts: string[] = [];
  const brain: Brain | null = replies && {
    async think(turn, signal) {
      prompts.push(turn);
      const next = replies.shift() ?? reply(null);
      if (next === 'hang') return new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted'))));
      if (next instanceof Error) throw next;
      if (typeof next === 'object') await new Promise((r) => setTimeout(r, next.afterMs));
      return { text: typeof next === 'object' ? next.text : next, tokens: { input: 100, output: 10 } };
    },
  };
  const logs: string[] = [];
  const { humanOn, bothOn, ...ai_ } = opts;
  /** The script's own lines as they were said: what a simulated human listens to. */
  const lines: Say[] = [];
  const ai = new AiPlayer(room, other(human), brain, {
    log: (l) => logs.push(l),
    ...ai_,
    onSay: (msg, info) => {
      if (info.line) lines.push(info.line);
      ai_.onSay?.(msg, info);
    },
  });
  if (humanOn ?? bothOn) devTeleport(room.state, human, (humanOn ?? bothOn)!);
  if (bothOn) devTeleport(room.state, other(human), bothOn);
  const said = () => room.chat.filter((m) => m.isAI).map((m) => m.text);
  const bot = () => room.state.players[other(human)];
  return { room, ai, prompts, logs, said, bot, lines };
}

/** A simulated human on a Room, typing at most one line a second like a person would. `lines` = setup().lines. */
function humanOn(room: Room, side: Side, lines: Say[], opts: HumanOptions = {}) {
  const typing: string[] = [];
  let typedAt = 0;
  const human = new SimHuman(side, { state: () => room.state, move: (dx, dy) => void room.move(side, dx, dy), interact: () => void room.interact(side), say: (text) => void typing.push(text) }, opts);
  return {
    human,
    /** Hear what the AI said since last time, then act once. */
    tick() {
      if (typing.length && Date.now() - typedAt >= 1000) {
        typedAt = Date.now();
        const text = typing.shift()!;
        assert.ok(room.say(side, text), `the human was rate limited saying "${text}"`);
      }
      for (const line of lines.splice(0)) human.hear(line.key, line.args);
      human.tick();
    },
  };
}
// ---- faces 4-6 (scripts-b) ----
/** The order a human who knows the chain plays in: 2 hands the battery to 5, 5 lights 6, 6 hands the flower to 4. */
const CHAIN_ORDER: FaceId[] = [1, 2, 3, 5, 6, 4];
// ---- end faces 4-6 ----
/** The whole-game tests need a script and a simulated human for every puzzle of the game. */
const wholeGame = defaultEnv.puzzles.every((p) => PUZZLE_SCRIPTS.some((s) => s.id === p.id) && HUMAN_SCRIPTS.some((h) => h.id === p.id));

// ---------- no key: the script alone ----------

test('no Gemini key: it plays from the script, silently: it greets, finds the human and never calls anything', async (t) => {
  const pass = clock(t);
  for (const human of ['out', 'in'] as const) {
    const { room, ai, said, bot } = setup(human, null, { humanOn: FAR });
    assert.deepEqual(room.info().seats[other(human)], { taken: true, connected: true, isAI: true });
    await pass(1000);
    assert.ok(bot().steps >= 4 && bot().steps <= 5, `${bot().steps} steps in 1 s`); // one step per 200 ms, no teleport
    assert.deepEqual(said(), [L(`hello.${other(human)}`)]);
    await pass(1000);
    assert.deepEqual(said(), [L(`hello.${other(human)}`), L('follow.far')]); // one line at a time, a beat apart
    await pass(30_000);
    assert.equal(bot().pose.face, FAR);
    assert.equal(ai.calls, 0);
    assert.deepEqual([room.chat[0]!.from, room.chat[0]!.isAI], [other(human), true]);
  }
});

for (const humanSide of ['out', 'in'] as const) {
  test(`no Gemini key: the scripted partner and a human ${humanSide}side finish the whole game on a real Room`, { skip: !wholeGame }, async (t) => {
    const pass = clock(t);
    const { room, ai, said, lines } = setup(humanSide, null);
    const { tick } = humanOn(room, humanSide, lines, { order: CHAIN_ORDER });
    for (let i = 0; i < 4500 && room.state.wonAt === null; i++) {
      await pass(200, 200);
      tick();
    }
    assert.notEqual(room.state.wonAt, null, `solved ${room.state.solved.join()}; AI said: ${said().slice(-6).join(' | ')}`);
    assert.equal(room.state.strikes, 0);
    assert.equal(ai.calls, 0);
    assert.ok(said().every((line) => line.length <= MAX_SAY_CHARS)); // only its own lines, each one short enough
    await pass(400);
    assert.equal(said().at(-1), L('win'));
  });
}

// ---- faces 1-3 (scripts-a) ----
for (const humanSide of ['out', 'in'] as const) {
  test(`no Gemini key: faces 1, 2 and 3 with a human ${humanSide}side on a real Room: solved, no strike, no "huh"`, async (t) => {
    const pass = clock(t);
    const { room, ai, said, lines } = setup(humanSide, null);
    const { tick, human } = humanOn(room, humanSide, lines, { order: [1, 2, 3] });
    const done = () => [1, 2, 3].every((f) => room.state.solved.includes(f as FaceId));
    for (let i = 0; i < 4500 && !done(); i++) {
      await pass(200, 200);
      tick();
    }
    assert.ok(done(), `solved ${room.state.solved.join()}; AI said: ${said().slice(-6).join(' | ')}; human said: ${human.said.slice(-4).join(' | ')}`);
    assert.equal(room.state.strikes, 0);
    assert.equal(ai.calls, 0);
    assert.ok(said().every((line) => line.length <= MAX_SAY_CHARS));
    // everything the human typed was plain protocol: the bot never had to say it did not understand
    assert.ok(!said().includes(L('huh')) && !said().includes(L('unknown')), said().join(' | '));
    // a relay line is vocabulary pieces only, filled into its words
    assert.ok(said().some((line) => /^(the code is|press) (\w+ ?)+$/.test(line)), said().join(' | '));
    assert.ok(!said().some((line) => line.includes('{')));
  });
}
// ---- end faces 1-3 ----

// ---------- Gemini is advisory: slow, failing, rate limited ----------

test('Gemini slower than 3 s: the body never waits, and at 3 s the script says the line itself', async (t) => {
  const pass = clock(t);
  const { ai, said, logs, bot } = setup('out', ['hang'], { humanOn: FAR });
  await pass(2900);
  assert.equal(ai.calls, 1); // the greeting went to Gemini to be reworded
  assert.ok(bot().steps >= 10, 'the AI stood still while Gemini was thinking');
  assert.ok(said().includes(L('follow.far'))); // protocol lines do not wait for anyone
  assert.ok(!said().includes(L('hello.in')));
  await pass(400);
  assert.equal(ai.stats.timeouts, 1); // given up 3 s after the call went out (at 0.2 s)
  await pass(1500); // its lines are a beat apart
  assert.ok(said().includes(L('hello.in')), 'no scripted greeting after the 3 s deadline');
  assert.ok(logs.some((l) => l.includes('no answer after 3000 ms; the script answers')));
  await pass(30_000);
  assert.equal(bot().pose.face, FAR);
});

test('Gemini errors (503): the script answers that turn at once and the calls back off 6 s, 12 s, ...', async (t) => {
  const pass = clock(t);
  const down = new Error('503 overloaded');
  const { room, ai, said, logs, bot } = setup('out', [down, down, down], { humanOn: FAR });
  await pass(1900);
  assert.ok(said().includes(L('hello.in'))); // no 3 s wait on an error: it is the next line said
  assert.equal(ai.stats.errors, 1);
  assert.ok(logs.some((l) => l.includes('503 overloaded') && l.includes('next call in 6s')));
  // While it backs off, free-form chat is answered by the script, not queued for Gemini.
  room.say('out', 'tell me about this place');
  await pass(3200);
  assert.ok(said().includes(L('huh')));
  assert.equal(ai.calls, 1);
  await pass(6000);
  room.say('out', 'tell me something about yourself');
  await pass(600);
  assert.equal(ai.calls, 2);
  assert.ok(logs.some((l) => l.includes('next call in 12s')));
  assert.equal(bot().pose.face, FAR); // the body walked to the human all the while
});

test('rate limit (429): same as any error, and the game goes on', async (t) => {
  const pass = clock(t);
  const quota = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 });
  const { ai, said, logs, bot } = setup('out', [quota, quota], { humanOn: FAR });
  await pass(30_000);
  assert.equal(bot().pose.face, FAR);
  assert.ok(said().includes(L('hello.in')) && said().includes(L('follow.far')));
  assert.ok(logs.some((l) => l.includes('429') && l.includes('the script answers')));
  assert.equal(ai.calls, 1);
});

test('the throttle: one Gemini call per 6 seconds per room, with no backlog', async (t) => {
  const pass = clock(t);
  const { room, ai } = setup('out', []);
  await pass(400);
  assert.equal(ai.calls, 1); // the greeting
  for (let i = 0; i < 4; i++) {
    room.say('out', `this is a long free form message number ${i}`);
    await pass(1000);
  }
  assert.equal(ai.calls, 1); // inside the window: nothing
  await pass(2400);
  assert.equal(ai.calls, 2); // only the latest message is asked about
  await pass(12_000);
  assert.equal(ai.calls, 2); // and the three before it are not replayed
  assert.equal((ai as unknown as { minThinkMs: number; timeoutMs: number }).minThinkMs, 6000);
  assert.equal((ai as unknown as { minThinkMs: number; timeoutMs: number }).timeoutMs, 3000);
});

test('a whole game with a Gemini that hangs, errors and hits the rate limit is still won', { skip: !wholeGame }, async (t) => {
  const pass = clock(t);
  const flaky: Reply[] = [];
  for (let i = 0; i < 40; i++) flaky.push('hang', new Error('503'), Object.assign(new Error('429'), { status: 429 }), 'not json at all');
  const { room, ai, lines } = setup('in', flaky);
  const { tick } = humanOn(room, 'in', lines, { order: CHAIN_ORDER });
  for (let i = 0; i < 6000 && room.state.wonAt === null; i++) {
    await pass(200, 200);
    tick();
  }
  assert.notEqual(room.state.wonAt, null, `solved ${room.state.solved.join()}`);
  assert.equal(room.state.strikes, 0);
  assert.equal(ai.stats.answered, 0);
  assert.ok(ai.stats.timeouts > 0 && ai.stats.errors > 0);
});

// ---------- Gemini is advisory: when it does answer ----------

test('small talk is reworded by Gemini; protocol lines are said exactly as written', async (t) => {
  const pass = clock(t);
  const said_: { text: string; scripted: boolean }[] = [];
  const { said, prompts, ai } = setup('out', [reply('Hey, hello from in here! Keep it short and I will keep up.')], { humanOn: FAR, onSay: (m, info) => said_.push({ text: m.text, scripted: info.scripted }) });
  await pass(6000);
  assert.ok(said().includes('Hey, hello from in here! Keep it short and I will keep up.'));
  assert.ok(!said().includes(L('hello.in')));
  assert.ok(said().includes(L('follow.far')));
  assert.equal(JSON.parse(prompts[0]!).scriptLine, L('hello.in'));
  assert.deepEqual([ai.stats.answered, ai.stats.modelLines], [1, 1]);
  // The voice is told which lines are the script's own (banked) and which are a model's.
  assert.deepEqual(said_.map((x) => x.scripted), said_.map((x) => keyOfLine.has(x.text)));
  assert.equal(said_.find((x) => x.text.startsWith('Hey, hello'))!.scripted, false);
});

test('free-form chat: Gemini turns it into protocol words and the script acts on them', async (t) => {
  const pass = clock(t);
  // Where does the bot look first when it only hears "somewhere next door"? Pick another face.
  const control = setup('in', null, { humanOn: NEXT[0] });
  let firstGuess: number = 1;
  control.room.listen({ onState: () => void (firstGuess === 1 && (firstGuess = control.bot().pose.face)) });
  await pass(10_000);
  assert.notEqual(firstGuess, 1);
  const target = NEXT.find((f) => f !== firstGuess)!;
  control.ai.stop();

  const { room, said, prompts, bot, ai } = setup('in', [reply('Hi!'), reply('On my way over.', `face ${target}`)], { humanOn: target });
  const visited = new Set<number>();
  room.listen({ onState: () => visited.add(bot().pose.face) });
  await pass(200);
  room.say('in', 'I wandered away, come find me at the snowy place');
  await pass(6200); // the greeting used the Gemini slot: this one waits for the next
  assert.equal(JSON.parse(prompts.at(-1)!).partnerSaid, 'I wandered away, come find me at the snowy place');
  await pass(1600);
  assert.ok(said().includes('On my way over.'));
  assert.deepEqual((ai as unknown as { mind: { cands: number[] } }).mind.cands, [target]); // it stopped guessing: it was told
  await pass(20_000);
  assert.equal(bot().pose.face, target);
  assert.ok(visited.has(target));
  // A model that invents words outside the protocol changes nothing.
  const junk = setup('in', [reply('Hi!'), reply(null, 'teleport to the crystal and win')], { humanOn: FAR });
  await pass(200);
  junk.room.say('in', 'do something clever please');
  await pass(7000);
  assert.ok(junk.said().includes(L('huh')));
});

test('a suggested move is walked only if the script calls it safe', async (t) => {
  const pass = clock(t);
  const calm = FACES.find((f) => !defaultEnv.puzzles.some((p) => p.face === f));
  if (calm === undefined) return t.skip('every face has a puzzle');
  const ask = async (s: ReturnType<typeof setup>, text: string) => {
    await pass(6500);
    s.room.say('in', text);
    await pass(6000);
  };
  // Idle on a face with nothing to solve: a suggestion on this face is fine.
  const a = setup('in', [reply('Hi!'), reply('Coming over.', null, { type: 'goto', col: 1, row: 1 })], { bothOn: calm });
  await ask(a, 'could you walk over to the top left corner for a moment');
  const o = observe(a.room.state, 'out');
  assert.deepEqual(o.position, { col: 1, row: 1 });
  assert.equal(a.ai.stats.refusedActions, 0);

  // Leaving the face, or anything that is not a plain walk, is not a model's call.
  const b = setup('in', [reply('Hi!'), reply(null, null, { type: 'go_face', face: FAR }), reply(null, null, { type: 'move', dir: 'up', steps: 24 })], { bothOn: calm });
  await ask(b, 'go and have a look at the far side would you');
  await ask(b, 'or just keep walking up until you fall off');
  assert.equal(b.bot().pose.face, calm);
  assert.equal(b.ai.stats.refusedActions, 2);

  // Told to wait, the body holds its place: nothing may pull it away.
  const c = setup('in', [reply('Hi!'), reply('Sure.', null, { type: 'goto', col: 1, row: 1 })], { bothOn: calm });
  await pass(6500);
  const before = { ...c.bot().pose };
  c.room.say('in', 'wait');
  await pass(400);
  c.room.say('in', 'could you walk over to the top left corner for a moment');
  await pass(3000);
  assert.deepEqual(c.bot().pose, before);
  assert.ok(c.logs.some((l) => l.includes('refused, the body is holding its place')));
});

test('a puzzle it has no script for: it says so and no suggestion gets it to touch what it sees there', async (t) => {
  const pass = clock(t);
  // Any puzzle face where the bot's side sees something. No scripts at all: every puzzle is unknown.
  const spot = defaultEnv.puzzles.flatMap((p) => (['out', 'in'] as const).map((side) => ({ face: p.face, side, thing: visibleObjects(rooms.create('ai').state, side, p.face)[0] }))).find((x) => x.thing);
  if (!spot) return t.skip('no puzzle shows anything');
  const s = setup(other(spot.side), [reply('Hi!'), reply('On it!', null, { type: 'step_on', object: spot.thing!.type })], { bothOn: spot.face, scripts: [] });
  await pass(6500);
  assert.ok(s.said().includes(L('unknown')));
  const before = { ...s.bot().pose };
  s.room.say(other(spot.side), 'just walk over and stand on that thing for me');
  await pass(6000);
  assert.deepEqual(s.bot().pose, before);
  assert.equal(s.ai.stats.refusedActions, 1);
  assert.ok(s.logs.some((l) => l.includes('refused')));
  assert.equal(s.room.state.strikes, 0);
});

test('the prompt only contains the AI side of the world, and no puzzle ids', async (t) => {
  const pass = clock(t);
  const { prompts, room } = setup('out', []);
  await pass(400);
  assert.equal(prompts.length, 1);
  const turn = JSON.parse(prompts[0]!);
  for (const hidden of ['players', '"pose"', '"x"', '"y"', 'puzzleList', 'puzzleId']) assert.ok(!prompts[0]!.includes(hidden), hidden);
  // Whatever only the human's side shows on this face is not in it.
  const mine = new Set(visibleObjects(room.state, 'in', 1).map((o) => o.type));
  for (const o of visibleObjects(room.state, 'out', 1)) if (!mine.has(o.type)) assert.ok(!JSON.stringify(turn.observation.objects).includes(`"${o.type}"`), o.type);
  assert.equal(typeof turn.planner, 'string');
  assert.equal(turn.youAre, 'the INSIDE player');
});

// ---------- small things ----------

test('parseReply: validates the JSON shape', () => {
  assert.deepEqual(parseReply('{"say":"hi","heard":null,"action":null}'), { say: 'hi', heard: null, action: null });
  assert.deepEqual(parseReply('```json\n{"say":null,"heard":"moon","action":{"type":"step_on","object":"plate"}}\n```'), { say: null, heard: 'moon', action: { type: 'step_on', object: 'plate' } });
  assert.deepEqual(parseReply('{"say":"ok","action":{"type":"teleport","face":3}}'), { say: 'ok', heard: null, action: null }); // bad action dropped
  for (const bad of ['', 'not json', '[]', '"hi"', '{}', '{"say":5,"action":null}', '{"say": "unterminated']) assert.equal(parseReply(bad), null, bad);
  assert.equal(parseReply(JSON.stringify({ say: 'x'.repeat(900), action: null }))!.say!.length, 80);
  const long = parseReply(JSON.stringify({ say: 'There is a plate on my floor near the top left corner and a pillar right below it, I think', action: null }))!.say!;
  assert.ok(long.length <= 80 && !long.endsWith(' ') && long.endsWith('below'), long); // cut at a word
});

test('every line of every registered script has words, in both personas, within 80 characters, with no em dash', () => {
  for (const key of lineKeys()) assert.ok(hasLine(key), `no words for "${key}" in server/src/ai/scripted.ts`);
  for (const line of allScriptedLines()) {
    assert.ok(line.length <= MAX_SAY_CHARS, `${line.length}: ${line}`);
    assert.ok(!line.includes('\u2014'), line);
  }
  // A script registered without words does not crash the bot: it says it does not know this one.
  assert.equal(lineText('default', 'brand-new-puzzle.hello'), L('unknown'));
  // The persona changes tone only: every line of a puzzle script is the same in both.
  for (const key of lineKeys()) if (!(CORE_LINES as readonly string[]).includes(key)) assert.equal(lineText('tsundere', key), lineText('default', key), key);
  assert.notEqual(lineText('tsundere', 'win'), lineText('default', 'win'));
  // Only the core is banked for now.
  assert.ok(bankedScriptLines().length >= CORE_LINES.length && bankedScriptLines().length <= CORE_LINES.length * 2);
});

test('persona changes the tone, not the rules or what the bot knows', () => {
  assert.equal(parsePersona(undefined), 'default');
  assert.equal(parsePersona('tsundere'), 'tsundere');
  assert.equal(parsePersona('pirate'), 'default');
  const a = systemPrompt('default');
  const b = systemPrompt('tsundere');
  assert.notEqual(a, b);
  assert.match(b, /tsundere/i);
  for (const p of [a, b]) {
    assert.match(p, /at most 80 characters/);
    assert.match(p, /only know what your own observation shows/);
    assert.match(p, /YOUR OWN frame of reference/);
    assert.match(p, /sun, moon, star, drop, bolt, ring/);
  }
});

test('a throw inside the AI is contained: it is logged, and an AI that keeps failing is stopped', async (t) => {
  const pass = clock(t);
  // its body: one step throws (a timer callback: uncaught, this would end the process)
  const walk = setup('out', null, { humanOn: FAR });
  const move = walk.room.move.bind(walk.room);
  let thrown = 0;
  walk.room.move = (...args) => {
    if (thrown++ === 0) throw new Error('boom in step');
    return move(...args);
  };
  await pass(2000);
  assert.ok(walk.logs.some((l) => l.includes('boom in step')));
  assert.ok(!walk.logs.some((l) => l.includes('stopped')), 'one fault does not stop the AI');
  assert.ok(walk.bot().steps > 3, 'it did not carry on after the fault');

  // its advisor, before the call is even made (async: this would be an unhandled rejection)
  const think = setup('out', [], { humanOn: FAR });
  (think.ai as unknown as { last: unknown }).last = null;
  Object.defineProperty(think.room, 'chat', { get: () => { throw new Error('boom in think'); } });
  await pass(2000);
  assert.ok(think.logs.some((l) => l.includes('boom in')));
  assert.ok(think.logs.some((l) => l.includes('stopped')), 'an AI that keeps failing is stopped');
});

test('the AI leaves with the human, once the human\'s seat is no longer held', async (t) => {
  const pass = clock(t);
  const { room, logs } = setup('out', null);
  room.leave('out');
  assert.ok(!logs.some((l) => l.includes('stopped')), 'the room is kept while the seat is held');
  await pass(LIMITS.seatHoldMs + 1000, 1000);
  assert.ok(logs.some((l) => l.includes('stopped')));
  assert.equal(rooms.get(room.code), undefined);
});
