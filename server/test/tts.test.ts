import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MAX_SAY_CHARS } from '../src/ai/prompt';
import { bankedScriptLines } from '../src/ai/scripted';
import { VOCAB } from '@cubic/shared';
import { DEFAULT_TTS_MODEL, TTS_BANK_DIR, bankFileName, bankLines, clipFileName, createTts, loadBank, normalizeLine, parseBank, parseTtsMode } from '../src/ai/tts';

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
  // a new clip is named by voice + model + exact text
  assert.deepEqual(readdirSync(bankDir).sort(), ['Got it.', "I can't hear you. Come closer."].map((l) => tts.fileName(l)).sort());
  assert.equal(tts.fileName('Got it.'), clipFileName('21m00Tcm4TlvDq8ikWAM', 'eleven_flash_v2_5', 'Got it.'));
  assert.notEqual(tts.fileName('Got it.'), tts.fileName('got it'));
  assert.equal((await tts.speak('Got it.', 'ROOM'))!.source, 'bank');
  assert.equal(api.calls.length, 2);
  // A server with NO key and an empty cache (a fresh deploy) still plays them.
  const fresh = createTts({ cacheDir: tmp(), bankDir, fetchFn: api.fetchFn, log: () => {} });
  for (const said of ['Got it.', "I can't hear you. Come closer."]) {
    assert.equal((await fresh.speak(said, 'ROOM'))!.source, 'bank', said);
    assert.equal((await fresh.speak(said, 'ROOM', { cacheOnly: true }))!.source, 'bank', said);
  }
  assert.equal(api.calls.length, 2);
  assert.equal(fresh.bankSize, 2);
  // Another voice or model is another clip: it is not served the old one, and not bought behind your back.
  assert.equal(await createTts({ voiceId: 'another', modelId: 'other', cacheDir: tmp(), bankDir, log: () => {} }).speak('Got it.', 'R'), null);
  // The clips bought before (named by normalized text only) still play, in any spelling and with any voice setting.
  const old = tmp();
  writeFileSync(join(old, bankFileName('It worked!')), new Uint8Array([9]));
  const legacy = createTts({ voiceId: 'another', cacheDir: tmp(), bankDir: old, fetchFn: api.fetchFn, apiKey: 'k', log: () => {} });
  for (const said of ['It worked!', 'it worked', ' IT  WORKED!! ']) assert.equal((await legacy.speak(said, 'R'))!.source, 'bank', said);
  assert.equal(await legacy.bank('It worked!'), 'banked'); // and they are never bought again
  assert.equal(api.calls.length, 2);
  assert.equal(normalizeLine("I can't HEAR you... Come closer!"), 'i cant hear you come closer');
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

test('usage log without a budget: one line per real API call; cached lines are not counted', async () => {
  const lines: string[] = [];
  const tts = make(fakeApi(), { log: (l) => lines.push(l) });
  await tts.speak('12345', 'AAAA');
  await tts.speak('1234567890', 'AAAA');
  await tts.speak('12345', 'AAAA'); // cached: not counted
  await tts.speak('abc', 'BBBB');
  assert.equal(tts.totalChars, 18);
  assert.deepEqual(lines, ['[eleven] room=AAAA chars=5 total=5', '[eleven] room=AAAA chars=10 total=15', '[eleven] room=BBBB chars=3 total=18']);
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

test('the bank list: every fixed line of both personas, the generic file and every vocabulary piece, no duplicates', () => {
  const lines = bankLines();
  assert.ok(lines.every((l) => l.length <= MAX_SAY_CHARS), lines.filter((l) => l.length > MAX_SAY_CHARS).join(' | '));
  assert.equal(new Set(lines.map(normalizeLine)).size, lines.length);
  const banked = new Set(lines.map(normalizeLine));
  for (const l of [...bankedScriptLines(), ...loadBank(), ...VOCAB]) assert.ok(banked.has(normalizeLine(l)), l);
  assert.ok(lines.every((l) => !l.includes('{')), 'a relay line with a placeholder is never a whole clip');
  assert.deepEqual(parseBank('# note\n\nHi!\nhi\n  Got it.  \n'), ['Hi!', 'Got it.']);
});

test('the committed bank: every clip is a real MP3, listed in the index, tracked by git, and served with no key and no network', async () => {
  // Lines and pieces added since the last `tts:bank -- --buy` are not in the bank yet (the
  // dry run lists them); until then the browser voice reads them. What IS there must be right.
  const prod = createTts({ cacheDir: tmp(), fetchFn: (() => assert.fail('the bank must not call the API')) as unknown as typeof fetch, log: () => {} });
  const lines = bankLines().filter((l) => prod.where(l)?.source === 'bank');
  assert.ok(lines.length >= 70, `${lines.length} banked lines`);
  const index = JSON.parse(readFileSync(join(TTS_BANK_DIR, 'index.json'), 'utf8')) as { lines: { file: string; text: string }[] };
  const indexed = new Set(index.lines.map((l) => l.file));
  for (const l of lines) {
    const file = join(TTS_BANK_DIR, prod.where(l)!.file);
    const head = readFileSync(file).subarray(0, 3);
    // an MP3: an ID3 tag or a frame sync
    assert.ok(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0), l);
    assert.ok(statSync(file).size > 2000, l);
    assert.equal((await prod.speak(l, 'ROOM', { cacheOnly: true }))?.source, 'bank', l);
  }
  // No stray clip: every file is in the index with its text (a retired line's clip too: clips are never deleted).
  assert.deepEqual(readdirSync(TTS_BANK_DIR).filter((f) => f.endsWith('.mp3') && !indexed.has(f)), []);
  for (const l of index.lines) assert.ok(existsSync(join(TTS_BANK_DIR, l.file)), l.text);
  // The core lines were banked before this change and must keep resolving.
  for (const l of ['It worked!', 'We did it!', 'Okay, waiting. Say go when you are ready.']) assert.equal(prod.where(l)?.source, 'bank', l);
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
