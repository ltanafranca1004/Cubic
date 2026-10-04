import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODE_LEN,
  FACES,
  FACE_SIZE,
  MOVES,
  SIDES,
  SPAWN,
  createGame,
  defaultEnv,
  devSolve,
  findPath,
  glyphCode,
  isBlocked,
  isSolidTile,
  objectiveFor,
  objectsOn,
  pathTo,
  safeLine,
  visibleObjects,
  type FaceId,
  type GameState,
  type Side,
  type TileRef,
} from '../src/index';
import { around, flood, keyOf, type XY } from '../src/puzzles/util';
import { solver, type Solver } from './harness';
import { SOLUTIONS } from './solutions';

// The three co-op puzzles (code relay on face 3, mirror maze on face 4, skylight on face 5).
// Everything is played with real moves through the engine. For each puzzle there is a
// "cannot be solved alone" test: either the missing half is an ACTION only the other
// player's body can do, or it is INFORMATION that is not in this side's view and differs
// from game to game.
// Run just this file: npx tsx --test shared/test/coop.test.ts

const world = defaultEnv.world;
const tile = (face: FaceId, o: XY): TileRef => ({ face, x: o.x, y: o.y });
const find = (side: Side, face: FaceId, type: string, name?: string): TileRef => {
  const o = objectsOn(world, side, face, type).find((x) => name === undefined || x.name === name);
  assert.ok(o, `no ${type} on ${side} ${face}`);
  return tile(face, o);
};
const sees = (s: GameState, side: Side, face: FaceId, type?: string) => visibleObjects(s, side, face).filter((o) => !type || o.type === type);
const where = (s: GameState, side: Side) => {
  const p = s.players[side].pose;
  return [p.face, p.x, p.y];
};
const puzzle = <T>(s: GameState, id: string) => s.puzzles[id] as T;
/** Everything one side can perceive of a face: what is drawn, and the objective line. */
const view = (s: GameState, side: Side, face: FaceId) => JSON.stringify([sees(s, side, face), s.players[side].pose.face === face ? objectiveFor(s, side) : null]);
/** Step `side` off the tile it stands on, in any direction that works. */
function stepOff(t: Solver, side: Side) {
  for (const [dx, dy] of MOVES) {
    const evs = t.move(side, dx, dy);
    if (!evs.some((e) => e.type === 'bump')) return evs;
  }
  return assert.fail(`${side} cannot step off`);
}
const allFacesReachable = (s: GameState, what: string) => {
  for (const side of SIDES) for (const face of FACES) assert.ok(findPath(s, side, (p) => p.face === face), `${what}: ${side} cannot reach face ${face}`);
};
const SEEDS = Array.from({ length: 200 }, (_, i) => 1_760_000_000_000 + i * 7919);

// ---------- code relay (face 3) ----------

const SIGNS = objectsOn(world, 'out', 3, 'glyph').map((g) => g.name);

test('code relay: the map has six different sign stones, a plate, a tablet and one lamp per sign', () => {
  assert.equal(SIGNS.length, 6);
  assert.equal(new Set(SIGNS).size, 6);
  assert.equal(objectsOn(world, 'in', 3, 'plate').length, 1);
  assert.equal(objectsOn(world, 'in', 3, 'tablet').length, 1);
  assert.equal(objectsOn(world, 'in', 3, 'lamp').length, CODE_LEN);
  // Every stone sits in a dead-end niche, so a walk to somewhere else never crosses one.
  for (const g of objectsOn(world, 'out', 3, 'glyph')) {
    const open = around(g).filter((n) => !isSolidTile(world, 'out', 3, n.x, n.y));
    assert.ok(open.length <= 1, `stone ${g.name} at ${keyOf(g)} is not in a niche`);
  }
});

