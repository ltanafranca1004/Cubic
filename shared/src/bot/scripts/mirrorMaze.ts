import type { Observation } from '../observe';
import { DIRS, type Dir, type Heard } from '../talk';
import { VEC, agreeTurn, around, cellKey, dirOf, flood, same, throughWall, type Cell } from './grid';
import type { PuzzleScript } from './types';

// MIRROR MAZE (face 4).
// The two players see the wall mirrored and maybe turned, so first they agree on
// directions with one landmark question ("where is the crystal from the doorway: up left").
// Outside: call the stepping stones one step at a time in the HUMAN's screen directions;
// the human answers "yes" after each step. A new line of stones means they fell.
// Inside: walk to the doorway, onto the first stone, then exactly the directions the human
// types, one step each. Never anywhere else in the room.

const RESAY_MS = 25_000;
const MAX_QUEUE = 8;

interface Mem {
  /** Quarter turns between my screen and the human's (plus the mirror). null = not agreed yet. */
  rot: number | null;
  /** The stepping stones as last seen, to notice that they moved. */
  trail: string;
  /** Calling: the stone the human stands on (-1 = still at the doorway). */
  at: number;
  called: number;
  calledAt: number;
  /** Walking: directions the human gave, in my own screen space. */
  queue: Dir[];
  moved: boolean;
}

/** The inside view of the room: doorway, crystal, trap floor, the one stone the rules give away. */
function room(o: Observation) {
  const entry = o.objects.find((x) => x.type === 'entry');
  const crystal = entry ? o.objects.find((x) => x.type === 'crystal' && x.state !== 'taken') : undefined;
  const field = entry && crystal ? flood(o, crystal, (c) => same(c, entry)) : [];
  const inField = (c: Cell) => field.some((f) => same(f, c));
  return { entry, crystal, field, inField, first: entry ? around(entry).find(inField) : undefined };
}
const dirs = (h: Heard) => h.tokens.flatMap((t) => (t.t === 'dir' ? [t.dir] : []));

export const mirrorMazeScript: PuzzleScript<Mem> = {
  id: 'mirror-maze',
  lines: [
    'mirror-maze.calib',
    'mirror-maze.stepin',
    ...DIRS.map((d) => `mirror-maze.go.${d}`),
    'mirror-maze.fell',
    'mirror-maze.toDoor',
    'mirror-maze.askCalib',
    'mirror-maze.guide',
    'mirror-maze.wall',
    'mirror-maze.ok',
    'mirror-maze.fellIn',
  ],
  init: () => ({ rot: null, trail: '', at: -1, called: -2, calledAt: 0, queue: [], moved: false }),

  // The whole trap floor, except tiles already walked and the first stone behind the doorway.
  hazards(o) {
    const { field, first } = room(o);
    const walked = o.objects.filter((x) => x.type === 'step');
    return field.filter((f) => !walked.some((w) => same(w, f)) && !same(f, first));
  },

  play({ o, mem: m, heard, objs, say, has, now, struck }) {
    const pos = o.position;

    // ---- outside: call the steps ----
    if (o.you === 'out') {
      const trail = objs('trail');
      if (trail.length < 2) return null;
      const shape = trail.map(cellKey).join(' ');
      if (m.trail !== shape) {
        const moved = m.trail !== '';
        Object.assign(m, { trail: shape, at: -1, called: -2 });
        if (moved && m.rot !== null) say('mirror-maze.fell', { force: true });
      }
      const line = { col: trail.at(-1)!.col - trail[0]!.col, row: trail.at(-1)!.row - trail[0]!.row };
      if (m.rot === null) {
        for (const h of heard) m.rot ??= agreeTurn(line, dirs(h));
        if (m.rot === null) {
          say('mirror-maze.calib', { every: RESAY_MS, force: has('again') });
          return { action: null, status: 'asking where the crystal is on the partner screen, to agree on directions' };
        }
        say('mirror-maze.stepin', { force: true });
        return { action: null, status: 'waiting for the partner to step into the room' };
      }
      const ack = has('yes', 'go');
      if (m.at === -1) {
        if (ack) m.at = 0;
        else {
          if (has('again')) say('mirror-maze.stepin', { force: true });
          return { action: null, status: 'waiting for the partner to step into the room' };
        }
      } else if (ack && m.called === m.at) m.at++;
      if (m.at < trail.length - 1) {
        const step = { col: trail[m.at + 1]!.col - trail[m.at]!.col, row: trail[m.at + 1]!.row - trail[m.at]!.row };
        const dir = dirOf(throughWall(step, m.rot));
        if (dir && (m.called !== m.at || has('no', 'again') || now - m.calledAt >= RESAY_MS)) {
          say(`mirror-maze.go.${dir}`, { force: true });
          m.called = m.at;
          m.calledAt = now;
        }
      }
      return { action: null, status: `calling the safe steps: the partner is on stone ${m.at + 1} of ${trail.length}` };
    }

    // ---- inside: walk only where the partner says ----
    const { entry, crystal, inField, first } = room(o);
    if (!entry || !crystal || !first) return null;
    if (!same(pos, entry) && !inField(pos)) {
      m.queue = [];
      say('mirror-maze.toDoor');
      return { action: { type: 'goto', col: entry.col, row: entry.row }, status: 'walking to the doorway of the trap room' };
    }
    if (struck) {
      m.queue = [];
      m.moved = false;
      if (m.rot !== null) say('mirror-maze.fellIn', { force: true });
    }
    let calibrated = -1;
    if (m.rot === null) {
      const line = { col: crystal.col - first.col, row: crystal.row - first.row };
      heard.forEach((h, i) => {
        if (m.rot !== null) return;
        m.rot = agreeTurn(line, dirs(h));
        if (m.rot !== null) calibrated = i;
      });
    }
    // The first stone is the tile behind the doorway: that much the rules give away.
    if (same(pos, entry)) return { action: { type: 'goto', col: first.col, row: first.row }, status: 'stepping onto the first stone, just inside the doorway' };
    if (m.rot === null) {
      say('mirror-maze.askCalib', { every: RESAY_MS, force: has('again') });
      return { action: null, hold: true, status: 'on the first stone, asking where the last stone is on the partner screen' };
    }
    const turn = m.rot;
    if (calibrated >= 0 || has('again')) say('mirror-maze.guide', { force: true });
    else if (!struck) say('mirror-maze.guide');
    heard.forEach((h, i) => {
      if (i === calibrated) return;
      for (const t of h.tokens) {
        if (t.t !== 'dir') continue;
        const mine = DIRS.find((d) => dirOf(throughWall(VEC[d], turn)) === t.dir)!;
        for (let n = 0; n < t.n && m.queue.length < MAX_QUEUE; n++) m.queue.push(mine);
      }
    });
    const next = m.queue[0];
    if (next) {
      const to = { col: pos.col + VEC[next].col, row: pos.row + VEC[next].row };
      if (!inField(to)) {
        m.queue = [];
        say('mirror-maze.wall', { force: true });
        return { action: null, hold: true, status: 'the direction given leads into a wall' };
      }
      m.queue.shift();
      m.moved = true;
      return { action: { type: 'move', dir: next, steps: 1 }, allow: [to], status: 'taking the step the partner called' };
    }
    if (m.moved) {
      m.moved = false;
      say('mirror-maze.ok', { force: true });
    }
    return { action: null, hold: true, status: 'in the trap room, waiting for the next direction' };
  },
};
