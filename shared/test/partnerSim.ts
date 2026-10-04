import {
  FACE_SIZE,
  applyInteract,
  applyMove,
  createGame,
  decide,
  defaultEnv,
  findPath,
  isSolidTile,
  newMind,
  nextStep,
  objectsOn,
  observe,
  parseHuman,
  pathTo,
  stepPose,
  visibleObjects,
  type Decision,
  type FaceId,
  type GameEnv,
  type GameState,
  type Heard,
  type LineKey,
  type Mind,
  type Pose,
  type Side,
  type TileRef,
} from '../src/index';
import { around, flood } from '../src/puzzles/util';

// A SIMULATED HUMAN for the AI partner tests (not a test file itself). It plays one side
// the way a person would: it looks at its own screen (observe / visibleObjects for ITS
// side only), walks with real moves, and does what the AI partner's lines ask for, typing
// the short words those lines suggest. It never reads the other side or the puzzle state.
//
// The same class drives the pure scripted partner (shared/test/partner.test.ts) and the
// real AiPlayer on a Room (server/test/ai.test.ts): only `Hands` differs.

/** How the simulated human touches the game. */
export interface Hands {
  state(): GameState;
  move(dx: number, dy: number): void;
  interact(): void;
  say(text: string): void;
}

export interface HumanOptions {
  /** The faces in the order this human wants to solve them. */
  order?: FaceId[];
  /** Say "face N" on arriving somewhere, instead of letting the AI search by voice. */
  announce?: boolean;
  /** Make this many mistakes in the maze (a wrong step, or a wrong direction to the AI). */
  mazeMistakes?: number;
  /** Type like a person: "I think it shows a moon" instead of "moon". */
  chatty?: boolean;
  /** Outside on face 5: stand on the pane for the far bridge first. */
  wrongPaneFirst?: boolean;
}

