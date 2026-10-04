import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// What the AI partner may spend, for the whole server. Both APIs are on small plans that
// every solo room shares, so every call asks here first and is refused rather than queued:
// a refused Gemini call means the scripted line is said, a refused ElevenLabs call means
// the browser voice reads the line. Nothing here ever retries.
//
//  Gemini:      GEMINI_ENABLED (kill switch), 8 calls a minute and GEMINI_DAILY_CAP calls a
//               day over all rooms, 25 calls per game, and a 10 minute pause after a 429.
//  ElevenLabs:  ELEVENLABS_ENABLED (kill switch), 5 bought lines per game and
//               ELEVENLABS_DAILY_CHARS characters a day over all rooms.
//
// The daily counters are kept in a small JSON file so a restart within the same UTC day
// does not hand out a second allowance. A disk that cannot be read or written (or is wiped
// by the host, as on Render's free plan) falls back to memory. They reset at UTC midnight.

export const GEMINI_PER_MINUTE = 8;
export const GEMINI_PER_GAME = 25;
export const DEFAULT_GEMINI_DAILY_CAP = 200;
export const GEMINI_PAUSE_MS = 10 * 60_000;
export const ELEVEN_PER_GAME = 5;
export const DEFAULT_ELEVEN_DAILY_CHARS = 2000;
/** The same fallback reason is logged at most this often (with how many it stands for). */
export const FALLBACK_LOG_MS = 60_000;
/** Gitignored. The daily counters of both APIs. */
export const USAGE_FILE = fileURLToPath(new URL('../../.data/usage.json', import.meta.url));

/** Why Gemini is asked: the only four events that may cost a call. */
export type GeminiReason = 'chat' | 'solved' | 'strike' | 'stuck';
/** Why a call was not made. */
export type Refusal = 'disabled' | 'paused_429' | 'minute_cap' | 'day_cap' | 'game_cap';

/** An on/off env var: only "false", "0", "off" and "no" turn it off. */
export const parseEnabled = (value: string | undefined): boolean => !['false', '0', 'off', 'no'].includes((value ?? '').trim().toLowerCase());

