import { execFileSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import { runBank, trimCommand } from '../src/ai/bank';
import { parsePersona } from '../src/ai/prompt';
import { DEFAULT_VOICE_ID, TTS_BANK_DIR, bankLines, createTts, ttsModels } from '../src/ai/tts';

// The voice bank: one clip per fixed line of the partner in the active persona
// (server/src/ai/scripted.ts) and per relay vocabulary piece
// (shared/src/bot/vocab.ts), written to server/tts/bank and COMMITTED, so production
// serves them from the repo and never buys them again. The list is read when the script
// runs: a line added to scripted.ts or a piece added to the vocabulary is picked up.
//
//   npm run tts:bank -w server            DRY RUN (the default): lists every missing clip
//                                         and the exact characters it would cost. No
//                                         network call, nothing written, exit 0.
//   npm run tts:bank -w server -- --buy   buys the missing clips from ElevenLabs. Refuses
//                                         (exit 1) over 4000 characters in one run.
//                                         With ffmpeg on PATH each bought clip then has the
//                                         silence cut off both ends (without it: skipped).
//
// Voice: ELEVENLABS_VOICE_ID. Model: ELEVENLABS_BANK_MODEL (default eleven_v4), not the fast
// model the live lines use. A clip is named by voice + model + exact text.
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
const { modelId, bankModelId } = ttsModels(process.env);
// Only --buy ever sees the key. A dry run gets no key and a fetch that throws.
const apiKey = buy ? process.env.ELEVENLABS_API_KEY : undefined;
const noNetwork = (() => {
  throw new Error('a dry run must not call the network');
}) as unknown as typeof fetch;
const tts = createTts({ apiKey, voiceId, modelId, bankModelId, log: () => {}, ...(buy ? {} : { fetchFn: noNetwork }) });

/** Is ffmpeg on PATH? Only asked when buying. */
const hasFfmpeg = (): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
/** Cut the silence off both ends of a clip, in place. A failure leaves the clip as it was bought. */
const trim = (file: string): boolean => {
  const tmp = `${file}.trim.mp3`;
  try {
    execFileSync('ffmpeg', trimCommand(file, tmp), { stdio: 'ignore' });
    renameSync(tmp, file);
    return true;
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
};

process.exit(
  await runBank({
    argv,
    lines: bankLines(parsePersona(process.env.AI_PERSONA)),
    tts,
    hasKey: !!apiKey,
    bankDir: TTS_BANK_DIR,
    voiceId,
    modelId: bankModelId,
    ...(buy && hasFfmpeg() ? { trim } : {}),
    out: (line) => console.log(line),
  }),
);