test('code relay: the code is CODE_LEN signs, never two the same in a row, and differs from game to game', () => {
  const codes = new Set<string>();
  for (const seed of SEEDS) {
    const code = glyphCode(seed, 0, SIGNS);
    assert.equal(code.length, CODE_LEN);
    code.forEach((sign, i) => {
      assert.ok(SIGNS.includes(sign));
      assert.notEqual(sign, code[i - 1]);
    });
    assert.deepEqual(glyphCode(seed, 0, SIGNS), code, 'same game, same code');
    codes.add(code.join(' '));
  }
  assert.ok(codes.size > 100, `only ${codes.size} different codes in ${SEEDS.length} games`);
  assert.notDeepEqual(glyphCode(SEEDS[0]!, 1, SIGNS), glyphCode(SEEDS[0]!, 0, SIGNS), 'a wrong stone changes the code');
});

test('code relay: each side sees only its half', () => {
  const s = createGame(SEEDS[0]!);
  const t = solver(s);
  assert.deepEqual([...new Set(sees(s, 'out', 3).map((o) => o.type))], ['glyph']);
  assert.deepEqual([...new Set(sees(s, 'in', 3).map((o) => o.type))].sort(), ['lamp', 'plate', 'tablet']);
  // Nobody on the plate: the tablet is blank and the stones sleep.
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, 'off');
  assert.ok(sees(s, 'out', 3, 'glyph').every((g) => g.state!.endsWith('-off')));
  t.go('in', find('in', 3, 'plate'));
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, glyphCode(s.startedAt, 0, SIGNS)[0]);
  assert.equal(sees(s, 'in', 3, 'plate')[0]!.state, 'on');
  // Awake stones show their own sign: the same list whatever the code is.
  assert.deepEqual(sees(s, 'out', 3, 'glyph').map((g) => g.state), SIGNS);
  assert.ok(t.events.some((e) => e.type === 'puzzle' && e.name === 'glyph-wake'));
});

test('code relay: right stones count up, a wrong stone is a strike and a new code, four right solve it', () => {
  const s = createGame(SEEDS[1]!);
  const t = solver(s);
  const stone = (sign: string) => find('out', 3, 'glyph', sign);
  t.go('in', find('in', 3, 'plate'));
  const code = glyphCode(s.startedAt, 0, SIGNS);
  t.go('out', stone(code[0]!));
  t.go('out', stone(code[1]!));
  assert.equal(puzzle<{ progress: number }>(s, 'glyph-code').progress, 2);
  assert.deepEqual(sees(s, 'in', 3, 'lamp').map((l) => l.state), ['on', 'on', 'off', 'off']);
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, code[2]);

  const wrong = SIGNS.find((n) => n !== code[2] && n !== code[1])!;
  const evs = t.go('out', stone(wrong));
  assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'out'));
  assert.ok(evs.some((e) => e.type === 'puzzle' && e.name === 'glyph-wrong'));
  assert.deepEqual(puzzle(s, 'glyph-code'), { progress: 0, attempt: 1 });
  assert.equal(s.strikes, 1);
  assert.ok(sees(s, 'in', 3, 'lamp').every((l) => l.state === 'off'));

  // The second try, with the new code. Out is standing on a stone: if that is the first
  // sign, it has to step off and on again.
  const next = glyphCode(s.startedAt, 1, SIGNS);
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, next[0]);
  if (next[0] === wrong) stepOff(t, 'out');
  for (const sign of next) t.go('out', stone(sign));
  assert.deepEqual(s.solved, [3]);
  assert.equal(s.strikes, 1);
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, 'done');
  // Solved: more stones change nothing.
  stepOff(t, 'out');
  t.go('out', stone(wrong));
  assert.equal(s.strikes, 1);
});

test('code relay: stepping off the plate keeps the progress and puts the stones back to sleep', () => {
  const s = createGame(SEEDS[2]!);
  const t = solver(s);
  const code = glyphCode(s.startedAt, 0, SIGNS);
  t.go('in', find('in', 3, 'plate'));
  t.go('out', find('out', 3, 'glyph', code[0]));
  const evs = stepOff(t, 'in');
  assert.ok(evs.some((e) => e.type === 'puzzle' && e.name === 'glyph-sleep'));
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, 'off');
  assert.ok(sees(s, 'out', 3, 'glyph').every((g) => g.state!.endsWith('-off')));
  assert.equal(puzzle<{ progress: number }>(s, 'glyph-code').progress, 1);
});

