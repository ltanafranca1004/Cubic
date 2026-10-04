import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID, TTS_BANK_DIR, bankFileName, bankLines, createTts } from '../src/ai/tts';

// Builds the voice bank: one clip per scripted line (server/src/ai/scripted.ts) and per
// generic line (server/tts/bank-lines.txt), written to server/tts/bank and COMMITTED, so
// production serves them from the repo and never buys them again.
//   npm run tts:bank -w server
// Lines already in the bank are skipped, and a clip already in the local cache
// (server/.tts-cache) is copied instead of bought: running it again is free.

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_TTS_MODEL;
const lines = bankLines();
const tts = createTts({ apiKey, voiceId, modelId, log: () => {} });
console.log(`voice bank: ${lines.length} lines, voice ${voiceId}, model ${modelId}${apiKey ? '' : ' (ELEVENLABS_API_KEY is not set: only copying from the local cache)'}`);

const count = { banked: 0, copied: 0, new: 0, failed: 0 };
let newChars = 0;
for (const line of lines) {
  const res = await tts.bank(line);
  count[res ?? 'failed']++;
  if (res === 'new') newChars += line.length;
  console.log(`  ${(res ?? 'FAILED').padEnd(7)} ${line}`);
}

// A readable index next to the clips: which file is which line.
const index = { voiceId, modelId, lines: lines.map((text) => ({ file: bankFileName(text), chars: text.length, text })) };
writeFileSync(join(TTS_BANK_DIR, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
const clips = readdirSync(TTS_BANK_DIR).filter((f) => f.endsWith('.mp3'));
const bytes = clips.reduce((n, f) => n + statSync(join(TTS_BANK_DIR, f)).size, 0);
console.log(
  `done: ${count.new} bought (${newChars} characters sent to ElevenLabs), ${count.copied} copied from the cache, ${count.banked} already banked, ${count.failed} failed. ` +
    `Bank: ${clips.length} clips, ${(bytes / 1024).toFixed(0)} KB, ${lines.reduce((n, l) => n + l.length, 0)} characters in all. ${TTS_BANK_DIR}`,
);
process.exit(count.failed ? 1 : 0);
