import { DIRS, type Dir } from '../talk';
import { numberWord } from '../vocab';
import type { Observation } from '../observe';
import { dirOf, same, throughWall, VEC, type Cell } from './grid';
import { canonDir, partnerCell, REPEAT_MS, rowColumnIn, runsOf, stepsIn, turnOf } from './kit456';
import { ASK_MS, canonOf, cellOf, relay, type Tile } from './relayKit';
import type { Play, PuzzleScript, ScriptCtx } from './types';

// LASER AND LAVA (face 6), both sides.
//
// OUTSIDE (mirrors, then relay). The mirrors are this side's own puzzle, so it solves them
// from what it sees: push "/" along its row into the beam's column (the source's), then
// push "\" along its column onto the row of "/"; the beam then runs down the column of the
// crate, which stands on the edge. Anything else: RESET. When the crate is burnt the
// mirrors are locked and THE BEAM IS THE PATH: it picks up the flower from the crate's
// tile and reads the beam out backwards, from that edge tile to the source (the button).
//
// THE CONVENTION (both ways). The two players see the room mirrored and maybe turned, and
// neither sees the other. So directions are always given ON THE WALKER'S OWN SCREEN, and
// the turn between the screens is agreed with one landmark both can name:
//   1. The side of the ring the path starts on (where the crate stood) is named by the face
//      beyond it ("face 4").
//   2. The walker stands on that side and says which way the lava is on their screen
//      ("right"). The guide sees the same step on their own screen: that fixes the turn.
//   3. The start tile is given as a row or a column of the walker's screen, counted from
//      their top / their left, one to twelve: [row, six].
//   4. Then runs of steps, at most two per line: [step, right, two, then, up, one]; the
//      last line ends [then, press]. The walker says "yes" after each line ("again" repeats).
//   5. A fall puts the walker back on the ring tile the path starts on: the guide starts over from
//      there (and asks for the lava direction again, in case the walker was turned wrong).
//
// INSIDE (doing): stays on the ring while the lava is hot (from the start of the game). It
// asks for the face (1), goes
// there and says where the lava is (2), asks for its tile (3), then walks the steps the
// human says, one at a time, also onto lava: only tiles it was told. It never sees the path.

const ID = 'laser-path';
const RELAY = `${ID}.relay`;

interface Mem {
  since: number | null;
  /** Outside: pushes tried since the last RESET. */
  tries: number;
  /** Where the relay is: which side, which way the lava is, the start tile, the steps. */
  phase: 'side' | 'lava' | 'tile' | 'steps';
  /** The turn between my screen and the human's. */
  k: number;
  /** Outside: path steps the human has confirmed, and how many the last line carried. */
  i: number;
  chunk: number;
  /** Outside: the human is on the start tile for sure (they fell). */
  atStart: boolean;
  /** Inside: the side of my screen the path starts from. */
  edge: Dir | null;
  /** Inside: steps I was told and have not taken; the tile I am stepping onto. */
  queue: Dir[];
  going: Cell | null;
  walked: boolean;
}

export const opposite = (d: Dir): Dir => dirOf({ col: -VEC[d].col, row: -VEC[d].row })!;

// ---------- the mirrors: the outside player's own puzzle, in canonical tiles ----------

type Push = { stand: Tile; dx: number; dy: number } | 'reset' | 'set' | null;

/** The next push that brings the beam onto the crate, from where the mirrors, the source and the crate are. */
export function mirrorPush(fwd: Tile | undefined, back: Tile | undefined, source: Tile | undefined, crate: Tile | undefined): Push {
  if (!fwd || !back || !source || !crate) return null;
  // "/" turns the beam east on its own row; "\" must stand on that row, in the crate's column
  if (fwd.y >= source.y || back.x !== crate.x || back.x <= source.x || back.y < fwd.y) return 'reset';
  if (fwd.x !== source.x) {
    const dx = Math.sign(source.x - fwd.x);
    return { stand: { x: fwd.x - dx, y: fwd.y }, dx, dy: 0 };
  }
  if (back.y !== fwd.y) return { stand: { x: back.x, y: back.y + 1 }, dx: 0, dy: -1 };
  return 'set';
}

