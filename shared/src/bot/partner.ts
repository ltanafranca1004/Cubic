import { faceDistance, screenToCanon } from '../cube';
import { defaultEnv, type GameEnv } from '../game';
import { FACES, type FaceId, type GameState, type Side } from '../types';
import { planAction, type BotAction, type BotStep } from './actions';
import type { Observation } from './observe';
import { hazardAvoid } from './path';
import { PUZZLE_SCRIPTS, same, type Cell, type Play, type PuzzleScript, type ScriptCtx } from './scripts';
import type { Heard, Token } from './talk';

// THE SCRIPTED PARTNER: the core. A rule-based player that needs no API. It decides one
// small thing at a time (what to say, where to walk next, which tiles no walk may touch)
// from two inputs only: its own observation (observe(): what its side can see, in its own
// screen orientation) and what the human typed in chat (talk.ts).
//
// The core knows NOTHING about any puzzle: not how many there are, their ids or their
// faces. It does the generic part:
//   - greet, react to a solve, a win, "wait" / "go";
//   - find the human by voice (or "face N") and stay on their wall;
//   - walk safely: never onto a hazard tile (a script's own, or hot lava: hazardAvoid).
// The game is won the moment the last puzzle is solved: there is nowhere to walk after it.
// Each puzzle is a script in ./scripts (one file per puzzle id). On a face whose puzzle has
// no script, the bot says it does not know that one, keeps off everything it can see on
// that face (unless that leaves it no way to walk), and stays with the human.
//
// Pure: no clock (the caller passes `now`), no randomness, no networking. `mind` is the
// partner's memory; decide() updates it in place.

/** Lines of the core: not about any puzzle. The words live in server/src/ai/scripted.ts. */
export const CORE_LINES = ['hello.out', 'hello.in', 'solved', 'win', 'huh', 'wait.ok', 'follow.where', 'follow.far', 'next', 'unknown'] as const;
export type LineKey = string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScript = PuzzleScript<any>;

/** Every line key the partner can say with these scripts. */
export const lineKeys = (scripts: readonly AnyScript[] = PUZZLE_SCRIPTS): LineKey[] => [...CORE_LINES, ...scripts.flatMap((s) => s.lines)];
/** A line that belongs to a puzzle script (not to the core). */
export const isPuzzleLine = (key: LineKey): boolean => !(CORE_LINES as readonly string[]).includes(key);

/** Values for the {placeholders} of a line's words, e.g. { code: '4 7 2' }. */
export type LineArgs = Record<string, string | number>;

export interface Say {
  key: LineKey;
  /** What this line relays (what the bot sees): fills the {placeholders} of its words. */
  args?: LineArgs;
  /** Small talk: a model may reword it. Lines without this carry protocol words and are said as written. */
  flavor?: boolean;
}

export interface Decision {
  say: Say[];
  /** Where the body walks next (re-decided every step), or null to stand still. */
  action: BotAction | null;
  /** Tiles of this face that no walk may enter right now. */
  avoid: Cell[];
  /** `avoid` is only caution (a puzzle with no script): it gives way when there is no other walk. */
  soft: boolean;
  /** Tiles of this face the walk may enter although they are deadly (hot lava): a path the script was told. */
  allow: Cell[];
  /** The partner depends on the body staying exactly here (a plate, a pane): nothing may move it. */
  hold: boolean;
  /** Lines said earlier that are out of date now (a question that was just answered): do not say them if they still wait. */
  cancel: LineKey[];
  /** One line on what it is doing, for the model and the logs. */
  status: string;
}

export interface Mind {
  face: FaceId | null;
  strikes: number;
  solved: FaceId[];
  /** Faces the partner may be on, from the voice signal and "face N". */
  cands: FaceId[];
  /** When each line was last said. */
  said: Record<LineKey, number>;
  greeted: boolean;
  pauseUntil: number;
  /** Each puzzle script's own memory, by puzzle id. */
  scripts: Record<string, unknown>;
  /** How many faces were solved when "there is more to solve" was last said: once per solve. */
  nextAt: number;
  /** Since when the partner is only faintly heard (a next face, which one unknown), or null. */
  faintSince: number | null;
}

