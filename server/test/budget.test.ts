import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { CHAT_MAX_LEN, FACES, VOCAB, createGame, defaultEnv, devSolve, devTeleport, observe, relayText, type ChatMessage } from '@cubic/shared';
import { AiPlayer, STUCK_MS } from '../src/ai/aiPlayer';
import { BUY_LIMIT_CHARS, planBank, runBank } from '../src/ai/bank';
import { Budget, DEFAULT_ELEVEN_DAILY_CHARS, DEFAULT_GEMINI_DAILY_CAP, ELEVEN_PER_GAME, FALLBACK_LOG_MS, GEMINI_PAUSE_MS, GEMINI_PER_GAME, GEMINI_PER_MINUTE, parseCap, parseEnabled, utcDay } from '../src/ai/budget';
import { DEFAULT_GEMINI_MODEL, MAX_OUTPUT_TOKENS, geminiBrain, isQuotaError, thinkingConfig, type Brain, type GeminiClient } from '../src/ai/gemini';
import { CHAT_LINES, REPLY_SCHEMA, estimateTokens, systemPrompt, turnPrompt } from '../src/ai/prompt';
import { RELAY_GAP_MS, relayPieces } from '../src/ai/relay';
import { eventLine, fixedLines } from '../src/ai/scripted';
import { bankFileName, bankLines, createTts } from '../src/ai/tts';
import { createAiPartner, type Send } from '../src/ai/wire';
import { LIMITS, Rooms } from '../src/rooms';

// The budget of both APIs, the Gemini client, the events that may cost a call, the voice
// bank and its script. Nothing here touches the network: Gemini is a fake SDK client or a
// fake Brain, ElevenLabs is a fake fetch, and time is a number or the mocked clock.

LIMITS.moveBurst = 1e9;
const rooms = new Rooms();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cubic-budget-'));
  dirs.push(d);
  return d;
};
after(() => {
  rooms.closeAll();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const DAY = Date.UTC(2026, 9, 4, 12, 0, 0);
/** A budget with its own clock and log. */
function budgetAt(opts: ConstructorParameters<typeof Budget>[0] = {}, start = DAY) {
  const t = { now: start };
  const logs: string[] = [];
  const budget = new Budget({ now: () => t.now, log: (l) => logs.push(l), ...opts });
  return { budget, logs, t };
}
function clock(t: TestContext, now = DAY) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now });
  return async (ms: number, slice = 100) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}
