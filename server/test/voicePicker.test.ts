import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { AI_VOICES, DEFAULT_AI_VOICE, aiVoice, parseAiVoice, type AiVoice, type ClientToServer, type Seat, type ServerToClient, type VoicePreview } from '@cubic/shared';
import { creditsPerChar, estimateCredits, runBank } from '../src/ai/bank';
import { Budget } from '../src/ai/budget';
import { lineText } from '../src/ai/scripted';
import { DEFAULT_BANK_MODEL, DEFAULT_VOICE_ID, TTS_BANK_DIR, bankDirFor, bankLines, clipFileName, createTts } from '../src/ai/tts';
import { createAiPartner, type Send } from '../src/ai/wire';
import { createApp } from '../src/app';
import { Rooms, type Room } from '../src/rooms';

// The AI partner's voice picker: the list of voices, the check of what a client sends, one
// bank folder per voice that is only read when it is asked for, and the soft fall when a
// voice's clip is not there. No test needs a real Wizard clip: every bank here is a temp
// folder, and nothing reaches ElevenLabs (the fetch is a spy).

const WIZARD = 'JoYo65swyP8hH6fVMeTO';
const JESSICA = 'r1KmysJdVYZjJCm4mL3b';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cubic-voice-'));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake ElevenLabs that records the voice id of every call. */
function fakeApi() {
  const voices: string[] = [];
  const fetchFn = (async (url: string) => {
    voices.push(String(url).split('/').at(-1)!.split('?')[0]!);
    return new Response(new Uint8Array([9, 9, 9]));
  }) as unknown as typeof fetch;
  return { voices, fetchFn };
}
/** Put a clip of `text` in a voice's bank folder under `base`, the way the bank script names it. */
function bankClip(base: string, voice: AiVoice, text: string, bytes: number[]): void {
  const dir = bankDirFor(voice, base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, clipFileName(aiVoice(voice).id, DEFAULT_BANK_MODEL, text)), new Uint8Array(bytes));
}

test('the voices: Jessica (the default, the id of the committed bank) and Wizard', () => {
  assert.deepEqual(AI_VOICES.map((v) => [v.key, v.label, v.id]), [['jessica', 'Jessica', JESSICA], ['wizard', 'Wizard', WIZARD]]);
  assert.equal(DEFAULT_AI_VOICE, 'jessica');
  assert.equal(DEFAULT_VOICE_ID, JESSICA);
  // one folder per voice: the default keeps the folder it always had
  assert.equal(bankDirFor('jessica'), TTS_BANK_DIR);
  assert.equal(bankDirFor('wizard'), `${TTS_BANK_DIR}-wizard`);
  assert.ok(existsSync(TTS_BANK_DIR), 'the committed bank of the default voice is still where it was');
});

test('validation: only a key of the known list is a voice, never an id or anything else', () => {
  assert.equal(parseAiVoice('jessica'), 'jessica');
  assert.equal(parseAiVoice('wizard'), 'wizard');
  for (const bad of [WIZARD, JESSICA, 'Wizard', 'WIZARD', ' wizard', 'someOtherVoiceId123', '', '../bank', 'constructor', '__proto__', null, undefined, 1, true, {}, ['wizard'], { key: 'wizard' }]) assert.equal(parseAiVoice(bad), null, JSON.stringify(bad));
});

