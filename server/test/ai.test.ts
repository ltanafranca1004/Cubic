import assert from 'node:assert/strict';
import { after, test, type TestContext } from 'node:test';
import { AI_STEP_MS, CORE_LINES, FACES, PUZZLE_SCRIPTS, createGame, defaultEnv, devSolve, devTeleport, faceDistance, lineKeys, visibleObjects, type FaceId, type PuzzleScript, type Say, type Side } from '@cubic/shared';
import { HUMAN_SCRIPTS, SimHuman, type HumanOptions } from '../../shared/test/partnerSim';
import { AiPlayer, CHAT_TIMEOUT_MS, LINE_GAP_MS, LINE_MS_PER_CHAR, STALE_MS, lineHoldMs, parseReply, type AiOptions } from '../src/ai/aiPlayer';
import { Budget, GEMINI_PAUSE_MS, GEMINI_PER_GAME, GEMINI_PER_MINUTE } from '../src/ai/budget';
import { geminiBrain, type Brain, type GeminiClient } from '../src/ai/gemini';
import { MAX_SAY_CHARS, REPLY_SCHEMA, parsePersona, systemPrompt } from '../src/ai/prompt';
import { allScriptedLines, bankedScriptLines, hasLine, lineText } from '../src/ai/scripted';
import { INACTIVITY, INACTIVITY_RANGE, LIMITS, Rooms, type Room } from '../src/rooms';

// Several tests here let the human sit silent for ten minutes and more to watch the AI.
// A real room would remove that human for inactivity (inactivity.test.ts has those rules,
// with the real AiPlayer too), so here that clock is as long as it goes.
INACTIVITY.idleMs = INACTIVITY_RANGE.max;

// The AI partner on a real Room. The clock is fake and the timings are the real ones:
// a step every AI_STEP_MS, one Gemini call per 6 s, a 3 s deadline. Gemini is only asked on
// events (here: a free-form chat line, a solve); budget.test.ts has the caps and the rest.
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
function setup(human: Side, replies: Reply[] | null, opts: AiOptions & { humanOn?: FaceId; bothOn?: FaceId; seed?: number } = {}) {
  const room = rooms.create('ai');
  // a room draws a fresh seed per game: a test that is about one layout pins it
  if (opts.seed !== undefined) room.state = createGame(Date.now(), defaultEnv, opts.seed);
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
  const { humanOn, bothOn, seed: _seed, ...ai_ } = opts;
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
    const want = Math.floor(1000 / AI_STEP_MS); // one step per AI_STEP_MS (the walking pace), no teleport
    assert.ok(bot().steps >= want && bot().steps <= want + 1, `${bot().steps} steps in 1 s`);
    assert.deepEqual(said(), [L(`hello.${other(human)}`)]);
    await pass(1000);
    assert.deepEqual(said(), [L(`hello.${other(human)}`)]); // one line at a time: the greeting is still being said
    await pass(lineHoldMs(L(`hello.${other(human)}`)) - 1500 + AI_STEP_MS); // lines go out on the AI's own tick
    assert.deepEqual(said(), [L(`hello.${other(human)}`), L('follow.far')]); // the next one when it has had its time
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
    assert.equal(await lastWord(pass, said), L('win'));
  });
}

/**
 * The win line is said like any other: after the line before it has had its time (lineHoldMs,
 * up to MAX_SAY_CHARS * LINE_MS_PER_CHAR = 5.2 s) and after whatever still waits in front of
 * it. Let the AI finish talking, then return its last line.
 */
async function lastWord(pass: (ms: number, slice?: number) => Promise<void>, said: () => string[]): Promise<string | undefined> {
  for (let i = 0; i < 150 && said().at(-1) !== L('win'); i++) await pass(200, 200);
  return said().at(-1);
}

