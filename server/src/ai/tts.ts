import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_VOICES, DEFAULT_AI_VOICE, VOCAB, type AiVoice } from '@cubic/shared';
import type { Budget } from './budget';
import type { Persona } from './prompt';
import { fixedLines } from './scripted';

// The AI partner's voice: ElevenLabs text-to-speech, kept cheap.
//  1. THE VOICE BANK (server/tts/bank, committed): one clip per fixed line and per relay
//     vocabulary piece, bought once with `npm run tts:bank -w server -- --buy`. It is part
//     of the repo, so it is there after every deploy and every spin-down: the scripted
//     partner never costs a character at run time. A clip is named by voice + BANK model +
//     exact text, so a clip of another voice or model (the 82 bought for the first voice,
//     named by their normalized text) no longer resolves: one voice, never two in a game.
//     Banked clips are made with the best model (ELEVENLABS_BANK_MODEL), live lines with the
//     fast one (ELEVENLABS_MODEL).
//  2. Other lines (Gemini's) are bought on demand and cached on disk (server/.tts-cache,
//     keyed by voice + model + text): the same text is never bought twice.
//  3. Buying asks the budget first (budget.ts): 20 lines per game and a daily number of
//     characters for the whole server, and the ELEVENLABS_ENABLED kill switch. A refusal,
//     a miss or a failure gives null and the caller uses the browser voice.
// Nothing here blocks the game: the caller does not wait for a clip before moving.
//
// VOICES. The player picks the partner's voice in Settings (AI_VOICES in
// shared/src/aiVoices.ts). Every voice has its own committed bank folder: the default voice
// in server/tts/bank, any other in server/tts/bank-<key> (bankDirFor). A room only ever
// asks for its own voice, and a voice's clips are read from disk the first time each is
// asked for (then kept): the other bank is never read until a player picks that voice.
// A voice whose clip is missing falls through like any other miss: cache, live, browser.
// API: POST /v1/text-to-speech/{voice_id}
// (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

/**
 * The id of the default voice (Jessica), for its banked clips and its live lines.
 * ELEVENLABS_VOICE_ID replaces the id behind that default voice only; the other voices of
 * the picker keep their own ids.
 */
export const DEFAULT_VOICE_ID: string = AI_VOICES.find((v) => v.key === DEFAULT_AI_VOICE)!.id;
/** Live lines (Gemini's own). Flash v2.5: half the per-character price of the standard models, low latency. */
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
/** Banked clips: bought once, so the highest quality model. Override with ELEVENLABS_BANK_MODEL. */
export const DEFAULT_BANK_MODEL = 'eleven_v4';
/** The model ids the env asks for. ELEVENLABS_MODEL_ID is the older name of ELEVENLABS_MODEL. */
export const ttsModels = (env: Record<string, string | undefined>) => ({ modelId: env.ELEVENLABS_MODEL || env.ELEVENLABS_MODEL_ID || DEFAULT_TTS_MODEL, bankModelId: env.ELEVENLABS_BANK_MODEL || DEFAULT_BANK_MODEL });
export const TTS_CACHE_DIR = fileURLToPath(new URL('../../.tts-cache', import.meta.url));
/** Extra generic lines for the bank, on top of the scripted partner's own lines. */
export const TTS_BANK_FILE = fileURLToPath(new URL('../../tts/bank-lines.txt', import.meta.url));
/** The committed clips of the default voice. */
export const TTS_BANK_DIR = fileURLToPath(new URL('../../tts/bank', import.meta.url));
/** The bank folder of a voice: `base` itself for the default voice, `<base>-<key>` for any other. */
export const bankDirFor = (voice: AiVoice, base: string = TTS_BANK_DIR): string => (voice === DEFAULT_AI_VOICE ? base : `${base}-${voice}`);
const OUTPUT_FORMAT = 'mp3_44100_64';
const TIMEOUT_MS = 10_000;
/** A banked clip is made once, with the slow best model: it may take its time. */
const BANK_TIMEOUT_MS = 30_000;

export type TtsMode = 'browser' | 'elevenlabs';

/** TTS_MODE, defaulting to the free browser voice outside production. */
export function parseTtsMode(value: string | undefined, nodeEnv: string | undefined): TtsMode {
  if (value === 'browser' || value === 'elevenlabs') return value;
  return nodeEnv === 'production' ? 'elevenlabs' : 'browser';
}

