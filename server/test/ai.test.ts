import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { faceDistance, parseAction, planAction, type Side } from '@cubic/shared';
import { AiPlayer, FALLBACK_LINE, parseReply } from '../src/ai/aiPlayer';
import type { Brain } from '../src/ai/gemini';
import { MAX_SAY_CHARS, idleHint, parsePersona, systemPrompt } from '../src/ai/prompt';
import { scriptedBrain } from '../src/ai/scripted';
import { LIMITS, Rooms, type Room } from '../src/rooms';

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


/** Walk a player like a human would: one validated move at a time. */
function walk(room: Room, side: Side, raw: unknown) {
  const plan = planAction(room.state, side, parseAction(raw)!);
  assert.ok('steps' in plan, 'error' in plan ? plan.error : '');
  for (const step of plan.steps) {
    if (step === 'interact') room.interact(side);
    else room.move(side, step[0], step[1]);
  }
}
const apart = (room: Room) => faceDistance(room.state.players.out.pose.face, room.state.players.in.pose.face);
const say = (text: string | null, action: object | null = null) => JSON.stringify({ say: text, action });

test('scripted partner (AI_FAKE): after face 1 is solved it stays within one face of the human, and suggests the next goal after 20s', async (t) => {
  // Fake clock, real timings: 6 s throttle, 200 ms steps, 20 s idle hint.
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const pass = async (ms: number) => {
    for (let at = 0; at < ms; at += 100) {
      t.mock.timers.tick(100);
      await new Promise((r) => setImmediate(r));
    }
  };
  const room = rooms.create('ai');
  room.sit('out');
  const ai = new AiPlayer(room, 'in', scriptedBrain('default'), { log: () => {} });
  let farthest = 0;
  room.listen({ onState: () => (farthest = Math.max(farthest, apart(room))) });

  await pass(10_000);
  assert.ok((room.state.puzzles['plate-door'] as { pressed: boolean }).pressed, 'the AI is on the plate');
  walk(room, 'out', { type: 'step_on', object: 'crystal' });
  assert.deepEqual(room.state.solved, [1]);

  const solvedAt = Date.now(); // the human's last move
  const calls = ai.calls;
  const lines = room.chat.length;
  await pass(30_000); // the human does nothing at all
  assert.equal(farthest, 0, 'the AI left the wall the human is on');
  assert.equal(room.state.players.in.pose.face, 1);
  assert.ok(ai.calls - calls <= 5, `calls ${ai.calls - calls}`); // still one think per 6 s at most
  const hint = idleHint({ kind: 'stay' });
  const spoken = room.chat.slice(lines).filter((m) => m.isAI);
  assert.deepEqual(spoken.filter((m) => m.text === hint).length, 1, spoken.map((m) => m.text).join(' | '));
  const waited = spoken.find((m) => m.text === hint)!.at - solvedAt;
  assert.ok(waited >= 20_000 && waited <= 26_100, `hint after ${waited} ms`); // 20 s of idling, then the next free think
  assert.ok(hint.length <= MAX_SAY_CHARS);

  // The human walks one face over: the AI may stay, it is still in earshot.
  walk(room, 'out', { type: 'go_face', face: 2 });
  await pass(30_000);
  assert.equal(farthest, 1);
  // The human walks out of earshot: the AI follows until it hears them again, and no further.
  walk(room, 'out', { type: 'go_face', face: 3 });
  assert.equal(apart(room), 2);
  await pass(15_000);
  assert.equal(apart(room), 1);
  await pass(30_000);
  assert.equal(apart(room), 1);
  ai.stop();
});

test('the leash is enforced by the body: a brain that asks for a far face is refused', async () => {
  const far = say(null, { type: 'go_face', face: 3 });
  const { room, prompts } = setup('out', [far, say(null, { type: 'go_face', face: 2 }), far, say(null, { type: 'move', dir: 'left', steps: 20 })]);
  let farthest = 0;
  room.listen({ onState: () => (farthest = Math.max(farthest, apart(room))) });
  await until(() => prompts.length >= 2, 'the think after the refusal');
  assert.match(JSON.parse(prompts[1]!).lastActionResult, /could not do it, that is more than one face away from your partner/);
  // One face over is fine. From there the far face is a single edge away, and still refused.
  await until(() => room.state.players.in.pose.face === 2, 'the walk to face 2');
  await until(() => prompts.length >= 5, 'the thinks after both refusals');
  assert.match(JSON.parse(prompts[3]!).lastActionResult, /go_face.*more than one face away/);
  assert.match(JSON.parse(prompts[4]!).lastActionResult, /move.*more than one face away/);
  assert.equal(room.state.players.in.pose.face, 2);
  assert.equal(farthest, 1);
});

test('the leash: if the human slipped away unheard, the AI turns back at the first silent face', async () => {
  const { room, prompts } = setup('out', [say(null, { type: 'go_face', face: 2 }), say(null), say(null, { type: 'go_face', face: 6 })], { minThinkMs: 150 });
  await until(() => room.state.players.in.pose.face === 2 && prompts.length >= 2, 'the walk to face 2');
  // Face 1 to face 5: both are next to face 2, so the voice stays faint and the AI cannot tell.
  walk(room, 'out', { type: 'go_face', face: 5 });
  const faces: number[] = [];
  room.listen({ onState: () => faces.push(room.state.players.in.pose.face) });
  room.say('out', 'anything on face 6?'); // wakes the brain, which now asks for face 6
  await until(() => faces.includes(6), 'the AI to try face 6');
  await until(() => room.state.players.in.pose.face === 2, 'the AI to come back');
  assert.equal(faces.filter((f) => f === 6).length, 1); // one step onto the silent face, then straight back
  await until(() => prompts.length >= 4, 'the think after turning back');
  assert.match(prompts.slice(3).map((p) => JSON.parse(p).lastActionResult).join(' '), /out of earshot/);
  assert.equal(apart(room), 1);
});

