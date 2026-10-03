import {
  CHAT_MAX_LEN,
  chooseGoal,
  leashAllows,
  leashBroken,
  newMemory,
  observe,
  parseAction,
  planAction,
  remember,
  stepPose,
  type BotAction,
  type BotStep,
  type ChatMessage,
  type GameEvent,
  type GameState,
  type Observation,
  type Side,
} from '@cubic/shared';
import type { Room } from '../rooms';
import type { Brain } from './gemini';
import { MAX_SAY_CHARS, idleHint, turnPrompt } from './prompt';

// The AI partner. Gemini is the brain, this is the nervous system: it shows the brain what
// its own side can see, validates the reply, and walks the chosen action one step at a
// time through the same Room methods a human's socket uses. It also keeps the body on a
// leash: whatever the brain asks for, it never walks more than one face from the human.

export interface AiOptions {
  /** Minimum time between Gemini calls for this room. */
  minThinkMs?: number;
  /** Think this often when something might have changed. */
  idleMs?: number;
  /** Walking speed: one step per this many ms. */
  stepMs?: number;
  /** Give up on a Gemini call after this long. */
  timeoutMs?: number;
  /** First back-off after a failed call; doubles per failure in a row, up to a minute. */
  backoffMs?: number;
  /** The human has neither moved nor spoken for this long: suggest the next goal. */
  idleHintMs?: number;
  /** Answers a turn when the brain fails (429, 503, timeout, bad JSON), so the game never stalls. */
  fallback?: Brain;
  /** Called with each line the AI says (for speech). */
  onSay?: (msg: ChatMessage) => void;
  log?: (line: string) => void;
}

export const FALLBACK_LINE = 'Give me a sec...';
const FALLBACK_EVERY_MS = 20_000;
/** After a failed call, wait this long before the next one, doubling up to the max. */
const BACKOFF_MS = 6000;
const BACKOFF_MAX_MS = 60_000;
const EVENTS_KEPT = 8;
/** Human idle time before the AI suggests the next goal. */
const IDLE_HINT_MS = 20_000;

export interface ParsedReply {
  say: string | null;
  action: BotAction | null;
}