/** A fake ElevenLabs that records what it was asked. */
function fakeApi() {
  const calls: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    calls.push((JSON.parse(init.body as string) as { text: string }).text);
    return new Response(new Uint8Array([1, 2, 3]));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const reply = (say: string | null, heard: string | null = null) => JSON.stringify({ say, heard });

// ---------- the env ----------

test('env: both APIs are on unless switched off, and the caps have defaults', () => {
  for (const off of ['false', 'FALSE', '0', 'off', 'no', ' false ']) assert.equal(parseEnabled(off), false, off);
  for (const on of [undefined, '', 'true', '1', 'yes']) assert.equal(parseEnabled(on), true, String(on));
  assert.deepEqual([parseCap(undefined, 200), parseCap('', 200), parseCap('50', 200), parseCap('0', 200), parseCap('-3', 200), parseCap('lots', 200)], [200, 200, 50, 0, 200, 200]);
  const d = Budget.fromEnv({}, { file: null, log: () => {} });
  assert.deepEqual([d.geminiEnabled, d.geminiDailyCap, d.elevenEnabled, d.elevenDailyChars], [true, 200, true, 2000]);
  assert.deepEqual([DEFAULT_GEMINI_DAILY_CAP, DEFAULT_ELEVEN_DAILY_CHARS, GEMINI_PER_MINUTE, GEMINI_PER_GAME, ELEVEN_PER_GAME, GEMINI_PAUSE_MS], [200, 2000, 8, 25, 5, 600_000]);
  const e = Budget.fromEnv({ GEMINI_ENABLED: 'false', GEMINI_DAILY_CAP: '40', ELEVENLABS_ENABLED: 'false', ELEVENLABS_DAILY_CHARS: '500' }, { file: null, log: () => {} });
  assert.deepEqual([e.geminiEnabled, e.geminiDailyCap, e.elevenEnabled, e.elevenDailyChars], [false, 40, false, 500]);
});

// ---------- Gemini caps ----------

test('Gemini: 8 calls a minute over ALL rooms, then the script, with no queue', () => {
  const { budget, t, logs } = budgetAt();
  for (let i = 0; i < 8; i++) assert.equal(budget.gemini(`R${i % 3}`, 'chat'), null);
  assert.equal(budget.gemini('R9', 'chat'), 'minute_cap');
  assert.equal(budget.gemini('R0', 'solved'), 'minute_cap');
  t.now += 59_000;
  assert.equal(budget.gemini('R0', 'chat'), 'minute_cap');
  t.now += 1000; // the minute of the first eight is over: eight again, not the refused ones on top
  for (let i = 0; i < 8; i++) assert.equal(budget.gemini('R1', 'chat'), null);
  assert.equal(budget.gemini('R1', 'chat'), 'minute_cap');
  assert.equal(budget.summary().geminiCalls, 16); // refused calls were never made
  assert.equal(logs.filter((l) => l.includes('fallback')).length, 2); // one a minute, not one per refusal
});

test('Gemini: the daily cap is for the whole server, and a new UTC day starts from zero', () => {
  const { budget, t } = budgetAt({ geminiDailyCap: 10 }, Date.UTC(2026, 9, 4, 23, 50, 0));
  for (let i = 0; i < 10; i++) {
    assert.equal(budget.gemini(`ROOM${i}`, 'chat'), null);
    t.now += 20_000;
  }
  assert.equal(budget.gemini('OTHER', 'chat'), 'day_cap');
  assert.equal(budget.summary().day, '2026-10-04');
  t.now = Date.UTC(2026, 9, 5, 0, 0, 1);
  assert.deepEqual(budget.summary(), { day: '2026-10-05', geminiCalls: 0, tokensIn: 0, tokensOut: 0, elevenCalls: 0, elevenChars: 0 });
  assert.equal(budget.gemini('OTHER', 'chat'), null);
  assert.equal(utcDay(Date.UTC(2026, 0, 1, 23, 59, 59)), '2026-01-01');
});

test('Gemini: 25 calls per game, then scripted only; a new game in the room starts again', () => {
  const { budget, t } = budgetAt();
  for (let i = 0; i < 25; i++) {
    assert.equal(budget.gemini('ABCD', 'chat'), null, `call ${i}`);
    t.now += 10_000;
  }
  for (let i = 0; i < 5; i++) {
    assert.equal(budget.gemini('ABCD', 'stuck'), 'game_cap');
    t.now += 10_000;
  }
  assert.equal(budget.gemini('WXYZ', 'chat'), null); // another game has its own
  budget.newGame('ABCD');
  assert.equal(budget.gemini('ABCD', 'chat'), null);
  assert.equal(budget.summary().geminiCalls, 27);
});

test('Gemini: a 429 stops every call on the server for 10 minutes', () => {
  const { budget, t, logs } = budgetAt();
  assert.equal(budget.gemini('AAAA', 'chat'), null);
  budget.geminiQuota('AAAA');
  assert.ok(logs.some((l) => l.startsWith('[gemini] 429 room=AAAA')));
  for (const room of ['AAAA', 'BBBB']) assert.equal(budget.gemini(room, 'chat'), 'paused_429');
  t.now += GEMINI_PAUSE_MS - 1;
  assert.equal(budget.gemini('BBBB', 'chat'), 'paused_429');
  t.now += 1;
  assert.equal(budget.gemini('BBBB', 'chat'), null);
  assert.equal(budget.summary().geminiCalls, 2);
  for (const e of [Object.assign(new Error('x'), { status: 429 }), new Error('got status: 429 Too Many Requests'), new Error('{"error":{"status":"RESOURCE_EXHAUSTED"}}')]) assert.ok(isQuotaError(e));
  for (const e of [new Error('503 overloaded'), new Error('timed out'), null, 'oops']) assert.ok(!isQuotaError(e));
});

test('kill switches: GEMINI_ENABLED=false and ELEVENLABS_ENABLED=false refuse everything', () => {
  const { budget, logs, t } = budgetAt({ geminiEnabled: false, elevenEnabled: false });
  for (let i = 0; i < 50; i++) {
    assert.equal(budget.gemini('ABCD', 'chat'), 'disabled');
    assert.equal(budget.eleven('ABCD', 10), 'disabled');
  }
  assert.deepEqual(budget.summary(), { day: '2026-10-04', geminiCalls: 0, tokensIn: 0, tokensOut: 0, elevenCalls: 0, elevenChars: 0 });
  // 100 refusals, two log lines: it cannot flood.
  assert.deepEqual(logs, ['[gemini] fallback room=ABCD reason=chat why=disabled', '[eleven] fallback room=ABCD chars=10 why=disabled']);
  t.now += FALLBACK_LOG_MS;
  budget.gemini('WXYZ', 'stuck');
  assert.equal(logs.at(-1), '[gemini] fallback room=WXYZ reason=stuck why=disabled more=49');
});

// ---------- ElevenLabs caps ----------

test('ElevenLabs: 5 bought lines per game and a daily number of characters for the whole server', () => {
  const { budget, logs } = budgetAt({ elevenDailyChars: 300 });
  for (let i = 0; i < 5; i++) assert.equal(budget.eleven('ABCD', 20), null);
  assert.equal(budget.eleven('ABCD', 20), 'game_cap');
  assert.equal(logs[1], '[eleven] room=ABCD chars=20 day=40/300 game=2/5');
  for (let i = 0; i < 3; i++) assert.equal(budget.eleven('WXYZ', 60), null); // 100 + 180 = 280
  assert.equal(budget.eleven('WXYZ', 21), 'day_cap'); // 301 would be over
  assert.equal(budget.eleven('WXYZ', 20), null); // exactly 300 is not
  assert.equal(budget.eleven('NEW1', 1), 'day_cap');
  assert.deepEqual([budget.summary().elevenCalls, budget.summary().elevenChars], [9, 300]);
  budget.newGame('ABCD');
  assert.equal(budget.eleven('ABCD', 1), 'day_cap'); // a new game does not reset the day
  assert.ok(logs.includes('[eleven] fallback room=ABCD chars=20 why=game_cap'));
  assert.ok(logs.includes('[eleven] fallback room=WXYZ chars=21 why=day_cap'));
});

// ---------- the daily counters on disk ----------

test('the daily counters survive a restart within the same UTC day, and not into the next', () => {
  const file = join(tmp(), 'data', 'usage.json');
  const a = budgetAt({ file });
  a.budget.gemini('ABCD', 'chat');
  a.budget.geminiDone('ABCD', 'chat', { input: 312, output: 41 });
  a.budget.eleven('ABCD', 64);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { day: '2026-10-04', geminiCalls: 1, tokensIn: 312, tokensOut: 41, elevenCalls: 1, elevenChars: 64 });
  // a restart, three hours later
  const b = budgetAt({ file, geminiDailyCap: 2 }, DAY + 3 * 3600_000);
  assert.deepEqual(b.budget.summary(), { day: '2026-10-04', geminiCalls: 1, tokensIn: 312, tokensOut: 41, elevenCalls: 1, elevenChars: 64 });
  assert.equal(b.budget.gemini('WXYZ', 'chat'), null);
  assert.equal(b.budget.gemini('WXYZ', 'chat'), 'day_cap'); // yesterday's... no: this morning's call still counts
  // a restart the next day
  const c = budgetAt({ file }, DAY + 24 * 3600_000);
  assert.equal(c.budget.summary().geminiCalls, 0);
  // and a day that turns while the server runs is written too
  b.t.now = DAY + 24 * 3600_000;
  assert.equal(b.budget.gemini('WXYZ', 'chat'), null);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).day, '2026-10-05');
});

