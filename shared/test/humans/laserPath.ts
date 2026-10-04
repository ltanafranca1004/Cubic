import { DIRS, dirOf, throughWall, VEC, type Dir } from '../../src/index';
import { canonDir, partnerCell, rowColumnIn, runsOf, stepsIn, turnOf } from '../../src/bot/scripts/kit456';
import { mirrorPush, opposite, pathOf, sideTile } from '../../src/bot/scripts/laserPath';
import { canonOf, wordsOf, type Tile } from '../../src/bot/scripts/relayKit';
import type { HumanCtx, HumanScript } from '../partnerSim';

// The simulated human for LASER PATH (face 6), either side, only from its own screen, in
// the convention of src/bot/scripts/laserPath.ts. Inside: it goes to the side of the ring
// the AI names, says which way the lava is, stands on the tile the AI names and takes the
// steps it is told, with "yes" after each line. Outside: it pushes the mirrors, takes the
// flower, and guides the AI the same way.

const ID = 'laser-path';
const RELAY = `${ID}.relay`;

export interface LaserPathHumanOptions {
  /** Outside: never say anything. */
  mute?: boolean;
  /** Inside: take this many wrong first steps (a fall each) before doing as told. */
  slips?: number;
}

interface HumanMem {
  /** Inside: the side I was sent to, a tile I am walking to (then "yes"), raw steps still to take, then E. */
  edge: Dir | null;
  walkTo: Tile | null;
  confirm: boolean;
  moves: Dir[];
  press: boolean;
  /** Outside: asked for the side; said it; the turn; the next path step to say. */
  asked: boolean;
  told: boolean;
  k: number;
  i: number;
  strikes: number;
  slipped: number;
}

/** The inside human: does exactly what the partner's lines say, on its own screen. */
function humanInside({ o, mem, next, walk, move, interact, say }: HumanCtx<HumanMem>, opts: LaserPathHumanOptions): void {
  if (o.strikes > mem.strikes) Object.assign(mem, { strikes: o.strikes, moves: [], press: false }); // I fell: back on the ring
  if (mem.walkTo) {
    if (!walk(mem.walkTo)) return;
    mem.walkTo = null;
    if (mem.confirm) say('yes');
    mem.confirm = false;
    return;
  }
  if (mem.moves.length) {
    const d = VEC[mem.moves.shift()!];
    move(d.col, d.row);
    if (!mem.moves.length && !mem.press) say('yes');
    return;
  }
  if (mem.press) {
    mem.press = false;
    return interact();
  }
  const line = next();
  if (!line) return;
  const side = /^laser-path\.out\.side\.(\d)$/.exec(line.key);
  if (side) {
    // somewhere on that side of the ring: not the right tile yet, the partner says which
    mem.edge = DIRS.find((d) => o.edges[d].face === Number(side[1])) ?? null;
    if (mem.edge) mem.walkTo = canonOf(o, sideTile(mem.edge, 2));
  } else if (line.key === `${ID}.out.lava` && mem.edge) say(opposite(mem.edge));
  else if (line.key === `${ID}.out.fell`) Object.assign(mem, { moves: [], press: false });
  else if (line.key === RELAY) {
    const words = String(line.args?.words ?? '');
    const tile = rowColumnIn(words);
    const n = tile.row ?? tile.column;
    if (n !== undefined && mem.edge) Object.assign(mem, { walkTo: canonOf(o, sideTile(mem.edge, n - 1)), confirm: true });
    else if (n === undefined && mem.slipped < (opts.slips ?? 0)) {
      // a mistake: straight on across the lava instead of what was said
      mem.slipped++;
      Object.assign(mem, { moves: Array<Dir>(10).fill(opposite(mem.edge!)), press: false });
    } else if (n === undefined) Object.assign(mem, { moves: stepsIn(words), press: wordsOf(words).includes('press') });
  }
}

export const laserPathHuman = (opts: LaserPathHumanOptions = {}): HumanScript<HumanMem> => ({
  id: ID,
  init: () => ({ edge: null, walkTo: null, confirm: false, moves: [], press: false, asked: false, told: false, k: 0, i: 0, strikes: 0, slipped: 0 }),

  play(ctx) {
    const { side, o, mem, seen, next, walk, move, interact, say } = ctx;
    if (side === 'in') return humanInside(ctx, opts);
    if (opts.mute) return void next();

    // ---- outside: the mirrors, the flower, then guide the partner ----
    const one = (type: string, state?: string): Tile | undefined => seen(type).find((x) => state === undefined || x.state === state);
    const crate = seen('f6-crate')[0];
    const reset = one('reset')!;
    if (crate?.state !== 'burnt') {
      const push = mirrorPush(one('f6-mirror', 'fwd'), one('f6-mirror', 'back'), one('f6-source'), crate);
      if (push === 'reset') return void (walk(reset) && interact());
      if (push === null || push === 'set') return;
      if (!walk(push.stand)) return;
      const d = VEC[canonDir(o, push.dx, push.dy)];
      return move(d.col, d.row);
    }
    const path = pathOf(o.objects.filter((x) => x.type === 'f6-path'));
    if (!path) return void (walk(reset) && interact());
    const flower = o.items.find((i) => i.kind.startsWith('flower-'));
    if (!o.carrying && flower) return void (walk(canonOf(o, flower)) && interact());

    const inward = path.steps[0]!;
    const dirs = path.steps.map((v) => dirOf(throughWall(v, mem.k))!);
    const tell = () => {
      const runs = runsOf(dirs.slice(mem.i)).slice(0, 2);
      mem.i += runs.reduce((n, r) => n + r[1], 0);
      say(runs.map(([d, n]) => `${d} ${n}`).join(' then ') + (mem.i >= dirs.length ? ' then press' : ''));
    };
    const line = next();
    if (line?.key === `${ID}.in.side`) mem.asked = true;
    if (mem.asked && !mem.told) {
      mem.told = true;
      return say(`face ${o.edges[opposite(dirOf(inward)!)].face}`);
    }
    const lava = /^laser-path\.in\.lava\.(\w+)$/.exec(line?.key ?? '');
    if (lava) {
      // the same step on my screen and on theirs: now I know how their screen is turned
      mem.k = turnOf(inward, lava[1] as Dir);
      const theirs = partnerCell(path.ring, mem.k);
      return say(lava[1] === 'left' || lava[1] === 'right' ? `row ${theirs.row + 1}` : `column ${theirs.col + 1}`);
    }
    if (line?.key === `${ID}.in.fell`) mem.i = 0;
    if (line && [`${ID}.in.ready`, `${ID}.in.done`, `${ID}.in.fell`].includes(line.key) && mem.i < dirs.length) tell();
  },
});
