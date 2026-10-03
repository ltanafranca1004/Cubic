import { createApp } from './app';
import { AiPlayer } from './ai/aiPlayer';
import { DEFAULT_GEMINI_MODEL, geminiBrain } from './ai/gemini';
import { scriptedBrain } from './ai/scripted';
import { elevenLabsTts } from './ai/tts';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const env = process.env;
const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const fake = env.AI_FAKE === '1';
const brain = fake ? scriptedBrain : env.GEMINI_API_KEY ? geminiBrain(env.GEMINI_API_KEY, model) : null;
const tts = env.ELEVENLABS_API_KEY ? elevenLabsTts(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID || undefined) : null;

const app = createApp({
  origins: (env.CLIENT_ORIGIN ?? '').split(','),
  allowLocalhost: env.NODE_ENV !== 'production',
  info: () => ({ aiAvailable: !!brain, ttsAvailable: !!tts }),
  onAiRoom: (room, humanSide) => {
    if (!brain) return;
    new AiPlayer(room, humanSide === 'out' ? 'in' : 'out', brain, {
      onSay: (msg) => {
        void tts?.speak(msg.text).then((audio) => {
          if (audio) app.io.to(room.code).emit('tts', { chatId: msg.id, mime: 'audio/mpeg', data: audio as unknown as ArrayBuffer });
        });
      },
    });
  },
});

const port = await app.listen(Number(env.PORT) || 3001);
console.log(`cubic server listening on :${port} (AI partner: ${fake ? 'scripted (AI_FAKE=1)' : brain ? model : 'off, no GEMINI_API_KEY'}; AI voice: ${tts ? 'on' : 'off'})`);
