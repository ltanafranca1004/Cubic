import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { defaultEnv, devSolve, type ClientToServer, type Seat, type ServerToClient, type Side } from '@cubic/shared';
import { STUCK_MS } from '../src/ai/aiPlayer';
import { Budget } from '../src/ai/budget';
import type { Brain } from '../src/ai/gemini';
import { createAiPartner, type Send } from '../src/ai/wire';
import { createApp } from '../src/app';
import { LIMITS, Rooms, type Room } from '../src/rooms';

// The AI partner, Gemini and ElevenLabs exist ONLY in solo rooms. Here the server is wired
// the way index.ts wires it (createAiPartner + createApp), with both keys "present" (fake
// values), AI_FAKE off and TTS_MODE=elevenlabs, and both API clients replaced by spies
// that record the call and throw. Nothing reaches the network.

LIMITS.moveBurst = 1e9;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cubic-solo-only-'));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** The server's AI wiring with spies for both APIs. */
function wiring(env: Record<string, string> = {}) {
  const gemini: string[] = [];
  const eleven: string[] = [];
  const logs: string[] = [];
  const brain: Brain = {
    async think(turn) {
      gemini.push(turn);
      throw new Error('Gemini must not be called');
    },
  };
  const ai = createAiPartner(
    { GEMINI_API_KEY: 'fake-gemini-key', ELEVENLABS_API_KEY: 'fake-eleven-key', TTS_MODE: 'elevenlabs', NODE_ENV: 'production', ...env },
    {
      brain: () => brain,
      fetchFn: (async (url: string) => {
        eleven.push(String(url));
        throw new Error('ElevenLabs must not be called');
      }) as unknown as typeof fetch,
      budget: Budget.fromEnv(env, { file: null, log: (l) => logs.push(l) }),
      tts: { cacheDir: tmp() }, // the committed bank, an empty cache
      log: (l) => logs.push(l),
    },
  );
  return { ai, gemini, eleven, logs };
}

const strike = (room: Room) =>
  room.devApply((state) => {
    state.strikes++;
    return [{ type: 'strike', side: 'out' }];
  });

type Sock = Socket<ServerToClient, ClientToServer>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a two-player game makes ZERO Gemini and ZERO ElevenLabs calls: chat, strikes, solves and the win, over the server', async () => {
  const w = wiring();
  assert.ok(w.ai.advisor, 'the advisor exists: a key is present and AI_FAKE is off');
  assert.equal(w.ai.ttsMode, 'elevenlabs');
  let aiRooms = 0;
  const speech: string[] = [];
  const app = createApp({
    allowLocalhost: true,
    info: () => ({ aiAvailable: true, ttsAvailable: true, ttsMode: w.ai.ttsMode }),
    onAiRoom: (room, human) => {
      aiRooms++;
      w.ai.join(room, human, (r, event, msg) => void app.io.to(r.code).emit(event, ...([msg] as never)));
    },
  });
  const url = `http://localhost:${await app.listen(0)}`;
  const socks: Sock[] = [];
  const connect = () => {
    const s: Sock = io(url, { transports: ['websocket'], forceNew: true });
    for (const event of ['tts', 'tts:chain', 'speak', 'typing'] as const) s.on(event, () => void speech.push(event));
    socks.push(s);
    return s;
  };
  try {
    const a = connect();
    const b = connect();
    const seat = await new Promise<Seat>((ok, no) => a.emit('room:create', (r) => (r.ok ? ok(r) : no(new Error(r.error)))));
    await new Promise<Seat>((ok, no) => b.emit('room:join', { code: seat.code }, (r) => (r.ok ? ok(r) : no(new Error(r.error)))));
    const lobby = (send: (ack: (r: { ok: true } | { ok: false; error: string }) => void) => void) => new Promise<void>((ok, no) => send((r) => (r.ok ? ok() : no(new Error(r.error)))));
    await lobby((ack) => a.emit('lobby:pick', { side: 'out' }, ack));
    await lobby((ack) => b.emit('lobby:pick', { side: 'in' }, ack));
    await lobby((ack) => b.emit('lobby:ready', { ready: true }, ack));
    await lobby((ack) => a.emit('lobby:start', ack));
    const room = app.rooms.get(seat.code)!;
    assert.deepEqual([room.mode, room.phase], ['friend', 'playing']);

    // Everything that costs a call in a solo room: free-form chat, protocol words, strikes, solves, the win.
    const lines = ['hello, can you hear me in there?', 'what do you see on your side of the wall', 'wait', 'the code is 4 7 2 I think', 'face 3', 'are you stuck?'];
    for (const [i, text] of lines.entries()) {
      (i % 2 ? b : a).emit('chat', { text });
      a.emit('move', { dx: 1, dy: 0, seq: i + 1 });
      await wait(60);
    }
    a.emit('quick', { index: 0 });
    for (let i = 0; i < 3; i++) strike(room);
    for (const p of defaultEnv.puzzles) {
      room.devApply((state, now) => devSolve(state, p.face, now));
      await wait(40);
    }
    await wait(500); // more than two steps of an AI player, if there were one
    assert.equal(room.chat.length, lines.length + 1);
    assert.equal(room.state.strikes, 3);
    assert.notEqual(room.state.wonAt, null);

    assert.deepEqual(w.gemini, [], 'Gemini was called in a two-player game');
    assert.deepEqual(w.eleven, [], 'ElevenLabs was called in a two-player game');
    assert.equal(aiRooms, 0); // no AI player was ever made
    assert.ok(room.chat.every((m) => !m.isAI));
    assert.deepEqual(room.info().seats.in.isAI, false);
    assert.deepEqual(speech, []); // no AI speech, no "typing"
    assert.deepEqual(w.ai.budget.summary(), { ...w.ai.budget.summary(), geminiCalls: 0, tokensIn: 0, tokensOut: 0, elevenCalls: 0, elevenChars: 0 });
    assert.deepEqual(w.logs.filter((l) => /^\[(gemini|eleven)\]/.test(l)), []); // not even a refused call
  } finally {
    for (const s of socks) s.disconnect();
    await app.close();
  }
});