/** A cap from the env: a whole number from 0 up, else the default. */
export function parseCap(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** The UTC day of a time, e.g. "2026-10-04". */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Today's totals. Read-only: what Luis reports. */
export interface UsageSummary {
  day: string;
  geminiCalls: number;
  tokensIn: number;
  tokensOut: number;
  elevenCalls: number;
  elevenChars: number;
}

export interface BudgetOptions {
  geminiEnabled?: boolean;
  geminiDailyCap?: number;
  elevenEnabled?: boolean;
  elevenDailyChars?: number;
  /** Where the daily counters are kept. null = memory only. */
  file?: string | null;
  now?: () => number;
  log?: (line: string) => void;
}

const fresh = (day: string): UsageSummary => ({ day, geminiCalls: 0, tokensIn: 0, tokensOut: 0, elevenCalls: 0, elevenChars: 0 });
const COUNTERS = ['geminiCalls', 'tokensIn', 'tokensOut', 'elevenCalls', 'elevenChars'] as const;

export class Budget {
  readonly geminiEnabled: boolean;
  readonly elevenEnabled: boolean;
  readonly geminiDailyCap: number;
  readonly elevenDailyChars: number;
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private usage: UsageSummary;
  /** Times of the Gemini calls of the last minute, all rooms. */
  private minute: number[] = [];
  private pausedUntil = 0;
  private games = new Map<string, { gemini: number; eleven: number }>();
  private fallbacks = new Map<string, { at: number; hidden: number }>();
  private reported = '';
  private diskOk = true;

  constructor(opts: BudgetOptions = {}) {
    this.geminiEnabled = opts.geminiEnabled ?? true;
    this.elevenEnabled = opts.elevenEnabled ?? true;
    this.geminiDailyCap = opts.geminiDailyCap ?? DEFAULT_GEMINI_DAILY_CAP;
    this.elevenDailyChars = opts.elevenDailyChars ?? DEFAULT_ELEVEN_DAILY_CHARS;
    this.file = opts.file === undefined ? null : opts.file;
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? ((line) => console.log(line));
    this.usage = this.load();
    this.reported = JSON.stringify(this.usage);
  }

  /** The budget the env asks for (see server/.env.example). */
  static fromEnv(env: Record<string, string | undefined>, opts: BudgetOptions = {}): Budget {
    return new Budget({
      geminiEnabled: parseEnabled(env.GEMINI_ENABLED),
      geminiDailyCap: parseCap(env.GEMINI_DAILY_CAP, DEFAULT_GEMINI_DAILY_CAP),
      elevenEnabled: parseEnabled(env.ELEVENLABS_ENABLED),
      elevenDailyChars: parseCap(env.ELEVENLABS_DAILY_CHARS, DEFAULT_ELEVEN_DAILY_CHARS),
      file: USAGE_FILE,
      ...opts,
    });
  }

  private load(): UsageSummary {
    const today = fresh(utcDay(this.now()));
    if (!this.file) return today;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      if (saved.day !== today.day) return today;
      for (const k of COUNTERS) if (Number.isSafeInteger(saved[k]) && (saved[k] as number) >= 0) today[k] = saved[k] as number;
    } catch {
      // no file yet, or not ours: start the day at zero
    }
    return today;
  }

  private save(): void {
    if (!this.file || !this.diskOk) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.usage)}\n`);
    } catch (e) {
      this.diskOk = false; // a read-only disk: count in memory, and say so once
      this.log(`[budget] cannot write ${this.file} (${e instanceof Error ? e.message : String(e)}): the daily counters are kept in memory only`);
    }
  }

  /** Today's counters: a new UTC day starts from zero. */
  private today(): UsageSummary {
    const day = utcDay(this.now());
    if (this.usage.day !== day) {
      this.usage = fresh(day);
      this.save();
    }
    return this.usage;
  }

  private game(room: string) {
    let g = this.games.get(room);
    if (!g) this.games.set(room, (g = { gemini: 0, eleven: 0 }));
    return g;
  }

  /** A new game in this room: its per-game allowances start again. */
  newGame(room: string): void {
    this.games.set(room, { gemini: 0, eleven: 0 });
  }

  /** The room is gone. */
  endRoom(room: string): void {
    this.games.delete(room);
  }

  private minuteCalls(now: number): number {
    this.minute = this.minute.filter((t) => now - t < 60_000);
    return this.minute.length;
  }

  /** One line per refused call, but the same reason at most once a minute. */
  private refuse(api: 'gemini' | 'eleven', room: string, why: Refusal, detail: string): Refusal {
    const key = `${api} ${why}`;
    const now = this.now();
    const f = this.fallbacks.get(key);
    if (f && now - f.at < FALLBACK_LOG_MS) f.hidden++;
    else {
      this.log(`[${api}] fallback room=${room} ${detail} why=${why}${f?.hidden ? ` more=${f.hidden}` : ''}`);
      this.fallbacks.set(key, { at: now, hidden: 0 });
    }
    return why;
  }

  /**
   * May this room call Gemini now? null = yes, and the call is counted from this moment
   * (whether it then succeeds or not). Otherwise why not: the caller says the scripted line.
   */
  gemini(room: string, reason: GeminiReason): Refusal | null {
    const now = this.now();
    const u = this.today();
    const g = this.game(room);
    const why: Refusal | null = !this.geminiEnabled
      ? 'disabled'
      : now < this.pausedUntil
        ? 'paused_429'
        : g.gemini >= GEMINI_PER_GAME
          ? 'game_cap'
          : u.geminiCalls >= this.geminiDailyCap
            ? 'day_cap'
            : this.minuteCalls(now) >= GEMINI_PER_MINUTE
              ? 'minute_cap'
              : null;
    if (why) return this.refuse('gemini', room, why, `reason=${reason}`);
    u.geminiCalls++;
    g.gemini++;
    this.minute.push(now);
    this.save();
    return null;
  }

  /** The call that gemini() allowed is over: count its tokens and write the one log line. */
  geminiDone(room: string, reason: GeminiReason, tokens: { input: number; output: number } | undefined, error?: string): void {
    const u = this.today();
    u.tokensIn += tokens?.input ?? 0;
    u.tokensOut += tokens?.output ?? 0;
    this.save();
    this.log(
      `[gemini] room=${room} reason=${reason} in=${tokens?.input ?? 0} out=${tokens?.output ?? 0} day=${u.geminiCalls}/${this.geminiDailyCap} min=${this.minuteCalls(this.now())}/${GEMINI_PER_MINUTE} game=${this.game(room).gemini}/${GEMINI_PER_GAME}${error ? ` error=${error}` : ''}`,
    );
  }

  /** Gemini answered 429: nobody calls it for ten minutes. */
  geminiQuota(room: string): void {
    this.pausedUntil = this.now() + GEMINI_PAUSE_MS;
    this.log(`[gemini] 429 room=${room}: no Gemini calls for ${GEMINI_PAUSE_MS / 60_000} minutes, on the whole server`);
  }

  /** May this room buy `chars` characters of speech now? null = yes (counted, logged). */
  eleven(room: string, chars: number): Refusal | null {
    const u = this.today();
    const g = this.game(room);
    const why: Refusal | null = !this.elevenEnabled ? 'disabled' : g.eleven >= ELEVEN_PER_GAME ? 'game_cap' : u.elevenChars + chars > this.elevenDailyChars ? 'day_cap' : null;
    if (why) return this.refuse('eleven', room, why, `chars=${chars}`);
    u.elevenCalls++;
    u.elevenChars += chars;
    g.eleven++;
    this.save();
    this.log(`[eleven] room=${room} chars=${chars} day=${u.elevenChars}/${this.elevenDailyChars} game=${g.eleven}/${ELEVEN_PER_GAME}`);
    return null;
  }

  /** Today's totals. */
  summary(): UsageSummary {
    return { ...this.today() };
  }

  summaryLine(): string {
    const u = this.today();
    return `[usage] day=${u.day} gemini_calls=${u.geminiCalls}/${this.geminiDailyCap} tokens_in=${u.tokensIn} tokens_out=${u.tokensOut} eleven_calls=${u.elevenCalls} eleven_chars=${u.elevenChars}/${this.elevenDailyChars}`;
  }

  /** The summary line if anything changed since the last report (the hourly log), else null. */
  report(): string | null {
    const now = JSON.stringify(this.today());
    if (now === this.reported) return null;
    this.reported = now;
    return this.summaryLine();
  }
}
