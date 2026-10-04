import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, MOVES, SIDES, applyMove, brightFace, createGame, devSolve, hazardTiles, isBlocked, linesOn, objectiveFor, onRing, visibleObjects, type GameState, type Side } from '../src/index';
import { FLOWER_ID, flowerKind } from '../src/puzzles/chain';
import { MIRROR_SOLVED, MIRROR_START, RESPAWN, traceBeam } from '../src/puzzles/laserPath';
import type { Box } from '../src/puzzles/lib/push';
import { solver, type Solver } from './harness';
import { insideGo, pushMirrors, resetMirrors, shownPath, stepTo, toPathStart } from './laser-solutions';
import { SOLUTIONS } from './solutions';

// LASER AND LAVA (face 6). Run just this file: npx tsx --test shared/test/laser-path.test.ts

const FACE = 6;
const ID = 'laser-path';
const see = (t: Solver, side: Side) => visibleObjects(t.state, side, FACE, t.env);
const mirrors = (state: GameState): Box[] => (state.puzzles[ID] as { mirrors: Box[] }).mirrors;
const burnt = (state: GameState): boolean => (state.puzzles[ID] as { burnt: boolean }).burnt;
const names = (evs: readonly { type: string }[]) => evs.flatMap((e) => (e.type === 'puzzle' ? [(e as unknown as { name: string }).name] : []));
const tile = (x: number, y: number) => ({ face: FACE, x, y }) as const;

/** A game with the laser of face 5 on (faces 2 and 5 played by their scripts). */
function withLaser(seed: number): Solver {
  const t = solver(createGame(seed));
  SOLUTIONS['sequence-laser']!(t);
  assert.ok(t.state.solved.includes(5));
  return t;
}
/** ... and the crate burnt: the mirrors are locked and the beam is the path. */
function withPath(seed: number): Solver {
  const t = withLaser(seed);
  resetMirrors(t);
  pushMirrors(t);
  assert.ok(burnt(t.state));
  return t;
}
/** May this ring tile be blocked? Only the crate's, only for the outside player, only until it burns away. */
const crateException = (t: Solver, state: GameState, side: Side, x: number, y: number): boolean => {
  const crate = t.find('out', FACE, 'f6-crate');
  return side === 'out' && !burnt(state) && crate.x === x && crate.y === y;
};

test('laser-path: beam geometry, every turn of both mirror kinds', () => {
  const none = (_t: { x: number; y: number }) => false;
  const end = (ms: Box[], stops = none) => traceBeam({ x: 5, y: 5 }, ms, stops).points;
  const fwd = (x: number, y: number): Box => ({ id: `fwd-${x}-${y}`, x, y });
  const back = (x: number, y: number): Box => ({ id: `back-${x}-${y}`, x, y });
  const xy = (x: number, y: number) => ({ x, y });
  // no mirror: north to the edge
  assert.deepEqual(end([]), [xy(5, 5), xy(5, 0)]);
  // "/": north -> east, east -> north, south -> west, west -> south
  assert.deepEqual(end([fwd(5, 3)]), [xy(5, 5), xy(5, 3), xy(11, 3)]);
  assert.deepEqual(end([fwd(5, 3), fwd(8, 3)]), [xy(5, 5), xy(5, 3), xy(8, 3), xy(8, 0)]);
  assert.deepEqual(end([back(5, 3), fwd(2, 3)]), [xy(5, 5), xy(5, 3), xy(2, 3), xy(2, 11)]);
  assert.deepEqual(end([back(5, 3), fwd(2, 3), fwd(2, 8)]), [xy(5, 5), xy(5, 3), xy(2, 3), xy(2, 8), xy(0, 8)]);
  // "\": north -> west, west -> north, south -> east, east -> south
  assert.deepEqual(end([back(5, 3)]), [xy(5, 5), xy(5, 3), xy(0, 3)]);
  assert.deepEqual(end([back(5, 3), back(2, 3)]), [xy(5, 5), xy(5, 3), xy(2, 3), xy(2, 0)]);
  assert.deepEqual(end([fwd(5, 3), back(8, 3)]), [xy(5, 5), xy(5, 3), xy(8, 3), xy(8, 11)]);
  assert.deepEqual(end([fwd(5, 3), back(8, 3), back(8, 8)]), [xy(5, 5), xy(5, 3), xy(8, 3), xy(8, 8), xy(11, 8)]);
  // it stops ON an obstacle, and a loop of four mirrors ends
  assert.deepEqual(end([fwd(5, 3)], (t) => t.x === 8 && t.y === 3), [xy(5, 5), xy(5, 3), xy(8, 3)]);
  assert.deepEqual(traceBeam({ x: 5, y: 5 }, [fwd(5, 3)], none).tiles.length, 2 + 6);
  assert.ok(traceBeam({ x: 5, y: 5 }, [fwd(5, 2), back(8, 2), fwd(8, 5), back(5, 5)], none).points.length > 4);
});

