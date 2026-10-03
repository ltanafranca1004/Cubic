import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The AI partner's voice: ElevenLabs text-to-speech, kept cheap.
//  1. Every clip is cached on disk (server/.tts-cache), keyed by voice + model + text.
//     The cache is checked before every API call.
//  2. A voice bank of common lines (server/tts/bank-lines.txt) is pre-generated with
//     `npm run tts:bank -w server`. A line that matches a bank line, ignoring case and
//     punctuation, plays the banked clip.
//  3. Characters actually sent to ElevenLabs are logged per session and in total.
// API: POST /v1/text-to-speech/{voice_id}
// (https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

/** Stock "Rachel" voice. Override with ELEVENLABS_VOICE_ID. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
/** Flash v2.5: half the per-character price of the standard models, low latency. */
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
export const TTS_CACHE_DIR = fileURLToPath(new URL('../../.tts-cache', import.meta.url));
export const TTS_BANK_FILE = fileURLToPath(new URL('../../tts/bank-lines.txt', import.meta.url));
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

export interface TtsOptions {
  /** Without a key only cached clips can be served. */
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  cacheDir?: string;
  bank?: string[];
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
  /** Characters sent to ElevenLabs since the server started. */
  readonly totalChars: number;
  readonly bankSize: number;
}

export function createTts(opts: TtsOptions = {}): Tts {
  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  const modelId = opts.modelId || DEFAULT_TTS_MODEL;
  const dir = opts.cacheDir ?? TTS_CACHE_DIR;
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? ((line: string) => console.info(line));
  const bank = new Map((opts.bank ?? loadBank()).map((line) => [normalizeLine(line), line]));
  const inFlight = new Map<string, Promise<Buffer | null>>();
  const sessionChars = new Map<string, number>();
  let totalChars = 0;

  const fileFor = (text: string) => join(dir, `${createHash('sha256').update(`${voiceId}\n${modelId}\n${text}`).digest('hex')}.mp3`);

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
      mkdirSync(dir, { recursive: true });
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
    bankSize: bank.size,
    async speak(text, session, { cacheOnly = false } = {}) {
      const banked = bank.get(normalizeLine(text));
      // A banked line is always spoken with the bank's own wording, so it shares one clip.
      const spoken = banked ?? text;
      const file = fileFor(spoken);
      if (existsSync(file)) return { audio: readFileSync(file), source: banked ? 'bank' : 'cache' };
      if (cacheOnly || !opts.apiKey) return null;
      let job = inFlight.get(file);
      if (!job) {
        job = generate(spoken, file, session).finally(() => inFlight.delete(file));
        inFlight.set(file, job);
      }
      const audio = await job;
      return audio ? { audio, source: 'api' } : null;
    },
  };
}