test('code relay: CANNOT BE SOLVED ALONE (outside): without a reader on the plate no stone does anything', () => {
  const s = createGame(SEEDS[3]!);
  const t = solver(s);
  const before = JSON.stringify(s.puzzles['glyph-code']);
  // Every stone, twice, in two orders. The state never changes, so by induction no
  // sequence of stones of any length can solve it.
  for (const sign of [...SIGNS, ...[...SIGNS].reverse(), ...SIGNS]) {
    t.go('out', find('out', 3, 'glyph', sign));
    stepOff(t, 'out');
    assert.equal(JSON.stringify(s.puzzles['glyph-code']), before);
  }
  assert.deepEqual(s.solved, []);
  assert.equal(s.strikes, 0);
});

test('code relay: CANNOT BE SOLVED ALONE (outside): the wanted sign is not in the outside view, and differs per game', () => {
  // Two games whose codes start differently look exactly the same from outside, with
  // the reader on the plate: nothing the outside player sees tells them which stone.
  const games = SEEDS.slice(0, 40).map((seed) => {
    const s = createGame(seed);
    const t = solver(s);
    t.go('in', find('in', 3, 'plate'));
    t.go('out', { face: 3, x: 5, y: 5 });
    return { first: glyphCode(seed, 0, SIGNS)[0], out: view(s, 'out', 3) };
  });
  assert.equal(new Set(games.map((g) => g.out)).size, 1, 'the outside view depends on the code');
  assert.ok(new Set(games.map((g) => g.first)).size >= 4, 'the first sign barely changes between games');
});

test('code relay: CANNOT BE SOLVED ALONE (inside): nothing the inside player does enters a sign', () => {
  const s = createGame(SEEDS[4]!);
  const t = solver(s);
  // Walk over every tile of the frost room, the plate included.
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      if (isSolidTile(world, 'in', 3, x, y)) continue;
      t.go('in', { face: 3, x, y });
      t.interact('in');
    }
  }
  assert.deepEqual(puzzle(s, 'glyph-code'), { progress: 0, attempt: 0 });
  assert.deepEqual(s.solved, []);
});

// ---------- mirror maze (face 4) ----------

const ENTRY = find('in', 4, 'entry');
const GOAL = find('in', 4, 'crystal');
const FIELD = flood(world.in[4].tiles, GOAL, [ENTRY]);

test('mirror maze: the trap room is walled in, with the doorway as its only way in', () => {
  assert.ok(FIELD.length >= 40, `the room is only ${FIELD.length} tiles`);
  // Without the doorway the room cannot be reached at all: nobody walks through it by accident.
  const outside = flood(world.in[4].tiles, { x: 0, y: 0 }, [ENTRY]);
  assert.ok(!outside.some((o) => FIELD.some((f) => f.x === o.x && f.y === o.y)));
  // The same tiles are open floor on the forest side, so the stones are never under a tree.
  for (const f of FIELD) assert.equal(isSolidTile(world, 'out', 4, f.x, f.y), false, `a tree hides the stone at ${keyOf(f)}`);
});

