import { createApp } from './app';
import { devCommandsEnabled } from './dev';
import { INACTIVITY, inactivityMs } from './rooms';
import { createAiPartner } from './ai/wire';

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
// Gemini, ElevenLabs and their budget: only ever used by solo (AI) rooms, through onAiRoom.
const ai = createAiPartner(env);
// TURN relay for voice (optional). All three are needed, otherwise clients get STUN only.
const turnUrls = (env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
const turn = turnUrls.length && env.TURN_USERNAME && env.TURN_CREDENTIAL ? { urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL } : null;

// Inactivity timers in ms (defaults: 4 minutes, then a 60 second countdown).
INACTIVITY.idleMs = inactivityMs(env.INACTIVE_MS, INACTIVITY.idleMs);
INACTIVITY.warnMs = inactivityMs(env.INACTIVE_WARN_MS, INACTIVITY.warnMs);

const app = createApp({
  origins: (env.CLIENT_ORIGIN ?? '').split(','),
  allowLocalhost: env.NODE_ENV !== 'production',
  turn,
  info: () => ({ aiAvailable: true, ttsAvailable: true, ttsMode: ai.ttsMode }),
  devCommands: devCommandsEnabled(env),
  onAiRoom: (room, humanSide) => void ai.join(room, humanSide, (r, event, msg) => void app.io.to(r.code).emit(event, ...([msg] as never))),
});

if (!turn && (turnUrls.length || env.TURN_USERNAME || env.TURN_CREDENTIAL)) console.warn('TURN needs TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL together: voice uses STUN only.');
if (ai.ttsWanted === 'elevenlabs' && ai.ttsMode === 'browser') console.warn('TTS_MODE=elevenlabs but ELEVENLABS_API_KEY is not set: using the browser voice.');

if (env.DEV_COMMANDS === '1') console.warn(devCommandsEnabled(env) ? 'DEV_COMMANDS=1: dev commands (teleport, solve) are ON. Never use this on a public server.' : 'DEV_COMMANDS=1 ignored: NODE_ENV=production.');

// What both APIs were used for today: every hour, but only if something changed, and when
// the server is stopped. There is no endpoint for it: it is in the logs only.
const HOUR_MS = 60 * 60_000;
setInterval(() => {
  const line = ai.budget.report();
  if (line) console.log(line);
}, HOUR_MS).unref();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${ai.budget.summaryLine()} (${signal})`);
    process.exit(0);
  });
}

const port = await app.listen(Number(env.PORT) || 3001);
console.log(`cubic server listening on :${port} (${ai.describe()}; voice ICE: ${turn ? `STUN + TURN (${turnUrls.length} urls)` : 'STUN only'})`);
console.log(ai.budget.summaryLine());
