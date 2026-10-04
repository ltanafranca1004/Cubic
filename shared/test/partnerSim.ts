import {
  applyInteract,
  applyMove,
  createGame,
  decide,
  defaultEnv,
  findPath,
  hazardAvoid,
  newMind,
  nextStep,
  observe,
  parseHuman,
  tick,
  visibleObjects,
  type Decision,
  type FaceId,
  type GameEnv,
  type GameState,
  type Heard,
  type LineArgs,
  type LineKey,
  type Mind,
  type Observation,
  type Pose,
  type PuzzleScript,
  type Side,
  type TileRef,
  type VisibleObject,
} from '../src/index';
// ---- faces 1-3 (scripts-a) ----
import { equationSafeHuman } from './humans/equationSafe';
import { hiddenCodeHuman } from './humans/hiddenCode';
import { mirroredGlyphHuman } from './humans/mirroredGlyph';
// ---- end faces 1-3 ----
// ---- faces 4-6 (scripts-b) ----
import { botanicalMirrorHuman } from './humans/botanicalMirror';
import { laserPathHuman } from './humans/laserPath';
import { sequenceLaserHuman } from './humans/sequenceLaser';
// ---- end faces 4-6 ----

// A SIMULATED HUMAN for the AI partner tests (not a test file itself). It plays one side
// the way a person would: it looks at its own screen (observe / visibleObjects for ITS
// side only), walks with real moves, and does what the AI partner's lines ask for, typing
// the short words those lines suggest. It never reads the other side or the puzzle state.
//
// The core here knows no puzzle, like the partner core: it walks to the next unsolved face
// of its `order`, waits for the AI to arrive, and then hands each tick to that puzzle's
// HumanScript (`humans`, by puzzle id). A puzzle with no HumanScript is skipped.
//
// The same class drives the pure scripted partner (play() below, shared tests) and the
// real AiPlayer on a Room (server/test/ai.test.ts): only `Hands` differs.

/** How the simulated human touches the game. */
export interface Hands {
  state(): GameState;
  move(dx: number, dy: number): void;
  interact(): void;
  say(text: string): void;
}

/** One line the AI said, as the human hears it. */
export interface HeardLine {
  key: LineKey;
  args?: LineArgs;
}

/** What a HumanScript gets each tick it is asked. */
export interface HumanCtx<M> {
  side: Side;
  /** What the human sees right now (its own side only). */
  o: Observation;
  /** The script's own memory. Starts as init() and is reset when the human enters the face. */
  mem: M;
  /** AI lines not yet acted on, oldest first. Take one with next(). */
  inbox: readonly HeardLine[];
  /** Take the oldest AI line off the inbox (undefined if there is none). */
  next(): HeardLine | undefined;
  /** Canonical tiles of what the human sees on its face, by object type. */
  seen(type: string): VisibleObject[];
  /** Is the human standing on this canonical tile of its face? */
  at(t: { x: number; y: number }): boolean;
  /** One careful step towards a tile of this face (or a tile anywhere). True when already there. */
  walk(to: { x: number; y: number; face?: FaceId }): boolean;
  /** One raw step in the human's own screen space (also into a hazard: a mistake). */
  move(dx: number, dy: number): void;
  /** Press E. */
  interact(): void;
  /** Type a chat line. */
  say(text: string): void;
  /** Walk to a tile over the coming ticks, then run `then`. The script is not asked meanwhile. */
  errand(to: TileRef, then?: () => void): void;
}

/** How the simulated human plays one puzzle. The mirror image of a PuzzleScript. */
export interface HumanScript<M = unknown> {
  /** The puzzle module's id. */
  id: string;
  init(): M;
  /** Asked once per tick while the human is on the puzzle's face, it is unsolved and the AI is on the same wall. */
  play(ctx: HumanCtx<M>): void;
  /** Asked on every tick on any face, before anything else, while the puzzle is unsolved: work across the cube (carrying). Return true if it acted. */
  errand?(ctx: HumanCtx<M>): boolean;
}

