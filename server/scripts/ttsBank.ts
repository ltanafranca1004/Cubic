import { runBank } from '../src/ai/bank';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID, TTS_BANK_DIR, bankLines, createTts } from '../src/ai/tts';

// The voice bank: one clip per fixed line of the partner (server/src/ai/scripted.ts), per
// generic line (server/tts/bank-lines.txt) and per relay vocabulary piece
// (shared/src/bot/vocab.ts), written to server/tts/bank and COMMITTED, so production
// serves them from the repo and never buys them again. The list is read when the script
// runs: a line added to scripted.ts or a piece added to the vocabulary is picked up.
//
//   npm run tts:bank -w server            DRY RUN (the default): lists every missing clip
//                                         and the exact characters it would cost. No
//                                         network call, nothing written, exit 0.
//   npm run tts:bank -w server -- --buy   buys the missing clips from ElevenLabs. Refuses
//                                         (exit 1) over 4000 characters in one run.
//
// Clips already in the bank are never bought again, and a clip in the local cache
// (server/.tts-cache) is copied instead of bought.

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const argv = process.argv.slice(2);
const buy = argv.includes('--buy');
const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_TTS_MODEL;
// Only --buy ever sees the key. A dry run gets no key and a fetch that throws.
const apiKey = buy ? process.env.ELEVENLABS_API_KEY : undefined;
const noNetwork = (() => {
  throw new Error('a dry run must not call the network');
}) as unknown as typeof fetch;
const tts = createTts({ apiKey, voiceId, modelId, log: () => {}, ...(buy ? {} : { fetchFn: noNetwork }) });

process.exit(await runBank({ argv, lines: bankLines(), tts, hasKey: !!apiKey, bankDir: TTS_BANK_DIR, voiceId, modelId, out: (line) => console.log(line) }));