const DIR_OF: Record<string, string> = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };
const VEC: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export class SimHuman {
  /** AI lines not yet acted on. */
  private inbox: LineKey[] = [];
  private order: FaceId[];
  private announced: FaceId | null = null;
  private mistakes: number;
  /** Maze, guiding the AI: the stone the AI stands on. */
  private stone = 0;
  private pane = 0;
  /** What the human is walking to, and what to do on arrival. */
  private errand: { to: TileRef; then?: () => void } | null = null;
  readonly said: string[] = [];

  constructor(
    readonly side: Side,
    private hands: Hands,
    private opts: HumanOptions = {},
    private env: GameEnv = defaultEnv,
  ) {
    this.order = opts.order ?? [1, 6, 3, 4, 5];
    this.mistakes = opts.mazeMistakes ?? 0;
  }

  /** The AI said a line. */
  hear(key: LineKey): void {
    this.inbox.push(key);
  }

  private get s(): GameState {
    return this.hands.state();
  }
  private get pose(): Pose {
    return this.s.players[this.side].pose;
  }
  private say(text: string): void {
    this.said.push(text);
    this.hands.say(text);
  }
  private sees(type: string) {
    return observe(this.s, this.side, this.env).objects.filter((o) => o.type === type);
  }
  /** Canonical tiles of what I see on my face. */
  private seen(type: string) {
    return visibleObjects(this.s, this.side, this.pose.face, this.env).filter((o) => o.type === type);
  }
  private tile(o: { x: number; y: number }): TileRef {
    return { face: this.pose.face, x: o.x, y: o.y };
  }
  private at(t: { x: number; y: number }): boolean {
    return this.pose.x === t.x && this.pose.y === t.y;
  }

  /** Tiles a careful player does not cross by accident: sign stones, panes, the trap floor. */
  private careful(target?: TileRef) {
    return (p: Pose): boolean => {
      if (target && p.face === target.face && p.x === target.x && p.y === target.y) return false;
      if (this.s.solved.includes(p.face)) return false;
      if (this.side === 'out') return objectsOn(this.env.world, 'out', p.face).some((o) => (o.type === 'glyph' || o.type === 'skylight') && o.x === p.x && o.y === p.y);
      const entry = objectsOn(this.env.world, 'in', p.face, 'entry')[0];
      const crystal = objectsOn(this.env.world, 'in', p.face, 'crystal')[0];
      if (!entry || !crystal) return false;
      return flood(this.env.world.in[p.face].tiles, crystal, [entry]).some((t) => t.x === p.x && t.y === p.y);
    };
  }

  /** One step towards a tile (or a face). True when already there. */
  private walk(goal: TileRef | FaceId): boolean {
    const target = typeof goal === 'number' ? undefined : goal;
    const path = findPath(this.s, this.side, (p) => (target ? p.face === target.face && p.x === target.x && p.y === target.y : p.face === goal), this.env, undefined, this.careful(target));
    if (!path) return false;
    if (path.length === 0) return true;
    this.hands.move(path[0]![0], path[0]![1]);
    return false;
  }

  /** Where `to` is from `from` on my screen, as two words ("up left"). */
  private landmark(from: { col: number; row: number }, to: { col: number; row: number }): string {
    return `${to.row < from.row ? 'up' : 'down'} ${to.col < from.col ? 'left' : 'right'}`;
  }

  /** Called once per step of game time. */
  tick(): void {
    const s = this.s;
    if (s.wonAt !== null) return;
    const o = observe(s, this.side, this.env);
    const face = this.pose.face;

    if (this.errand) {
      const { to, then } = this.errand;
      if (!this.walk(to)) return;
      this.errand = null;
      then?.();
      return;
    }

    if (o.portalOpen) {
      const portal = objectsOn(this.env.world, this.side, 6, 'portal')[0]!;
      this.walk({ face: 6, x: portal.x, y: portal.y });
      return;
    }

    // The rose is the outside player's job.
    const goalFace = this.order.find((f) => !s.solved.includes(f) && !(f === 6 && this.side === 'in'));
    if (goalFace === undefined) return;
    if (goalFace === 6) {
      if (!s.players.out.carrying) {
        const rose = s.items.rose!;
        this.errand = { to: { face: rose.face, x: rose.x, y: rose.y }, then: () => this.hands.interact() };
      } else {
        const pot = objectsOn(this.env.world, 'out', 6, 'target')[0]!;
        this.errand = { to: { face: 6, x: pot.x, y: pot.y }, then: () => this.hands.interact() };
      }
      return;
    }
    if (face !== goalFace) {
      this.inbox = [];
      this.walk(goalFace);
      return;
    }
    if (this.announced !== face) {
      this.announced = face;
      this.stone = 0;
      this.pane = this.opts.wrongPaneFirst ? 1 : 0;
      if (this.opts.announce) this.say(`face ${face}`);
    }
    if (o.voiceSignal < 3 && !(face === 1 && this.side === 'in')) return; // wait for the partner to come

    const key = this.inbox[0];
    const handled = () => void this.inbox.shift();

    // ---- face 1 ----
    if (face === 1) {
      this.inbox = [];
      if (this.side === 'in') return void this.walk(this.tile(this.seen('plate')[0]!));
      if (this.seen('door')[0]!.state === 'open') this.walk(this.tile(this.seen('crystal')[0]!));
      return;
    }

    // ---- face 3 ----
    if (face === 3 && this.side === 'in') {
      if (!this.walk(this.tile(this.seen('plate')[0]!))) return;
      if (key === 'glyph-code.ready' || key === 'glyph-code.next' || key === 'glyph-code.oops') {
        const sign = this.seen('tablet')[0]!.state!;
        this.say(this.opts.chatty ? `I think it shows a ${sign} now` : sign);
      }
      if (key) handled();
      return;
    }
    if (face === 3) {
      const named = /^glyph-code\.sign\.(\w+)$/.exec(key ?? '');
      if (named) {
        const stone = this.seen('glyph').find((g) => g.state === named[1]);
        if (stone) {
          // Standing on it already (a new code): off and on again.
          if (this.at(stone)) {
            const off = around(stone).find((n) => !isSolidTile(this.env.world, 'out', 3, n.x, n.y))!;
            this.errand = { to: this.tile(off), then: () => (this.errand = { to: this.tile(stone) }) };
          } else this.errand = { to: this.tile(stone) };
        }
      }
      if (key) handled();
      return;
    }

    // ---- face 4 ----
    if (face === 4 && this.side === 'in') {
      const entry = this.seen('entry')[0]!;
      const inRoom = this.careful()(this.pose);
      if (!inRoom && !this.at(entry)) return void this.walk(this.tile(entry));
      if (!key) return;
      handled();
      const me = o.position;
      if (key === 'mirror-maze.calib') return this.say(this.landmark(me, this.sees('crystal')[0]!));
      if (key === 'mirror-maze.stepin' || key === 'mirror-maze.fell') {
        if (!this.at(entry)) return; // already in
        // the one way in: the tile of the room next to the doorway
        const step = pathTo(s, 'in', this.tile(around(entry).find((n) => this.careful()({ ...this.pose, x: n.x, y: n.y }))!), this.env)!;
        this.hands.move(step[0]![0], step[0]![1]);
        return this.say(this.opts.chatty ? 'ok I am in' : 'yes');
      }
      const called = /^mirror-maze\.go\.(\w+)$/.exec(key);
      if (called) {
        let dir = called[1]!;
        if (this.mistakes > 0) {
          // an honest slip: any other way that is not a wall
          const other = Object.keys(VEC).find((d) => d !== dir && this.careful()(stepPose(this.pose, VEC[d]![0], VEC[d]![1]).pose));
          if (other) {
            this.mistakes--;
            dir = other;
          }
        }
        this.hands.move(VEC[dir]![0], VEC[dir]![1]);
        if (this.at(entry)) return; // fell: the AI will notice the stones moved
        return this.say('yes');
      }
      return;
    }
    if (face === 4) {
      if (!key) return;
      handled();
      const trail = this.sees('trail');
      if (key === 'mirror-maze.askCalib') return this.say(this.landmark(trail[0]!, trail.at(-1)!));
      if (key === 'mirror-maze.guide' || key === 'mirror-maze.fellIn') this.stone = 0;
      else if (key === 'mirror-maze.ok') this.stone++;
      else if (key !== 'mirror-maze.wall') return;
      const a = trail[this.stone]!;
      const b = trail[this.stone + 1];
      if (!b) return;
      let dir = DIR_OF[`${b.col - a.col},${b.row - a.row}`]!;
      if (this.mistakes > 0 && this.stone === 1) {
        // a slip: a direction that is not the line's, and not back where the AI came from
        const back = trail[this.stone - 1]!;
        const wrong = Object.keys(VEC).find((d) => d !== dir && !(a.col + VEC[d]![0] === back.col && a.row + VEC[d]![1] === back.row) && a.col + VEC[d]![0] > 0 && a.col + VEC[d]![0] < FACE_SIZE - 1);
        if (wrong) {
          this.mistakes--;
          dir = wrong;
        }
      }
      return this.say(this.opts.chatty ? `go ${dir} one step` : dir);
    }

    // ---- face 5 ----
    if (face === 5 && this.side === 'in') {
      const bridges = this.seen('bridge');
      const isBridge = (t: { x: number; y: number }) => bridges.find((b) => b.x === t.x && b.y === t.y);
      // My way to the crystal as the room is drawn, and the first bridge on it that is still dark.
      const way = this.terrainRoute(this.seen('crystal')[0]!);
      const dark = way.findIndex((t, i) => i > 0 && isBridge(t)?.state === 'dark');
      const stand = dark < 0 ? way.at(-1)! : way[dark - 1]!;
      if (!this.at(stand)) return void this.walk(this.tile(stand));
      if (!key) return;
      handled();
      if (key !== 'skylight.on') return;
      const crossedOne = way.filter((t) => isBridge(t)).length < bridges.length;
      return this.say(crossedOne ? (this.opts.chatty ? 'I am across, go to the next one' : 'go') : 'no');
    }
    if (face === 5) {
      if (!key) return;
      handled();
      const panes = this.seen('skylight');
      if (key === 'skylight.other' || key === 'skylight.across1') this.pane = (this.pane + 1) % panes.length;
      else if (key !== 'skylight.need') return;
      this.errand = { to: this.tile(panes[this.pane]!) };
    }
  }

  /** Shortest way over my own map's terrain (bridges count as floor), from where I stand. */
  private terrainRoute(to: { x: number; y: number }): { x: number; y: number }[] {
    const k = (t: { x: number; y: number }) => `${t.x},${t.y}`;
    const from = { x: this.pose.x, y: this.pose.y };
    const prev = new Map<string, { x: number; y: number } | null>([[k(from), null]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      if (cur.x === to.x && cur.y === to.y) {
        const path = [];
        for (let t: { x: number; y: number } | null = cur; t; t = prev.get(k(t)) ?? null) path.unshift(t);
        return path;
      }
      for (const n of around(cur)) {
        if (prev.has(k(n)) || isSolidTile(this.env.world, this.side, this.pose.face, n.x, n.y)) continue;
        prev.set(k(n), cur);
        queue.push(n);
      }
    }
    return [from];
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

/** Play until the game is won, `until` says so, or the time is up. */
export function play(aiSide: Side, opts: HumanOptions & { maxMs?: number; until?: (s: GameState) => boolean; state?: GameState; startAt?: number } = {}, env: GameEnv = defaultEnv): Played {
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
    const d = decide(mind, observe(state, aiSide, env), chat.splice(0), now);
    decisions.push(d);
    for (const say of d.say) {
      lines.push(say.key);
      human.hear(say.key);
    }
    const step = nextStep(state, aiSide, d, env);
    if (step === 'interact') applyInteract(state, aiSide, now, env);
    else if (step) applyMove(state, aiSide, step[0], step[1], now, env);
    const p = state.players[aiSide].pose;
    trodden.add(`${p.face}:${p.x},${p.y}`);
    human.tick();
  }
  // The partner's last word, once the game is over.
  if (state.wonAt !== null) lines.push(...decide(mind, observe(state, aiSide, env), [], now + STEP_MS).say.map((x) => x.key));
  return { state, mind, lines, human, ms: now - state.startedAt, trodden, decisions };
}