/** Lowercase, punctuation stripped, spaces collapsed: how lines are matched to the bank. */
export const normalizeLine = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Lines of a bank file (no comments, no blanks, no duplicates). */
export function parseBank(content: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || seen.has(normalizeLine(line))) continue;
    seen.add(normalizeLine(line));
    lines.push(line);
  }
  return lines;
}

export function loadBank(file: string = TTS_BANK_FILE): string[] {
  return existsSync(file) ? parseBank(readFileSync(file, 'utf8')) : [];
}

/**
 * Every clip the bank should hold, read when it is called (never a hand-kept copy): the
 * fixed lines of the ACTIVE persona (scripted.ts: core, event and puzzle lines) and every
 * piece of the relay vocabulary (shared/src/bot/vocab.ts). Nothing else is bought: not the
 * other persona, not the generic lines of bank-lines.txt (a model almost never says one
 * word for word, and clips are found by their exact text).
 */
export function bankLines(persona: Persona = 'default'): string[] {
  return parseBank([...fixedLines(persona), ...VOCAB].join('\n'));
}

/** How the first clips (the old voice) were named: by their normalized text only. They no longer resolve. */
export const bankFileName = (text: string) => `${createHash('sha256').update(normalizeLine(text)).digest('hex').slice(0, 24)}.mp3`;

/** File name of a clip bought from now on: voice + model + the exact text. */
export const clipFileName = (voiceId: string, modelId: string, text: string) => `${createHash('sha256').update(`${voiceId}\n${modelId}\n${text}`).digest('hex').slice(0, 24)}.mp3`;

export interface TtsOptions {
  /** Without a key only cached clips can be served. */
  apiKey?: string;
  /** The id behind the DEFAULT voice (ELEVENLABS_VOICE_ID). The other voices keep the ids of AI_VOICES. */
  voiceId?: string;
  /** The model of live lines. */
  modelId?: string;
  /** The model of banked clips. */
  bankModelId?: string;
  cacheDir?: string;
  /** Where the committed clips of the default voice are; another voice's are in `<bankDir>-<key>` (bankDirFor). */
  bankDir?: string;
  /** Asked before every bought line (bank and cache hits are free and never ask). Without it nothing is capped. */
  budget?: Budget;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
}

export interface SpeakResult {
  audio: Buffer;
  /** Where the clip came from. */
  source: 'bank' | 'cache' | 'api';
}

export interface Tts {
  /**
   * MP3 for a line, or null if it cannot be produced (the caller falls back to the browser
   * voice). `cacheOnly` never calls the API. `session` is the room, for the usage log.
   * `voice`: the voice the room's player picked (the default one when left out).
   */
  speak(text: string, session: string, opts?: { cacheOnly?: boolean; voice?: AiVoice }): Promise<SpeakResult | null>;
  /**
   * Make sure a line is in the bank (the tts:bank script). 'banked' = already there,
   * 'copied' = taken from the local cache for free, 'new' = bought from the API.
   */
  bank(text: string): Promise<'banked' | 'copied' | 'new' | null>;
  /** The banked clip of this exact line or vocabulary piece in that voice (the default one when left out), or null. Never calls anything. */
  banked(text: string, voice?: AiVoice): Buffer | null;
  /** Banked clips of that voice held in memory: 0 until a clip of it was asked for. */
  loaded(voice: AiVoice): number;
  /** Where a line's clip is already: the bank (its file name), the local cache, or nowhere (null = it would be bought). */
  where(text: string): { source: 'bank' | 'cache'; file: string } | null;
  /** The file name a newly banked line gets. */
  fileName(text: string): string;
  /** The credits ElevenLabs said it charged for the last call made for this text (its "character-cost" header), or null: no call, or no such header. */
  cost(text: string): number | null;
  /** Characters sent to ElevenLabs since the server started. */
  readonly totalChars: number;
  /** Clips in the bank directory that are of this voice and bank model. */
  readonly bankSize: number;
}

