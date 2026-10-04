import { faceDistance } from '../cube';
import { defaultEnv, type GameEnv } from '../game';
import { FACES, type FaceId, type GameState, type Side } from '../types';
import { planAction, type BotAction, type BotStep } from './actions';
import type { Observation } from './observe';
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
//   - walk safely: never onto a hazard tile;
//   - walk into the portal once everything is solved.
// Each puzzle is a script in ./scripts (one file per puzzle id). On a face whose puzzle has
// no script, the bot says it does not know that one, keeps off everything it can see on
// that face, and stays with the human.
//
// Pure: no clock (the caller passes `now`), no randomness, no networking. `mind` is the
// partner's memory; decide() updates it in place.

/** Lines of the core: not about any puzzle. The words live in server/src/ai/scripted.ts. */
export const CORE_LINES = ['hello.out', 'hello.in', 'solved', 'win', 'huh', 'wait.ok', 'follow.where', 'follow.far', 'next', 'unknown', 'portal.go', 'portal.in'] as const;
export type LineKey = string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScript = PuzzleScript<any>;

/** Every line key the partner can say with these scripts. */
export const lineKeys = (scripts: readonly AnyScript[] = PUZZLE_SCRIPTS): LineKey[] => [...CORE_LINES, ...scripts.flatMap((s) => s.lines)];
/** A line that belongs to a puzzle script (not to the core). */
export const isPuzzleLine = (key: LineKey): boolean => !(CORE_LINES as readonly string[]).includes(key);

export interface Say {
  key: LineKey;
  /** Small talk: a model may reword it. Lines without this carry protocol words and are said as written. */
  flavor?: boolean;
}

export interface Decision {
  say: Say[];
  /** Where the body walks next (re-decided every step), or null to stand still. */
  action: BotAction | null;
  /** Tiles of this face that no walk may enter right now. */
  avoid: Cell[];
  /** The partner depends on the body staying exactly here (a plate, a pane): nothing may move it. */
  hold: boolean;
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
}

export const newMind = (): Mind => ({ face: null, strikes: 0, solved: [], cands: [], said: {}, greeted: false, pauseUntil: 0, scripts: {} });

const RESAY_MS = 25_000;
const PAUSE_MS = 10_000;

/**
 * One decision. `heard` is what the human said since the last call, one entry per chat line,
 * oldest first. Call it before every step of the body. `scripts` is what it knows how to
 * play (tests pass their own).
 */