test('one bank per voice, looked up by voice, and a bank is not read until it is asked for', async () => {
  const base = tmp();
  bankClip(base, 'jessica', 'four', [1]);
  bankClip(base, 'wizard', 'four', [2]);
  bankClip(base, 'wizard', 'It worked!', [3]);
  const api = fakeApi();
  const tts = createTts({ apiKey: 'k', cacheDir: tmp(), bankDir: base, fetchFn: api.fetchFn, log: () => {} });
  assert.deepEqual([tts.loaded('jessica'), tts.loaded('wizard')], [0, 0]);
  // no voice = the default voice
  assert.deepEqual([...tts.banked('four')!], [1]);
  assert.deepEqual([...(await tts.speak('four', 'ROOM'))!.audio], [1]);
  assert.deepEqual([tts.loaded('jessica'), tts.loaded('wizard')], [1, 0], 'a game in the default voice never reads the other bank');
  // the other voice: its own folder, its own clips
  assert.deepEqual([...tts.banked('four', 'wizard')!], [2]);
  const line = await tts.speak('It worked!', 'ROOM', { voice: 'wizard', cacheOnly: true });
  assert.deepEqual([[...line!.audio], line!.source], [[3], 'bank']);
  assert.deepEqual([tts.loaded('jessica'), tts.loaded('wizard')], [1, 2]);
  // a clip is one voice's only: Jessica has no "It worked!" here
  assert.equal(tts.banked('It worked!', 'jessica'), null);
  assert.deepEqual(api.voices, [], 'banked clips cost nothing');
});

test('fail soft: a voice with no bank folder gives null (then cache, live, browser), never a throw', async () => {
  const base = tmp();
  bankClip(base, 'jessica', 'four', [1]);
  const api = fakeApi();
  const budget = new Budget({ file: null, log: () => {} });
  const tts = createTts({ apiKey: 'k', cacheDir: tmp(), bankDir: base, budget, fetchFn: api.fetchFn, log: () => {} });
  assert.equal(existsSync(bankDirFor('wizard', base)), false);
  assert.equal(tts.banked('four', 'wizard'), null);
  // a scripted line (cacheOnly): nothing is bought, the caller hands it to the browser voice
  assert.equal(await tts.speak('four', 'ROOM', { voice: 'wizard', cacheOnly: true }), null);
  assert.deepEqual(api.voices, []);
  assert.equal(tts.loaded('wizard'), 0);
  // a live line: bought with the CHOSEN voice's id, through the same budget, then cached per voice
  const live = await tts.speak('A line by Gemini.', 'ROOM', { voice: 'wizard' });
  assert.deepEqual([[...live!.audio], live!.source], [[9, 9, 9], 'api']);
  assert.deepEqual(api.voices, [WIZARD]);
  assert.equal(budget.summary().elevenCalls, 1);
  assert.equal((await tts.speak('A line by Gemini.', 'ROOM', { voice: 'wizard' }))!.source, 'cache');
  assert.equal((await tts.speak('A line by Gemini.', 'ROOM'))!.source, 'api', 'the other voice has its own cache entry');
  assert.deepEqual(api.voices, [WIZARD, JESSICA]);
});

test('ELEVENLABS_VOICE_ID replaces the id behind the default voice only', async () => {
  const api = fakeApi();
  const tts = createTts({ apiKey: 'k', voiceId: 'OTHER', cacheDir: tmp(), bankDir: tmp(), fetchFn: api.fetchFn, log: () => {} });
  await tts.speak('One.', 'ROOM');
  await tts.speak('Two.', 'ROOM', { voice: 'jessica' });
  await tts.speak('Three.', 'ROOM', { voice: 'wizard' });
  assert.deepEqual(api.voices, ['OTHER', 'OTHER', WIZARD]);
});

// ---------- the room's voice, on a fake clock ----------

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_700_000_000_000 });
  return async (ms: number, slice = 200) => {
    for (let at = 0; at < ms; at += slice) {
      t.mock.timers.tick(Math.min(slice, ms - at));
      await new Promise((r) => setImmediate(r));
    }
  };
}

function partner(base: string) {
  const eleven: string[] = [];
  const ai = createAiPartner(
    { AI_FAKE: '1', ELEVENLABS_API_KEY: 'fake-eleven-key', TTS_MODE: 'elevenlabs' },
    {
      fetchFn: (async (url: string) => {
        eleven.push(String(url));
        throw new Error('ElevenLabs must not be called');
      }) as unknown as typeof fetch,
      budget: new Budget({ file: null, log: () => {} }),
      tts: { cacheDir: tmp(), bankDir: base },
      log: () => {},
    },
  );
  return { ai, eleven };
}

