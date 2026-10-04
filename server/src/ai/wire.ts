import { DEFAULT_AI_VOICE, type AiVoice, type ChatMessage, type Say, type ServerToClient, type Side, type VoicePreview } from '@cubic/shared';
import type { Room } from '../rooms';
import { AiPlayer, type AiOptions } from './aiPlayer';
import { Budget } from './budget';
import { DEFAULT_GEMINI_MODEL, geminiBrain, type Brain } from './gemini';
import { parsePersona, type Persona } from './prompt';
import { lineText } from './scripted';
import { RELAY_GAP_MS, relayPieces } from './relay';
import { createTts, parseTtsMode, ttsModels, type Tts, type TtsMode, type TtsOptions } from './tts';

// The AI partner as the server wires it up from the environment: the one Gemini advisor,
// the one voice and the one budget, shared by every solo room. It is only ever reached
// through join(), which the app calls for a room made by "Play with AI": a two-player room
// has no AiPlayer, so nothing in here runs for it and neither API is ever called.

type SpeechEvent = 'tts' | 'tts:chain' | 'speak';
/** Send one of the speech messages to everyone in a room. */
export type Send = <E extends SpeechEvent>(room: Room, event: E, msg: Parameters<ServerToClient[E]>[0]) => void;

export interface AiDeps {
  /** Builds the Gemini advisor (tests pass a spy). */
  brain?: (apiKey: string, model: string, persona: Persona) => Brain;
  /** The fetch ElevenLabs is called with (tests pass a spy). */
  fetchFn?: typeof fetch;
  budget?: Budget;
  tts?: Pick<TtsOptions, 'cacheDir' | 'bankDir'>;
  player?: AiOptions;
  log?: (line: string) => void;
}

export interface AiPartner {
  budget: Budget;
  tts: Tts;
  /** Gemini, or null: no key, or AI_FAKE=1. */
  advisor: Brain | null;
  model: string;
  persona: Persona;
  /** What TTS_MODE asked for, and what it is without a key. */
  ttsWanted: TtsMode;
  ttsMode: TtsMode;
  /** Put the AI in the other seat of a solo room. */
  join(room: Room, humanSide: Side, send: Send): AiPlayer;
  /** The voice the player of a solo room picked (already checked against AI_VOICES): used from the AI's next line. */
  setVoice(room: Room, voice: AiVoice): void;
  /** The voice a room's AI speaks with. */
  voiceOf(room: Room): AiVoice;
  /** One banked greeting in a voice, for the settings panel. Never bought: `data` is null when that voice has no clip of it. */
  preview(voice: AiVoice): VoicePreview;
  /** For the start-up log line. */
  describe(): string;
}

export function createAiPartner(env: Record<string, string | undefined>, deps: AiDeps = {}): AiPartner {
  const log = deps.log ?? ((line: string) => console.log(line));
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const persona = parsePersona(env.AI_PERSONA);
  const fake = env.AI_FAKE === '1';
  const budget = deps.budget ?? Budget.fromEnv(env, { log });
  // The scripted partner always plays. Gemini only talks, when there is a key (and the budget allows each call).
  const advisor = !fake && env.GEMINI_API_KEY ? (deps.brain ?? geminiBrain)(env.GEMINI_API_KEY, model, persona) : null;
  const { modelId: ttsModel, bankModelId } = ttsModels(env);
  // browser = the client's free speechSynthesis. elevenlabs needs a key; without one we
  // stay on the browser voice so the AI is never silent.
  const ttsWanted = parseTtsMode(env.TTS_MODE, env.NODE_ENV);
  const ttsMode: TtsMode = ttsWanted === 'elevenlabs' && !env.ELEVENLABS_API_KEY ? 'browser' : ttsWanted;
  const tts = createTts({ apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID, modelId: ttsModel, bankModelId, budget, log, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}), ...deps.tts });
  /** The voice each solo room's player picked. A room that never said is on the default voice. */
  const voices = new WeakMap<Room, AiVoice>();
  const voiceOf = (room: Room): AiVoice => voices.get(room) ?? DEFAULT_AI_VOICE;

  /** Speak one line of the AI, in the room's voice. The game never waits for it. */
  function voice(room: Room, send: Send, msg: ChatMessage, info: { scripted: boolean; line?: Say }): void {
    const speak = () => send(room, 'speak', { chatId: msg.id, text: msg.text });
    const picked = voiceOf(room); // read when the line is said: a change in Settings counts from the next line
    // A relay line (an answer, built from vocabulary pieces): the chain of the pieces'
    // banked clips. Never bought: if one clip is missing the browser reads the whole line.
    const pieces = info.scripted ? relayPieces(msg.text) : null;
    if (pieces) {
      const clips = pieces.map((p) => tts.banked(p, picked));
      if (clips.every((c) => c !== null)) send(room, 'tts:chain', { chatId: msg.id, mime: 'audio/mpeg', pieces, clips: clips as unknown as ArrayBuffer[], gapMs: RELAY_GAP_MS });
      else speak();
      return;
    }
    // Banked and cached clips are free, so they are used in either mode. Only Gemini's own
    // lines may be bought, only in elevenlabs mode, and only while the budget allows it.
    tts
      .speak(msg.text, room.code, { cacheOnly: info.scripted || ttsMode === 'browser', voice: picked })
      .then((clip) => {
        if (clip) send(room, 'tts', { chatId: msg.id, mime: 'audio/mpeg', data: clip.audio as unknown as ArrayBuffer });
        else speak();
      })
      .catch((e: unknown) => {
        log(`[tts ${room.code}] ${e instanceof Error ? e.message : String(e)}`);
        speak(); // the line is still said, by the browser
      });
  }

  return {
    budget,
    tts,
    advisor,
    model,
    persona,
    ttsWanted,
    ttsMode,
    join: (room, humanSide, send) =>
      new AiPlayer(room, humanSide === 'out' ? 'in' : 'out', advisor, {
        persona,
        budget,
        ...deps.player,
        onSay: (msg, info) => {
          try {
            voice(room, send, msg, info);
          } catch (e) {
            log(`[tts ${room.code}] ${e instanceof Error ? e.message : String(e)}`);
          }
          deps.player?.onSay?.(msg, info);
        },
      }),
    setVoice: (room, voice) => void voices.set(room, voice),
    voiceOf,
    preview: (voice) => {
      const text = lineText(persona, 'hello.out');
      return { voice, text, mime: 'audio/mpeg', data: tts.banked(text, voice) as unknown as ArrayBuffer | null };
    },
    describe: () =>
      `AI partner: scripted${fake ? ' only (AI_FAKE=1)' : !advisor ? ' only, no GEMINI_API_KEY' : !budget.geminiEnabled ? ' only (GEMINI_ENABLED=false)' : ` + ${model}, ${budget.geminiDailyCap} calls a day`}, persona ${persona}; ` +
      `AI voice: ${tts.bankSize} banked clips + ${ttsMode === 'elevenlabs' && budget.elevenEnabled ? `ElevenLabs ${ttsModel}, ${budget.elevenDailyChars} characters a day` : `the browser voice${budget.elevenEnabled ? '' : ' (ELEVENLABS_ENABLED=false)'}`}`,
  };
}