test('a missing, broken or read-only disk falls back to memory and the caps still hold', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'blocker'), 'a file where the data directory should be');
  const broken = join(dir, 'usage.json');
  writeFileSync(broken, '{ not json');
  for (const file of [join(dir, 'blocker', 'usage.json'), broken, null]) {
    const { budget, logs } = budgetAt({ file, geminiDailyCap: 3 });
    for (let i = 0; i < 3; i++) assert.equal(budget.gemini('ABCD', 'chat'), null);
    assert.equal(budget.gemini('ABCD', 'chat'), 'day_cap');
    assert.equal(budget.summary().geminiCalls, 3);
    assert.ok(logs.filter((l) => l.includes('kept in memory only')).length <= 1); // said once, not per call
  }
  const { logs } = (() => {
    const b = budgetAt({ file: join(dir, 'blocker', 'usage.json') });
    b.budget.gemini('ABCD', 'chat');
    return b;
  })();
  assert.equal(logs.filter((l) => l.includes('kept in memory only')).length, 1);
});

// ---------- logging ----------

test('logging: one grep-friendly line per Gemini call and per ElevenLabs call, with the running totals', () => {
  const { budget, logs, t } = budgetAt();
  for (let i = 0; i < 4; i++) {
    budget.gemini('ABCD', 'chat');
    t.now += 15_000;
  }
  budget.geminiDone('ABCD', 'chat', { input: 312, output: 41 });
  assert.equal(logs.at(-1), '[gemini] room=ABCD reason=chat in=312 out=41 day=4/200 min=3/8 game=4/25');
  budget.gemini('WXYZ', 'stuck');
  budget.geminiDone('WXYZ', 'stuck', undefined, 'timeout');
  assert.equal(logs.at(-1), '[gemini] room=WXYZ reason=stuck in=0 out=0 day=5/200 min=4/8 game=1/25 error=timeout');
  budget.eleven('ABCD', 64);
  assert.equal(logs.at(-1), '[eleven] room=ABCD chars=64 day=64/2000 game=1/5');
  assert.ok(logs.every((l) => !l.includes('\n') && /^\[(gemini|eleven)\] /.test(l)));
});

