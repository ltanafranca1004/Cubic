import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MAX_SAY_CHARS } from '../src/ai/prompt';
import { bankedScriptLines } from '../src/ai/scripted';
import { DEFAULT_SESSION_LINES, DEFAULT_TTS_MODEL, TTS_BANK_DIR, bankFileName, bankLines, createTts, loadBank, normalizeLine, parseBank, parseSessionLines, parseTtsMode } from '../src/ai/tts';

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
/** A TTS with its own empty cache and bank, so the committed bank does not answer. */
const make = (api: ReturnType<typeof fakeApi>, extra: Parameters<typeof createTts>[0] = {}) => createTts({ apiKey: 'k', cacheDir: tmp(), bankDir: tmp(), fetchFn: api.fetchFn, log: () => {}, ...extra });

test('request shape: endpoint, voice id, key header, model id', async () => {
  const api = fakeApi();
  const tts = make(api, { voiceId: 'VOICE', modelId: 'eleven_flash_v2_5' });
  const res = await tts.speak('Hello there.', 'ROOM');
  assert.deepEqual([...res!.audio], [1, 2, 3]);
  assert.equal(res!.source, 'api');
  assert.equal(api.calls[0]!.url, 'https://api.elevenlabs.io/v1/text-to-speech/VOICE?output_format=mp3_44100_64');
  assert.equal(api.calls[0]!.key, 'k');
  assert.deepEqual(api.calls[0]!.body, { text: 'Hello there.', model_id: 'eleven_flash_v2_5' });
  assert.equal(DEFAULT_TTS_MODEL, 'eleven_flash_v2_5');
});

test('disk cache: checked before every call, survives a restart, keyed by voice + model + text', async () => {
  const dir = tmp();
  const bankDir = tmp();
  const api = fakeApi();
  const at = (voiceId: string, modelId: string) => createTts({ apiKey: 'k', voiceId, modelId, cacheDir: dir, bankDir, fetchFn: api.fetchFn, log: () => {} });
  const a = at('v1', 'm1');
  await a.speak('same line', 'R');
  assert.equal((await a.speak('same line', 'R'))!.source, 'cache');
  assert.equal(api.calls.length, 1);
  assert.equal((await at('v1', 'm1').speak('same line', 'R'))!.source, 'cache'); // a new server process
  assert.equal(api.calls.length, 1);
  await at('v2', 'm1').speak('same line', 'R'); // another voice is another clip
  await at('v1', 'm2').speak('same line', 'R'); // another model too
  await a.speak('other line', 'R');
  assert.equal(api.calls.length, 4);
  assert.equal(readdirSync(dir).length, 4);
  assert.ok(readdirSync(dir).every((f) => /^[0-9a-f]{64}\.mp3$/.test(f)));
});

test('two requests for the same new line share one API call', async () => {
  const api = fakeApi();
  const tts = make(api);
  await Promise.all([tts.speak('twice', 'R'), tts.speak('twice', 'R')]);
  assert.equal(api.calls.length, 1);
});

test('voice bank: banking writes into the bank directory, and any spelling of a banked line plays it for free', async () => {
  const bankDir = tmp();
  const api = fakeApi();
  const tts = make(api, { bankDir });
  assert.equal(await tts.bank('Got it.'), 'new');
  assert.equal(await tts.bank("I can't hear you. Come closer."), 'new');
  assert.equal(await tts.bank('Got it.'), 'banked'); // running the script again buys nothing
  assert.equal(api.calls.length, 2);
  assert.deepEqual(readdirSync(bankDir).sort(), [bankFileName('Got it.'), bankFileName("I can't hear you. Come closer.")].sort());
  // A server with NO key and an empty cache (a fresh deploy) still plays them.
  const fresh = createTts({ cacheDir: tmp(), bankDir, fetchFn: api.fetchFn, log: () => {} });
  for (const said of ['got it', 'GOT IT!!', '  Got   it. ', 'I cant hear you, come closer']) {
    assert.equal((await fresh.speak(said, 'ROOM'))!.source, 'bank', said);
    assert.equal((await fresh.speak(said, 'ROOM', { cacheOnly: true }))!.source, 'bank', said);
  }
  assert.equal(api.calls.length, 2);
  assert.equal(fresh.bankSize, 2);
  assert.equal(normalizeLine("I can't HEAR you... Come closer!"), 'i cant hear you come closer');
  // The bank does not depend on the voice settings of the day.
  assert.equal((await createTts({ voiceId: 'another', modelId: 'other', cacheDir: tmp(), bankDir, log: () => {} }).speak('Got it.', 'R'))!.source, 'bank');
});

test('banking copies a clip that is already in the local cache instead of buying it again', async () => {
  const cacheDir = tmp();
  const bankDir = tmp();
  const api = fakeApi();
  const tts = createTts({ apiKey: 'k', cacheDir, bankDir, fetchFn: api.fetchFn, log: () => {} });
  await tts.speak('Nice one!', 'R');
  assert.equal(await tts.bank('Nice one!'), 'copied');
  assert.equal(api.calls.length, 1);
  assert.equal(await createTts({ cacheDir: tmp(), bankDir: tmp(), log: () => {} }).bank('No key, no cache.'), null);
});