test('a solo room speaks in the voice its player picked, from the next line, and falls to the browser voice without a clip', async (t) => {
  const pass = clock(t);
  const base = tmp();
  const hello = lineText('default', 'hello.in'); // the human is outside: the AI greets from inside
  bankClip(base, 'jessica', hello, [1]);
  bankClip(base, 'wizard', hello, [2]);
  const { ai, eleven } = partner(base);
  const greet = async (voice: AiVoice | null) => {
    const rooms = new Rooms();
    const room = rooms.create('ai');
    room.sit('out');
    const sent: { event: string; data?: number[] }[] = [];
    const send: Send = (_room, event, msg) => void sent.push({ event, ...('data' in msg ? { data: [...new Uint8Array(msg.data)] } : {}) });
    if (voice) ai.setVoice(room, voice);
    ai.join(room, 'out', send);
    await pass(3000);
    rooms.closeAll();
    return sent[0];
  };
  assert.deepEqual(await greet(null), { event: 'tts', data: [1] }, 'a room that never chose is on the default voice');
  assert.equal(ai.tts.loaded('wizard'), 0);
  assert.deepEqual(await greet('wizard'), { event: 'tts', data: [2] });
  assert.deepEqual(await greet('jessica'), { event: 'tts', data: [1] });

  // No Wizard bank at all (it is not bought yet): the same line is read by the browser voice.
  const bare = tmp();
  bankClip(bare, 'jessica', hello, [1]);
  const b = partner(bare);
  const rooms = new Rooms();
  const room = rooms.create('ai');
  room.sit('out');
  const sent: string[] = [];
  b.ai.setVoice(room, 'wizard');
  assert.equal(b.ai.voiceOf(room), 'wizard');
  b.ai.join(room, 'out', (_room, event) => void sent.push(event));
  await pass(3000);
  // changed in the middle of the game: it counts from the next line
  b.ai.setVoice(room, 'jessica');
  assert.equal(b.ai.voiceOf(room), 'jessica');
  rooms.closeAll();
  assert.equal(sent[0], 'speak');
  assert.deepEqual([...eleven, ...b.eleven], [], 'a scripted line is never bought, in any voice');

  // The preview: the greeting of the chosen voice, or no clip (the client's browser voice reads the text).
  assert.equal(ai.preview('wizard').data, null);
  bankClip(base, 'wizard', lineText('default', 'hello.out'), [7]);
  const preview = ai.preview('wizard');
  assert.deepEqual([preview.voice, preview.text, preview.mime, [...new Uint8Array(preview.data!)]], ['wizard', lineText('default', 'hello.out'), 'audio/mpeg', [7]]);
  assert.equal(b.ai.preview('wizard').data, null);
});

// ---------- over the socket ----------