test('mirror maze: the safe line runs from the doorway to the crystal, never touches itself, and differs per game', () => {
  const lines = new Set<string>();
  for (const seed of SEEDS) {
    const line = safeLine(seed, 0, FIELD, ENTRY, GOAL);
    assert.ok(line.length >= 2);
    assert.equal(Math.abs(line[0]!.x - ENTRY.x) + Math.abs(line[0]!.y - ENTRY.y), 1, 'starts behind the doorway');
    assert.deepEqual(line.at(-1), { x: GOAL.x, y: GOAL.y });
    line.forEach((a, i) => {
      assert.ok(FIELD.some((f) => f.x === a.x && f.y === a.y));
      line.forEach((b, j) => {
        const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        // consecutive tiles are neighbours, and no two others are: there is no shortcut
        if (j === i + 1) assert.equal(d, 1);
        else if (j > i + 1) assert.ok(d > 1, `the line touches itself at ${keyOf(a)} / ${keyOf(b)}`);
      });
    });
    assert.deepEqual(safeLine(seed, 0, FIELD, ENTRY, GOAL), line, 'same game, same line');
    lines.add(line.map(keyOf).join(' '));
  }
  assert.ok(lines.size > SEEDS.length * 0.8, `only ${lines.size} different lines in ${SEEDS.length} games`);
});

test('mirror maze: each side sees only its half, on the same canonical tiles', () => {
  const s = createGame(SEEDS[0]!);
  const line = safeLine(s.startedAt, 0, FIELD, ENTRY, GOAL);
  const trail = sees(s, 'out', 4);
  assert.deepEqual([...new Set(trail.map((o) => o.type))], ['trail']);
  assert.deepEqual(trail.map((o) => ({ x: o.x, y: o.y })), line); // in walking order
  assert.deepEqual([trail[0]!.state, trail.at(-1)!.state], ['start', 'end']);
  // Inside: the doorway and the crystal, and not one stone.
  assert.deepEqual(sees(s, 'in', 4).map((o) => o.type).sort(), ['crystal', 'entry']);
});

test('mirror maze: safe tiles hold, a wrong tile is a strike, back to the doorway and a new line', () => {
  const s = createGame(SEEDS[1]!);
  const t = solver(s);
  const line = safeLine(s.startedAt, 0, FIELD, ENTRY, GOAL);
  t.go('in', ENTRY);
  t.go('in', tile(4, line[0]!));
  t.go('in', tile(4, line[1]!));
  assert.deepEqual(sees(s, 'in', 4, 'step').map(keyOf), line.slice(0, 2).map(keyOf));
  assert.equal(s.strikes, 0);

  const wrong = around(line[1]!).find((n) => FIELD.some((f) => keyOf(f) === keyOf(n)) && !line.some((l) => keyOf(l) === keyOf(n)))!;
  const evs = t.go('out', { face: 4, x: 0, y: 0 }); // (the partner is watching)
  assert.equal(evs.some((e) => e.type === 'strike'), false);
  const fall = pathTo(s, 'in', tile(4, wrong))!.flatMap(([dx, dy]) => t.move('in', dx, dy));
  assert.ok(fall.some((e) => e.type === 'strike' && e.side === 'in'));
  assert.ok(fall.some((e) => e.type === 'puzzle' && e.name === 'maze-fall'));
  assert.deepEqual(where(s, 'in'), [4, ENTRY.x, ENTRY.y]);
  assert.deepEqual(puzzle(s, 'mirror-maze'), { attempt: 1, walked: [], taken: false });
  assert.deepEqual(sees(s, 'out', 4).map((o) => ({ x: o.x, y: o.y })), safeLine(s.startedAt, 1, FIELD, ENTRY, GOAL));
  allFacesReachable(s, 'after a fall');

  // The new line, walked right: solved, and from then on the whole floor holds.
  for (const step of safeLine(s.startedAt, 1, FIELD, ENTRY, GOAL)) t.go('in', tile(4, step));
  assert.deepEqual(s.solved, [4]);
  assert.equal(s.strikes, 1);
  for (const f of FIELD.slice(0, 20)) t.go('in', tile(4, f));
  assert.equal(s.strikes, 1);
});