test('carrying an item lifts the leash: the puzzle needs the two apart', async () => {
  const { room } = setup('in', [say(null, { type: 'step_on', object: 'rose' }), say(null, { type: 'pick_up' }), say(null, { type: 'go_face', face: 3 })]);
  await until(() => room.state.players.out.pose.face === 3, 'the AI to carry the rose to the far face');
  assert.equal(room.state.players.out.carrying, 'rose');
  assert.equal(apart(room), 2);
});

test('after the human idles, the AI suggests the next goal in one line, once', async () => {
  // A brain that never speaks: the body still says the hint.
  const { room, prompts } = setup('out', [], { idleHintMs: 120, minThinkMs: 30 });
  await sleep(60);
  assert.equal(room.chat.length, 0);
  room.say('out', 'hm'); // the human is not idle yet: the clock starts again
  await sleep(90);
  assert.equal(room.chat.filter((m) => m.isAI).length, 0);
  const hint = idleHint({ kind: 'puzzle', face: 1, here: true, inReach: true });
  await until(() => room.chat.some((m) => m.isAI && m.text === hint), 'the idle hint');
  const turn = JSON.parse(prompts.at(-1)!);
  assert.equal(turn.partnerIdle, true);
  assert.deepEqual([turn.goal.kind, turn.goal.face], ['puzzle', 1]);
  assert.equal(JSON.parse(prompts[0]!).partnerIdle, false);
  await sleep(300);
  assert.equal(room.chat.filter((m) => m.isAI).length, 1); // not repeated while the human stays idle
  room.move('out', 1, 0); // a move counts as activity too
  await until(() => room.chat.filter((m) => m.isAI).length === 2, 'a second hint after a second idle spell');

  // A brain that does answer the idle turn is not talked over.
  const b = setup('out', [say('hello'), say('Shall we try the plate?')], { idleHintMs: 80, minThinkMs: 30 });
  await until(() => b.room.chat.length === 2, 'the brain to answer the idle turn');
  await sleep(100);
  assert.deepEqual(b.room.chat.map((m) => m.text), ['hello', 'Shall we try the plate?']);
});

test('a failing Gemini does not delay the idle hint: the body says it, without another call', async () => {
  const down = new Error('503 overloaded');
  const { room, ai } = setup('out', [down, down, down, down], { idleHintMs: 150, backoffMs: 60_000, fallback: scriptedBrain('default') });
  const hint = idleHint({ kind: 'puzzle', face: 1, here: true, inReach: true });
  await until(() => room.chat.some((m) => m.text === hint), 'the idle hint');
  assert.equal(ai.calls, 1); // still backing off
  await sleep(250);
  assert.equal(room.chat.filter((m) => m.text === hint).length, 1);
});

test('the turn tells the brain its goal, and nothing about the other side', async () => {
  const { prompts } = setup('out', []);
  await until(() => prompts.length === 1, 'first think');
  const turn = JSON.parse(prompts[0]!);
  assert.equal(turn.goal.kind, 'puzzle');
  assert.match(turn.goal.advice, /not solved yet/);
  assert.match(systemPrompt(), /Stay within one face of your partner/);
  for (const hidden of ['"door"', '"crystal"', 'partnerFace', '"pose"', '"x"', '"y"']) assert.ok(!prompts[0]!.includes(hidden), hidden);
});

test('a throw inside the AI is contained: it is logged, and an AI that keeps failing is stopped', async () => {
  // its body: every step throws (a timer callback: uncaught, this would end the process)
  const walk = setup('out', ['{"say":null,"action":{"type":"step_on","object":"plate"}}']);
  walk.room.move = () => {
    throw new Error('boom in step');
  };
  await until(() => walk.logs.some((l) => l.includes('boom in step')), 'the step fault to be logged');
  await sleep(30);
  assert.ok(!walk.logs.some((l) => l.includes('stopped')), 'one fault drops the action, it does not stop the AI');

  // its brain, before the call is even made (async: this would be an unhandled rejection),
  // again and again: that AI is stopped
  const think = setup('out', [], { idleMs: 5 });
  think.room.isConnected = () => {
    throw new Error('boom in think');
  };
  await until(() => think.logs.some((l) => l.includes('boom in think')), 'the think fault to be logged');
  await until(() => think.logs.some((l) => l.includes('stopped')), 'the failing AI to be stopped');

  // what it does when the human acts reaches it inside the human's own call: that must not throw
  const hear = setup('out', []);
  await sleep(30);
  (hear.ai as unknown as { look(): never }).look = () => {
    throw new Error('boom in listener');
  };
  assert.doesNotThrow(() => hear.room.move('out', 1, 0));
  assert.ok(hear.logs.some((l) => l.includes('boom in listener')));
});