/**
 * The safe path, read off the beam the outside player sees: from the ring tile where the
 * burnt crate lies, straight to the "\" mirror, along to the "/" mirror, and down to the
 * source (behind it is the button). `ring` is that first tile, `steps` the single steps
 * from it, on my screen. Null until the crate is burnt.
 */
export function beamRoute(objects: Observation['objects']): { ring: Cell; steps: Cell[] } | null {
  const one = (type: string, state?: string) => objects.find((x) => x.type === type && (state === undefined || x.state === state));
  const corners = [one('f6-crate', 'burnt'), one('f6-mirror', 'back'), one('f6-mirror', 'fwd'), one('f6-source')];
  const steps: Cell[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1], corners[i]];
    if (!a || !b) return null;
    const d = { col: Math.sign(b.col - a.col), row: Math.sign(b.row - a.row) };
    if (!dirOf(d)) return null; // not in one line: this is not the beam that burnt the crate
    for (let n = Math.abs(b.col - a.col) + Math.abs(b.row - a.row); n > 0; n--) steps.push(d);
  }
  const ring = corners[0]!;
  return { ring: { col: ring.col, row: ring.row }, steps };
}

/** One relay line of steps from `i`: at most two runs, in the walker's own screen directions. */
export function stepLine(dirs: readonly Dir[], i: number): { pieces: string[]; length: number } {
  const runs = runsOf(dirs.slice(i)).slice(0, 2);
  const length = runs.reduce((n, r) => n + r[1], 0);
  const pieces = ['step', ...runs.flatMap(([d, n], j) => [...(j ? ['then'] : []), d, numberWord(n)])];
  if (i + length >= dirs.length) pieces.push('then', 'press');
  return { pieces, length };
}

