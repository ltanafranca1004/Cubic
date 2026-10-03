import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Side } from '@cubic/shared';
import { AiPlayer, FALLBACK_LINE, parseReply } from '../src/ai/aiPlayer';
import type { Brain } from '../src/ai/gemini';
import { MAX_SAY_CHARS, parsePersona, systemPrompt } from '../src/ai/prompt';
import { scriptedBrain } from '../src/ai/scripted';
import { elevenLabsTts } from '../src/ai/tts';
import { LIMITS, Rooms } from '../src/rooms';

LIMITS.moveBurst = 1e9;
const rooms = new Rooms();
after(() => rooms.closeAll());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** A room with a human on `human` and an AI driven by a scripted brain on the other side. */
function setup(human: Side, replies: (string | Error | 'hang')[], opts = {}) {
  const room = rooms.create('ai');
  room.sit(human);
  const prompts: string[] = [];
  const brain: Brain = {
    async think(turn, signal) {
      prompts.push(turn);
      const next = replies.shift() ?? '{"say":null,"action":null}';
      if (next === 'hang') return new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted'))));
      if (next instanceof Error) throw next;
      return { text: next, tokens: { input: 100, output: 10 } };
    },
  };
  const logs: string[] = [];
  const ai = new AiPlayer(room, human === 'out' ? 'in' : 'out', brain, { minThinkMs: 40, idleMs: 1e9, stepMs: 1, timeoutMs: 80, log: (l) => logs.push(l), ...opts });
  return { room, ai, prompts, logs };
}

test('parseReply: validates the JSON shape', () => {
  assert.deepEqual(parseReply('{"say":"hi","action":null}'), { say: 'hi', action: null });
  assert.deepEqual(parseReply('```json\n{"say":null,"action":{"type":"step_on","object":"plate"}}\n```'), { say: null, action: { type: 'step_on', object: 'plate' } });
  assert.deepEqual(parseReply('{"say":"ok","action":{"type":"teleport","face":3}}'), { say: 'ok', action: null }); // bad action dropped
  for (const bad of ['', 'not json', '[]', '"hi"', '{}', '{"say":5,"action":null}', '{"say":null,"action":{"type":"teleport"}}', '{"say": "unterminated']) {
    assert.equal(parseReply(bad), null, bad);
  }
  assert.equal(parseReply(JSON.stringify({ say: 'x'.repeat(900), action: null }))!.say!.length, 80);
  const long = parseReply(JSON.stringify({ say: 'There is a plate on my floor near the top left corner and a pillar right below it, I think', action: null }))!.say!;
  assert.ok(long.length <= 80 && !long.endsWith(' ') && long.endsWith('below'), long); // cut at a word
});

test('the AI takes the empty seat, talks, and walks its action at walking speed', async () => {
  const { room, ai, prompts } = setup('out', ['{"say":"I see a plate. Going to stand on it.","action":{"type":"step_on","object":"plate"}}']);
  assert.deepEqual(room.info().seats.in, { taken: true, connected: true, isAI: true });
  await until(() => room.chat.length === 1, 'the AI to speak');
  assert.deepEqual([room.chat[0]!.from, room.chat[0]!.isAI], ['in', true]);
  const plate = JSON.parse(prompts[0]!).observation.objects[0];
  assert.equal(plate.type, 'plate');
  await until(() => (room.state.puzzles['plate-door'] as { pressed: boolean }).pressed, 'the AI to reach the plate');
  assert.ok(room.state.players.in.steps >= 8); // it walked there step by step, no teleport
  assert.equal(ai.calls >= 1, true);
});

test('the prompt only contains the AI side of the world', async () => {
  const { prompts } = setup('out', []);
  await until(() => prompts.length === 1, 'first think');
  for (const hidden of ['"door"', '"crystal"', '"rose"', 'players', 'puzzles']) assert.ok(!prompts[0]!.includes(hidden), hidden);
});

