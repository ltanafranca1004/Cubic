import {
  CHAT_MAX_LEN,
  canonToScreen,
  decide,
  hazardAvoid,
  newMind,
  nextStep,
  observe,
  parseAction,
  parseHuman,
  planAction,
  stepPose,
  type BotAction,
  type BotStep,
  type ChatMessage,
  type Decision,
  type GameState,
  type Heard,
  type PuzzleScript,
  type Say,
  type Side,
} from '@cubic/shared';
import type { Room } from '../rooms';
import type { Brain } from './gemini';
import { MAX_SAY_CHARS, turnPrompt, type Persona } from './prompt';
import { lineText } from './scripted';

// The AI partner. Two parts:
//
//  - THE SCRIPT (shared/src/bot/partner.ts) drives. Every step (200 ms) it looks at what
//    its own side can see and what the human typed, and decides what to say and where the
//    body walks, through the same Room methods a human's socket uses. It needs no API.
//  - GEMINI advises, when there is a key. It rewords small talk, answers free-form chat,
//    turns it into the protocol words the script understands ("heard"), and may suggest a
//    move, which is only walked if the script calls it safe.
//
// The body never waits for Gemini. A call that takes longer than 3 s, fails, or would
// break the rate limit (one call per 6 s per room, no backlog) is dropped and the script's
// own line is said instead. Without a key there is no advisor at all.

export interface AiOptions {
  persona?: Persona;
  /** The puzzle scripts it plays with (default: the registry in shared/src/bot/scripts). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scripts?: readonly PuzzleScript<any>[];
  /** Walking speed: one decision and one step per this many ms. */
  stepMs?: number;
  /** Minimum time between Gemini calls for this room. */
  minThinkMs?: number;
  /** Give up on a Gemini call after this long: the script's line is used. */
  timeoutMs?: number;
  /** First back-off after a failed call; doubles per failure in a row, up to a minute. */
  backoffMs?: number;
  /**
   * Called with each line the AI says (for speech). `scripted` = one of the script's own
   * lines, not a model's; `line` = which one (its key and relay args), when it is said as written.
   */
  onSay?: (msg: ChatMessage, info: { scripted: boolean; line?: Say }) => void;
  log?: (line: string) => void;
}

const STEP_MS = 200;
const MIN_THINK_MS = 6000;
const TIMEOUT_MS = 3000;
const BACKOFF_MS = 6000;
const BACKOFF_MAX_MS = 60_000;
/** "I did not get that" at most this often. */
const HUH_EVERY_MS = 8000;
const OUTBOX_MAX = 6;
/** An AI whose own code has thrown this many times is stopped: it is broken, not unlucky. */
const MAX_FAULTS = 3;
/** Time between two of its lines, so each one can be heard and read (one caption shows at a time). */
const LINE_GAP_MS = 1500;

export interface ParsedReply {
  say: string | null;
  /** The human's message in protocol words, as the model read it. */
  heard: string | null;
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
  if (!('say' in r) && !('action' in r) && !('heard' in r)) return null;
  if (r.say != null && typeof r.say !== 'string') return null;
  const say = typeof r.say === 'string' && r.say.trim() ? clip(r.say.replace(/\s*\u2014\s*/g, ', ').trim()) : null;
  const heard = typeof r.heard === 'string' && r.heard.trim() ? r.heard.trim().slice(0, 60) : null;
  const action = r.action == null ? null : parseAction(r.action);
  return { say, heard, action };
}

/** Moves a model may suggest. Never another face, never picking things up. */
const ADVICE_TYPES = new Set<BotAction['type']>(['goto', 'step_on', 'move', 'wait']);

/** Why a call was made: a small-talk line to reword, or a human message to read. */
type Ask = { kind: 'flavor'; line: string } | { kind: 'chat'; text: string; read: Heard };