test('laser-path: no beam before face 5 is solved, but the mirrors can be pushed; the beam then arrives on a tick', () => {
  const t = solver(createGame(4));
  assert.deepEqual(linesOn(t.state, 'out', FACE, t.env), []);
  assert.equal(see(t, 'out').find((o) => o.type === 'f6-source')?.state, 'off');
  pushMirrors(t); // already in the solving position
  assert.equal(burnt(t.state), false);
  assert.equal(see(t, 'out').find((o) => o.type === 'f6-crate')?.state, 'whole');
  assert.equal(t.state.items[FLOWER_ID], undefined);
  SOLUTIONS['sequence-laser']!(t);
  const evs = t.wait(250);
  assert.ok(burnt(t.state), 'the beam came on and found the mirrors in place');
  assert.ok(names(evs).includes('burn'), 'the burn is announced from the tick');
  assert.equal(names(t.events).filter((n) => n === 'burn').length, 1);
});

test('laser-path: the beam is drawn for the outside only, from the middle north, and follows the mirrors', () => {
  const t = withLaser(4);
  resetMirrors(t);
  assert.deepEqual(linesOn(t.state, 'in', FACE, t.env), []);
  const src = t.find('out', FACE, 'f6-source');
  assert.deepEqual(linesOn(t.state, 'out', FACE, t.env), [{ from: [src.x, src.y], to: [src.x, 0], colour: '#ff3b3b' }]);
  assert.equal(burnt(t.state), false, 'the start position does not burn the crate');
  pushMirrors(t);
  const crate = t.find('out', FACE, 'f6-crate');
  const lines = linesOn(t.state, 'out', FACE, t.env);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2]!.to, [crate.x, crate.y]);
  for (const l of lines) assert.ok(l.from[0] === l.to[0] || l.from[1] === l.to[1], 'segments are straight');
});

test('laser-path: SOLVABLE (search over every push from the start), needs at least 2 pushes, never blocks the ring', () => {
  const t = withLaser(8);
  resetMirrors(t);
  assert.deepEqual(mirrors(t.state), MIRROR_START);
  const key = (s: GameState) => `${s.players.out.pose.x},${s.players.out.pose.y}|${mirrors(s).map((m) => `${m.x},${m.y}`).join('|')}`;
  // 0-1 search: a step costs 0, a push costs 1. `best` = fewest pushes that burn the crate.
  const seen = new Map<string, number>([[key(t.state), 0]]);
  let layer: GameState[] = [structuredClone(t.state) as GameState];
  const layouts = new Set<string>();
  let best = -1;
  for (let pushes = 0; pushes <= 4 && best < 0; pushes++) {
    const next: GameState[] = [];
    for (let i = 0; i < layer.length; i++) {
      const state = layer[i]!;
      const layout = key(state).split('|').slice(1).join('|');
      if (!layouts.has(layout)) {
        layouts.add(layout);
        // the edge rule, in every mirror layout the search reaches
        for (const m of mirrors(state)) assert.ok(!onRing(m.x, m.y), `a mirror reached the ring at ${m.x},${m.y}`);
        for (const side of SIDES)
          for (let y = 0; y < FACE_SIZE; y++)
            // EDGE RULE, with its one exception: the unburnt crate (it burns away)
            for (let x = 0; x < FACE_SIZE; x++) if (onRing(x, y)) assert.equal(isBlocked(state, side, tile(x, y), t.env), crateException(t, state, side, x, y), `${side} ring ${x},${y} with mirrors at ${layout}`);
      }
      for (const [dx, dy] of MOVES) {
        const s = structuredClone(state) as GameState;
        const evs = applyMove(s, 'out', dx, dy, 0, t.env);
        if (s.players.out.pose.face !== FACE) continue;
        const pushed = evs.some((e) => e.type === 'push');
        if (burnt(s)) best = pushes + 1;
        const k = key(s);
        const cost = pushes + (pushed ? 1 : 0);
        if ((seen.get(k) ?? Infinity) <= cost) continue;
        seen.set(k, cost);
        (pushed ? next : layer).push(s);
      }
    }
    layer = next;
  }
  assert.equal(best, 3, 'fewest pushes that burn the crate');
  assert.ok(best >= 2);
  assert.ok(layouts.size > 20, 'the search really moved the mirrors about');
});

