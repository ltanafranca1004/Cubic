import { CHAT_MAX_LEN, observe, parseAction, planAction, type BotAction, type BotStep, type ChatMessage, type GameEvent, type Side } from '@cubic/shared';
import type { Room } from '../rooms';
import type { Brain } from './gemini';
import { turnPrompt } from './prompt';

// The AI partner. Gemini is the brain, this is the nervous system: it shows the brain what
// its own side can see, validates the reply, and walks the chosen action one step at a
// time through the same Room methods a human's socket uses.

export interface AiOptions {
  /** Minimum time between Gemini calls for this room. */
  minThinkMs?: number;
  /** Think this often when something might have changed. */
  idleMs?: number;
  /** Walking speed: one step per this many ms. */
  stepMs?: number;
  /** Give up on a Gemini call after this long. */
  timeoutMs?: number;
  /** Called with each line the AI says (for speech). */
  onSay?: (msg: ChatMessage) => void;
  log?: (line: string) => void;
}

export const FALLBACK_LINE = 'Give me a sec...';
const FALLBACK_EVERY_MS = 20_000;
const MAX_SAY = 140;
const EVENTS_KEPT = 8;

export interface ParsedReply {
  say: string | null;
  action: BotAction | null;
}

/** Validate the model's JSON. Returns null when it is not usable at all. */
export function parseReply(text: string): ParsedReply | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!('say' in r) && !('action' in r)) return null;
  if (r.say != null && typeof r.say !== 'string') return null;
  const say = typeof r.say === 'string' && r.say.trim() ? r.say.trim().slice(0, Math.min(MAX_SAY, CHAT_MAX_LEN)) : null;
  const action = r.action == null ? null : parseAction(r.action);
  if (r.action != null && !action) return say ? { say, action: null } : null; // bad action: keep the words
  return { say, action };
}

export class AiPlayer {
  private queue: BotStep[] = [];
  private doing: string | null = null;
  private events: string[] = [];
  private lastResult: string | null = null;
  private thinking = false;
  private lastThinkAt = 0;
  private lastFallbackAt = 0;
  /** Something happened since the last think. */
  private stale = true;
  private lastSeen = '';
  private stopped = false;
  private stepTimer: NodeJS.Timeout;
  private thinkTimer: NodeJS.Timeout;
  private wakeTimer: NodeJS.Timeout | null = null;
  private abort: AbortController | null = null;
  private unlisten: () => void;
  /** Stats, for logs and tests. */
  calls = 0;
  tokens = { input: 0, output: 0 };

  private readonly minThinkMs: number;
  private readonly timeoutMs: number;

  constructor(
    private room: Room,
    readonly side: Side,
    private brain: Brain,
    private opts: AiOptions = {},
  ) {
    this.minThinkMs = opts.minThinkMs ?? 3000;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    room.sit(side, true);
    this.unlisten = room.listen({
      onChat: (msg) => {
        if (msg.from !== side) this.wake();
      },
      onState: (u) => this.notice(u.events),
      onClosed: () => this.stop(),
    });
    this.stepTimer = setInterval(() => this.step(), opts.stepMs ?? 200);
    this.thinkTimer = setInterval(() => this.maybeThink(), opts.idleMs ?? 8000);
    this.stepTimer.unref();
    this.thinkTimer.unref();
    this.wake();
  }

  private log(line: string): void {
    (this.opts.log ?? console.log)(`[ai ${this.room.code}] ${line}`);
  }

  /** Only what this side could notice: its own body, and things announced to both. */
  private notice(events: GameEvent[]): void {
    let news = false;
    for (const e of events) {
      if ('side' in e && e.side !== this.side) continue;
      if (e.type === 'step' || e.type === 'flip') continue;
      const text =
        e.type === 'bump'
          ? 'you bumped into something'
          : e.type === 'solve'
            ? `face ${e.face} was solved`
            : e.type === 'win'
              ? 'you both escaped: the game is won'
              : e.type === 'strike'
                ? 'you got a strike'
                : e.type === 'puzzle'
                  ? `something happened: ${e.name}`
                  : e.type === 'pickup'
                    ? 'you picked something up'
                    : e.type === 'drop'
                      ? 'you put something down'
                      : e.type === 'place'
                        ? 'you placed the item on a target'
                        : e.type;
      this.events.push(text);
      if (e.type !== 'bump') news = true;
    }
    this.events = this.events.slice(-EVENTS_KEPT);
    if (news) this.wake();
  }

