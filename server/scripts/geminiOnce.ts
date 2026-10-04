import { createGame, defaultEnv, observe } from '@cubic/shared';
import { parseReply } from '../src/ai/aiPlayer';
import { parseEnabled } from '../src/ai/budget';
import { DEFAULT_GEMINI_MODEL, geminiBrain, isQuotaError } from '../src/ai/gemini';
import { parsePersona, turnPrompt } from '../src/ai/prompt';
import { humanSays } from '../src/ai/scripted';

// ONE real chat round trip with Gemini, exactly as the AI partner makes it (the same
// client, system prompt, turn summary and reply check as a "chat" event in a solo room),
// to see with your own eyes that the key, the model and the quota answer.
//
//   npm run gemini:once -w server                        asks "hey, how are you doing in there?"
//   npm run gemini:once -w server -- "what do you see?"  asks that instead
//
// It makes EXACTLY ONE Gemini call (no retry, no second model) and no ElevenLabs call, and
// it does not touch the server's daily counters (server/.data/usage.json). The key is read
// from server/.env (or the real environment) and is never printed.

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no server/.env: use the real environment
}

const env = process.env;
const key = env.GEMINI_API_KEY;
const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const persona = parsePersona(env.AI_PERSONA);
const said = process.argv.slice(2).join(' ').trim() || 'hey, how are you doing in there?';
/** Longer than the server's 6 s chat deadline: this is to see how long it really takes. */
const DEADLINE_MS = 20_000;

console.log(`GEMINI_API_KEY: ${key ? 'set' : 'NOT SET'}; GEMINI_MODEL: ${model}; AI_PERSONA: ${persona}`);
if (env.AI_FAKE === '1') console.log('note: AI_FAKE=1 is set: the server would not call Gemini at all. This script calls it anyway.');
if (!parseEnabled(env.GEMINI_ENABLED)) console.log('note: GEMINI_ENABLED is off: the server would not call Gemini at all. This script calls it anyway.');
if (!key) {
  console.error('No key: put GEMINI_API_KEY in server/.env. Nothing was called.');
  process.exit(1);
}

// A fresh game, the AI inside, the human outside on the same wall: the first seconds of a solo room.
const state = createGame(Date.now(), defaultEnv, 1);
const o = observe(state, 'in');
const turn = turnPrompt({
  side: 'in',
  event: 'chat',
  observation: o,
  planner: 'starting',
  scriptLine: null,
  partnerSaid: said,
  partnerSays: humanSays(o.puzzleId, 'in'),
  chat: [{ id: 1, from: 'out', isAI: false, text: said, at: Date.now() }],
});

const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), DEADLINE_MS);
const started = Date.now();
console.log(`you: ${said}`);
try {
  const reply = await geminiBrain(key, model, persona).think(turn, abort.signal);
  const ms = Date.now() - started;
  const parsed = parseReply(reply.text);
  console.log(`answered in ${ms} ms (the server gives a chat line 6000 ms); finish=${reply.finish ?? 'none'}; tokens in=${reply.tokens?.input ?? 0} out=${reply.tokens?.output ?? 0}`);
  console.log(`raw: ${reply.text.slice(0, 300)}`);
  if (!parsed) {
    console.error('NOT USABLE: the reply is not the JSON the server asks for. In a game she would say the preset line.');
    process.exit(1);
  }
  console.log(`she says: ${parsed.say ?? '(nothing: in a game she would say the preset line)'}`);
  console.log(`heard as protocol words: ${parsed.heard ?? '(none)'}`);
} catch (e) {
  const ms = Date.now() - started;
  const why = abort.signal.aborted ? `no answer after ${DEADLINE_MS} ms` : isQuotaError(e) ? '429: the quota of this key is used up (see the message for which one)' : 'the call failed';
  console.error(`FAILED after ${ms} ms: ${why}`);
  console.error((e instanceof Error ? e.message : String(e)).slice(0, 1200));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