test('laser-path: the intended pushes burn the crate once; the flower appears once, outside, where the crate stood', () => {
  const t = withLaser(6);
  resetMirrors(t);
  const crate = t.find('out', FACE, 'f6-crate');
  assert.ok(onRing(crate.x, crate.y), 'the crate stands on the edge');
  assert.equal(isBlocked(t.state, 'out', tile(crate.x, crate.y), t.env), true, 'the crate is solid until it burns');
  assert.equal(isBlocked(t.state, 'in', tile(crate.x, crate.y), t.env), false, 'nothing stands there inside');
  pushMirrors(t);
  assert.ok(burnt(t.state));
  assert.equal(see(t, 'out').find((o) => o.type === 'f6-crate')?.state, 'burnt');
  const flower = t.state.items[FLOWER_ID]!;
  assert.deepEqual([flower.side, flower.face, flower.kind, flower.carriedBy], ['out', FACE, flowerKind(t.state.seed ?? 0), null]);
  assert.deepEqual([flower.x, flower.y], [crate.x, crate.y]);
  assert.equal(isBlocked(t.state, 'out', tile(crate.x, crate.y), t.env), false, 'ash: the tile is open, and it is a ring tile like any other');
  // time passes: still one burn, one flower, and the face is not solved yet
  t.wait(1000);
  assert.equal(names(t.events).filter((n) => n === 'burn').length, 1);
  assert.equal(Object.values(t.state.items).filter((i) => i.face === FACE && i.kind.startsWith('flower')).length, 1); // (four more lie on other faces: face 4's)
  assert.ok(!t.state.solved.includes(FACE), 'only the button solves the face');
  // the outside player can carry the flower off
  t.go('out', t.item(FLOWER_ID));
  assert.deepEqual(t.interact('out').map((e) => e.type), ['pickup']);
});

test('laser-path: RESET puts the mirrors back, from anywhere', () => {
  const t = solver(createGame(2));
  pushMirrors(t);
  // shove the "/" on, out of the beam
  t.go('out', tile(5, 3));
  stepTo(t, 'out', tile(5, 2));
  assert.notDeepEqual(mirrors(t.state), MIRROR_START);
  const mark = t.events.length;
  resetMirrors(t);
  const evs = t.events.slice(mark);
  assert.deepEqual(mirrors(t.state), MIRROR_START);
  assert.ok(names(evs).includes('toggle'));
  assert.deepEqual(see(t, 'out').filter((o) => o.type === 'f6-mirror').map((o) => [o.x, o.y, o.state]), [[4, 2, 'fwd'], [9, 4, 'back']]);
  // the inside player cannot reset
  pushMirrors(t);
  const moved = structuredClone(mirrors(t.state));
  const reset = t.find('out', FACE, 'reset');
  t.state.players.in.pose = { ...t.state.players.in.pose, face: FACE, x: reset.x, y: reset.y }; // put there: the lava keeps a walker out
  t.interact('in');
  assert.deepEqual(mirrors(t.state), moved);
});

test('laser-path: mirrors and rocks block the outside player; a mirror is not pushed into a rock, a wall, another mirror or the ring', () => {
  const t = solver(createGame(2));
  for (const rock of see(t, 'out').filter((o) => o.type === 'f6-rock')) {
    assert.ok(!onRing(rock.x, rock.y));
    assert.equal(isBlocked(t.state, 'out', tile(rock.x, rock.y), t.env), true);
    assert.equal(isBlocked(t.state, 'in', tile(rock.x, rock.y), t.env), false, 'nothing blocks inside');
  }
  assert.equal(isBlocked(t.state, 'out', tile(4, 2), t.env), true);
  // "/" north: 4,2 -> 4,1, then the ring refuses it
  t.go('out', tile(4, 3));
  assert.ok(stepTo(t, 'out', tile(4, 2)).some((e) => e.type === 'push'));
  const bump = stepTo(t, 'out', tile(4, 1));
  assert.deepEqual(bump.map((e) => e.type), ['bump']);
  assert.deepEqual(mirrors(t.state)[0], { id: 'fwd-a', x: 4, y: 1 });
  // "\" west along row 4 ... then north twice up to the rock at 7,3
  resetMirrors(t);
  t.go('out', tile(10, 4));
  stepTo(t, 'out', tile(9, 4));
  stepTo(t, 'out', tile(8, 4)); // the mirror is on 7,4, under the rock
  t.go('out', tile(7, 5));
  assert.deepEqual(stepTo(t, 'out', tile(7, 4)).map((e) => e.type), ['bump'], 'the rock holds it');
  assert.deepEqual(mirrors(t.state)[1], { id: 'back-b', x: 7, y: 4 });
});