function outside(ctx: ScriptCtx<Mem>): Play | null {
  const { o, mem, heard, now, struck, objs, say, has } = ctx;
  const crate = objs('f6-crate')[0];
  const reset = objs('reset')[0];
  const pressReset = (why: string): Play | null => (reset && !o.carrying ? { action: { type: 'use', col: reset.col, row: reset.row }, status: why } : null);

  if (crate?.state !== 'burnt') {
    const mirror = (kind: string) => objs('f6-mirror').find((m) => m.state === kind);
    const canon = (c: Cell | undefined) => (c ? canonOf(o, c) : undefined);
    const push = mirrorPush(canon(mirror('fwd')), canon(mirror('back')), canon(objs('f6-source')[0]), canon(crate));
    if (push === null) return null;
    if (push === 'set') return objs('f6-source')[0]?.state === 'on' ? pressReset('the mirrors are set but nothing burns: RESET') : null;
    say(`${ID}.out.mirrors`);
    if (push === 'reset' || mem.tries > 12) {
      mem.tries = 0;
      return pressReset('the mirrors are stuck: RESET');
    }
    const stand = cellOf(o, push.stand);
    if (!same(o.position, stand)) return { action: { type: 'goto', col: stand.col, row: stand.row }, status: 'walking behind a mirror' };
    mem.tries++;
    return { action: { type: 'move', dir: canonDir(o, push.dx, push.dy), steps: 1 }, status: 'pushing a mirror' };
  }

  // ---- the crate is burnt: the beam is the path, the flower is out ----
  const path = beamRoute(o.objects);
  const flower = o.items.find((i) => i.kind.startsWith('flower-'));
  if (!path) return null;
  if (!o.carrying && flower) return same(o.position, flower) ? { action: { type: 'pick_up' }, status: 'picking up the flower' } : { action: { type: 'goto', col: flower.col, row: flower.row }, status: 'fetching the flower' };

  const inward = path.steps[0]!;
  const said = heard.flatMap((h) => stepsIn(h.text)).at(-1);
  const dirs = (): Dir[] => path.steps.map((v) => dirOf(throughWall(v, mem.k))!);
  const tellSteps = () => {
    const line = stepLine(dirs(), mem.i);
    mem.chunk = line.length;
    mem.since = now;
    relay(ctx, RELAY, line.pieces);
  };
  const tellTile = () => {
    const theirs = partnerCell(path.ring, mem.k);
    const sideways = dirOf(throughWall(inward, mem.k))!;
    relay(ctx, RELAY, sideways === 'left' || sideways === 'right' ? ['row', numberWord(theirs.row + 1)] : ['column', numberWord(theirs.col + 1)]);
    say(`${ID}.out.ready`, { force: true });
    mem.since = now;
  };
  if (struck) {
    // they fell: they are back on the ring tile the path starts on. Their answer may have been off: ask again.
    say(`${ID}.out.fell`, { force: true });
    say(`${ID}.out.lava`, { force: true });
    Object.assign(mem, { phase: 'lava', atStart: true, i: 0, since: now });
    return { action: null, status: 'the partner fell: starting the path over' };
  }
  if (mem.phase === 'side') {
    say(`${ID}.out.side.${o.edges[opposite(dirOf(inward)!)].face}`);
    say(`${ID}.out.lava`);
    Object.assign(mem, { phase: 'lava', since: now });
  }
  if (mem.phase === 'lava') {
    if (said) {
      mem.k = turnOf(inward, said);
      if (mem.atStart) {
        mem.phase = 'steps';
        tellSteps();
      } else {
        mem.phase = 'tile';
        say(`${ID}.out.tile`, { force: true });
        tellTile();
      }
    } else if (now - (mem.since ?? now) >= REPEAT_MS || has('again')) {
      mem.since = now;
      if (!mem.atStart) say(`${ID}.out.side.${o.edges[opposite(dirOf(inward)!)].face}`, { force: true });
      say(`${ID}.out.lava`, { force: true });
    }
  } else if (mem.phase === 'tile') {
    if (has('yes')) {
      mem.phase = 'steps';
      tellSteps();
    } else if (has('again') || now - (mem.since ?? now) >= REPEAT_MS) tellTile();
  } else if (has('yes')) {
    mem.i = Math.min(mem.i + mem.chunk, path.steps.length);
    if (mem.i < path.steps.length) tellSteps();
  } else if (has('again') || (has('no') && mem.i === 0)) tellSteps();
  else if (now - (mem.since ?? now) >= REPEAT_MS) {
    mem.since = now;
    say(`${ID}.out.ready`, { force: true });
  }
  return { action: null, status: `guiding the partner along the path: ${mem.phase}, step ${mem.i} of ${path.steps.length}` };
}

/** The middle tile of one side of the ring, on my screen. */
export const sideTile = (edge: Dir, along = 5): Cell => (edge === 'up' ? { col: along, row: 0 } : edge === 'down' ? { col: along, row: 11 } : edge === 'left' ? { col: 0, row: along } : { col: 11, row: along });