// ---------- solo rooms, on a fake clock ----------

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_700_000_000_000 });
  return async (ms: number, slice = 200) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}

/** A solo game with everything that could cost a call: free-form chat, a strike, a quiet minute, a solve. */
async function soloGame(w: ReturnType<typeof wiring>, pass: (ms: number, slice?: number) => Promise<void>, human: Side = 'out') {
  const rooms = new Rooms();
  const room = rooms.create('ai');
  room.sit(human);
  const sent: { event: string; text?: string }[] = [];
  const send: Send = (_room, event, msg) => void sent.push({ event, ...('text' in msg ? { text: msg.text } : {}) });
  const player = w.ai.join(room, human, send);
  await pass(3000);
  room.say(human, 'hello in there, what does your side look like?');
  await pass(7000);
  strike(room);
  await pass(7000);
  await pass(STUCK_MS + 2000, 1000);
  room.devApply((state, now) => devSolve(state, defaultEnv.puzzles[0]!.face, now));
  await pass(7000);
  room.say(human, 'that was great, what is next for us?');
  await pass(7000);
  rooms.closeAll();
  return { room, player, sent };
}

test('a solo room with GEMINI_ENABLED=false and ELEVENLABS_ENABLED=false makes zero calls and still talks', async (t) => {
  const pass = clock(t);
  const w = wiring({ GEMINI_ENABLED: 'false', ELEVENLABS_ENABLED: 'false' });
  const { room, player, sent } = await soloGame(w, pass);
  assert.deepEqual(w.gemini, []);
  assert.deepEqual(w.eleven, []);
  assert.equal(player.calls, 0);
  assert.deepEqual(w.ai.budget.summary(), { ...w.ai.budget.summary(), geminiCalls: 0, tokensIn: 0, tokensOut: 0, elevenCalls: 0, elevenChars: 0 });
  // The scripted partner carried on: every line it said was spoken from the bank or by the browser.
  const said = room.chat.filter((m) => m.isAI);
  assert.ok(said.length >= 4, said.map((m) => m.text).join(' | '));
  assert.equal(sent.length, said.length);
  assert.ok(sent.every((x) => x.event === 'tts' || x.event === 'tts:chain' || x.event === 'speak'));
  // Banked clips still play with the switch off, once the bank holds this voice's clips (until it is bought: the browser voice).
  assert.equal(sent.some((x) => x.event === 'tts'), w.ai.tts.bankSize > 0);
  // The switch is the logged reason, and it does not flood.
  assert.ok(w.logs.some((l) => l.startsWith('[gemini] fallback') && l.endsWith('why=disabled')));
  assert.ok(w.logs.filter((l) => l.includes('fallback')).length <= 4);
});

test('control: the same solo room with both switches on DOES reach both spies, so the spies are wired', async (t) => {
  const pass = clock(t);
  const gemini: string[] = [];
  const eleven: string[] = [];
  const ai = createAiPartner(
    { GEMINI_API_KEY: 'fake-gemini-key', ELEVENLABS_API_KEY: 'fake-eleven-key', TTS_MODE: 'elevenlabs' },
    {
      brain: () => ({
        async think(turn) {
          gemini.push(turn);
          return { text: JSON.stringify({ say: `A line of my own, number ${gemini.length}.`, heard: null }), tokens: { input: 300, output: 20 } };
        },
      }),
      fetchFn: (async (_url: string, init: RequestInit) => {
        eleven.push((JSON.parse(init.body as string) as { text: string }).text);
        return new Response(new Uint8Array([1, 2, 3]));
      }) as unknown as typeof fetch,
      budget: new Budget({ file: null, log: () => {} }),
      tts: { cacheDir: tmp() },
      log: () => {},
    },
  );
  const { sent } = await soloGame({ ai, gemini, eleven, logs: [] }, pass);
  // (no 'strike': the keypad script of face 1 speaks on the strike, so the generic line is not asked for)
  assert.deepEqual(gemini.map((g) => (JSON.parse(g) as { event: string }).event), ['chat', 'stuck', 'solved', 'chat']);
  // ElevenLabs only ever gets Gemini's own lines, never a line of the script.
  assert.deepEqual(eleven, [1, 2, 3, 4].map((n) => `A line of my own, number ${n}.`));
  assert.equal(sent.filter((x) => x.event === 'tts').length >= 4, true);
  assert.deepEqual([ai.budget.summary().geminiCalls, ai.budget.summary().elevenCalls], [4, 4]);
});