export function decide(mind: Mind, o: Observation, heard: readonly Heard[], now: number, scripts: readonly AnyScript[] = PUZZLE_SCRIPTS): Decision {
  const says: Say[] = [];
  const say = (key: LineKey, opts: { every?: number; force?: boolean; flavor?: boolean } = {}): boolean => {
    const last = mind.said[key];
    if (!opts.force && last !== undefined && (opts.every === undefined || now - last < opts.every)) return false;
    mind.said[key] = now;
    says.push(opts.flavor ? { key, flavor: true } : { key });
    return true;
  };
  const tokens: Token[] = heard.flatMap((h) => h.tokens);
  const has = (...kinds: Token['t'][]) => tokens.some((t) => kinds.includes(t.t));
  const pos = o.position;
  const struck = o.strikes > mind.strikes;
  const done = (decision: Partial<Decision> & { status: string }): Decision => {
    mind.strikes = o.strikes;
    mind.solved = [...o.solvedFaces];
    mind.face = o.face;
    return { say: says, action: null, avoid: [], hold: false, ...decision };
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
  });

  const newlySolved = o.solvedFaces.filter((f) => !mind.solved.includes(f));
  if (mind.face !== o.face) {
    // A new face: its puzzle starts over in my head, and the lines about a place may be said again.
    if (here) mind.scripts[here.id] = here.init();
    for (const key of Object.keys(mind.said)) if (key === 'next' || key === 'unknown' || here?.lines.includes(key)) delete mind.said[key];
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
  if (newlySolved.length && !o.portalOpen) say('solved', { force: true, flavor: true });

  // ---- hazards: tiles on this face that must not be stepped on by accident ----
  // A script names its own. With no script, everything this side can see on the face is off limits.
  const hazards: Cell[] = !o.puzzleHere ? [] : here ? (here.hazards?.(o) ?? []) : [...o.objects, ...o.items];
  const avoiding = (allowed: (Cell | undefined)[] = []) => hazards.filter((h) => !allowed.some((a) => same(a, h))).map(({ col, row }) => ({ col, row }));
  const from = (play: Play): Decision => done({ action: play.action, hold: play.hold ?? false, avoid: avoiding(play.allow), status: play.status });

  // ---- "wait" and "go" ----
  if (has('wait')) {
    mind.pauseUntil = now + PAUSE_MS;
    say('wait.ok', { force: true });
  } else if (has('go', 'yes')) mind.pauseUntil = 0;

  // ---- the portal: everything is solved ----
  if (o.portalOpen) {
    const portal = o.objects.filter((x) => x.type === 'portal');
    if (portal.length === 0) {
      say('portal.go', { every: RESAY_MS * 2 });
      // Not told where it is: look on the next face over.
      return done({ action: { type: 'go_face', face: o.portalFace ?? o.edges.up.face }, avoid: avoiding(), status: 'walking to the portal' });
    }
    say('portal.in');
    const onIt = portal.some((p) => same(p, pos));
    return done({ action: onIt ? null : { type: 'step_on', object: 'portal' }, avoid: avoiding(), hold: onIt, status: onIt ? 'standing in the portal, waiting for the partner' : 'stepping into the portal' });
  }

  // ---- errands: work a puzzle needs away from its face (carrying something across the cube) ----
  for (const s of known) {
    if (o.solvedFaces.includes(o.puzzleList.find((p) => p.id === s.id)!.face)) continue;
    const errand = s.errand?.(ctxFor(s));
    if (errand) return from(errand);
  }

  if (now < mind.pauseUntil) return done({ avoid: avoiding(), hold: true, status: 'waiting, as asked' });

  // ---- not on the partner's wall: go and find them ----
  if (heardDistance > 0) {
    const open = (f: FaceId) => o.puzzleList.some((p) => p.face === f) && !o.solvedFaces.includes(f);
    const target = [...mind.cands].sort((a, b) => Number(open(b)) - Number(open(a)) || a - b)[0]!;
    if (heardDistance === 2) say('follow.far', { every: RESAY_MS });
    else if (mind.cands.length > 1) say('follow.where', { every: RESAY_MS });
    return done({ action: { type: 'go_face', face: target }, avoid: avoiding(), status: `looking for the partner, trying face ${target}` });
  }

  // ---- same wall: this face's puzzle, if I know it ----
  if (o.puzzleHere) {
    if (!here) {
      say('unknown', { every: RESAY_MS * 2 });
      return done({ avoid: avoiding(), status: `a puzzle I have no script for (${o.puzzleId}): keeping off it and staying with the partner` });
    }
    const play = here.play(ctxFor(here));
    if (play) return from(play);
  } else if (o.puzzleList.some((p) => !o.solvedFaces.includes(p.face))) say('next', { every: RESAY_MS * 2 });
  return done({ avoid: avoiding(), status: 'nothing to do on this face: staying with the partner' });
}

/**
 * The body's next single step for a decision: the first step of a legal walk that touches
 * none of the tiles to avoid. null = stand still (nothing to do, or no safe way right now).
 */
export function nextStep(state: GameState, side: Side, decision: Pick<Decision, 'action' | 'avoid'>, env: GameEnv = defaultEnv): BotStep | null {
  if (!decision.action) return null;
  const plan = planAction(state, side, decision.action, env, undefined, decision.avoid);
  return 'steps' in plan ? (plan.steps[0] ?? null) : null;
}