test('mirror maze: CANNOT BE SOLVED ALONE (inside): the line is not in the inside view, and differs per game', () => {
  // Standing in the doorway, every game looks the same from inside...
  const games = SEEDS.slice(0, 40).map((seed) => {
    const s = createGame(seed);
    solver(s).go('in', ENTRY);
    return { s, seed, inside: view(s, 'in', 4), line: safeLine(seed, 0, FIELD, ENTRY, GOAL).map(keyOf).join(' ') };
  });
  assert.equal(new Set(games.map((g) => g.inside)).size, 1, 'the inside view depends on the safe line');
  assert.ok(new Set(games.map((g) => g.line)).size >= 35);

  // ...so the best a lone player can do is guess. A straight walk falls in every game,
  // and so does the line of any other game.
  let solved = 0;
  games.forEach((g, i) => {
    const other = games[(i + 1) % games.length]!;
    if (other.line === g.line) return;
    const t = solver(g.s);
    for (const k of other.line.split(' ')) {
      const [x, y] = k.split(',').map(Number);
      if (g.s.players.in.pose.x === ENTRY.x && g.s.players.in.pose.y === ENTRY.y && g.s.strikes > 0) break; // fell
      const path = pathTo(g.s, 'in', { face: 4, x: x!, y: y! });
      if (!path || path.length !== 1) break;
      t.move('in', path[0]![0], path[0]![1]);
    }
    if (g.s.solved.includes(4)) solved++;
    else assert.ok(g.s.strikes > 0, 'a wrong line did not fall');
  });
  assert.equal(solved, 0);
});

test('mirror maze: CANNOT BE SOLVED ALONE (outside): the outside player cannot enter the room at all', () => {
  const s = createGame(SEEDS[5]!);
  const t = solver(s);
  // The room does not exist on the outside: walking the stones out there does nothing.
  for (const stone of sees(s, 'out', 4, 'trail')) t.go('out', tile(4, stone));
  assert.deepEqual(puzzle(s, 'mirror-maze'), { attempt: 0, walked: [], taken: false });
  assert.deepEqual(s.solved, []);
});

// ---------- skylight (face 5) ----------

const PANE_A = find('out', 5, 'skylight', 'a');
const PANE_B = find('out', 5, 'skylight', 'b');
const BRIDGE_A = find('in', 5, 'bridge', 'a');
const BRIDGE_B = find('in', 5, 'bridge', 'b');
const CRYSTAL = find('in', 5, 'crystal');
/** Dry ground between the two waters: reachable from the crystal with bridge b open, a shut. */
const RING = flood(world.in[5].tiles, BRIDGE_A, []).filter(
  (r) => !flood(world.in[5].tiles, CRYSTAL, [BRIDGE_B]).some((c) => keyOf(c) === keyOf(r)) && keyOf(r) !== keyOf(BRIDGE_B) && keyOf(r) !== keyOf(BRIDGE_A) && flood(world.in[5].tiles, CRYSTAL, [BRIDGE_A]).some((c) => keyOf(c) === keyOf(r)),
);
const RING_TILE = tile(5, around(BRIDGE_B).find((n) => RING.some((r) => keyOf(r) === keyOf(n)))!);
const SPAWN_IN: TileRef = { face: 1, ...SPAWN.in };

test('skylight: the crystal is behind two waters, and the light of each pane lands on dry floor', () => {
  assert.ok(RING.length > 0, 'no dry ring between the bridges');
  // Terrain alone: the crystal's island reaches the rest of the room only over the bridges.
  const island = flood(world.in[5].tiles, CRYSTAL, [BRIDGE_A, BRIDGE_B]);
  assert.ok(!island.some((t) => t.x === 0 || t.y === 0), 'the water has a gap');
  for (const pane of [PANE_A, PANE_B]) {
    assert.equal(isSolidTile(world, 'out', 5, pane.x, pane.y), false);
    assert.equal(isSolidTile(world, 'in', 5, pane.x, pane.y), false, 'a beam lands in the water');
  }
});