test('session cap: 15 generated lines per room, then null so the browser voice takes over', async () => {
  const api = fakeApi();
  const lines: string[] = [];
  const tts = make(api, { log: (l) => lines.push(l) });
  for (let i = 0; i < DEFAULT_SESSION_LINES; i++) assert.equal((await tts.speak(`dynamic line ${i}`, 'AAAA'))!.source, 'api');
  assert.equal(await tts.speak('one line too many', 'AAAA'), null);
  assert.equal(await tts.speak('and another', 'AAAA'), null);
  assert.equal(api.calls.length, 15);
  assert.equal(lines.filter((l) => l.includes('browser voice takes over')).length, 1);
  // Lines already paid for stay free after the cap, and another room has its own allowance.
  assert.equal((await tts.speak('dynamic line 3', 'AAAA'))!.source, 'cache');
  assert.equal((await tts.speak('fresh room', 'BBBB'))!.source, 'api');
  assert.equal(api.calls.length, 16);
  assert.equal(DEFAULT_SESSION_LINES, 15);
});

test('session cap: set by TTS_SESSION_LINES; bank lines never count against it', async () => {
  assert.equal(parseSessionLines(undefined), 15);
  assert.equal(parseSessionLines(''), 15);
  assert.equal(parseSessionLines('4'), 4);
  assert.equal(parseSessionLines('0'), 0);
  assert.equal(parseSessionLines('-1'), 15);
  assert.equal(parseSessionLines('lots'), 15);
  const api = fakeApi();
  const tts = make(api, { sessionLines: 2 });
  await tts.bank('It worked!');
  for (let i = 0; i < 10; i++) assert.equal((await tts.speak('It worked!', 'R'))!.source, 'bank');
  assert.equal((await tts.speak('first', 'R'))!.source, 'api');
  assert.equal((await tts.speak('second', 'R'))!.source, 'api');
  assert.equal(await tts.speak('third', 'R'), null);
  assert.equal(await make(api, { sessionLines: 0 }).speak('never', 'R'), null);
});

test('usage log: characters per session and running total, only for real API calls', async () => {
  const lines: string[] = [];
  const tts = make(fakeApi(), { log: (l) => lines.push(l) });
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
  const failing = make(bad, { cacheDir: dir });
  assert.equal(await failing.speak('hi', 'R'), null);
  assert.equal(readdirSync(dir).length, 0); // nothing bad is cached
  const ok = fakeApi();
  assert.equal(await make(ok, { apiKey: undefined }).speak('hi', 'R'), null);
  assert.equal(await make(ok).speak('hi', 'R', { cacheOnly: true }), null);
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

// ---------- the committed bank ----------

test('the bank list: every banked scripted line of both personas, plus the generic file, no duplicates', () => {
  const lines = bankLines();
  assert.ok(lines.every((l) => l.length <= MAX_SAY_CHARS), lines.filter((l) => l.length > MAX_SAY_CHARS).join(' | '));
  assert.equal(new Set(lines.map(normalizeLine)).size, lines.length);
  const banked = new Set(lines.map(normalizeLine));
  for (const l of bankedScriptLines()) assert.ok(banked.has(normalizeLine(l)), l);
  for (const l of loadBank()) assert.ok(banked.has(normalizeLine(l)), l);
  assert.deepEqual(parseBank('# note\n\nHi!\nhi\n  Got it.  \n'), ['Hi!', 'Got it.']);
});

test('the committed bank holds a real clip for every line, and git tracks it', async () => {
  const lines = bankLines();
  const missing = lines.filter((l) => !existsSync(join(TTS_BANK_DIR, bankFileName(l))));
  assert.deepEqual(missing, [], 'run: npm run tts:bank -w server, then commit server/tts/bank');
  for (const l of lines) {
    const head = readFileSync(join(TTS_BANK_DIR, bankFileName(l))).subarray(0, 3);
    // an MP3: an ID3 tag or a frame sync
    assert.ok(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0), l);
    assert.ok(statSync(join(TTS_BANK_DIR, bankFileName(l))).size > 2000, l);
  }
  // No clip without a line (a reworded line leaves no orphan behind).
  const wanted = new Set(lines.map(bankFileName));
  assert.deepEqual(readdirSync(TTS_BANK_DIR).filter((f) => f.endsWith('.mp3') && !wanted.has(f)), []);
  // Served in production with no key, no cache and no network: this is the lookup the server does.
  const prod = createTts({ cacheDir: tmp(), fetchFn: (() => assert.fail('the bank must not call the API')) as unknown as typeof fetch, log: () => {} });
  for (const l of bankedScriptLines()) assert.equal((await prod.speak(l, 'ROOM', { cacheOnly: true }))?.source, 'bank', l);
  assert.equal(prod.bankSize, lines.length);
  // Not ignored: the clips are part of the repo, so a deploy has them.
  const ignored = (() => {
    try {
      return execFileSync('git', ['check-ignore', join(TTS_BANK_DIR, bankFileName(lines[0]!))], { encoding: 'utf8' }).trim();
    } catch {
      return ''; // exit 1 = not ignored
    }
  })();
  assert.equal(ignored, '');
});