export function createTts(opts: TtsOptions = {}): Tts {
  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  /** The ElevenLabs id of a voice. Only keys of AI_VOICES get here: an id is never taken from outside. */
  const idOf = (voice: AiVoice): string => (voice === DEFAULT_AI_VOICE ? voiceId : AI_VOICES.find((v) => v.key === voice)!.id);
  const modelId = opts.modelId || DEFAULT_TTS_MODEL;
  const bankModelId = opts.bankModelId || DEFAULT_BANK_MODEL;
  const dir = opts.cacheDir ?? TTS_CACHE_DIR;
  const bankDir = opts.bankDir ?? TTS_BANK_DIR;
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? ((line: string) => console.info(line));
  const inFlight = new Map<string, Promise<Buffer | null>>();
  let totalChars = 0;
  const costs = new Map<string, number>();

  const fileFor = (text: string, voice: AiVoice = DEFAULT_AI_VOICE) => join(dir, `${createHash('sha256').update(`${idOf(voice)}\n${modelId}\n${text}`).digest('hex')}.mp3`);
  const bankNew = (text: string, voice: AiVoice = DEFAULT_AI_VOICE) => join(bankDirFor(voice, bankDir), clipFileName(idOf(voice), bankModelId, text));
  /** Where this line's clip is in the bank, or null. Only a clip of this voice and bank model counts. */
  const bankFor = (text: string, voice: AiVoice = DEFAULT_AI_VOICE): string | null => (existsSync(bankNew(text, voice)) ? bankNew(text, voice) : null);
  /** The banked clips read so far, per voice: a voice has no entry until one of its clips is asked for. */
  const memory = new Map<AiVoice, Map<string, Buffer>>();
  /** The banked clip of a line in a voice, or null: no such clip (or it cannot be read). Read once, then kept. */
  function bankClip(text: string, voice: AiVoice): Buffer | null {
    const file = bankNew(text, voice);
    const held = memory.get(voice)?.get(file);
    if (held) return held;
    try {
      if (!existsSync(file)) return null;
      const audio = readFileSync(file);
      if (!memory.has(voice)) memory.set(voice, new Map());
      memory.get(voice)!.set(file, audio);
      return audio;
    } catch {
      return null; // unreadable: the same as missing
    }
  }

  async function generate(text: string, file: string, session: string, model: string = modelId, voice: AiVoice = DEFAULT_AI_VOICE): Promise<Buffer | null> {
    try {
      totalChars += text.length;
      if (!opts.budget) log(`[eleven] room=${session} chars=${text.length} total=${totalChars}`);
      const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${idOf(voice)}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey!, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model }),
        signal: AbortSignal.timeout(model === modelId ? TIMEOUT_MS : BANK_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[tts ${session}] ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const charged = Number(res.headers.get('character-cost') ?? res.headers.get('x-character-count') ?? NaN);
      if (Number.isFinite(charged)) costs.set(text, charged);
      const audio = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, audio);
      return audio;
    } catch (e) {
      console.warn(`[tts ${session}] failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  return {
    get totalChars() {
      return totalChars;
    },
    get bankSize() {
      if (!existsSync(bankDir)) return 0;
      const mine = new Set(bankLines().map((l) => clipFileName(voiceId, bankModelId, l)));
      return readdirSync(bankDir).filter((f) => mine.has(f)).length;
    },
    async speak(text, session, { cacheOnly = false, voice = DEFAULT_AI_VOICE } = {}) {
      // The committed bank of this voice first: it is always there (once it was bought).
      const banked = bankClip(text, voice);
      if (banked) return { audio: banked, source: 'bank' };
      const file = fileFor(text, voice);
      if (existsSync(file)) return { audio: readFileSync(file), source: 'cache' };
      if (cacheOnly || !opts.apiKey) return null;
      let job = inFlight.get(file);
      if (!job) {
        // The caps and the kill switch: a refusal is logged there, and the browser reads the line.
        if (opts.budget && opts.budget.eleven(session, text.length) !== null) return null;
        job = generate(text, file, session, modelId, voice).finally(() => inFlight.delete(file));
        inFlight.set(file, job);
      }
      const audio = await job;
      return audio ? { audio, source: 'api' } : null;
    },
    banked: (text, voice = DEFAULT_AI_VOICE) => bankClip(text, voice),
    loaded: (voice) => memory.get(voice)?.size ?? 0,
    where(text) {
      const file = bankFor(text);
      if (file) return { source: 'bank', file: basename(file) };
      return bankModelId === modelId && existsSync(fileFor(text)) ? { source: 'cache', file: basename(fileFor(text)) } : null;
    },
    fileName: (text) => clipFileName(voiceId, bankModelId, text),
    cost: (text) => costs.get(text) ?? null,
    async bank(text) {
      if (bankFor(text)) return 'banked';
      const file = bankNew(text);
      mkdirSync(bankDir, { recursive: true });
      // The local cache holds live-model clips: only the same model may be copied.
      const cached = fileFor(text);
      if (bankModelId === modelId && existsSync(cached)) {
        writeFileSync(file, readFileSync(cached));
        return 'copied';
      }
      if (!opts.apiKey) return null;
      return (await generate(text, file, 'bank', bankModelId)) ? 'new' : null;
    },
  };
}