test('skylight: each side sees only its half', () => {
  const s = createGame(0);
  const t = solver(s);
  assert.deepEqual(sees(s, 'out', 5).map((o) => `${o.type}:${o.state}`), ['skylight:off', 'skylight:off']);
  assert.deepEqual(sees(s, 'in', 5).map((o) => `${o.type}:${o.state}`).sort(), ['beam:off', 'beam:off', 'bridge:dark', 'bridge:dark', 'crystal:idle']);
  t.go('out', PANE_A);
  assert.deepEqual(sees(s, 'out', 5).map((o) => `${o.type}:${o.state}`).sort(), ['skylight:off', 'skylight:on']);
  const inside = sees(s, 'in', 5);
  assert.equal(inside.find((o) => o.type === 'bridge' && o.x === BRIDGE_A.x && o.y === BRIDGE_A.y)!.state, 'lit');
  assert.equal(inside.find((o) => o.type === 'bridge' && o.x === BRIDGE_B.x && o.y === BRIDGE_B.y)!.state, 'dark');
  // The beam is on the inside tile right behind the pane the partner stands on.
  assert.equal(inside.find((o) => o.type === 'beam' && o.x === PANE_A.x && o.y === PANE_A.y)!.state, 'on');
  assert.ok(!inside.some((o) => o.type === 'skylight'));
});

test('skylight: a bridge is only there while its own pane is held', () => {
  const s = createGame(0);
  const t = solver(s);
  t.go('in', { face: 5, x: 0, y: 0 });
  assert.equal(isBlocked(s, 'in', BRIDGE_A), true);
  assert.equal(isBlocked(s, 'in', BRIDGE_B), true);
  assert.equal(isBlocked(s, 'out', BRIDGE_A), false); // it is not the outside player's water
  t.go('out', PANE_A);
  assert.deepEqual([isBlocked(s, 'in', BRIDGE_A), isBlocked(s, 'in', BRIDGE_B)], [false, true]);
  t.go('out', PANE_B);
  assert.deepEqual([isBlocked(s, 'in', BRIDGE_A), isBlocked(s, 'in', BRIDGE_B)], [true, false]);
  assert.ok(t.events.some((e) => e.type === 'puzzle' && e.name === 'skylight-on'));
  assert.ok(t.events.some((e) => e.type === 'puzzle' && e.name === 'skylight-off'));
});

test('skylight: CANNOT BE SOLVED ALONE: the crystal is out of reach wherever the outside player stands still', () => {
  // The inside player alone, with the outside player parked on every single tile of the
  // roof in turn (both panes included): there is never a way to the crystal. It takes the
  // outside player moving from one pane to the other while the inside player waits between.
  const s = createGame(0);
  const t = solver(s);
  t.go('in', { face: 5, x: 0, y: 0 });
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      if (isSolidTile(world, 'out', 5, x, y)) continue;
      t.go('out', { face: 5, x, y });
      assert.equal(pathTo(s, 'in', CRYSTAL), null, `with out on ${x},${y} the crystal can be reached`);
    }
  }
  // And the outside player has no crystal to take at all.
  assert.ok(!sees(s, 'out', 5).some((o) => o.type === 'crystal'));
  assert.deepEqual(s.solved, []);
});

test('skylight: the light goes out under the inside player: back to the last dry tile, one strike, nobody stuck', () => {
  const s = createGame(0);
  const t = solver(s);
  t.go('out', PANE_A);
  t.go('in', BRIDGE_A);
  const dry = puzzle<{ dry: XY }>(s, 'skylight').dry;
  const evs = stepOff(t, 'out');
  assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'in'));
  assert.ok(evs.some((e) => e.type === 'puzzle' && e.name === 'skylight-fall'));
  assert.deepEqual(where(s, 'in'), [5, dry.x, dry.y]);
  assert.equal(isSolidTile(world, 'in', 5, dry.x, dry.y), false);
  assert.notDeepEqual([dry.x, dry.y], [BRIDGE_A.x, BRIDGE_A.y]);
  assert.equal(s.strikes, 1);
  allFacesReachable(s, 'after falling off bridge a');
});