/**
 * How the simulated human plays each puzzle: one HumanScript per puzzle id, next to the
 * PuzzleScript it is the partner of (shared/test/humans/<name>.ts). Add yours here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HUMAN_SCRIPTS: HumanScript<any>[] = [
  // ---- faces 1-3 (scripts-a) ----
  hiddenCodeHuman(),
  equationSafeHuman(),
  mirroredGlyphHuman(),
  // ---- end faces 1-3 ----
  // ---- faces 4-6 (scripts-b) ----
  botanicalMirrorHuman(),
  sequenceLaserHuman(),
  laserPathHuman(),
  // ---- end faces 4-6 ----
];

export interface HumanOptions {
  /** The faces in the order this human wants to solve them (default: the env's puzzles in list order). */
  order?: FaceId[];
  /** Say "face N" on arriving somewhere, instead of letting the AI search by voice. */
  announce?: boolean;
  /** How this human plays each puzzle (default: HUMAN_SCRIPTS). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humans?: readonly HumanScript<any>[];
}

export class SimHuman {
  /** AI lines not yet acted on. */
  private inbox: HeardLine[] = [];
  private order: FaceId[];
  private announced: FaceId | null = null;
  private mems: Record<string, unknown> = {};
  /** What the human is walking to, and what to do on arrival. */
  private errand: { to: TileRef; then?: () => void } | null = null;
  readonly said: string[] = [];

  constructor(
    readonly side: Side,
    private hands: Hands,
    private opts: HumanOptions = {},
    private env: GameEnv = defaultEnv,
  ) {
    this.order = opts.order ?? env.puzzles.map((p) => p.face);
  }

  /** The AI said a line. */
  hear(key: LineKey, args?: LineArgs): void {
    this.inbox.push(args ? { key, args } : { key });
  }

  private get s(): GameState {
    return this.hands.state();
  }
  private get pose(): Pose {
    return this.s.players[this.side].pose;
  }

  /** One step towards a tile (or a face), never through a deadly tile. True when already there. */
  private walk(goal: TileRef | FaceId): boolean {
    const target = typeof goal === 'number' ? undefined : goal;
    const careful = hazardAvoid(this.s, this.side, this.env, target ? [target] : []);
    const path = findPath(this.s, this.side, (p) => (target ? p.face === target.face && p.x === target.x && p.y === target.y : p.face === goal), this.env, undefined, careful);
    if (!path) return false;
    if (path.length === 0) return true;
    this.hands.move(path[0]![0], path[0]![1]);
    return false;
  }

  private ctx<M>(script: HumanScript<M>, o: Observation): HumanCtx<M> {
    const face = this.pose.face;
    return {
      side: this.side,
      o,
      mem: (this.mems[script.id] ??= script.init()) as M,
      inbox: this.inbox,
      next: () => this.inbox.shift(),
      seen: (type) => visibleObjects(this.s, this.side, this.pose.face, this.env).filter((x) => x.type === type),
      at: (t) => this.pose.x === t.x && this.pose.y === t.y,
      walk: (to) => this.walk({ face: to.face ?? face, x: to.x, y: to.y }),
      move: (dx, dy) => this.hands.move(dx, dy),
      interact: () => this.hands.interact(),
      say: (text) => {
        this.said.push(text);
        this.hands.say(text);
      },
      errand: (to, then) => void (this.errand = then ? { to, then } : { to }),
    };
  }

  /** Called once per step of game time. */
  tick(): void {
    const s = this.s;
    if (s.wonAt !== null) return;
    const o = observe(s, this.side, this.env);
    const face = this.pose.face;
    const humans = this.opts.humans ?? HUMAN_SCRIPTS;

    if (this.errand) {
      const { to, then } = this.errand;
      if (!this.walk(to)) return;
      this.errand = null;
      then?.();
      return;
    }
    for (const h of humans) {
      const puzzle = this.env.puzzles.find((p) => p.id === h.id);
      if (puzzle && !s.solved.includes(puzzle.face) && h.errand?.(this.ctx(h, o))) return;
    }

    // The next face of my order that I know how to play.
    const goalFace = this.order.find((f) => !s.solved.includes(f) && humans.some((h) => h.id === this.env.puzzles.find((p) => p.face === f)?.id));
    if (goalFace === undefined) return;
    const script = humans.find((h) => h.id === this.env.puzzles.find((p) => p.face === goalFace)!.id)!;
    if (face !== goalFace) {
      this.inbox = [];
      this.walk(goalFace);
      return;
    }
    if (this.announced !== face) {
      this.announced = face;
      this.mems[script.id] = script.init();
      if (this.opts.announce) {
        this.said.push(`face ${face}`);
        this.hands.say(`face ${face}`);
      }
    }
    if (o.voiceSignal < 3) return; // wait for the partner to come
    script.play(this.ctx(script, o));
  }
}