type Sock = Socket<ServerToClient, ClientToServer>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the server takes a voice only from the known list, and only a solo room hears of it', async () => {
  const picked: { mode: string; voice: string }[] = [];
  const previews: string[] = [];
  const app = createApp({
    allowLocalhost: true,
    info: () => ({ aiAvailable: true, ttsAvailable: true, ttsMode: 'browser' }),
    onAiRoom: () => {},
    onAiVoice: (room: Room, voice) => void picked.push({ mode: room.mode, voice }),
    voicePreview: (voice): VoicePreview => {
      previews.push(voice);
      return { voice, text: 'Hi!', mime: 'audio/mpeg', data: null };
    },
  });
  const port = await app.listen(0);
  const socks: Sock[] = [];
  const connect = async () => {
    const s: Sock = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    socks.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));
    return s;
  };
  const seat = (send: (ack: (res: ({ ok: true } & Seat) | { ok: false; error: string }) => void) => void) => new Promise<Seat>((resolve, reject) => send((res) => (res.ok ? resolve(res) : reject(new Error(res.error)))));
  const raw = (s: Sock) => s as unknown as { emit(event: string, ...args: unknown[]): void };
  try {
    // a two-player room: the choice is kept for the connection and nothing is told to anyone
    const a = await connect();
    a.emit('ai:voice', { voice: 'wizard' });
    await seat((ack) => a.emit('room:create', ack));
    a.emit('ai:voice', { voice: 'jessica' });
    await wait(50);
    assert.deepEqual(picked, []);

    // a solo room: the voice chosen BEFORE the room exists is there from its first line
    const b = await connect();
    b.emit('ai:voice', { voice: 'wizard' });
    await seat((ack) => b.emit('room:createAI', { side: 'out' }, ack));
    assert.deepEqual(picked, [{ mode: 'ai', voice: 'wizard' }]);
    // changed in the middle of the game
    b.emit('ai:voice', { voice: 'jessica' });
    await wait(50);
    assert.deepEqual(picked.at(-1), { mode: 'ai', voice: 'jessica' });
    // anything that is not a key of the list is ignored: an id, another id, junk
    const before = picked.length;
    for (const bad of [WIZARD, 'someOtherVoiceId123', '', null, 7, { key: 'wizard' }]) raw(b).emit('ai:voice', { voice: bad });
    raw(b).emit('ai:voice');
    raw(b).emit('ai:voice', 'wizard');
    await wait(50);
    assert.equal(picked.length, before);

    // a player who never chose: the default voice
    const c = await connect();
    await seat((ack) => c.emit('room:createAI', { side: 'in' }, ack));
    assert.deepEqual(picked.at(-1), { mode: 'ai', voice: 'jessica' });

    // the preview: a known voice only
    const ask = (voice: unknown) => new Promise<({ ok: true } & VoicePreview) | { ok: false; error: string }>((r) => c.emit('ai:preview', { voice: voice as AiVoice }, r));
    assert.deepEqual(await ask('wizard'), { ok: true, voice: 'wizard', text: 'Hi!', mime: 'audio/mpeg', data: null });
    assert.deepEqual(await ask(WIZARD), { ok: false, error: 'Unknown voice.' });
    assert.deepEqual(previews, ['wizard']);
  } finally {
    for (const s of socks) s.disconnect();
    await app.close();
  }
});

// ---------- the bank script ----------

test('the bank dry run for a voice: clips, characters and estimated credits, no call, nothing written', async () => {
  assert.deepEqual([creditsPerChar('eleven_v4'), creditsPerChar('eleven_multilingual_v2'), creditsPerChar('eleven_flash_v2_5'), creditsPerChar('eleven_turbo_v2_5')], [1, 1, 0.5, 0.5]);
  assert.deepEqual([estimateCredits(3697, 'eleven_v4'), estimateCredits(11, 'eleven_flash_v2_5')], [3697, 6]);
  const bankDir = bankDirFor('wizard', tmp());
  const noNetwork = (() => {
    throw new Error('a dry run must not call the network');
  }) as unknown as typeof fetch;
  const tts = createTts({ voiceId: WIZARD, cacheDir: tmp(), bankDir, fetchFn: noNetwork, log: () => {} });
  const lines = bankLines();
  const chars = lines.reduce((n, l) => n + l.length, 0);
  const out: string[] = [];
  assert.equal(await runBank({ argv: ['--voice', 'wizard'], lines, tts, hasKey: false, bankDir, voiceId: WIZARD, modelId: DEFAULT_BANK_MODEL, voiceArg: '--voice wizard', out: (l) => out.push(l) }), 0);
  assert.ok(out[0]!.includes(`${lines.length} clips wanted, voice ${WIZARD}, model ${DEFAULT_BANK_MODEL}: 0 banked`));
  assert.ok(out.includes(`whole bank: ${lines.length} clips, ${chars} characters. Folder: ${bankDir}`));
  assert.ok(out.some((l) => l.startsWith(`ESTIMATED cost with ${DEFAULT_BANK_MODEL}: ${chars} credits to buy what is missing (${chars} for the whole bank), at 1 credit per character.`)));
  assert.ok(out.at(-1)!.endsWith('npm run tts:bank -w server -- --voice wizard --buy'));
  assert.equal(existsSync(bankDir), false, 'a dry run writes nothing');
  // the same lines and pieces as the default voice's bank, named by the Wizard's id
  assert.equal(tts.fileName('four'), clipFileName(WIZARD, DEFAULT_BANK_MODEL, 'four'));
});
