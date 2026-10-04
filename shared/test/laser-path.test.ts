import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, MOVES, SIDES, applyMove, createGame, isBlocked, linesOn, onRing, visibleObjects, type GameState, type Side } from '../src/index';
import { FLOWER_ID, flowerKind } from '../src/puzzles/chain';
import { MIRROR_START, PATH_START, RESPAWN, traceBeam } from '../src/puzzles/laserPath';
import type { Box } from '../src/puzzles/lib/push';
import { solver, type Solver } from './harness';
import { insideGo, pushMirrors, resetMirrors, shownPath, stepTo, toPathStart } from './laser-solutions';
import { SOLUTIONS } from './solutions';

// LASER AND INVISIBLE PATH (face 6). Run just this file: npx tsx --test shared/test/laser-path.test.ts

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
/** ... and the crate burnt, the mirrors back at their start. */
function withPath(seed: number): Solver {
  const t = withLaser(seed);
  resetMirrors(t);
  pushMirrors(t);
  resetMirrors(t);
  assert.ok(burnt(t.state));
  return t;
}

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
            for (let x = 0; x < FACE_SIZE; x++) if (onRing(x, y)) assert.equal(isBlocked(state, side, tile(x, y), t.env), false, `${side} ring ${x},${y} blocked with mirrors at ${layout}`);
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

test('laser-path: the intended pushes burn the crate once; the flower appears once, outside, beside it', () => {
  const t = withLaser(6);
  resetMirrors(t);
  pushMirrors(t);
  assert.ok(burnt(t.state));
  const crate = t.find('out', FACE, 'f6-crate');
  assert.ok(onRing(crate.x, crate.y), 'the crate stands on the edge');
  assert.equal(see(t, 'out').find((o) => o.type === 'f6-crate')?.state, 'burnt');
  const flower = t.state.items[FLOWER_ID]!;
  assert.deepEqual([flower.side, flower.face, flower.kind, flower.carriedBy], ['out', FACE, flowerKind(t.state.seed ?? 0), null]);
  assert.equal(Math.abs(flower.x - crate.x) + Math.abs(flower.y - crate.y), 1);
  assert.ok(!onRing(flower.x, flower.y));
  // again: reset, push, wait. Still one burn, one flower, and the face is not solved yet
  resetMirrors(t);
  pushMirrors(t);
  t.wait(1000);
  assert.equal(names(t.events).filter((n) => n === 'burn').length, 1);
  assert.equal(Object.values(t.state.items).filter((i) => i.kind.startsWith('flower')).length, 1);
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
  t.go('in', t.find('out', FACE, 'reset')); // the laser is off: the lava is cold
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

test('laser-path: the path is seeded, contiguous from its start to the button, and the same after a fall', () => {
  const paths = [21, 22, 23].map((seed) => {
    const t = withPath(seed);
    const path = shownPath(t);
    const button = t.find('in', FACE, 'button');
    assert.deepEqual([path[0]!.x, path[0]!.y], [PATH_START.x, PATH_START.y]);
    assert.deepEqual([path.at(-1)!.x, path.at(-1)!.y, path.at(-1)!.state], [button.x, button.y, 'goal']);
    for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y), 1, 'a step at a time');
    for (const p of path) assert.ok(!onRing(p.x, p.y), 'the path is lava tiles only');
    assert.equal(new Set(path.map((p) => `${p.x},${p.y}`)).size, path.length);
    return path.map((p) => `${p.x},${p.y}`).join(' ');
  });
  assert.notEqual(paths[0], paths[1]);
  assert.notEqual(paths[1], paths[2]);
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
  assert.equal(see(t, 'in').some((o) => o.type === 'f6-path'), false);
  assert.equal(see(t, 'out').some((o) => o.type === 'f6-lava'), false);
});

test('laser-path: lava off the path is a strike and a trip back to the start; before the crate burns all of it is', () => {
  const t = withLaser(21);
  const fall = (what: string) => {
    const strikes = t.state.strikes;
    return (evs: ReturnType<Solver['move']>) => {
      const p = t.state.players.in.pose;
      assert.deepEqual([p.face, p.x, p.y], [FACE, RESPAWN.x, RESPAWN.y], `${what}: back beside the start, on face 6`);
      assert.equal(t.state.strikes, strikes + 1, what);
      assert.ok(names(evs).includes('splash'), what);
    };
  };
  insideGo(t, tile(RESPAWN.x, RESPAWN.y));
  // no path yet: even its first tile is lava
  fall('before the burn')(stepTo(t, 'in', tile(PATH_START.x, PATH_START.y)));
  // the button does nothing yet either way: it cannot be reached
  resetMirrors(t);
  pushMirrors(t);
  resetMirrors(t);
  const path = toPathStart(t);
  const shown = shownPath(t).map((o) => `${o.x},${o.y}`);
  // walk the path until a neighbour tile is lava off it, and step there
  let fell = false;
  for (const p of path) {
    stepTo(t, 'in', p);
    const off = [tile(p.x + 1, p.y), tile(p.x - 1, p.y), tile(p.x, p.y + 1), tile(p.x, p.y - 1)].find((n) => !onRing(n.x, n.y) && !shown.includes(`${n.x},${n.y}`));
    if (!off) continue;
    fall('off the path')(stepTo(t, 'in', off));
    fell = true;
    break;
  }
  assert.ok(fell);
  assert.deepEqual(shownPath(t).map((o) => `${o.x},${o.y}`), shown, 'the path does not change after a fall');
  // the ring never hurts
  const strikes = t.state.strikes;
  for (let i = 0; i < 4; i++) stepTo(t, 'in', tile(0, RESPAWN.y + (i % 2 ? 0 : 1)));
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
  // walk off across what was lava
  t.go('in', tile(11, 6));
  assert.equal(t.state.strikes, strikes);
});

test('laser-path: before the laser is on, the lava is cold rock (nobody is dropped back)', () => {
  const t = solver(createGame(1));
  assert.ok(see(t, 'in').filter((o) => o.type === 'f6-lava').every((o) => o.state === 'cold'));
  t.go('in', t.find('in', FACE, 'button'));
  t.interact('in');
  assert.equal(t.state.strikes, 0);
  assert.ok(!t.state.solved.includes(FACE), 'the button does nothing before the crate burns');
});
