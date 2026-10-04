import { createApp } from './app';
import { devCommandsEnabled } from './dev';
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

// Last line of defence: one room's bug must not end the process and every other room with
// it (Node exits on both of these by default). Log it and keep serving.
process.on('unhandledRejection', (reason) => console.error('[server] unhandled rejection:', reason));
process.on('uncaughtException', (e) => console.error('[server] uncaught exception:', e));

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
// TURN relay for voice (optional). All three are needed, otherwise clients get STUN only.
const turnUrls = (env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
const turn = turnUrls.length && env.TURN_USERNAME && env.TURN_CREDENTIAL ? { urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL } : null;
const tts = createTts({ apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID, modelId: ttsModel });

const app = createApp({
  origins: (env.CLIENT_ORIGIN ?? '').split(','),
  allowLocalhost: env.NODE_ENV !== 'production',
  turn,
  info: () => ({ aiAvailable: !!brain, ttsAvailable: !!brain, ttsMode }),
  devCommands: devCommandsEnabled(env),
  onAiRoom: (room, humanSide) => {
    if (!brain) return;
    new AiPlayer(room, humanSide === 'out' ? 'in' : 'out', brain, {
      fallback: scripted,
      onSay: (msg) => {
        // Cached and banked clips are free, so they are used in either mode. Only
        // elevenlabs mode may call the API; any miss or failure falls back to the browser.
        const speak = () => app.io.to(room.code).emit('speak', { chatId: msg.id, text: msg.text });
        tts
          .speak(msg.text, room.code, { cacheOnly: ttsMode === 'browser' })
          .then((clip) => {
            if (clip) app.io.to(room.code).emit('tts', { chatId: msg.id, mime: 'audio/mpeg', data: clip.audio as unknown as ArrayBuffer });
            else speak();
          })
          .catch((e: unknown) => {
            console.error(`[tts ${room.code}]`, e);
            speak(); // the line is still said, by the browser
          });
      },
    });
  },
});

if (!turn && (turnUrls.length || env.TURN_USERNAME || env.TURN_CREDENTIAL)) console.warn('TURN needs TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL together: voice uses STUN only.');
if (wanted === 'elevenlabs' && ttsMode === 'browser') console.warn('TTS_MODE=elevenlabs but ELEVENLABS_API_KEY is not set: using the browser voice.');

if (env.DEV_COMMANDS === '1') console.warn(devCommandsEnabled(env) ? 'DEV_COMMANDS=1: dev commands (teleport, solve) are ON. Never use this on a public server.' : 'DEV_COMMANDS=1 ignored: NODE_ENV=production.');

const port = await app.listen(Number(env.PORT) || 3001);
console.log(`cubic server listening on :${port} (AI partner: ${fake ? 'scripted (AI_FAKE=1)' : brain ? model : 'off, no GEMINI_API_KEY'}, persona ${persona}; AI voice: ${ttsMode}${ttsMode === 'elevenlabs' ? ` ${ttsModel}` : ''}, ${tts.bankSize} bank lines; voice ICE: ${turn ? `STUN + TURN (${turnUrls.length} urls)` : 'STUN only'})`);