test('the usage summary: what was used today, and the hourly report only when something changed', () => {
  const { budget } = budgetAt();
  assert.equal(budget.report(), null); // nothing happened: nothing to log
  budget.gemini('ABCD', 'chat');
  budget.geminiDone('ABCD', 'chat', { input: 300, output: 40 });
  budget.eleven('ABCD', 64);
  assert.deepEqual(budget.summary(), { day: '2026-10-04', geminiCalls: 1, tokensIn: 300, tokensOut: 40, elevenCalls: 1, elevenChars: 64 });
  assert.equal(budget.report(), '[usage] day=2026-10-04 gemini_calls=1/200 tokens_in=300 tokens_out=40 eleven_calls=1 eleven_chars=64/2000');
  assert.equal(budget.report(), null);
  budget.eleven('ABCD', 1);
  assert.match(budget.report()!, /eleven_chars=65\/2000/);
  assert.equal(budget.summaryLine(), '[usage] day=2026-10-04 gemini_calls=1/200 tokens_in=300 tokens_out=40 eleven_calls=2 eleven_chars=65/2000');
});

// ---------- the Gemini client ----------

/** A fake of the SDK: records every request, answers from a list. */
function fakeSdk(answers: (Awaited<ReturnType<GeminiClient['models']['generateContent']>> | Error)[]) {
  const requests: Parameters<GeminiClient['models']['generateContent']>[0][] = [];
  const client: GeminiClient = {
    models: {
      async generateContent(params) {
        requests.push(params);
        const next = answers.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, requests };
}

test('Gemini client: exactly one model, minimal thinking, room for a real reply, tokens from usageMetadata', async () => {
  const sdk = fakeSdk([{ text: reply('Hello!'), candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 312, totalTokenCount: 353 } }]);
  const warned: string[] = [];
  const brain = geminiBrain('fake-key', undefined, 'default', { client: sdk.client, warn: (l) => warned.push(l) });
  const res = await brain.think('{"event":"chat"}', new AbortController().signal);
  assert.deepEqual(res, { text: reply('Hello!'), tokens: { input: 312, output: 41 }, finish: 'STOP' });
  assert.deepEqual(warned, []);
  const req = sdk.requests[0]!;
  assert.equal(req.model, 'gemini-3.5-flash');
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.5-flash');
  assert.deepEqual(req.config!.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(thinkingConfig('gemini-2.5-flash'), { thinkingBudget: 0 }); // the older family turns it off with a budget
  assert.ok(MAX_OUTPUT_TOKENS >= 256 && req.config!.maxOutputTokens === MAX_OUTPUT_TOKENS, 'a thinking model needs room, or no text comes back');
  assert.equal(req.config!.responseMimeType, 'application/json');
  assert.equal(req.config!.systemInstruction, systemPrompt('default'));
  // GEMINI_MODEL picks the model, and that one is the only one ever asked.
  const other = fakeSdk([{ text: reply(null) }]);
  await geminiBrain('fake-key', 'gemini-9-flash', 'default', { client: other.client, warn: () => {} }).think('{}', new AbortController().signal);
  assert.equal(other.requests[0]!.model, 'gemini-9-flash');
});

test('Gemini client: an empty reply or one cut off by MAX_TOKENS is logged as a warning', async () => {
  const sdk = fakeSdk([
    { text: undefined, candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 300, totalTokenCount: 313 } }, // the live probe: 13 thought tokens, no text
    { text: '{"say":"Hel', candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 300, totalTokenCount: 812 } },
    { text: '   ', candidates: [{ finishReason: 'STOP' }] },
  ]);
  const warned: string[] = [];
  const brain = geminiBrain('fake-key', DEFAULT_GEMINI_MODEL, 'default', { client: sdk.client, warn: (l) => warned.push(l) });
  const signal = new AbortController().signal;
  assert.deepEqual(await brain.think('{}', signal), { text: '', tokens: { input: 300, output: 13 }, finish: 'MAX_TOKENS' });
  await brain.think('{}', signal);
  await brain.think('{}', signal);
  assert.deepEqual(warned, [
    '[gemini] warning model=gemini-3.5-flash empty reply finish=MAX_TOKENS in=300 out=13 max_out=512',
    '[gemini] warning model=gemini-3.5-flash reply cut off finish=MAX_TOKENS in=300 out=512 max_out=512',
    '[gemini] warning model=gemini-3.5-flash empty reply finish=STOP in=0 out=0 max_out=512',
  ]);
});

