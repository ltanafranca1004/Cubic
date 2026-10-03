import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MAX_SAY_CHARS } from '../src/ai/prompt';
import { SCRIPTED_LINES } from '../src/ai/scripted';
import { DEFAULT_TTS_MODEL, createTts, loadBank, normalizeLine, parseBank, parseTtsMode } from '../src/ai/tts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cubic-tts-'));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake ElevenLabs that records what it was asked. */
function fakeApi(status = 200) {
  const calls: { url: string; key: string; body: { text: string; model_id: string } }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, key: (init.headers as Record<string, string>)['xi-api-key']!, body: JSON.parse(init.body as string) });
    return status === 200 ? new Response(new Uint8Array([1, 2, 3])) : new Response('quota exceeded', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

test('request shape: endpoint, voice id, key header, model id', async () => {
  const { calls, fetchFn } = fakeApi();
  const tts = createTts({ apiKey: 'k', voiceId: 'VOICE', modelId: 'eleven_flash_v2_5', cacheDir: tmp(), bank: [], fetchFn, log: () => {} });
  const res = await tts.speak('Hello there.', 'ROOM');
  assert.deepEqual([...res!.audio], [1, 2, 3]);
  assert.equal(res!.source, 'api');
  assert.equal(calls[0]!.url, 'https://api.elevenlabs.io/v1/text-to-speech/VOICE?output_format=mp3_44100_64');
  assert.equal(calls[0]!.key, 'k');
  assert.deepEqual(calls[0]!.body, { text: 'Hello there.', model_id: 'eleven_flash_v2_5' });
  assert.equal(DEFAULT_TTS_MODEL, 'eleven_flash_v2_5');
});

test('disk cache: checked before every call, survives a restart, keyed by voice + model + text', async () => {
  const dir = tmp();
  const { calls, fetchFn } = fakeApi();
  const make = (voiceId: string, modelId: string) => createTts({ apiKey: 'k', voiceId, modelId, cacheDir: dir, bank: [], fetchFn, log: () => {} });
  const a = make('v1', 'm1');
  await a.speak('same line', 'R');
  assert.equal((await a.speak('same line', 'R'))!.source, 'cache');
  assert.equal(calls.length, 1);
  assert.equal((await make('v1', 'm1').speak('same line', 'R'))!.source, 'cache'); // a new server process
  assert.equal(calls.length, 1);
  await make('v2', 'm1').speak('same line', 'R'); // another voice is another clip
  await make('v1', 'm2').speak('same line', 'R'); // another model too
  await a.speak('other line', 'R');
  assert.equal(calls.length, 4);
  assert.equal(readdirSync(dir).length, 4);
  assert.ok(readdirSync(dir).every((f) => /^[0-9a-f]{64}\.mp3$/.test(f)));
});

test('two requests for the same new line share one API call', async () => {
  const { calls, fetchFn } = fakeApi();
  const tts = createTts({ apiKey: 'k', cacheDir: tmp(), bank: [], fetchFn, log: () => {} });
  await Promise.all([tts.speak('twice', 'R'), tts.speak('twice', 'R')]);
  assert.equal(calls.length, 1);
});

test('voice bank: a line that normalizes to a bank line plays the bank clip and skips the API', async () => {
  const dir = tmp();
  const { calls, fetchFn } = fakeApi();
  const bank = ['Got it.', "I can't hear you. Come closer."];
  const tts = createTts({ apiKey: 'k', cacheDir: dir, bank, fetchFn, log: () => {} });
  for (const line of bank) await tts.speak(line, 'bank'); // what `npm run tts:bank` does
  assert.equal(calls.length, 2);
  for (const said of ['got it', 'GOT IT!!', '  Got   it. ', 'I cant hear you, come closer']) {
    const res = await tts.speak(said, 'ROOM');
    assert.equal(res!.source, 'bank', said);
  }
  assert.equal(calls.length, 2); // no further API calls
  assert.equal(tts.bankSize, 2);
  assert.equal(normalizeLine("I can't HEAR you... Come closer!"), 'i cant hear you come closer');
});

test('usage log: characters per session and running total, only for real API calls', async () => {
  const lines: string[] = [];
  const { fetchFn } = fakeApi();
  const tts = createTts({ apiKey: 'k', cacheDir: tmp(), bank: [], fetchFn, log: (l) => lines.push(l) });
  await tts.speak('12345', 'AAAA');
  await tts.speak('1234567890', 'AAAA');
  await tts.speak('12345', 'AAAA'); // cached: not counted
  await tts.speak('abc', 'BBBB');
  assert.equal(tts.totalChars, 18);
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /\[tts AAAA\] 5 chars to ElevenLabs .*session 5, total since start 5/);
  assert.match(lines[1]!, /\[tts AAAA\] 10 chars .*session 15, total since start 15/);
  assert.match(lines[2]!, /\[tts BBBB\] 3 chars .*session 3, total since start 18/);
});

test('fails soft: API error, no key, or cacheOnly give null so the caller uses the browser voice', async () => {
  const bad = fakeApi(429);
  const dir = tmp();
  const failing = createTts({ apiKey: 'k', cacheDir: dir, bank: [], fetchFn: bad.fetchFn, log: () => {} });
  assert.equal(await failing.speak('hi', 'R'), null);
  assert.equal(readdirSync(dir).length, 0); // nothing bad is cached
  const ok = fakeApi();
  const noKey = createTts({ cacheDir: tmp(), bank: [], fetchFn: ok.fetchFn, log: () => {} });
  assert.equal(await noKey.speak('hi', 'R'), null);
  const cacheOnly = createTts({ apiKey: 'k', cacheDir: tmp(), bank: [], fetchFn: ok.fetchFn, log: () => {} });
  assert.equal(await cacheOnly.speak('hi', 'R', { cacheOnly: true }), null);
  assert.equal(ok.calls.length, 0);
});

test('TTS_MODE: browser unless production, explicit value wins', () => {
  assert.equal(parseTtsMode(undefined, undefined), 'browser');
  assert.equal(parseTtsMode(undefined, 'development'), 'browser');
  assert.equal(parseTtsMode(undefined, 'production'), 'elevenlabs');
  assert.equal(parseTtsMode('browser', 'production'), 'browser');
  assert.equal(parseTtsMode('elevenlabs', 'development'), 'elevenlabs');
  assert.equal(parseTtsMode('nonsense', 'development'), 'browser');
});

test('the shipped bank: about 50 short lines, no duplicates, comments ignored', () => {
  const bank = loadBank();
  assert.ok(bank.length >= 50, `${bank.length} lines`);
  assert.ok(bank.every((l) => l.length <= MAX_SAY_CHARS), bank.filter((l) => l.length > MAX_SAY_CHARS).join(' | '));
  assert.equal(new Set(bank.map(normalizeLine)).size, bank.length);
  // Every scripted (AI_FAKE / fallback) line is banked, so the demo fallback costs nothing.
  const banked = new Set(bank.map(normalizeLine));
  for (const lines of Object.values(SCRIPTED_LINES)) for (const l of Object.values(lines)) assert.ok(banked.has(normalizeLine(l)), l);
  assert.deepEqual(parseBank('# note\n\nHi!\nhi\n  Got it.  \n'), ['Hi!', 'Got it.']);
});
