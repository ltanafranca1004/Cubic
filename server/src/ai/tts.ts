import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankedScriptLines } from './scripted';

// The AI partner's voice: ElevenLabs text-to-speech, kept cheap.
//  1. THE VOICE BANK (server/tts/bank, committed): one clip per banked line, generated
//     once with `npm run tts:bank -w server`. A line that matches a banked line, ignoring
//     case and punctuation, plays that clip. It is part of the repo, so it is there after
//     every deploy and every spin-down: the scripted partner never costs a character.
//  2. Other lines (Gemini's) are generated on demand and cached on disk (server/.tts-cache,
//     keyed by voice + model + text; lost when the host's disk is wiped).
//  3. At most TTS_SESSION_LINES (15) generated lines per room. After that, and on any
//     miss or failure, speak() gives null and the caller uses the browser voice.
//  4. Characters actually sent to ElevenLabs are logged per session and in total.
// Nothing here blocks the game: the caller does not wait for a clip before moving.
// API: POST /v1/text-to-speech/{voice_id}
// (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

/** Stock "Rachel" voice. Override with ELEVENLABS_VOICE_ID. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
/** Flash v2.5: half the per-character price of the standard models, low latency. */
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
export const TTS_CACHE_DIR = fileURLToPath(new URL('../../.tts-cache', import.meta.url));
/** Extra generic lines for the bank, on top of the scripted partner's own lines. */
export const TTS_BANK_FILE = fileURLToPath(new URL('../../tts/bank-lines.txt', import.meta.url));
/** The committed clips. */
export const TTS_BANK_DIR = fileURLToPath(new URL('../../tts/bank', import.meta.url));
/** Generated (non-bank) lines one room may buy before it falls back to the browser voice. */
export const DEFAULT_SESSION_LINES = 15;
const OUTPUT_FORMAT = 'mp3_44100_64';
const TIMEOUT_MS = 10_000;

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

/** Every line the bank should hold: the scripted partner's banked lines first, then the generic file. */
export function bankLines(file: string = TTS_BANK_FILE): string[] {
  return parseBank([...bankedScriptLines(), ...loadBank(file)].join('\n'));
}

/** File name of a banked line: from its normalized text only, so any spelling of it finds the clip. */
export const bankFileName = (text: string) => `${createHash('sha256').update(normalizeLine(text)).digest('hex').slice(0, 24)}.mp3`;

/** Env TTS_SESSION_LINES: a whole number from 0 up, else the default. */
export function parseSessionLines(value: string | undefined): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : DEFAULT_SESSION_LINES;
}

export interface TtsOptions {
  /** Without a key only cached clips can be served. */
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  cacheDir?: string;
  /** Where the committed clips are. */
  bankDir?: string;
  /** Generated lines allowed per session (bank and cache hits are free and do not count). */
  sessionLines?: number;
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
   */
  speak(text: string, session: string, opts?: { cacheOnly?: boolean }): Promise<SpeakResult | null>;
  /**
   * Make sure a line is in the bank (the tts:bank script). 'banked' = already there,
   * 'copied' = taken from the local cache for free, 'new' = bought from the API.
   */
  bank(text: string): Promise<'banked' | 'copied' | 'new' | null>;
  /** Characters sent to ElevenLabs since the server started. */
  readonly totalChars: number;
  /** Clips in the bank directory. */
  readonly bankSize: number;
}

export function createTts(opts: TtsOptions = {}): Tts {
  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  const modelId = opts.modelId || DEFAULT_TTS_MODEL;
  const dir = opts.cacheDir ?? TTS_CACHE_DIR;
  const bankDir = opts.bankDir ?? TTS_BANK_DIR;
  const cap = opts.sessionLines ?? DEFAULT_SESSION_LINES;
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? ((line: string) => console.info(line));
  const inFlight = new Map<string, Promise<Buffer | null>>();
  const sessionChars = new Map<string, number>();
  const sessionLines = new Map<string, number>();
  let totalChars = 0;

  const fileFor = (text: string) => join(dir, `${createHash('sha256').update(`${voiceId}\n${modelId}\n${text}`).digest('hex')}.mp3`);
  const bankFor = (text: string) => join(bankDir, bankFileName(text));

  async function generate(text: string, file: string, session: string): Promise<Buffer | null> {
    try {
      const used = (sessionChars.get(session) ?? 0) + text.length;
      sessionChars.set(session, used);
      totalChars += text.length;
      log(`[tts ${session}] ${text.length} chars to ElevenLabs (${modelId}); session ${used}, total since start ${totalChars}`);
      const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey!, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: modelId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[tts ${session}] ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
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
      return existsSync(bankDir) ? readdirSync(bankDir).filter((f) => f.endsWith('.mp3')).length : 0;
    },
    async speak(text, session, { cacheOnly = false } = {}) {
      // The committed bank first: it is always there, whatever the voice settings are now.
      const banked = bankFor(text);
      if (existsSync(banked)) return { audio: readFileSync(banked), source: 'bank' };
      const file = fileFor(text);
      if (existsSync(file)) return { audio: readFileSync(file), source: 'cache' };
      if (cacheOnly || !opts.apiKey) return null;
      let job = inFlight.get(file);
      if (!job) {
        const bought = sessionLines.get(session) ?? 0;
        if (bought >= cap) {
          if (bought === cap) log(`[tts ${session}] ${cap} generated lines used: the browser voice takes over for this session`);
          sessionLines.set(session, bought + 1);
          return null;
        }
        sessionLines.set(session, bought + 1);
        job = generate(text, file, session).finally(() => inFlight.delete(file));
        inFlight.set(file, job);
      }
      const audio = await job;
      return audio ? { audio, source: 'api' } : null;
    },
    async bank(text) {
      const file = bankFor(text);
      if (existsSync(file)) return 'banked';
      mkdirSync(bankDir, { recursive: true });
      const cached = fileFor(text);
      if (existsSync(cached)) {
        writeFileSync(file, readFileSync(cached));
        return 'copied';
      }
      if (!opts.apiKey) return null;
      return (await generate(text, file, 'bank')) ? 'new' : null;
    },
  };
}