test('laser-path: the burn locks the mirrors: no push, no RESET, and the beam stays drawn', () => {
  const t = withPath(7);
  const locked = structuredClone(mirrors(t.state));
  const beam = linesOn(t.state, 'out', FACE, t.env);
  assert.equal(beam.length, 3);
  // push each mirror from all four sides: it is a wall now
  for (const m of locked)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const from = tile(m.x - dx, m.y - dy);
      if (isBlocked(t.state, 'out', from, t.env)) continue;
      t.go('out', from);
      assert.deepEqual(stepTo(t, 'out', tile(m.x, m.y)).map((e) => e.type), ['bump']);
    }
  const mark = t.events.length;
  resetMirrors(t);
  assert.ok(!names(t.events.slice(mark)).includes('toggle'), 'RESET does nothing after the burn');
  assert.deepEqual(mirrors(t.state), locked);
  assert.deepEqual(linesOn(t.state, 'out', FACE, t.env), beam);
  // ... also after the button
  SOLUTIONS[ID]!(t);
  assert.ok(t.state.solved.includes(FACE));
  assert.deepEqual(linesOn(t.state, 'out', FACE, t.env), beam);
  assert.deepEqual(linesOn(t.state, 'in', FACE, t.env), []);
});

test('laser-path: the safe path IS the beam: from the edge tile where the crate stood to the button behind the source', () => {
  const src = solver(createGame(1)).find('out', FACE, 'f6-source');
  const button = solver(createGame(1)).find('in', FACE, 'button');
  assert.deepEqual([button.x, button.y], [src.x, src.y], 'the button stands behind the beam source');
  for (const seed of [21, 22, 23]) {
    const t = withLaser(seed);
    resetMirrors(t);
    assert.deepEqual(shownPath(t), [], 'no path before the crate burns');
    pushMirrors(t);
    const path = shownPath(t);
    const crate = t.find('out', FACE, 'f6-crate');
    assert.deepEqual([path[0]!.x, path[0]!.y], [crate.x, crate.y]);
    assert.deepEqual([path.at(-1)!.x, path.at(-1)!.y], [button.x, button.y]);
    for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y), 1, 'a step at a time');
    assert.equal(new Set(path.map((p) => `${p.x},${p.y}`)).size, path.length);
    assert.equal(path.filter((p) => onRing(p.x, p.y)).length, 1, 'only its first tile is on the ring');
    // every tile of it is safe, every other lava tile is deadly
    const safe = new Set(path.map((p) => `${p.x},${p.y}`));
    for (let y = 1; y < FACE_SIZE - 1; y++)
      for (let x = 1; x < FACE_SIZE - 1; x++) {
        // the tiles under the beam, and no others: what the puzzle calls safe is what the outside player sees
        const underBeam = linesOn(t.state, 'out', FACE, t.env).some((l) => (l.from[0] === l.to[0] ? x === l.from[0] && (y - l.from[1]) * (y - l.to[1]) <= 0 : y === l.from[1] && (x - l.from[0]) * (x - l.to[0]) <= 0));
        assert.equal(safe.has(`${x},${y}`), underBeam, `${x},${y}`);
      }
  }
});

test('laser-path: the inside player sees lava and a button, never the path', () => {
  const t = withLaser(21);
  const before = see(t, 'in');
  assert.equal(before.filter((o) => o.type === 'f6-lava' && o.state === 'hot').length, 99);
  assert.equal(before.filter((o) => o.type === 'button' && o.state === 'off').length, 1);
  for (const o of before) assert.ok(!onRing(o.x, o.y), 'the ring is plain floor');
  resetMirrors(t);
  pushMirrors(t);
  assert.ok(shownPath(t).length > 0);
  assert.deepEqual(see(t, 'in'), before, 'burning the crate changes nothing inside');
  assert.deepEqual(linesOn(t.state, 'in', FACE, t.env), [], 'no beam inside');
  assert.equal(see(t, 'out').some((o) => o.type === 'f6-lava'), false);
  assert.equal(see(t, 'out').some((o) => o.type === 'f6-path'), false, 'the old drawn path is gone: the beam is the path');
});