// ---------- the pure game loop: scripted partner + simulated human, real moves ----------

export const STEP_MS = 200;

export interface Played {
  state: GameState;
  mind: Mind;
  /** Every line the AI said, in order. */
  lines: LineKey[];
  human: SimHuman;
  /** Game time used, in ms. */
  ms: number;
  /** Every tile the AI stood on: "face:x,y". */
  trodden: Set<string>;
  decisions: Decision[];
}

export interface PlayOptions extends HumanOptions {
  /** The puzzle scripts the AI plays with (default: the registry). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scripts?: readonly PuzzleScript<any>[];
  /** Give up after this much game time (default 30 minutes). */
  maxMs?: number;
  until?: (s: GameState) => boolean;
  /** Start from this state instead of a new game (e.g. with faces already solved by devSolve). */
  state?: GameState;
  startAt?: number;
}

/**
 * Play until the game is won, `until` says so, or the time is up. Each 200 ms step: the AI
 * decides (decide) and takes one step (nextStep), then the human ticks once. What the human
 * types reaches the AI's next decide() as Heard; what the AI says reaches human.hear().
 */
export function play(aiSide: Side, opts: PlayOptions = {}, env: GameEnv = defaultEnv): Played {
  const state = opts.state ?? createGame(opts.startAt ?? 1_700_000_000_000, env);
  const mind = newMind();
  const lines: LineKey[] = [];
  const chat: Heard[] = [];
  const trodden = new Set<string>();
  const decisions: Decision[] = [];
  let now = state.startedAt;
  const humanSide: Side = aiSide === 'out' ? 'in' : 'out';
  const human = new SimHuman(
    humanSide,
    {
      state: () => state,
      move: (dx, dy) => void applyMove(state, humanSide, dx, dy, now, env),
      interact: () => void applyInteract(state, humanSide, now, env),
      say: (text) => void chat.push(parseHuman(text)),
    },
    opts,
    env,
  );
  const end = now + (opts.maxMs ?? 30 * 60_000);
  while (state.wonAt === null && now < end && !opts.until?.(state)) {
    now += STEP_MS;
    const d = decide(mind, observe(state, aiSide, env), chat.splice(0), now, opts.scripts);
    decisions.push(d);
    for (const say of d.say) {
      lines.push(say.key);
      human.hear(say.key, say.args);
    }
    const step = nextStep(state, aiSide, d, env);
    if (step === 'interact') applyInteract(state, aiSide, now, env);
    else if (step) applyMove(state, aiSide, step[0], step[1], now, env);
    const p = state.players[aiSide].pose;
    trodden.add(`${p.face}:${p.x},${p.y}`);
    human.tick();
    tick(state, STEP_MS, now, env);
  }
  // The partner's last word, once the game is over.
  if (state.wonAt !== null) lines.push(...decide(mind, observe(state, aiSide, env), [], now + STEP_MS, opts.scripts).say.map((x) => x.key));
  return { state, mind, lines, human, ms: now - state.startedAt, trodden, decisions };
}