test('malformed replies, errors and timeouts get the fallback line and never crash', async () => {
  const { room, ai, logs } = setup('in', ['this is not json', new Error('503 overloaded'), 'hang', '{"say":"Back. What do you see?","action":null}'], { backoffMs: 10 });
  await until(() => room.chat.some((m) => m.text === FALLBACK_LINE), 'fallback line');
  for (let i = 0; i < 3; i++) {
    room.say('in', `hello ${i}`); // each human line wakes the AI again
    await sleep(140);
  }
  await until(() => room.chat.some((m) => m.text === 'Back. What do you see?'), 'recovery');
  assert.equal(room.chat.filter((m) => m.text === FALLBACK_LINE).length, 1); // not spammed
  assert.ok(logs.some((l) => l.includes('unusable reply')));
  assert.ok(logs.some((l) => l.includes('503 overloaded')));
  assert.ok(logs.some((l) => l.includes('timed out') || l.includes('aborted')));
  assert.ok(logs.some((l) => l.includes('tokens in=100 out=10')));
  assert.equal(ai.tokens.input >= 100, true);
});

test('rate limit: a burst of chat does not mean a burst of Gemini calls', async () => {
  const { room, ai } = setup('in', [], { minThinkMs: 150 });
  for (let i = 0; i < 5; i++) {
    room.say('in', `msg ${i}`);
    await sleep(20);
  }
  await sleep(200);
  assert.ok(ai.calls <= 3, `calls ${ai.calls}`);
});

test('a failing Gemini (429) backs off and the scripted partner plays that turn', async () => {
  const quota = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 });
  const { room, ai, logs } = setup('out', [quota, quota, quota], { fallback: scriptedBrain('default'), minThinkMs: 30 });
  // Gemini never answered, yet the AI still found the plate and stood on it.
  await until(() => (room.state.puzzles['plate-door'] as { pressed: boolean }).pressed, 'the scripted fallback to act');
  assert.ok(room.chat.some((m) => m.isAI && /plate/.test(m.text)));
  assert.ok(!room.chat.some((m) => m.text === FALLBACK_LINE));
  assert.ok(logs.some((l) => l.includes('429') && l.includes('backing off 6s')));
  // Backed off: no second call right away even though events keep arriving.
  const calls = ai.calls;
  room.say('out', 'hello?');
  await sleep(150);
  assert.equal(ai.calls, calls);
});

test('the default throttle is one Gemini call per 6 seconds per room, with no backlog', async () => {
  const { room, ai } = setup('in', [], { minThinkMs: undefined });
  await until(() => ai.calls === 1, 'first think');
  for (let i = 0; i < 5; i++) {
    room.say('in', `msg ${i}`); // five triggers inside the window
    await sleep(30);
  }
  await sleep(300);
  assert.equal(ai.calls, 1);
  assert.equal((ai as unknown as { minThinkMs: number }).minThinkMs, 6000);
});

test('AI_FAKE scripted partner works with no keys, in both personas, within the say limit', async () => {
  for (const persona of ['default', 'tsundere'] as const) {
    const room = rooms.create('ai');
    room.sit('out');
    new AiPlayer(room, 'in', scriptedBrain(persona), { minThinkMs: 20, idleMs: 1e9, stepMs: 1, log: () => {} });
    await until(() => (room.state.puzzles['plate-door'] as { pressed: boolean }).pressed, `${persona} scripted AI on the plate`);
    assert.ok(room.chat.length > 0 && room.chat.every((m) => m.text.length <= MAX_SAY_CHARS));
  }
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
  }
});

test('an impossible action is reported back instead of executed', async () => {
  const { room, prompts } = setup('in', ['{"say":null,"action":{"type":"step_on","object":"crystal"}}']);
  const before = { ...room.state.players.out.pose };
  await until(() => prompts.length >= 2, 'the follow-up think');
  assert.match(JSON.parse(prompts[1]!).lastActionResult, /cannot be reached/);
  assert.deepEqual(room.state.players.out.pose, before);
});

test('the AI leaves with the human', () => {
  const { room, logs } = setup('out', []);
  room.leave('out');
  assert.ok(logs.some((l) => l.includes('stopped')));
});

test('ElevenLabs speech is cached per line and fails soft', async () => {
  let calls = 0;
  const ok = (async (url: string, init: RequestInit) => {
    calls++;
    assert.match(url, /text-to-speech/);
    assert.equal((init.headers as Record<string, string>)['xi-api-key'], 'k');
    return new Response(new Uint8Array([1, 2, 3]));
  }) as unknown as typeof fetch;
  const tts = elevenLabsTts('k', 'voice', ok);
  const a = await tts.speak('Give me a sec...');
  const b = await tts.speak('Give me a sec...');
  assert.deepEqual([...a!], [1, 2, 3]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  const bad = elevenLabsTts('k', 'voice', (async () => new Response('no', { status: 401 })) as unknown as typeof fetch);
  assert.equal(await bad.speak('hi'), null);
});