export class AiPlayer {
  private mind = newMind();
  private mindOf: GameState;
  private lastChatId = 0;
  /** What the script hears on its next decision. */
  private heard: Heard[] = [];
  /** Lines waiting for the chat rate limit. */
  private outbox: { text: string; scripted: boolean; line?: Say }[] = [];
  /** A human message waiting for the next free Gemini slot. Only the latest is kept. */
  private pending: Extract<Ask, { kind: 'chat' }> | null = null;
  /** Steps a model suggested, walked only while the script has nothing to do. */
  private advice: BotStep[] = [];
  private last: Decision | null = null;
  private thinking = false;
  /** No Gemini call before this time (rate limit + back-off after errors). */
  private nextThinkAt = 0;
  private failures = 0;
  private lastHuhAt = -Infinity;
  private lastSaidAt = -Infinity;
  private stopped = false;
  /** Times this AI's own code has thrown (see fault). */
  private faults = 0;
  private timer: NodeJS.Timeout;
  private abort: AbortController | null = null;
  private unlisten: () => void;
  private readonly persona: Persona;
  private readonly minThinkMs: number;
  private readonly timeoutMs: number;
  /** Stats, for logs and tests. */
  calls = 0;
  tokens = { input: 0, output: 0 };
  stats = { answered: 0, timeouts: 0, errors: 0, scriptedLines: 0, modelLines: 0, refusedActions: 0 };

  constructor(
    private room: Room,
    readonly side: Side,
    /** Gemini, or null to play from the script alone (no key, AI_FAKE=1). */
    private advisor: Brain | null,
    private opts: AiOptions = {},
  ) {
    this.persona = opts.persona ?? 'default';
    this.minThinkMs = opts.minThinkMs ?? MIN_THINK_MS;
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.mindOf = room.state;
    room.sit(side, true);
    this.unlisten = room.listen({ onClosed: () => this.stop() });
    this.timer = setInterval(() => this.tick(), opts.stepMs ?? STEP_MS);
    this.timer.unref();
  }

  private log(line: string): void {
    (this.opts.log ?? console.log)(`[ai ${this.room.code}] ${line}`);
  }

  /** May Gemini be asked right now? */
  private free(now: number): boolean {
    return !!this.advisor && !this.thinking && now >= this.nextThinkAt;
  }

  /**
   * One decision and at most one step. Never throws: this runs in a timer, where a throw
   * would be an uncaught exception that ends the process and every room on the server.
   */
  private tick(): void {
    if (this.stopped) return;
    try {
      this.act();
    } catch (e) {
      this.fault('step', e);
    }
  }

  /** A throw costs this AI what it was doing. An AI that keeps throwing is stopped. */
  private fault(what: string, e: unknown): void {
    this.log(`error in ${what}: ${(e instanceof Error ? (e.stack ?? e.message) : String(e)).slice(0, 600)}`);
    this.advice = [];
    if (++this.faults >= MAX_FAULTS) this.stop();
  }

  /** Ask Gemini without waiting for it. A throw before the call is even made must not become an unhandled rejection. */
  private consult(ask: Ask, now: number): void {
    this.ask(ask, now).catch((e: unknown) => {
      this.thinking = false;
      this.fault('think', e);
      if (!this.stopped) this.scripted(ask);
    });
  }