test('Gemini client: an error is thrown on, with no retry and no other model', async () => {
  for (const err of [Object.assign(new Error('429'), { status: 429 }), new Error('503 overloaded'), new Error('404 model not found')]) {
    const sdk = fakeSdk([err, { text: reply('never') }]);
    const brain = geminiBrain('fake-key', DEFAULT_GEMINI_MODEL, 'default', { client: sdk.client, warn: () => {} });
    await assert.rejects(brain.think('{}', new AbortController().signal), err);
    assert.deepEqual(sdk.requests.map((r) => r.model), ['gemini-3.5-flash']);
  }
});

// ---------- the prompt ----------

test('the prompt stays under 800 input tokens in the worst case (chars / 3), and asks for one or two sentences', () => {
  const state = createGame(DAY);
  const long = 'W'.repeat(CHAT_MAX_LEN);
  const chat: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({ id: i, from: i % 2 ? 'out' : 'in', isAI: false, text: long, at: DAY }));
  let worst = 0;
  for (const persona of ['default', 'tsundere'] as const)
    for (const side of ['out', 'in'] as const)
      for (const face of FACES) {
        devTeleport(state, side, face);
        state.solved = [...FACES];
        state.strikes = 99;
        const observation = { ...observe(state, side), objective: 'O'.repeat(400), faceName: 'N'.repeat(60) };
        for (const event of ['chat', 'solved', 'strike', 'stuck'] as const) {
          const turn = turnPrompt({ side, event, observation, planner: 'P'.repeat(300), scriptLine: event === 'chat' ? null : 'S'.repeat(80), partnerSaid: event === 'chat' ? long : null, chat });
          worst = Math.max(worst, estimateTokens(systemPrompt(persona), turn, JSON.stringify(REPLY_SCHEMA)));
          assert.equal((JSON.parse(turn) as { chat: string[] }).chat.length, CHAT_LINES);
        }
      }
  assert.ok(worst < 800, `${worst} tokens`);
  assert.equal(CHAT_LINES, 3);
  // A real turn is far smaller.
  const real = turnPrompt({ side: 'in', event: 'chat', observation: observe(createGame(DAY), 'in'), planner: 'waiting with the human', scriptLine: null, partnerSaid: 'what do you see?', chat: [] });
  assert.ok(estimateTokens(systemPrompt('default'), real, JSON.stringify(REPLY_SCHEMA)) < 700);
  assert.match(systemPrompt('default'), /one or two short sentences, at most 80 characters/);
});

// ---------- the events that may cost a call ----------

/** A solo room with a fake Gemini that always answers, on its own budget. */
function solo(replies: () => string = () => reply('Mm.')) {
  const room = rooms.create('ai');
  room.sit('out');
  const prompts: { event: string }[] = [];
  const brain: Brain = {
    async think(turn) {
      prompts.push(JSON.parse(turn) as { event: string });
      return { text: replies(), tokens: { input: 300, output: 20 } };
    },
  };
  const logs: string[] = [];
  const budget = new Budget({ log: (l) => logs.push(l) });
  // no puzzle scripts: what is counted here must not depend on what a script does with a line
  const ai = new AiPlayer(room, 'in', brain, { budget, scripts: [], log: () => {} });
  const said = () => room.chat.filter((m) => m.isAI).map((m) => m.text);
  const events = () => prompts.map((p) => p.event);
  return { room, ai, budget, logs, said, events };
}
const strike = (room: ReturnType<typeof solo>['room']) =>
  room.devApply((state) => {
    state.strikes++;
    return [{ type: 'strike', side: 'out' }];
  });

test('Gemini is called ONLY on events: not for the greeting, not on a timer, not per move, not for protocol words', async (t) => {
  const pass = clock(t);
  const s = solo();
  await pass(30_000);
  assert.ok(s.room.state.players.in.steps === 0 || s.ai.calls === 0);
  assert.equal(s.ai.calls, 0); // 150 decisions, a greeting: nothing
  for (const plain of ['wait', 'go', 'yes', 'face 2', '4 7 2']) {
    s.room.say('out', plain);
    await pass(2000);
  }
  for (let i = 0; i < 20; i++) {
    s.room.move('out', 1, 0); // the human walks about
    await pass(500);
  }
  assert.equal(s.ai.calls, 0);
  s.room.say('out', 'so what is it like in there');
  await pass(7000);
  strike(s.room);
  await pass(7000);
  s.room.devApply((state, now) => devSolve(state, defaultEnv.puzzles[0]!.face, now));
  await pass(7000);
  assert.deepEqual(s.events(), ['chat', 'strike', 'solved']);
  assert.deepEqual(s.logs.filter((l) => l.startsWith('[gemini] room=')).map((l) => l.replace(/min=\d/, 'min=N')), [
    `[gemini] room=${s.room.code} reason=chat in=300 out=20 day=1/200 min=N/8 game=1/25`,
    `[gemini] room=${s.room.code} reason=strike in=300 out=20 day=2/200 min=N/8 game=2/25`,
    `[gemini] room=${s.room.code} reason=solved in=300 out=20 day=3/200 min=N/8 game=3/25`,
  ]);
});