  /** Think soon (as soon as the rate limit allows). */
  private wake(): void {
    this.stale = true;
    if (this.wakeTimer || this.stopped) return;
    const wait = Math.max(0, this.lastThinkAt + this.minThinkMs - Date.now());
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.maybeThink();
    }, wait + 20);
    this.wakeTimer.unref();
  }

  private step(): void {
    if (this.stopped || this.room.state.wonAt !== null) return;
    const next = this.queue.shift();
    if (!next) return;
    const events = next === 'interact' ? this.room.interact(this.side) : this.room.move(this.side, next[0], next[1]);
    if (events.some((e) => e.type === 'bump')) {
      this.queue = [];
      this.finish('blocked: you bumped into something and stopped');
    } else if (this.queue.length === 0) this.finish('done');
  }

  private finish(result: string): void {
    this.lastResult = `${this.doing ?? 'action'}: ${result}`;
    this.doing = null;
    this.wake();
  }

  private async maybeThink(): Promise<void> {
    if (this.stopped || this.thinking || this.room.state.wonAt !== null) return;
    if (!this.room.isConnected(this.side === 'out' ? 'in' : 'out')) return; // nobody to play with
    if (Date.now() - this.lastThinkAt < this.minThinkMs) return this.wake();
    const observation = observe(this.room.state, this.side);
    // Nothing new to react to: do not spend a call.
    const seen = JSON.stringify(observation) + this.room.chat.length;
    if (!this.stale && seen === this.lastSeen) return;
    this.lastSeen = seen;
    this.stale = false;

    this.thinking = true;
    this.lastThinkAt = Date.now();
    this.room.setTyping(this.side, true);
    const turn = turnPrompt({ side: this.side, observation, recentEvents: this.events, chat: this.room.chat, lastActionResult: this.lastResult, busy: this.doing });
    this.events = [];
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), this.timeoutMs);
    try {
      this.calls++;
      const reply = await Promise.race([
        this.brain.think(turn, this.abort.signal),
        new Promise<never>((_, no) => this.abort!.signal.addEventListener('abort', () => no(new Error('timed out')))),
      ]);
      if (reply.tokens) {
        this.tokens.input += reply.tokens.input;
        this.tokens.output += reply.tokens.output;
        this.log(`tokens in=${reply.tokens.input} out=${reply.tokens.output} (total in=${this.tokens.input} out=${this.tokens.output}, calls=${this.calls})`);
      }
      if (this.stopped) return;
      const parsed = parseReply(reply.text);
      if (!parsed) {
        this.log(`unusable reply: ${reply.text.slice(0, 120)}`);
        this.fallback();
      } else this.act(parsed);
    } catch (e) {
      this.log(`gemini error: ${e instanceof Error ? e.message : String(e)}`);
      if (!this.stopped) this.fallback();
    } finally {
      clearTimeout(timeout);
      this.thinking = false;
      if (!this.stopped) this.room.setTyping(this.side, false);
    }
  }

  private fallback(): void {
    if (Date.now() - this.lastFallbackAt < FALLBACK_EVERY_MS) return;
    this.lastFallbackAt = Date.now();
    this.speak(FALLBACK_LINE);
  }

  private speak(text: string): void {
    const msg = this.room.say(this.side, text);
    if (msg) this.opts.onSay?.(msg);
  }

  private act(reply: ParsedReply): void {
    if (reply.say) this.speak(reply.say);
    if (!reply.action) return;
    const plan = planAction(this.room.state, this.side, reply.action);
    const label = JSON.stringify(reply.action);
    if ('error' in plan) {
      this.queue = [];
      this.doing = null;
      this.lastResult = `${label}: could not do it, ${plan.error}`;
      this.wake();
      return;
    }
    this.queue = plan.steps;
    this.doing = plan.steps.length ? label : null;
    if (plan.steps.length === 0) this.lastResult = `${label}: done`;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.stepTimer);
    clearInterval(this.thinkTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.abort?.abort();
    this.unlisten();
    this.log(`stopped after ${this.calls} calls, tokens in=${this.tokens.input} out=${this.tokens.output}`);
  }
}