test('laser-path: the lava is hot from the first second: a step in is a strike and a trip back to the ring', () => {
  const t = solver(createGame(1));
  assert.equal(t.state.solved.length, 0);
  assert.equal(hazardTiles(t.state, 'in', FACE, t.env).length, 100, 'the whole inside of the ring, button included');
  assert.equal(hazardTiles(t.state, 'out', FACE, t.env).length, 0);
  t.go('in', tile(5, 0));
  assert.equal(t.state.strikes, 0, 'the walk there kept to the ring');
  const evs = stepTo(t, 'in', tile(5, 1));
  const p = t.state.players.in.pose;
  assert.deepEqual([p.face, p.x, p.y, t.state.strikes], [FACE, RESPAWN.x, RESPAWN.y, 1]);
  assert.ok(onRing(RESPAWN.x, RESPAWN.y));
  assert.ok(names(evs).includes('splash'));
  assert.ok(!t.state.solved.includes(FACE));
});

test('laser-path: lava off the path is a strike and a trip back to the start of the path; before the crate burns all of it is', () => {
  const t = withLaser(21);
  const fall = (what: string, back: { x: number; y: number }) => {
    const strikes = t.state.strikes;
    return (evs: ReturnType<Solver['move']>) => {
      const p = t.state.players.in.pose;
      assert.deepEqual([p.face, p.x, p.y], [FACE, back.x, back.y], `${what}: back on the ring of face 6`);
      assert.equal(t.state.strikes, strikes + 1, what);
      assert.ok(names(evs).includes('splash'), what);
    };
  };
  const crate = t.find('out', FACE, 'f6-crate');
  resetMirrors(t);
  // no path yet: the tile the path will start with is lava like the rest
  insideGo(t, tile(crate.x, crate.y));
  fall('before the burn', RESPAWN)(stepTo(t, 'in', tile(crate.x, crate.y - 1)));
  pushMirrors(t);
  const path = toPathStart(t);
  const shown = shownPath(t).map((o) => `${o.x},${o.y}`);
  // walk the path until a neighbour tile is lava off it, and step there
  let fell = false;
  for (const p of path) {
    stepTo(t, 'in', p);
    const off = [tile(p.x + 1, p.y), tile(p.x - 1, p.y), tile(p.x, p.y + 1), tile(p.x, p.y - 1)].find((n) => !onRing(n.x, n.y) && !shown.includes(`${n.x},${n.y}`));
    if (!off) continue;
    fall('off the path', crate)(stepTo(t, 'in', off));
    fell = true;
    break;
  }
  assert.ok(fell);
  assert.deepEqual(shownPath(t).map((o) => `${o.x},${o.y}`), shown, 'the path does not change after a fall');
  // every lava tile off the path is deadly, every tile on it is safe (stepped onto from a neighbour)
  for (let y = 1; y < FACE_SIZE - 1; y++)
    for (let x = 1; x < FACE_SIZE - 1; x++) {
      const c = solver(structuredClone(t.state) as GameState, t.env);
      c.state.players.in.pose = { ...c.state.players.in.pose, face: FACE, x, y: y - 1 };
      stepTo(c, 'in', tile(x, y));
      assert.equal(c.state.strikes > t.state.strikes, !shown.includes(`${x},${y}`), `lava ${x},${y}`);
    }
  // the ring never hurts
  const strikes = t.state.strikes;
  for (let i = 0; i < 4; i++) stepTo(t, 'in', tile(crate.x + (i % 2 ? 0 : 1), crate.y));
  assert.equal(t.state.strikes, strikes);
});

test('laser-path: solved only by the button at the end of the path; then the lava is cold', () => {
  const t = withPath(30);
  assert.ok(!t.state.solved.includes(FACE));
  const strikes = t.state.strikes;
  const path = toPathStart(t);
  for (const p of path.slice(0, -1)) stepTo(t, 'in', p);
  t.interact('in'); // one tile short of the button: nothing
  assert.ok(!t.state.solved.includes(FACE));
  stepTo(t, 'in', path.at(-1)!);
  const evs = t.interact('in');
  assert.ok(names(evs).includes('chime'));
  assert.ok(t.state.solved.includes(FACE));
  assert.equal(t.state.strikes, strikes);
  assert.equal(see(t, 'in').find((o) => o.type === 'button')?.state, 'on');
  assert.ok(see(t, 'in').filter((o) => o.type === 'f6-lava').every((o) => o.state === 'cold'));
  assert.equal(hazardTiles(t.state, 'in', FACE, t.env).length, 0);
  // walk off across what was lava
  t.go('in', tile(11, 6));
  assert.equal(t.state.strikes, strikes);
});