test('stuck: 60 s with no solve, no strike and no human chat, once per quiet period, never while the human is away', async (t) => {
  const pass = clock(t);
  const s = solo();
  await pass(STUCK_MS - 1000);
  assert.deepEqual(s.events(), []);
  await pass(1400);
  assert.deepEqual(s.events(), ['stuck']);
  await pass(5 * STUCK_MS, 1000);
  assert.deepEqual(s.events(), ['stuck']); // once: the same quiet period
  s.room.say('out', 'go'); // the human speaks (a plain word: no call), and goes quiet again
  await pass(STUCK_MS - 1000);
  assert.deepEqual(s.events(), ['stuck']);
  await pass(1400);
  assert.deepEqual(s.events(), ['stuck', 'stuck']);
  // A strike and a solve each start the minute again.
  await pass(7000);
  strike(s.room);
  await pass(STUCK_MS - 1000);
  s.room.devApply((state, now) => devSolve(state, defaultEnv.puzzles[0]!.face, now));
  await pass(STUCK_MS - 1000);
  assert.deepEqual(s.events(), ['stuck', 'stuck', 'strike', 'solved']);
  await pass(1400);
  assert.deepEqual(s.events(), ['stuck', 'stuck', 'strike', 'solved', 'stuck']);
  // The human's connection drops: the time away is not "stuck", and nothing is called.
  s.room.say('out', 'yes');
  await pass(1000);
  s.room.drop('out');
  await pass(LIMITS.seatHoldMs - 5000, 1000);
  assert.equal(s.events().length, 5);
  assert.equal(STUCK_MS, 60_000);
});

test('stuck, strike: with no Gemini the script says its own line', async (t) => {
  const pass = clock(t);
  const room = rooms.create('ai');
  room.sit('out');
  const ai = new AiPlayer(room, 'in', null, { log: () => {} });
  const said = () => room.chat.filter((m) => m.isAI).map((m) => m.text);
  await pass(STUCK_MS + 2000);
  assert.ok(said().includes(eventLine('default', 'stuck')));
  room.devApply((state) => {
    state.strikes++;
    return [{ type: 'strike', side: 'out' }];
  });
  await pass(3000);
  assert.ok(said().includes(eventLine('default', 'strike')));
  assert.equal(ai.calls, 0);
  for (const p of ['default', 'tsundere'] as const) for (const k of ['strike', 'stuck'] as const) assert.ok(fixedLines().includes(eventLine(p, k)) && eventLine(p, k).length <= 80);
});

test('per game: after 25 Gemini calls the rest of the game is scripted; a restart of the game gets 25 again', async (t) => {
  const pass = clock(t);
  let n = 0;
  const s = solo(() => reply(`Answer ${n++}.`));
  await pass(400);
  for (let i = 0; i < 28; i++) {
    s.room.say('out', `free form question number ${i}, tell me more`);
    await pass(8000);
  }
  assert.equal(s.ai.calls, 25);
  assert.equal(s.ai.stats.refused, 3);
  assert.ok(s.logs.includes(`[gemini] fallback room=${s.room.code} reason=chat why=game_cap`));
  assert.equal(s.logs.filter((l) => l.includes('fallback')).length, 1);
  assert.equal(s.budget.summary().geminiCalls, 25);
  assert.deepEqual([s.budget.summary().tokensIn, s.budget.summary().tokensOut], [25 * 300, 25 * 20]);
});

// ---------- the voice ----------