function inside(ctx: ScriptCtx<Mem>): Play | null {
  const { o, mem, heard, tokens, now, struck, objs, say } = ctx;
  if (!objs('f6-lava').some((l) => l.state === 'hot')) return null; // crusted over: nothing left to do
  const button = objs('button')[0];
  if (button && same(o.position, button)) return { action: { type: 'use' }, allow: [button], status: 'pressing the button' };
  const ask = (key: string) => {
    if (mem.since === null) mem.since = now;
    if (now - mem.since < ASK_MS) return;
    mem.since = now;
    say(key, { force: true });
  };
  const steps = heard.flatMap((h) => stepsIn(h.text));
  const tile = heard.map((h) => rowColumnIn(h.text)).find((t) => t.row !== undefined || t.column !== undefined);
  if (struck) {
    // I fell: I am back on the ring, on the tile the path starts on
    Object.assign(mem, { queue: [], going: null, walked: false, phase: 'steps', since: now });
    say(`${ID}.in.fell`, { force: true });
    return { action: null, status: 'fell in the lava: asking again' };
  }

  if (mem.phase === 'side' || mem.phase === 'lava') {
    // "face 4", or just the number: the question asks for the face number
    const bare = mem.edge ? undefined : heard.map((h) => /^\s*([1-6])\s*$/.exec(h.text)?.[1]).filter((n) => n !== undefined).at(-1);
    const face = tokens.flatMap((t) => (t.t === 'face' ? [t.face] : [])).at(-1) ?? (bare === undefined ? undefined : Number(bare));
    const edge = DIRS.find((d) => o.edges[d].face === face);
    if (edge) {
      Object.assign(mem, { edge, phase: 'lava', since: now });
      ctx.cancel(`${ID}.in.side`);
    }
    if (!mem.edge) {
      say(`${ID}.in.side`);
      ask(`${ID}.in.side`);
      return { action: null, status: 'on the ring: waiting to hear where the path starts' };
    }
    const spot = sideTile(mem.edge);
    if (!same(o.position, spot)) return { action: { type: 'goto', col: spot.col, row: spot.row }, status: 'walking round the ring to the side the path starts from' };
    say(`${ID}.in.lava.${opposite(mem.edge)}`, { force: true });
    say(`${ID}.in.tile`, { force: true });
    Object.assign(mem, { phase: 'tile', since: now });
    return { action: null, status: 'on the side the path starts from' };
  }
  if (mem.phase === 'tile') {
    const n = mem.edge === 'left' || mem.edge === 'right' ? tile?.row : tile?.column;
    if (n !== undefined) {
      mem.going = sideTile(mem.edge!, n - 1);
      mem.since = now;
      ctx.cancel(`${ID}.in.tile`); // answered: the question must not come after the answer
    }
    if (mem.going) {
      if (!same(o.position, mem.going)) return { action: { type: 'goto', col: mem.going.col, row: mem.going.row }, status: 'walking along the ring to the start tile' };
      Object.assign(mem, { going: null, phase: 'steps', since: now });
      say(`${ID}.in.ready`, { force: true });
      return { action: null, status: 'on the start tile' };
    }
    if (!steps.length) {
      ask(`${ID}.in.tile`);
      return { action: null, status: 'waiting to hear which tile to start from' };
    }
    mem.phase = 'steps'; // steps straight away: the human steers from here
    ctx.cancel(`${ID}.in.tile`);
  }

  // ---- steps: one at a time, only where I was told ----
  if (steps.length) {
    mem.queue.push(...steps);
    ctx.cancel(`${ID}.in.ask`, `${ID}.in.ready`);
  }
  if (mem.going && same(o.position, mem.going)) {
    mem.queue.shift();
    mem.going = null;
    mem.walked = true;
  }
  const next = mem.queue[0];
  if (next) {
    const to = { col: o.position.col + VEC[next].col, row: o.position.row + VEC[next].row };
    if (to.col < 0 || to.row < 0 || to.col > 11 || to.row > 11) {
      mem.queue.shift(); // that way lies another face: not a step of this path
      return { action: null, status: 'told to step off the face: skipped' };
    }
    mem.going = to;
    mem.since = now;
    return { action: { type: 'move', dir: next, steps: 1 }, allow: [to], status: `stepping ${next}, as told` };
  }
  if (mem.walked) {
    mem.walked = false;
    mem.since = now;
    say(`${ID}.in.done`, { force: true });
  } else ask(`${ID}.in.ask`);
  return { action: null, hold: true, status: 'waiting to be told the next step' };
}

export const laserPathScript: PuzzleScript<Mem> = {
  id: ID,
  lines: [
    RELAY,
    `${ID}.out.mirrors`,
    ...[1, 2, 3, 4].map((f) => `${ID}.out.side.${f}`),
    `${ID}.out.lava`,
    `${ID}.out.tile`,
    `${ID}.out.ready`,
    `${ID}.out.fell`,
    `${ID}.in.side`,
    ...DIRS.map((d) => `${ID}.in.lava.${d}`),
    `${ID}.in.tile`,
    `${ID}.in.ready`,
    `${ID}.in.done`,
    `${ID}.in.ask`,
    `${ID}.in.fell`,
  ],
  init: () => ({ since: null, tries: 0, phase: 'side', k: 0, i: 0, chunk: 0, atStart: false, edge: null, queue: [], going: null, walked: false }),
  play: (ctx) => (ctx.o.you === 'out' ? outside(ctx) : inside(ctx)),
};