export const newMind = (): Mind => ({ face: null, strikes: 0, solved: [], cands: [], said: {}, greeted: false, pauseUntil: 0, scripts: {}, nextAt: -1, faintSince: null });

const RESAY_MS = 25_000;
const PAUSE_MS = 10_000;
/** Heard only faintly for this long with more than one face to try: it really does not know where the partner is, and asks. */
export const LOST_MS = 8_000;

/**
 * One decision. `heard` is what the human said since the last call, one entry per chat line,
 * oldest first. Call it before every step of the body. `scripts` is what it knows how to
 * play (tests pass their own).
 */
export function decide(mind: Mind, o: Observation, heard: readonly Heard[], now: number, scripts: readonly AnyScript[] = PUZZLE_SCRIPTS): Decision {
  const says: Say[] = [];
  const cancelled: LineKey[] = [];
  const say = (key: LineKey, opts: { every?: number; force?: boolean; flavor?: boolean; args?: LineArgs } = {}): boolean => {
    // A line with other args is another line: "the code is 4 7 2" is said again when the code changes.
    const id = opts.args ? `${key}#${JSON.stringify(opts.args)}` : key;
    const last = mind.said[id];
    if (!opts.force && last !== undefined && (opts.every === undefined || now - last < opts.every)) return false;
    mind.said[id] = now;
    says.push({ key, ...(opts.args ? { args: opts.args } : {}), ...(opts.flavor ? { flavor: true } : {}) });
    return true;
  };
  const tokens: Token[] = heard.flatMap((h) => h.tokens);
  const has = (...kinds: Token['t'][]) => tokens.some((t) => kinds.includes(t.t));
  const struck = o.strikes > mind.strikes;
  const done = (decision: Partial<Decision> & { status: string }): Decision => {
    mind.strikes = o.strikes;
    mind.solved = [...o.solvedFaces];
    mind.face = o.face;
    return { say: says, action: null, avoid: [], soft: false, allow: [], hold: false, cancel: cancelled, ...decision };
  };

  // Only scripts for puzzles that are really in this game count.
  const known = scripts.filter((s) => o.puzzleList.some((p) => p.id === s.id));
  const here = o.puzzleId === null ? undefined : known.find((s) => s.id === o.puzzleId);
  const ctxFor = (s: AnyScript): ScriptCtx<unknown> => ({
    o,
    mem: (mind.scripts[s.id] ??= s.init()),
    heard,
    tokens,
    has,
    now,
    struck,
    objs: (type) => o.objects.filter((x) => x.type === type),
    say: (key, opts) => (s.lines.includes(key) ? say(key, opts) : false),
    cancel: (...keys) => void cancelled.push(...keys.filter((k) => s.lines.includes(k))),
  });

  const newlySolved = o.solvedFaces.filter((f) => !mind.solved.includes(f));
  if (mind.face !== o.face) {
    // A new face: its puzzle starts over in my head, and the lines about a place may be said again.
    if (here) mind.scripts[here.id] = here.init();
    for (const id of Object.keys(mind.said)) {
      const key = id.split('#')[0]!;
      if (key === 'unknown' || here?.lines.includes(key)) delete mind.said[id];
    }
  }

  // Where is the partner? Only the voice says: clear = this wall, faint = a next face, silent = the far face.
  const heardDistance = o.voiceSignal >= 3 ? 0 : o.voiceSignal <= 0 ? 2 : 1;
  const fits = FACES.filter((f) => faceDistance(o.face, f) === heardDistance);
  const told = tokens.filter((t) => t.t === 'face').at(-1);
  const kept = mind.cands.filter((f) => fits.includes(f));
  mind.cands = told?.t === 'face' && fits.includes(told.face) ? [told.face] : kept.length ? kept : fits;

  if (o.won) {
    say('win', { flavor: true });
    return done({ status: 'the game is won' });
  }
  if (!mind.greeted) {
    mind.greeted = true;
    say(o.you === 'out' ? 'hello.out' : 'hello.in', { flavor: true });
  }
  if (newlySolved.length) say('solved', { force: true, flavor: true });

  // ---- hazards: tiles on this face that must not be stepped on by accident ----
  // A script names its own. With no script, everything this side can see on the face is off limits.
  const hazards: Cell[] = !o.puzzleHere ? [] : here ? (here.hazards?.(o) ?? []) : [...o.objects, ...o.items];
  const soft = o.puzzleHere && !here;
  const avoiding = (allowed: (Cell | undefined)[] = []) => hazards.filter((h) => !allowed.some((a) => same(a, h))).map(({ col, row }) => ({ col, row }));
  const from = (play: Play): Decision =>
    done({ action: play.action, hold: play.hold ?? false, avoid: avoiding(play.allow), soft, allow: (play.allow ?? []).flatMap((c) => (c ? [{ col: c.col, row: c.row }] : [])), status: play.status });

  // ---- "wait" and "go" ----
  if (has('wait')) {
    mind.pauseUntil = now + PAUSE_MS;
    say('wait.ok', { force: true });
  } else if (has('go', 'yes')) mind.pauseUntil = 0;

  // ---- errands: work a puzzle needs away from its face (carrying something across the cube) ----
  for (const s of known) {
    if (o.solvedFaces.includes(o.puzzleList.find((p) => p.id === s.id)!.face)) continue;
    const errand = s.errand?.(ctxFor(s));
    if (errand) return from(errand);
  }

  if (now < mind.pauseUntil) return done({ avoid: avoiding(), soft, hold: true, status: 'waiting, as asked' });

  // ---- not on the partner's wall: go and find them ----
  mind.faintSince = heardDistance === 1 ? (mind.faintSince ?? now) : null;
  if (heardDistance > 0) {
    const open = (f: FaceId) => o.puzzleList.some((p) => p.face === f) && !o.solvedFaces.includes(f);
    const target = [...mind.cands].sort((a, b) => Number(open(b)) - Number(open(a)) || a - b)[0]!;
    if (heardDistance === 2) say('follow.far', { every: RESAY_MS });
    // Faint: it follows its best guess first, and only asks when that did not find them.
    else if (mind.cands.length > 1 && now - mind.faintSince! >= LOST_MS) say('follow.where', { every: RESAY_MS });
    return done({ action: { type: 'go_face', face: target }, avoid: avoiding(), soft, status: `looking for the partner, trying face ${target}` });
  }

  // ---- same wall: this face's puzzle, if I know it ----
  if (o.puzzleHere) {
    if (!here) {
      say('unknown', { every: RESAY_MS * 2 });
      return done({ avoid: avoiding(), soft, status: `a puzzle I have no script for (${o.puzzleId}): keeping off it and staying with the partner` });
    }
    const play = here.play(ctxFor(here));
    if (play) return from(play);
  } else if (o.puzzleList.some((p) => !o.solvedFaces.includes(p.face)) && mind.nextAt !== o.solvedFaces.length) {
    // once per solve, not on every solved face it walks over behind the partner
    mind.nextAt = o.solvedFaces.length;
    say('next', { force: true });
  }
  return done({ avoid: avoiding(), soft, status: 'nothing to do on this face: staying with the partner' });
}