  private act(): void {
    const { room, side } = this;
    const human: Side = side === 'out' ? 'in' : 'out';
    if (!room.isConnected(human)) return; // nobody to play with
    const now = Date.now();
    if (this.mindOf !== room.state) {
      // A new game in the same room: forget the old cube.
      this.mindOf = room.state;
      this.mind = newMind();
      this.advice = [];
    }

    // 1. Listen. Plain protocol words go straight to the script; anything else is for Gemini.
    // Every line reaches the script in the end, with its raw text (a script reads digits and
    // colours from Heard.text): only a line nobody could read gets "I did not get that".
    for (const m of room.chat) {
      if (m.id <= this.lastChatId) continue;
      this.lastChatId = m.id;
      if (m.from === side) continue;
      const read = parseHuman(m.text);
      if (read.plain) this.heard.push(read);
      else if (this.free(now)) this.consult({ kind: 'chat', text: m.text, read }, now);
      else if (read.tokens.length) this.heard.push(read);
      else if (this.advisor && this.failures === 0) this.pending = { kind: 'chat', text: m.text, read };
      else {
        this.heard.push(read);
        this.huh(now);
      }
    }
    if (this.pending && this.free(now)) {
      const ask = this.pending;
      this.pending = null;
      this.consult(ask, now);
    }

    // 2. Decide, from this side's own view only.
    const d = decide(this.mind, observe(room.state, side), this.heard.splice(0), now, this.opts.scripts);
    this.last = d;

    // 3. Talk. Protocol lines are said as written, now. Small talk may be reworded by Gemini.
    for (const s of d.say) {
      const text = lineText(this.persona, s.key, s.args);
      if (s.flavor && this.free(now)) this.consult({ kind: 'flavor', line: text }, now);
      else this.queue(text, true, s);
    }
    this.flush();

    // 4. Walk: the script's step, or a suggested one while the script stands idle.
    if (room.state.wonAt !== null) return;
    if (d.action || d.hold) this.advice = [];
    const step = d.action ? nextStep(room.state, side, d) : this.adviceStep(d);
    if (!step) return;
    const events = step === 'interact' ? room.interact(side) : room.move(side, step[0], step[1]);
    if (events.some((e) => e.type === 'bump')) this.advice = [];
  }

  /** The next suggested step, if it stays on this face and off every tile the script avoids. */
  private adviceStep(d: Decision): BotStep | null {
    const step = this.advice.shift();
    if (!step || step === 'interact') return null;
    const from = this.room.state.players[this.side].pose;
    const to = stepPose(from, step[0], step[1]).pose;
    const [col, row] = canonToScreen(this.side, to.face, to.up, to.x, to.y);
    if (to.face !== from.face || d.avoid.some((c) => c.col === col && c.row === row) || hazardAvoid(this.room.state, this.side)(to)) {
      this.advice = [];
      this.stats.refusedActions++;
      return null;
    }
    return step;
  }

