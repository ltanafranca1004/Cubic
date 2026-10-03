import { createTts, loadBank, TTS_CACHE_DIR, DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID } from '../src/ai/tts';

// Pre-generates the voice bank (server/tts/bank-lines.txt) into server/.tts-cache.
// Lines already in the cache are skipped, so it is safe and free to run again.
//   npm run tts:bank -w server

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY is not set (put it in server/.env).');
  process.exit(1);
}

const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_TTS_MODEL;
const lines = loadBank();
const tts = createTts({ apiKey, voiceId, modelId, bank: lines, log: () => {} });
console.log(`voice bank: ${lines.length} lines, voice ${voiceId}, model ${modelId}`);

const count = { api: 0, cached: 0, failed: 0 };
for (const line of lines) {
  const res = await tts.speak(line, 'bank');
  if (!res) count.failed++;
  else if (res.source === 'api') count.api++;
  else count.cached++;
  console.log(`  ${!res ? 'FAILED ' : res.source === 'api' ? 'new    ' : 'cached '} ${line}`);
}
console.log(`done: ${count.api} generated, ${count.cached} already cached, ${count.failed} failed. ${tts.totalChars} characters sent. Cache: ${TTS_CACHE_DIR}`);
process.exit(count.failed ? 1 : 0);