test('live ElevenLabs: only through the budget, and the same text is never bought twice', async () => {
  const api = fakeApi();
  const { budget, logs } = budgetAt({ elevenDailyChars: 100 });
  const cacheDir = tmp();
  const tts = createTts({ apiKey: 'fake-key', cacheDir, bankDir: tmp(), fetchFn: api.fetchFn, budget, log: () => {} });
  assert.equal((await tts.speak('A line by Gemini.', 'ABCD'))!.source, 'api');
  for (let i = 0; i < 5; i++) assert.equal((await tts.speak('A line by Gemini.', i % 2 ? 'ABCD' : 'WXYZ'))!.source, 'cache');
  // a restart: still on disk, still free
  assert.equal((await createTts({ apiKey: 'fake-key', cacheDir, bankDir: tmp(), fetchFn: api.fetchFn, budget, log: () => {} }).speak('A line by Gemini.', 'ABCD'))!.source, 'cache');
  assert.deepEqual(api.calls, ['A line by Gemini.']);
  assert.deepEqual([budget.summary().elevenCalls, budget.summary().elevenChars], [1, 17]);
  assert.deepEqual(logs, ['[eleven] room=ABCD chars=17 day=17/100 game=1/5']);
  // 5 per game, then the browser voice (null); cached lines stay free after the cap
  for (let i = 2; i <= 5; i++) assert.equal((await tts.speak(`Line ${i}.`, 'ABCD'))!.source, 'api');
  assert.equal(await tts.speak('Line 6.', 'ABCD'), null);
  assert.equal((await tts.speak('Line 3.', 'ABCD'))!.source, 'cache');
  // the daily characters: 17 + 4 x 7 = 45 used, 100 allowed
  assert.equal(await tts.speak('x'.repeat(56), 'WXYZ'), null);
  assert.equal((await tts.speak('x'.repeat(55), 'WXYZ'))!.source, 'api');
  assert.equal(await tts.speak('y', 'WXYZ'), null);
  assert.equal(api.calls.length, 6);
  assert.equal(budget.summary().elevenChars, 100);
  // ELEVENLABS_ENABLED=false: nothing is bought, cached and banked clips still play
  const off = createTts({ apiKey: 'fake-key', cacheDir, bankDir: tmp(), fetchFn: api.fetchFn, budget: budgetAt({ elevenEnabled: false }).budget, log: () => {} });
  assert.equal(await off.speak('Something new.', 'ABCD'), null);
  assert.equal((await off.speak('Line 3.', 'ABCD'))!.source, 'cache');
  assert.equal(api.calls.length, 6);
});

test('relay lines: a line built from vocabulary pieces is taken apart again, piece by piece', () => {
  assert.deepEqual(relayPieces(relayText(['the code is', 'four', 'seven', 'two'])), ['the code is', 'four', 'seven', 'two']);
  assert.deepEqual(relayPieces(relayText([...VOCAB])), [...VOCAB]); // every piece, phrases included
  assert.deepEqual(relayPieces('the path is up up left then down'), ['the path is', 'up', 'up', 'left', 'then', 'down']);
  for (const not of ['The code is four.', 'the code is 4 7 2', 'the code', 'It worked!', '', 'four  seven']) assert.equal(relayPieces(not), null, not);
});

/** The server's own wiring, with keys "present", a throwing ElevenLabs and its own bank. */
function partner(bankDir: string, env: Record<string, string> = {}) {
  const fetched: string[] = [];
  const sent: { event: string; msg: Record<string, unknown> }[] = [];
  const ai = createAiPartner(
    { GEMINI_API_KEY: 'fake-gemini-key', ELEVENLABS_API_KEY: 'fake-eleven-key', TTS_MODE: 'elevenlabs', AI_FAKE: '1', ...env },
    {
      budget: new Budget({ log: () => {} }),
      log: () => {},
      tts: { bankDir, cacheDir: tmp() },
      fetchFn: (async (url: string) => {
        fetched.push(String(url));
        throw new Error('ElevenLabs must not be called');
      }) as unknown as typeof fetch,
    },
  );
  const send: Send = (_room, event, msg) => void sent.push({ event, msg: msg as unknown as Record<string, unknown> });
  return { ai, fetched, sent, send };
}

test('a relay line is played as a chain of banked piece clips, with no ElevenLabs call; one missing clip = the browser voice', async (t) => {
  const pass = clock(t);
  // A bank that holds every piece but "seven".
  const bankDir = tmp();
  const seed = createTts({ apiKey: 'k', bankDir, cacheDir: tmp(), log: () => {}, fetchFn: (async (_u: string, init: RequestInit) => new Response(Buffer.from((JSON.parse(init.body as string) as { text: string }).text))) as unknown as typeof fetch });
  for (const piece of VOCAB) if (piece !== 'seven') await seed.bank(piece);
  const { ai, fetched, sent, send } = partner(bankDir);
  const room = rooms.create('ai');
  room.sit('out');
  const player = ai.join(room, 'out', send);
  const say = (pieces: string[]) => (player as unknown as { queue(text: string, scripted: boolean): void }).queue(relayText(pieces), true);
  say(['the code is', 'four', 'two']);
  say(['the code is', 'four', 'seven', 'two']);
  await pass(6000);
  const chain = sent.find((x) => x.event === 'tts:chain')!;
  assert.deepEqual(chain.msg.pieces, ['the code is', 'four', 'two']);
  assert.deepEqual((chain.msg.clips as Buffer[]).map((c) => c.toString()), ['the code is', 'four', 'two']); // one clip per piece, in order
  assert.deepEqual([chain.msg.mime, chain.msg.gapMs], ['audio/mpeg', RELAY_GAP_MS]);
  assert.equal(room.chat.find((m) => m.id === chain.msg.chatId)!.text, 'the code is four two'); // the caption: relayText(pieces)
  // "seven" has no clip: the WHOLE line goes to the browser voice, never to ElevenLabs.
  assert.ok(sent.some((x) => x.event === 'speak' && x.msg.text === 'the code is four seven two'));
  assert.equal(sent.filter((x) => x.event === 'tts:chain').length, 1);
  assert.deepEqual(fetched, []);
  assert.ok(RELAY_GAP_MS > 0 && RELAY_GAP_MS <= 200);
});