  private queue(text: string, scripted: boolean, line?: Say): void {
    if (this.outbox.some((l) => l.text === text)) return;
    this.outbox.push(line ? { text, scripted, line } : { text, scripted });
    if (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
  }

  /** Say the next waiting line, one at a time, a beat apart. The rest goes on a later tick. */
  private flush(): void {
    const line = this.outbox[0];
    if (!line || Date.now() - this.lastSaidAt < LINE_GAP_MS) return;
    const msg = this.room.say(this.side, line.text);
    if (!msg) return; // the chat rate limit: try again next tick
    this.lastSaidAt = Date.now();
    this.outbox.shift();
    if (line.scripted) this.stats.scriptedLines++;
    else this.stats.modelLines++;
    this.opts.onSay?.(msg, line.line ? { scripted: line.scripted, line: line.line } : { scripted: line.scripted });
  }

  private huh(now: number): void {
    if (now - this.lastHuhAt < HUH_EVERY_MS) return;
    this.lastHuhAt = now;
    this.queue(lineText(this.persona, 'huh'), true);
  }

  /** The script's own answer to a turn Gemini did not take. */
  private scripted(ask: Ask): void {
    if (ask.kind === 'flavor') return this.queue(ask.line, true);
    this.heard.push(ask.read);
    if (!ask.read.tokens.length) this.huh(Date.now());
  }

  /** One Gemini call. The body keeps moving meanwhile; on any failure the script answers instead. */
  private async ask(ask: Ask, now: number): Promise<void> {
    const advisor = this.advisor!;
    this.thinking = true;
    this.nextThinkAt = now + this.minThinkMs;
    this.calls++;
    this.room.setTyping(this.side, true);
    const turn = turnPrompt({
      side: this.side,
      observation: observe(this.room.state, this.side),
      planner: this.last?.status ?? 'starting',
      scriptLine: ask.kind === 'flavor' ? ask.line : null,
      partnerSaid: ask.kind === 'chat' ? ask.text : null,
      chat: this.room.chat,
    });
    const abort = (this.abort = new AbortController());
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, this.timeoutMs);
    try {
      const reply = await Promise.race([advisor.think(turn, abort.signal), new Promise<never>((_, no) => abort.signal.addEventListener('abort', () => no(new Error('timed out'))))]);
      const took = Date.now() - now;
      if (reply.tokens) {
        this.tokens.input += reply.tokens.input;
        this.tokens.output += reply.tokens.output;
      }
      if (this.stopped) return;
      const parsed = parseReply(reply.text);
      if (!parsed) {
        this.stats.errors++;
        this.log(`gemini: unusable reply after ${took} ms, the script answers: ${reply.text.slice(0, 120)}`);
        return this.scripted(ask);
      }
      this.failures = 0;
      this.stats.answered++;
      this.log(`gemini answered in ${took} ms; tokens in=${reply.tokens?.input ?? 0} out=${reply.tokens?.output ?? 0} (total in=${this.tokens.input} out=${this.tokens.output}, calls=${this.calls})`);
      this.take(ask, parsed);
    } catch (e) {
      // Too slow, 429, 503, network: back off, and the script answers this turn.
      this.failures++;
      const backoff = Math.min(BACKOFF_MAX_MS, (this.opts.backoffMs ?? BACKOFF_MS) * 2 ** (this.failures - 1));
      this.nextThinkAt = Date.now() + Math.max(this.minThinkMs, backoff);
      if (timedOut) this.stats.timeouts++;
      else this.stats.errors++;
      const why = timedOut ? `no answer after ${this.timeoutMs} ms` : `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
      this.log(`gemini ${why}; the script answers, next call in ${Math.round(Math.max(this.minThinkMs, backoff) / 1000)}s`);
      if (!this.stopped) this.scripted(ask);
    } finally {
      clearTimeout(timeout);
      this.thinking = false;
      if (!this.stopped) {
        this.room.setTyping(this.side, false);
        this.flush();
      }
    }
  }

  /** Use a model reply: its line, what it heard, and its suggested move (checked when walked). */
  private take(ask: Ask, reply: ParsedReply): void {
    if (ask.kind === 'flavor') this.queue(reply.say ?? ask.line, !reply.say);
    else {
      const heard = reply.heard ? parseHuman(reply.heard) : null;
      // The model read no protocol word into it: only keep what cannot be small talk (a sign, a face).
      const sure = ask.read.tokens.filter((t) => t.t === 'sign' || t.t === 'face');
      // The script gets the line as typed, with the tokens the model (or nobody) read into it.
      this.heard.push({ text: ask.text, tokens: heard?.tokens.length ? heard.tokens : sure, plain: false });
      if (reply.say) this.queue(reply.say, false);
      else if (!heard?.tokens.length && !sure.length) this.huh(Date.now());
    }
    if (!reply.action) return;
    const d = this.last;
    const label = JSON.stringify(reply.action);
    if (!ADVICE_TYPES.has(reply.action.type) || !d || d.action || d.hold) {
      this.stats.refusedActions++;
      return this.log(`suggested ${label}: refused, ${d?.hold ? 'the body is holding its place' : d?.action ? 'the script is busy' : 'not a move the model may suggest'}`);
    }
    const face = this.room.state.players[this.side].pose.face;
    const plan = planAction(this.room.state, this.side, reply.action, undefined, (f) => f === face, d.avoid, hazardAvoid(this.room.state, this.side));
    if ('error' in plan) {
      this.stats.refusedActions++;
      return this.log(`suggested ${label}: refused, ${plan.error}`);
    }
    this.advice = plan.steps;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.abort?.abort();
    this.unlisten();
    const s = this.stats;
    this.log(
      `stopped: gemini calls=${this.calls} answered=${s.answered} timeouts=${s.timeouts} errors=${s.errors}, tokens in=${this.tokens.input} out=${this.tokens.output}; lines scripted=${s.scriptedLines} model=${s.modelLines}; refused suggestions=${s.refusedActions}`,
    );
  }
}
