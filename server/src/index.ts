import { createApp } from './app';
import { AiPlayer } from './ai/aiPlayer';
import { DEFAULT_GEMINI_MODEL, geminiBrain } from './ai/gemini';
import { parsePersona } from './ai/prompt';
import { scriptedBrain } from './ai/scripted';
import { DEFAULT_TTS_MODEL, createTts, parseTtsMode } from './ai/tts';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const env = process.env;
const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const persona = parsePersona(env.AI_PERSONA);
const fake = env.AI_FAKE === '1';
const scripted = scriptedBrain(persona);
const brain = fake ? scripted : env.GEMINI_API_KEY ? geminiBrain(env.GEMINI_API_KEY, model, persona) : null;
const ttsModel = env.ELEVENLABS_MODEL_ID || DEFAULT_TTS_MODEL;
// browser = the client's free speechSynthesis. elevenlabs needs a key; without one we
// stay on the browser voice so the AI is never silent.
const wanted = parseTtsMode(env.TTS_MODE, env.NODE_ENV);
const ttsMode = wanted === 'elevenlabs' && !env.ELEVENLABS_API_KEY ? 'browser' : wanted;
const tts = createTts({ apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID, modelId: ttsModel });

const app = createApp({
  origins: (env.CLIENT_ORIGIN ?? '').split(','),
  allowLocalhost: env.NODE_ENV !== 'production',
  info: () => ({ aiAvailable: !!brain, ttsAvailable: !!brain, ttsMode }),
  onAiRoom: (room, humanSide) => {
    if (!brain) return;
    new AiPlayer(room, humanSide === 'out' ? 'in' : 'out', brain, {
      fallback: scripted,
      onSay: (msg) => {
        // Cached and banked clips are free, so they are used in either mode. Only
        // elevenlabs mode may call the API; any miss or failure falls back to the browser.
        void tts.speak(msg.text, room.code, { cacheOnly: ttsMode === 'browser' }).then((clip) => {
          if (clip) app.io.to(room.code).emit('tts', { chatId: msg.id, mime: 'audio/mpeg', data: clip.audio as unknown as ArrayBuffer });
          else app.io.to(room.code).emit('speak', { chatId: msg.id, text: msg.text });
        });
      },
    });
  },
});

if (wanted === 'elevenlabs' && ttsMode === 'browser') console.warn('TTS_MODE=elevenlabs but ELEVENLABS_API_KEY is not set: using the browser voice.');

const port = await app.listen(Number(env.PORT) || 3001);
console.log(`cubic server listening on :${port} (AI partner: ${fake ? 'scripted (AI_FAKE=1)' : brain ? model : 'off, no GEMINI_API_KEY'}, persona ${persona}; AI voice: ${ttsMode}${ttsMode === 'elevenlabs' ? ` ${ttsModel}` : ''}, ${tts.bankSize} bank lines)`);