/**
 * The body's next single step for a decision: the first step of a legal walk that touches
 * none of the tiles to avoid and no deadly tile on any face (hazardAvoid), except the
 * deadly tiles the decision allows. null = stand still (nothing to do, or no safe way right
 * now). A soft avoid gives way when it leaves no walk at all; a deadly tile never does.
 */
export function nextStep(state: GameState, side: Side, decision: Pick<Decision, 'action' | 'avoid'> & Partial<Pick<Decision, 'soft' | 'allow'>>, env: GameEnv = defaultEnv): BotStep | null {
  if (!decision.action) return null;
  const pose = state.players[side].pose;
  const allowed = (decision.allow ?? []).map((c) => {
    const [x, y] = screenToCanon(side, pose.face, pose.up, c.col, c.row);
    return { face: pose.face, x, y };
  });
  const deadly = hazardAvoid(state, side, env, allowed);
  // Already standing in it (it turned deadly under the body): any way out is better than none.
  const hazard = deadly(pose) ? undefined : deadly;
  let plan = planAction(state, side, decision.action, env, undefined, decision.avoid, hazard);
  if ('error' in plan && decision.soft && decision.avoid.length) plan = planAction(state, side, decision.action, env, undefined, [], hazard);
  return 'steps' in plan ? (plan.steps[0] ?? null) : null;
}