// ---------- the bank script ----------

/** The bank script against a fake ElevenLabs, on a bank of its own. */
function bankRun(lines: string[], argv: string[], bankDir = tmp(), key = true) {
  const api = fakeApi();
  const out: string[] = [];
  const tts = createTts({ ...(key ? { apiKey: 'fake-key' } : {}), voiceId: 'V', modelId: 'M', bankDir, cacheDir: tmp(), fetchFn: api.fetchFn, log: () => {} });
  const run = () => runBank({ argv, lines, tts, hasKey: key, bankDir, voiceId: 'V', modelId: 'M', out: (l) => out.push(l) });
  return { api, out, run, bankDir, tts };
}

test('tts:bank: the default is a dry run: every missing clip, the exact total, no network call, nothing written, exit 0', async () => {
  const lines = ['It worked!', 'four', 'the code is'];
  const b = bankRun(lines, []);
  assert.equal(await b.run(), 0);
  assert.deepEqual(b.api.calls, []);
  assert.deepEqual(readdirSync(b.bankDir), []);
  assert.ok(b.out.includes('total to buy: 25 characters in 3 clips (limit per run: 4000)'));
  for (const l of lines) assert.ok(b.out.some((o) => o.includes('missing') && o.endsWith(l)), l);
  assert.ok(b.out.at(-1)!.startsWith('dry run: nothing was bought'));
  assert.deepEqual(planBank(lines, b.tts), { banked: [], cached: [], missing: lines, chars: 25 });
});

test('tts:bank --buy: buys only what is missing, never a clip twice, and refuses over 4000 characters', async () => {
  const dir = tmp();
  const first = bankRun(['It worked!', 'four'], ['--buy'], dir);
  assert.equal(await first.run(), 0);
  assert.deepEqual(first.api.calls, ['It worked!', 'four']);
  // again, with one line more: only that one is bought
  const second = bankRun(['It worked!', 'four', 'the code is'], ['--buy'], dir);
  assert.equal(await second.run(), 0);
  assert.deepEqual(second.api.calls, ['the code is']);
  const third = bankRun(['It worked!', 'four', 'the code is'], ['--buy'], dir);
  assert.equal(await third.run(), 0);
  assert.deepEqual(third.api.calls, []);
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { lines: { file: string; text: string; chars: number; voiceId: string; modelId: string }[] };
  assert.deepEqual(index.lines.map((l) => [l.text, l.chars, l.voiceId, l.modelId]), [['It worked!', 10, 'V', 'M'], ['four', 4, 'V', 'M'], ['the code is', 11, 'V', 'M']]);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort(), index.lines.map((l) => l.file).sort());
  // a clip from before the new names (normalized text only) counts as banked
  const old = tmp();
  writeFileSync(join(old, bankFileName('We did it!')), 'x');
  const legacy = bankRun(['We did it!'], ['--buy'], old);
  assert.equal(await legacy.run(), 0);
  assert.deepEqual(legacy.api.calls, []);
  // over the limit: exit 1, the number is printed, nothing is bought
  const big = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(2, '0')} ${'x'.repeat(77)}`); // 51 x 80 = 4080
  const over = bankRun(big, ['--buy']);
  assert.equal(await over.run(), 1);
  assert.deepEqual(over.api.calls, []);
  assert.ok(over.out.includes('REFUSED: 4080 characters is over the limit of 4000. Nothing was bought.'));
  assert.deepEqual(readdirSync(over.bankDir), []);
  assert.equal(BUY_LIMIT_CHARS, 4000);
  // exactly at the limit is allowed; and --buy without a key buys nothing
  assert.equal(await bankRun(big.slice(0, 50), ['--buy']).run(), 0);
  const nokey = bankRun(['four'], ['--buy'], tmp(), false);
  assert.equal(await nokey.run(), 1);
  assert.deepEqual(nokey.api.calls, []);
});

test('tts:bank reads its list at run time: every fixed line and every vocabulary piece, each one once', () => {
  const lines = bankLines();
  for (const piece of VOCAB) assert.ok(lines.includes(piece), piece);
  for (const line of fixedLines()) assert.ok(lines.some((l) => l === line || l.toLowerCase().replace(/[^a-z0-9 ]/g, '') === line.toLowerCase().replace(/[^a-z0-9 ]/g, '')), line);
  assert.equal(new Set(lines).size, lines.length);
});