/** Cut a line to the say limit, at a word boundary when there is one. */
export function clip(text: string, max = Math.min(MAX_SAY_CHARS, CHAT_MAX_LEN)): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '');
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
  const say = typeof r.say === 'string' && r.say.trim() ? clip(r.say.trim()) : null;
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
  private lastFallbackAt = 0;
  /** No Gemini call before this time (rate limit + back-off after errors). */
  private nextThinkAt = 0;
  private failures = 0;
  /** Something happened since the last think. */
  private stale = true;
  private lastSeen = '';
  private stopped = false;
  private stepTimer: NodeJS.Timeout;
  private thinkTimer: NodeJS.Timeout;
  private wakeTimer: NodeJS.Timeout | null = null;
  private abort: AbortController | null = null;
  /** What this side has seen so far, and where the voice says the partner is. */
  private memory = newMemory();
  private memoryOf: GameState;
  private idleTimer: NodeJS.Timeout | null = null;
  /** The human went quiet: the next turn suggests the next goal. */
  private hintDue = false;
  /** The hint line for the turn being answered, until something has been said. */
  private hint: string | null = null;
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
    this.minThinkMs = opts.minThinkMs ?? 6000;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.memoryOf = room.state;
    room.sit(side, true);
    this.unlisten = room.listen({
      onChat: (msg) => {
        if (msg.from === side) return;
        this.humanActed();
        this.wake();
      },
      onState: (u) => {
        this.look(); // the voice signal changes as either of us walks
        if (u.events.some((e) => 'side' in e && e.side !== side)) this.humanActed();
        this.notice(u.events);
      },
      onClosed: () => this.stop(),
    });
    this.stepTimer = setInterval(() => this.step(), opts.stepMs ?? 200);
    this.thinkTimer = setInterval(() => this.maybeThink(), opts.idleMs ?? 8000);
    this.stepTimer.unref();
    this.thinkTimer.unref();
    this.humanActed();
    this.wake();
  }

  /** Look around: this side's observation, folded into what it remembers. */
  private look(): Observation {
    if (this.memoryOf !== this.room.state) {
      this.memoryOf = this.room.state; // a new game: forget the old cube
      this.memory = newMemory();
    }
    const observation = observe(this.room.state, this.side);
    this.memory = remember(this.memory, observation);
    return observation;
  }

  /** The human moved or spoke: start the idle clock again. Only the fact is used, never where they are. */
  private humanActed(): void {
    this.hintDue = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stopped) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.hintDue = true;
      this.wake();
    }, this.opts.idleHintMs ?? IDLE_HINT_MS);
    this.idleTimer.unref();
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

  /**
   * Think as soon as the rate limit allows. At most one wake-up is ever pending: more
   * triggers in the meantime are folded into it, never queued. Until then the body keeps
   * doing its current action.
   */
  private wake(): void {
    this.stale = true;
    if (this.wakeTimer || this.stopped) return;
    const wait = Math.max(0, this.nextThinkAt - Date.now());
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
    const from = this.room.state.players[this.side].pose;
    if (next !== 'interact') {
      // The leash, checked again at every edge: the partner may have moved since the plan.
      const to = stepPose(from, next[0], next[1]).pose.face;
      if (to !== from.face && !leashAllows(this.look(), this.memory, to)) {
        this.queue = [];
        return this.finish(`stopped at the edge: face ${to} is more than one face away from your partner`);
      }
    }
    const events = next === 'interact' ? this.room.interact(this.side) : this.room.move(this.side, next[0], next[1]);
    if (events.some((e) => e.type === 'bump')) {
      this.queue = [];
      this.finish('blocked: you bumped into something and stopped');
    } else if (events.some((e) => e.type === 'flip') && leashBroken(this.look())) {
      // Walked out of earshot (the partner was not where the voice suggested): come straight back.
      const back = planAction(this.room.state, this.side, { type: 'go_face', face: from.face });
      this.queue = 'steps' in back ? back.steps : [];
      this.doing = `${this.doing ?? 'action'} stopped: you walked out of earshot of your partner. Turning back`;
      if (this.queue.length === 0) this.finish('could not');
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
    if (Date.now() < this.nextThinkAt) return this.wake();
    const observation = this.look();
    // Nothing new to react to: do not spend a call.
    const seen = JSON.stringify(observation) + this.room.chat.length;
    if (!this.stale && seen === this.lastSeen) return;
    this.lastSeen = seen;
    this.stale = false;

    this.thinking = true;
    this.nextThinkAt = Date.now() + this.minThinkMs;
    this.room.setTyping(this.side, true);
    const goal = chooseGoal(observation, this.memory);
    this.hint = this.hintDue ? idleHint(goal) : null;
    const turn = turnPrompt({
      side: this.side,
      observation,
      recentEvents: this.events,
      chat: this.room.chat,
      lastActionResult: this.lastResult,
      busy: this.doing,
      goal,
      partnerIdle: this.hintDue,
    });
    this.hintDue = false;
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
        await this.fallback(turn);
      } else {
        this.failures = 0;
        this.act(parsed);
      }
    } catch (e) {
      // 429, 503, network, timeout: back off, and let the scripted partner take this turn.
      this.failures++;
      const backoff = Math.min(BACKOFF_MAX_MS, (this.opts.backoffMs ?? BACKOFF_MS) * 2 ** (this.failures - 1));
      this.nextThinkAt = Date.now() + Math.max(this.minThinkMs, backoff);
      this.log(`gemini error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)} (backing off ${Math.round(backoff / 1000)}s)`);
      if (!this.stopped) await this.fallback(turn);
    } finally {
      clearTimeout(timeout);
      this.thinking = false;
      if (!this.stopped) this.room.setTyping(this.side, false);
    }
  }

  private async fallback(turn: string): Promise<void> {
    if (this.opts.fallback) {
      try {
        const parsed = parseReply((await this.opts.fallback.think(turn, new AbortController().signal)).text);
        if (parsed && !this.stopped) return this.act(parsed);
      } catch {
        // fall through to the plain line
      }
    }
    if (this.stopped) return;
    if (this.hint) return this.speak(this.hint);
    if (Date.now() - this.lastFallbackAt < FALLBACK_EVERY_MS) return;
    this.lastFallbackAt = Date.now();
    this.speak(FALLBACK_LINE);
  }

  private speak(text: string): void {
    this.hint = null;
    const msg = this.room.say(this.side, text);
    if (msg) this.opts.onSay?.(msg);
  }

  private act(reply: ParsedReply): void {
    // A brain that stays quiet on an idle turn still gets the hint said for it.
    const say = reply.say ?? this.hint;
    if (say) this.speak(say);
    if (!reply.action) return;
    const observation = this.look();
    const plan = planAction(this.room.state, this.side, reply.action, undefined, (face) => leashAllows(observation, this.memory, face));
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
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.abort?.abort();
    this.unlisten();
    this.log(`stopped after ${this.calls} calls, tokens in=${this.tokens.input} out=${this.tokens.output}`);
  }
}