// Seeds whose last flower is planted while the AI is still saying something: the win line
// came later than the 400 ms the whole-game test used to wait, and the test failed about
// two runs in five (a room draws a fresh seed). The game itself was always won.
for (const seed of [2, 29, 33, 40]) {
  test(`no Gemini key: seed ${seed}, where the win comes while the AI is talking: the game is won and "win" is its last word`, { skip: !wholeGame }, async (t) => {
    const pass = clock(t);
    const { room, said, lines } = setup('out', null, { seed });
    const { tick } = humanOn(room, 'out', lines, { order: CHAIN_ORDER });
    for (let i = 0; i < 4500 && room.state.wonAt === null; i++) {
      await pass(200, 200);
      tick();
    }
    assert.notEqual(room.state.wonAt, null, `solved ${room.state.solved.join()}`);
    assert.equal(room.state.strikes, 0);
    assert.equal(await lastWord(pass, said), L('win'));
    assert.equal(said().filter((l) => l === L('win')).length, 1);
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

test('Gemini slower than the chat deadline (6 s): the body never waits, and at 6 s the script answers by itself', async (t) => {
  const pass = clock(t);
  const { room, ai, said, logs, bot } = setup('out', ['hang'], { humanOn: FAR });
  await pass(6000); // the greeting and the follow line have been said
  assert.equal(ai.calls, 0); // the greeting is the script's own line: no call
  room.say('out', 'tell me about this place');
  await pass(2800);
  assert.equal(ai.calls, 1);
  assert.ok(bot().steps >= 10, 'the AI stood still while Gemini was thinking');
  assert.ok(said().includes(L('follow.far'))); // the script's lines do not wait for anyone
  assert.ok(!said().includes(L('huh')));
  await pass(600);
  assert.equal(ai.stats.timeouts, 0); // a chat line is given 6 s: an answer at 3 s is not thrown away
  await pass(3000);
  assert.equal(ai.stats.timeouts, 1); // given up 6 s after the call went out
  await pass(3000); // its lines are a beat apart
  assert.ok(said().includes(L('huh')), 'no scripted answer after the deadline');
  assert.ok(logs.some((l) => l.includes('no answer after 6000 ms; the script answers')));
  assert.ok(logs.some((l) => l.includes('chat: gemini did not answer (why=timeout)')));
  await pass(30_000);
  assert.equal(bot().pose.face, FAR);
  assert.equal(ai.calls, 1); // and it was not tried again
});

test('Gemini errors (503): the script answers that turn at once, nothing is retried, and the calls back off 6 s, 12 s, ...', async (t) => {
  const pass = clock(t);
  const down = new Error('503 overloaded');
  const { room, ai, said, logs, bot } = setup('out', [down, down, down], { humanOn: FAR });
  await pass(6000); // the greeting and the follow line have been said
  room.say('out', 'tell me about this place');
  await pass(4000);
  assert.ok(said().includes(L('huh'))); // no 3 s wait on an error
  assert.deepEqual([ai.calls, ai.stats.errors], [1, 1]);
  assert.ok(logs.some((l) => l.includes('503 overloaded') && l.includes('next call in 6s')));
  // While it backs off, free-form chat is answered by the script, and it does not wait for a later call.
  room.say('out', 'and what about that thing over there');
  await pass(8000);
  assert.equal(ai.calls, 1);
  room.say('out', 'tell me something about yourself');
  await pass(600);
  assert.equal(ai.calls, 2);
  assert.ok(logs.some((l) => l.includes('next call in 12s')));
  await pass(20_000);
  assert.equal(bot().pose.face, FAR); // the body walked to the human all the while
});

test('rate limit (429): no retry, the script answers, and NO room calls Gemini for the next 10 minutes', async (t) => {
  const pass = clock(t);
  const quota = Object.assign(new Error('got status: 429 RESOURCE_EXHAUSTED'), { status: 429 });
  const blog: string[] = [];
  const budget = new Budget({ log: (l) => blog.push(l) });
  const a = setup('out', [quota, reply('never')], { humanOn: FAR, budget });
  const b = setup('in', [reply('Hello over there.')], { budget, scripts: [] });
  await pass(11_000); // both have said their first lines
  a.room.say('out', 'tell me about this place');
  await pass(600);
  assert.equal(a.ai.calls, 1);
  assert.ok(blog.some((l) => l.startsWith('[gemini] room=') && l.includes('error=429')));
  assert.ok(blog.some((l) => l.includes('[gemini] 429') && l.includes('10 minutes')));
  b.room.say('in', 'hello there, how are you doing');
  await pass(3000);
  assert.equal(b.ai.calls, 0); // another room, same pause
  assert.ok(b.said().includes(L('huh')), b.said().join(' | '));
  assert.ok(blog.some((l) => l.includes('fallback') && l.includes('why=paused_429')));
  await pass(GEMINI_PAUSE_MS - 10_000, 1000);
  a.room.say('out', 'are you still there, partner of mine');
  await pass(600);
  assert.deepEqual([a.ai.calls, b.ai.calls], [1, 0]);
  await pass(10_000, 1000);
  b.room.say('in', 'hello again, how are you doing');
  await pass(2000);
  assert.equal(b.ai.calls, 1); // the pause is over
  assert.ok(b.said().includes('Hello over there.'));
  assert.equal(a.bot().pose.face, FAR); // the game went on
});

test('the throttle: one Gemini call per 6 seconds per room, with no backlog', async (t) => {
  const pass = clock(t);
  const { room, ai } = setup('out', []);
  await pass(400);
  assert.equal(ai.calls, 0); // no call for the greeting
  for (let i = 0; i < 4; i++) {
    room.say('out', `this is a long free form message number ${i}`);
    await pass(1000);
  }
  assert.equal(ai.calls, 1); // the first one; the three inside the window went to the script
  await pass(12_000);
  assert.equal(ai.calls, 1); // and they are not replayed later
  room.say('out', 'one more free form message for you');
  await pass(400);
  assert.equal(ai.calls, 2);
  assert.equal((ai as unknown as { minThinkMs: number; timeoutMs: number }).minThinkMs, 6000);
  assert.equal((ai as unknown as { minThinkMs: number; timeoutMs: number }).timeoutMs, 3000);
  assert.equal((ai as unknown as { chatTimeoutMs: number }).chatTimeoutMs, CHAT_TIMEOUT_MS);
  assert.equal(CHAT_TIMEOUT_MS, 6000);
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

// ---------- free-form chat: Gemini answers it, and when it does not the preset line does ----------

test('free-form chat reaches the Gemini client and its reply is said as a model line; puzzle answers and protocol words never do', async (t) => {
  const pass = clock(t);
  const requests: { model: string; contents: unknown }[] = [];
  const client: GeminiClient = {
    models: {
      generateContent: async (params) => {
        requests.push({ model: params.model, contents: params.contents });
        return { text: reply('I am a little nervous, but glad you are here.'), candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 500, totalTokenCount: 520 } };
      },
    },
  };
  const room = rooms.create('ai');
  room.sit('out');
  const spoken: { text: string; scripted: boolean }[] = [];
  const logs: string[] = [];
  const ai = new AiPlayer(room, 'in', geminiBrain('test-key', 'gemini-test', 'default', { client }), {
    log: (l) => logs.push(l),
    onSay: (m, info) => spoken.push({ text: m.text, scripted: info.scripted }),
  });
  t.after(() => ai.stop());
  await pass(8000);
  // Puzzle answers, directions and protocol words: the script's, never Gemini's.
  for (const line of ['4 7 2', 'the code is 3 8 4', 'left 2 then up 1', 'row 1 skip 3 flip 7', 'face 3', 'go', 'wait', 'yes', 'no', 'again', 'red', '2 bushes 3 birds 1 rock']) {
    assert.ok(room.say('out', line), line);
    await pass(1100);
  }
  assert.equal(requests.length, 0, 'a puzzle answer or a protocol word went to Gemini');
  await pass(12_000); // "wait" has run out
  assert.ok(room.say('out', 'hey, how are you feeling in there?'));
  await pass(600);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.model, 'gemini-test');
  assert.equal(JSON.parse(requests[0]!.contents as string).partnerSaid, 'hey, how are you feeling in there?');
  assert.equal(JSON.parse(requests[0]!.contents as string).event, 'chat');
  await pass(15_000);
  // Said in the chat (the caption) and handed to the voice as a model's line (the one that may be bought).
  assert.deepEqual(spoken.find((x) => x.text.startsWith('I am a little nervous')), { text: 'I am a little nervous, but glad you are here.', scripted: false });
  assert.ok(!room.chat.some((m) => m.isAI && m.text === L('huh')), 'the preset line was said although Gemini answered');
  assert.equal(ai.stats.chatMisses, 0);
});

test('a Gemini reply to chat is said however long it waits behind the script\'s lines', async (t) => {
  const pass = clock(t);
  const { room, said, ai } = setup('out', [reply('This place gives me the creeps too.')], { humanOn: FAR });
  await pass(200); // the greeting is being said: 5 s before the next line
  room.say('out', 'this cube is kind of creepy is it not');
  // Lines the script wants to say first, and a slow chat: the reply waits more than STALE_MS.
  (ai as unknown as { holdMs: number }).holdMs = STALE_MS + 4000;
  await pass(STALE_MS + 8000);
  assert.ok(said().includes('This place gives me the creeps too.'), said().join(' | '));
});

/** Every way a free-form chat line can go unanswered by Gemini: the preset line is the reply, and the log says why. */
const skew = { ms: 0 };
const MISSES: { why: string; replies: Reply[] | null; budget?: (b: Budget, code: string) => void; opts?: AiOptions; first?: { text: string; gapMs: number } }[] = [
  { why: 'off', replies: null }, // no GEMINI_API_KEY, or AI_FAKE=1
  { why: 'disabled', replies: [], opts: { budget: new Budget({ geminiEnabled: false, log: () => {} }) } }, // GEMINI_ENABLED=false
  { why: 'day_cap', replies: [], opts: { budget: new Budget({ geminiDailyCap: 0, log: () => {} }) } },
  { why: 'minute_cap', replies: [], budget: (b) => void Array.from({ length: GEMINI_PER_MINUTE }, () => b.gemini('ELSE', 'chat')) },
  {
    why: 'game_cap',
    replies: [],
    opts: { budget: new Budget({ now: () => Date.now() + skew.ms, log: () => {} }) },
    // 25 calls of this game, spread over minutes so the minute cap is not what refuses
    budget: (b, code) => {
      for (let i = 0; i < GEMINI_PER_GAME; i++) {
        if (i % GEMINI_PER_MINUTE === 0) skew.ms += 61_000;
        b.gemini(code, 'chat');
      }
      skew.ms += 61_000;
    },
  },
  { why: 'paused_429', replies: [], budget: (b) => b.geminiQuota('ELSE') },
  { why: 'timeout', replies: ['hang'] },
  { why: '429', replies: [Object.assign(new Error('got status: 429 RESOURCE_EXHAUSTED'), { status: 429 })] },
  { why: 'error', replies: [new Error('503 overloaded')] },
  { why: 'unusable', replies: ['not json at all'] },
  { why: 'no_say', replies: [reply(null)] },
  { why: 'busy', replies: ['hang'], first: { text: 'what is this strange place anyway', gapMs: 1000 } }, // a call is still out
  { why: 'throttled', replies: [reply('Hello to you too.')], first: { text: 'hello there my friend', gapMs: 2000 } }, // under 6 s since the last call
  { why: 'backoff', replies: [new Error('503 overloaded')], first: { text: 'hello there my friend', gapMs: 9000 }, opts: { backoffMs: 30_000 } },
];

for (const miss of MISSES) {
  test(`free-form chat that Gemini does not answer (${miss.why}): the preset line is the reply, and the log says why`, async (t) => {
    const pass = clock(t);
    const blog: string[] = [];
    const budget = miss.opts?.budget ?? new Budget({ log: (l) => blog.push(l) });
    const { room, ai, said, logs, lines } = setup('out', miss.replies, { ...miss.opts, budget });
    await pass(8000); // the greeting has been said
    if (miss.first) {
      room.say('out', miss.first.text);
      await pass(miss.first.gapMs);
      // the back-off case: its first line already got the preset reply; the 8 s between two of them is over
      if (miss.why === 'backoff') (ai as unknown as { lastHuhAt: number }).lastHuhAt = -Infinity;
      lines.length = 0;
    }
    miss.budget?.(budget, room.code);
    const calls = ai.calls;
    room.say('out', 'tell me a little about yourself');
    await pass(CHAT_TIMEOUT_MS + 12_000);
    const made = ['timeout', '429', 'error', 'unusable', 'no_say'].includes(miss.why);
    assert.equal(ai.calls - calls, made ? 1 : 0);
    if (miss.first) assert.ok(lines.some((l) => l.key === 'huh'), `silence: ${said().join(' | ')}`);
    else assert.equal(said().filter((l) => l === L('huh')).length, 1, `not exactly one preset reply: ${said().join(' | ')}`);
    assert.ok(logs.some((l) => l.includes(`chat: gemini did not answer (why=${miss.why})`)), logs.join('\n'));
  });
}

test('a protocol word inside a free-form line still reaches the script when Gemini is off, and a word the body does not act on is not met with silence', async (t) => {
  const pass = clock(t);
  // "wait" is acted on and answered by the script ("Okay, waiting"): no preset line on top of it.
  const a = setup('out', null);
  await pass(8000);
  a.room.say('out', 'could you wait a moment, friend');
  await pass(8000);
  assert.ok(a.said().includes(L('wait.ok')));
  assert.ok(!a.said().includes(L('huh')), a.said().join(' | '));
  // "what" reads as "again", which a face with nothing to repeat says nothing to: the preset line.
  const b = setup('out', null, { scripts: [], bothOn: FAR });
  await pass(8000);
  const before = b.said().length;
  b.room.say('out', 'what is your favourite colour');
  await pass(8000);
  assert.ok(b.said().length > before, 'silence');
});

// ---------- Gemini is advisory: when it does answer ----------

test('a solve is reworded by Gemini; the greeting and protocol lines are said exactly as written', async (t) => {
  const pass = clock(t);
  const said_: { text: string; scripted: boolean }[] = [];
  const { room, said, prompts, ai } = setup('out', [reply('Yes! That did it. What is next?')], { humanOn: FAR, onSay: (m, info) => said_.push({ text: m.text, scripted: info.scripted }) });
  await pass(7000);
  assert.ok(said().includes(L('hello.in')) && said().includes(L('follow.far')));
  assert.equal(ai.calls, 0);
  room.devApply((state, now) => devSolve(state, defaultEnv.puzzles[0]!.face, now));
  await pass(3000);
  assert.ok(said().includes('Yes! That did it. What is next?'));
  assert.ok(!said().includes(L('solved')));
  assert.deepEqual([JSON.parse(prompts[0]!).event, JSON.parse(prompts[0]!).scriptLine], ['solved', L('solved')]);
  assert.deepEqual([ai.calls, ai.stats.answered, ai.stats.modelLines], [1, 1, 1]);
  // The voice is told which lines are the script's own (banked) and which are a model's.
  assert.deepEqual(said_.map((x) => x.scripted), said_.map((x) => keyOfLine.has(x.text)));
  assert.equal(said_.find((x) => x.text.startsWith('Yes!'))!.scripted, false);
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

  const { room, said, prompts, bot, ai } = setup('in', [reply('On my way over.', `face ${target}`)], { humanOn: target });
  const visited = new Set<number>();
  room.listen({ onState: () => visited.add(bot().pose.face) });
  await pass(200);
  room.say('in', 'I wandered away, come find me at the snowy place');
  await pass(600);
  assert.equal(JSON.parse(prompts.at(-1)!).partnerSaid, 'I wandered away, come find me at the snowy place');
  await pass(5000); // after the greeting
  assert.ok(said().includes('On my way over.'));
  assert.deepEqual((ai as unknown as { mind: { cands: number[] } }).mind.cands, [target]); // it stopped guessing: it was told
  await pass(20_000);
  assert.equal(bot().pose.face, target);
  assert.ok(visited.has(target));
  // A model that invents words outside the protocol changes nothing.
  const junk = setup('in', [reply(null, 'teleport to the crystal and win')], { humanOn: FAR });
  await pass(200);
  junk.room.say('in', 'do something clever please');
  await pass(10_000);
  assert.ok(junk.said().includes(L('huh')));
});

test('Gemini never moves the body and never presses anything: whatever a reply asks for', async (t) => {
  const pass = clock(t);
  // A puzzle face where the bot's side sees something it could walk onto or press. No
  // scripts at all, so the body has nothing to do by itself: any step would be Gemini's.
  const spot = defaultEnv.puzzles.flatMap((p) => (['out', 'in'] as const).map((side) => ({ face: p.face, side, thing: visibleObjects(rooms.create('ai').state, side, p.face)[0] }))).find((x) => x.thing);
  if (!spot) return t.skip('no puzzle shows anything');
  const human = other(spot.side);
  const wants = [
    { type: 'goto', col: 1, row: 1 },
    { type: 'step_on', object: spot.thing!.type },
    { type: 'use', object: spot.thing!.type },
    { type: 'move', dir: 'up', steps: 3 },
    { type: 'go_face', face: FAR },
    { type: 'pick_up' },
  ];
  const s = setup(human, wants.map((action, i) => JSON.stringify({ say: `Sure, doing it ${i}.`, heard: null, action, press: true, move: 'up' })), { bothOn: spot.face, scripts: [], minThinkMs: 1000 });
  await pass(6000);
  assert.ok(s.said().includes(L('unknown')));
  const acts: string[] = [];
  for (const what of ['move', 'interact'] as const) {
    const real = s.room[what].bind(s.room) as (...args: unknown[]) => never;
    (s.room as unknown as Record<string, unknown>)[what] = (...args: unknown[]) => {
      if (args[0] === spot.side) acts.push(what);
      return real(...args);
    };
  }
  const before = { ...s.bot().pose };
  for (const [i] of wants.entries()) {
    s.room.say(human, `please just walk over and deal with that thing for me, try ${i}`);
    await pass(3000);
  }
  assert.deepEqual([s.ai.calls, s.ai.stats.answered], [wants.length, wants.length]);
  assert.ok(s.said().includes('Sure, doing it 5.')); // it talks
  assert.deepEqual(acts, []); // and that is all it does
  assert.deepEqual(s.bot().pose, before);
  assert.equal(s.room.state.strikes, 0);
  assert.equal(s.room.state.players[spot.side].carrying ?? null, null);
  // The reply format has no action, and one that is sent anyway is not read.
  assert.deepEqual(Object.keys(REPLY_SCHEMA.properties), ['say', 'heard']);
  assert.deepEqual(parseReply('{"say":"ok","heard":null,"action":{"type":"goto","col":1,"row":1}}'), { say: 'ok', heard: null });
});

test('the prompt is a short summary of the AI side: no grid, no objects, no puzzle ids, the last 3 chat lines', async (t) => {
  const pass = clock(t);
  const { prompts, room } = setup('out', []);
  await pass(400);
  for (const line of ['one', 'two', 'three']) room.say('out', line);
  room.say('out', 'what can you see in there?');
  await pass(400);
  assert.equal(prompts.length, 1);
  const turn = JSON.parse(prompts[0]!);
  for (const hidden of ['players', '"pose"', '"x"', '"y"', 'puzzleList', 'puzzleId', 'grid', 'objects', 'items']) assert.ok(!prompts[0]!.includes(hidden), hidden);
  // Nothing either side sees on this face is in it.
  for (const side of ['in', 'out'] as const) for (const o of visibleObjects(room.state, side, 1)) assert.ok(!prompts[0]!.includes(`"${o.type}"`), o.type);
  assert.equal(typeof turn.body, 'string');
  assert.equal(turn.youAre, 'the INSIDE player');
  assert.deepEqual([turn.event, turn.face, turn.partnerSaid], ['chat', 1, 'what can you see in there?']);
  assert.deepEqual(turn.chat, ['partner: two', 'partner: three', 'partner: what can you see in there?']);
});

// ---------- pacing ----------

test('pacing: each line gets max(1.5 s, 65 ms per character) before the next; small talk goes stale, a puzzle line never does', async (t) => {
  const pass = clock(t);
  assert.deepEqual([LINE_GAP_MS, LINE_MS_PER_CHAR, lineHoldMs('x'), lineHoldMs('x'.repeat(40)), lineHoldMs('x'.repeat(80))], [1500, 65, 1500, 2600, 5200]);
  const { room, ai } = setup('out', null, { scripts: [], humanOn: FAR });
  await pass(30_000); // the greeting and the follow lines are over
  const queue = (text: string, key?: string) => (ai as unknown as { queue(text: string, scripted: boolean, line?: Say): void }).queue(text, true, key ? { key } : undefined);
  const outbox = () => (ai as unknown as { outbox: { text: string }[] }).outbox.map((l) => l.text);
  const at = (text: string) => room.chat.find((m) => m.text === text)?.at;
  const relay = 'the code is four seven two'; // 26 characters: 1690 ms
  const long = 'L'.repeat(60); // 3900 ms
  queue(relay, 'hidden-code.relay');
  queue(long, 'hidden-code.out.intro');
  queue('Okay.');
  await pass(8000, 50);
  // a relay answer is never followed by another line sooner than its speaking time
  const gap1 = at(long)! - at(relay)!;
  const gap2 = at('Okay.')! - at(long)!;
  assert.ok(gap1 >= lineHoldMs(relay) && gap1 < lineHoldMs(relay) + 250, `${gap1} ms after the relay line`);
  assert.ok(gap2 >= lineHoldMs(long) && gap2 < lineHoldMs(long) + 250, `${gap2} ms after the long line`);
  assert.equal(room.chat.find((m) => m.text === long)!.key, 'hidden-code.out.intro'); // the chat line carries its key
  assert.equal(room.chat.find((m) => m.text === 'Okay.')!.key, undefined);
  // Small talk that waited too long behind puzzle lines is dropped; the puzzle lines are all said.
  await pass(2000);
  const three = ['A', 'B', 'C'].map((c) => c.repeat(80)); // 5.2 s each
  three.forEach((l) => queue(l, 'hidden-code.out.intro'));
  queue('Too late to matter.');
  queue(relay, 'hidden-code.relay');
  await pass(25_000);
  for (const l of three) assert.ok(at(l) !== undefined, l[0]);
  assert.ok(3 * lineHoldMs(three[0]!) > STALE_MS && at('Too late to matter.') === undefined);
  assert.ok(room.chat.filter((m) => m.text === relay).length === 2);
  // Bounded: small talk gives way, an answer never does.
  await pass(6000);
  for (let i = 0; i < 20; i++) queue(`small talk ${i}`);
  queue('the code is one two three', 'hidden-code.relay');
  for (let i = 20; i < 40; i++) queue(`small talk ${i}`);
  assert.ok(outbox().length <= 6 && outbox().includes('the code is one two three'), outbox().join(' | '));
  await pass(20_000);
  assert.ok(at('the code is one two three') !== undefined);
  assert.equal(outbox().length, 0); // it never stalls
});

test('a question that was answered while it waited is not asked after the answer', async (t) => {
  const pass = clock(t);
  // A script that explains (a long line), asks, and takes "yes" for the answer.
  const script: PuzzleScript<{ done: boolean }> = {
    id: 'hidden-code',
    lines: ['hidden-code.out.intro', 'hidden-code.ask.first', 'hidden-code.ask.next'],
    init: () => ({ done: false }),
    play(ctx) {
      ctx.say('hidden-code.out.intro');
      if (!ctx.mem.done) ctx.say('hidden-code.ask.first');
      if (ctx.has('yes')) {
        ctx.mem.done = true;
        ctx.cancel('hidden-code.ask.first');
        ctx.say('hidden-code.ask.next');
      }
      return { action: null, status: 'test' };
    },
  };
  const { room, said } = setup('out', null, { scripts: [script] });
  await pass(6000); // the greeting is over, the long line is being said, the question waits
  assert.ok(said().includes(L('hidden-code.out.intro')) && !said().includes(L('hidden-code.ask.first')));
  room.say('out', 'yes');
  await pass(12_000);
  assert.ok(!said().includes(L('hidden-code.ask.first')), said().join(' | '));
  assert.ok(said().includes(L('hidden-code.ask.next')));
  // without the answer the question is asked
  const quiet = setup('out', null, { scripts: [script] });
  await pass(14_000);
  assert.ok(quiet.said().includes(L('hidden-code.ask.first')));
});

// ---------- small things ----------

test('parseReply: validates the JSON shape', () => {
  assert.deepEqual(parseReply('{"say":"hi","heard":null}'), { say: 'hi', heard: null });
  assert.deepEqual(parseReply('```json\n{"say":null,"heard":"moon","action":{"type":"step_on","object":"plate"}}\n```'), { say: null, heard: 'moon' }); // an action is not read
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
  // Every fixed line is in the bank list; a relay line (with a {placeholder}) never is.
  for (const key of lineKeys()) for (const p of ['default', 'tsundere'] as const) assert.equal(bankedScriptLines(p).includes(lineText(p, key)), !/\{\w+\}/.test(lineText(p, key)), key);
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
    assert.match(p, /Never claim to see your partner's side/);
    assert.match(p, /Never promise to move or press anything/);
    assert.match(p, /one or two short sentences/);
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