test('skylight: left in the dark between the waters, the inside player can always walk out, never further in', () => {
  const s = createGame(0);
  const t = solver(s);
  t.go('out', PANE_A);
  t.go('in', RING_TILE);
  stepOff(t, 'out'); // the partner wanders off
  assert.deepEqual(where(s, 'in'), [5, RING_TILE.x, RING_TILE.y]); // dry ground: no fall
  assert.equal(s.strikes, 0);
  assert.equal(pathTo(s, 'in', CRYSTAL), null);
  allFacesReachable(s, 'in the dark on the ring');
  t.go('in', SPAWN_IN); // real moves, over the dark bridge and home
  assert.equal(s.strikes, 0);
  assert.equal(isBlocked(s, 'in', BRIDGE_A), true); // and it is shut again behind them
  assert.equal(pathTo(s, 'in', RING_TILE), null);
});

test('skylight: left in the dark on the island, the inside player can still walk all the way out', () => {
  const s = createGame(0);
  const t = solver(s);
  t.go('out', PANE_A);
  t.go('in', RING_TILE);
  t.go('out', PANE_B);
  const island = around(BRIDGE_B).find((n) => !isSolidTile(world, 'in', 5, n.x, n.y) && keyOf(n) !== keyOf(RING_TILE) && keyOf(n) !== keyOf(CRYSTAL))!;
  t.go('in', tile(5, island));
  t.go('out', { face: 1, ...SPAWN.out }); // the partner leaves the roof altogether
  assert.deepEqual(s.solved, []);
  allFacesReachable(s, 'in the dark on the island');
  t.go('in', SPAWN_IN);
  assert.equal(s.strikes, 0);
});

test('skylight: once the crystal is taken both bridges stay, whoever stands where', () => {
  const s = createGame(0);
  const t = solver(s);
  SOLUTIONS.skylight!(t);
  assert.deepEqual(s.solved, [5]);
  assert.equal(s.strikes, 0);
  t.go('out', { face: 1, ...SPAWN.out });
  assert.deepEqual(sees(s, 'in', 5, 'bridge').map((b) => b.state), ['lit', 'lit']);
  t.go('in', SPAWN_IN);
  t.go('in', CRYSTAL);
});

// ---------- all of them ----------

test('co-op puzzles: every face stays reachable for both players at every stage of the game', () => {
  const s = createGame(SEEDS[6]!);
  const t = solver(s);
  allFacesReachable(s, 'fresh game');
  for (const p of defaultEnv.puzzles) {
    SOLUTIONS[p.id]!(t);
    allFacesReachable(s, `after ${p.id}`);
    // Not only on paper: both actually walk home and back out.
    t.go('out', { face: 1, ...SPAWN.out });
    t.go('in', SPAWN_IN);
  }
  assert.deepEqual(s.solved, [1, 3, 4, 5, 6]);
});

test('co-op puzzles: the dev "solve" latch opens each one the same way the real solve does', () => {
  const s = createGame(0);
  for (const face of [3, 4, 5] as const) devSolve(s, face, 1);
  const t = solver(s);
  t.go('in', CRYSTAL); // bridges are there
  t.go('in', tile(4, FIELD[FIELD.length - 1]!)); // the floor holds
  assert.equal(s.strikes, 0);
  assert.equal(sees(s, 'in', 3, 'tablet')[0]!.state, 'done');
});

test('co-op puzzles: both sides get an objective line on every puzzle face, and they differ', () => {
  const s = createGame(0);
  const t = solver(s);
  for (const face of [3, 4, 5] as const) {
    t.go('out', { face, x: 0, y: 0 });
    t.go('in', { face, x: 0, y: 0 });
    const [out, inn] = [objectiveFor(s, 'out'), objectiveFor(s, 'in')];
    assert.ok(out.length > 10 && inn.length > 10);
    assert.ok(out.length <= 100 && inn.length <= 100, `face ${face}: an objective line is too long for the HUD`);
    assert.notEqual(out, inn);
    assert.ok(!(out + inn).includes(String.fromCharCode(0x2014)), 'no long dashes in objective text');
  }
});