test('laser-path: the dev "Solve puzzle" leaves what a real solve leaves: mirrors in the beam, crate burnt, flower on its tile, cold lava', () => {
  const s = createGame(3);
  devSolve(s, 5, 1000);
  devSolve(s, 6, 1000);
  const t = solver(s);
  assert.deepEqual(mirrors(s), MIRROR_SOLVED);
  const crate = t.find('out', FACE, 'f6-crate');
  assert.deepEqual(linesOn(s, 'out', FACE).at(-1)!.to, [crate.x, crate.y], 'the beam ends on the crate tile');
  assert.equal(see(t, 'out').find((o) => o.type === 'f6-crate')?.state, 'burnt');
  assert.deepEqual([s.items[FLOWER_ID]!.x, s.items[FLOWER_ID]!.y], [crate.x, crate.y]);
  assert.ok(see(t, 'in').filter((o) => o.type === 'f6-lava').every((o) => o.state === 'cold'));
  t.go('out', t.item(FLOWER_ID));
  assert.deepEqual(t.interact('out').map((e) => e.type), ['pickup']);
  t.go('in', t.find('in', FACE, 'button'));
  assert.equal(s.strikes, 0);
});

test('laser-path: the objective says what each side has to do, in every state', () => {
  const t = solver(createGame(5));
  const both = () => SIDES.map((side) => {
    t.state.players[side].pose = { ...t.state.players[side].pose, face: FACE, x: 0, y: 0 };
    return objectiveFor(t.state, side, t.env);
  });
  const seen = new Set<string>();
  const stage = (what: string) => {
    for (const line of both()) {
      assert.ok(line && line.length > 10, what);
      assert.ok(!/green|glow/i.test(line), `${what}: no drawn path any more`);
      seen.add(line);
    }
  };
  stage('start');
  assert.match(both()[1]!, /lava/i);
  devSolve(t.state, 5, 1000);
  stage('laser on');
  (t.state.puzzles[ID] as { mirrors: Box[] }).mirrors = structuredClone(MIRROR_SOLVED) as Box[];
  t.wait(250);
  assert.ok(burnt(t.state));
  stage('burnt');
  assert.match(both()[0]!, /beam/i);
  assert.equal(seen.size, 5);
});

test('laser-path: the lava is there for the inside player in every state, and nothing hides it', () => {
  // The room once looked empty: cold lava was drawn as dark rock, in a dark room. The data
  // was always there; this pins it, and that the room is lit (the client draws no darkness).
  assert.ok(brightFace(FACE), 'the lava room is bright: all of it is seen, not only the tiles nearby');
  const lava = (t: Solver) => see(t, 'in').filter((o) => o.type === 'f6-lava');
  const whole = (t: Solver, state: string, when: string) => {
    const tiles = lava(t);
    assert.equal(tiles.length, 99, `${when}: the whole 10x10 inside the ring, but the button`);
    assert.ok(tiles.every((o) => o.state === state), `${when}: every tile is ${state}`);
    const button = see(t, 'in').find((o) => o.type === 'button')!;
    const seen = new Set([...tiles, button].map((o) => `${o.x},${o.y}`));
    for (let y = 0; y < FACE_SIZE; y++) for (let x = 0; x < FACE_SIZE; x++) assert.equal(seen.has(`${x},${y}`), !onRing(x, y), `${when}: ${x},${y}`);
    assert.equal(see(t, 'in').some((o) => o.type === 'f6-path'), false, `${when}: the path is never in the inside view`);
  };
  whole(solver(createGame(33)), 'hot', 'at the start, before anything is solved');
  whole(withLaser(33), 'hot', 'laser on');
  const t = withPath(33);
  whole(t, 'hot', 'crate burnt');
  // the tiles of the path look like every other tile
  const path = new Set(shownPath(t).map((p) => `${p.x},${p.y}`));
  assert.ok(path.size > 2);
  assert.deepEqual(new Set(lava(t).filter((o) => path.has(`${o.x},${o.y}`)).map((o) => o.state)), new Set(['hot']));
  SOLUTIONS[ID]!(t);
  assert.ok(t.state.solved.includes(FACE));
  whole(t, 'cold', 'after the button');
});
