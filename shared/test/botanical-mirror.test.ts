import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FACE_SIZE,
  SIDES,
  applyInteract,
  createGame,
  defaultEnv,
  facedTile,
  isBlocked,
  isSolidTile,
  itemsOn,
  objectsOn,
  onRing,
  pathTo,
  visibleObjects,
  type GameEnv,
  type GameEvent,
  type GameState,
  type PuzzleModule,
  type Side,
} from '../src/index';
import { botanicalMirror, potColours } from '../src/puzzles/botanicalMirror';
import { FLOWER_COLOURS, FLOWER_ID, FLOWER_SPOT, START_FLOWER_FACES, flowerColour, flowerId, startFlowers, type FlowerColour } from '../src/puzzles/chain';
import { puzzleCtx, solver } from './harness';
import { SOLUTIONS } from './solutions';

// Botanical Mirror (face 4). Played on the shipped maps with a stand-in for face 6, so this
// file does not depend on how the real face 6 is solved: `hold` puts a flower in the outside
// player's hands directly (the crate's flower too).
// Run just this file: npx tsx --test shared/test/botanical-mirror.test.ts

const FACE = 4;
/** A face 6 that never solves itself and has no crate. */
const six: PuzzleModule<null> = { id: 'six', face: 6, init: () => null, isSolved: () => false };
const env: GameEnv = { world: defaultEnv.world, puzzles: [botanicalMirror, six] };
const POTS = objectsOn(env.world, 'out', FACE, 'target');
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function game(seed: number) {
  const state = createGame(0, env, seed);
  return { state, t: solver(state, env) };
}
/** Put the flower of `colour` in the outside player's hands (the crate's is made here). */
function hold(state: GameState, colour: FlowerColour): string {
  const id = flowerId(state.seed ?? 0, colour);
  state.items[id] ??= { id, kind: `flower-${colour}`, side: 'out', face: 1, x: 0, y: 0, carriedBy: null, placedOn: null, props: {} };
  state.items[id].carriedBy = 'out';
  state.players.out.carrying = id;
  return id;
}

const sees = (state: GameState, side: Side) => visibleObjects(state, side, FACE, env);
/** The pot the INSIDE player would name for a colour. */
const potOf = (state: GameState, colour: string) => sees(state, 'in').find((o) => o.state === colour)!;
const tileOf = (o: { x: number; y: number }) => ({ face: FACE, x: o.x, y: o.y }) as const;
const named = (evs: GameEvent[], name: string) => evs.some((e) => e.type === 'puzzle' && e.puzzle === botanicalMirror.id && e.name === name);
const objective = (state: GameState, side: Side) => botanicalMirror.objective!(state.puzzles[botanicalMirror.id] as never, puzzleCtx(state, env, botanicalMirror), side);
/** Plant what the outside player holds in `pot`: next to it, facing it, E. */
const plant = (t: ReturnType<typeof solver>, pot: { x: number; y: number }) => {
  t.face('out', tileOf(pot));
  return t.interact('out');
};

test('botanical-mirror: five pots, off the ring, each with a free tile next to it on both sides, no tree right next to one', () => {
  assert.equal(POTS.length, FLOWER_COLOURS.length);
  const { tiles } = env.world.out[FACE];
  const state = createGame(0, defaultEnv, 1);
  for (const p of POTS) {
    assert.ok(!onRing(p.x, p.y), `pot at ${p.x},${p.y} is on the ring`);
    for (const [dx, dy] of AROUND) assert.notEqual(tiles[p.y + dy]![p.x + dx], 'tree', `a tree stands next to the pot at ${p.x},${p.y}`);
    for (const side of SIDES) {
      const free = AROUND.filter(([dx, dy]) => !isBlocked(state, side, { face: FACE, x: p.x + dx, y: p.y + dy }));
      assert.ok(free.length >= 1, `${side}: no tile to stand on next to the pot at ${p.x},${p.y}`);
      // and a player can get there: from the spawn to a tile beside the pot
      assert.ok(free.some(([dx, dy]) => pathTo(state, side, { face: FACE, x: p.x + dx, y: p.y + dy })), `${side}: the pot at ${p.x},${p.y} cannot be reached`);
    }
  }
  assert.ok(tiles.flat().filter((k) => k === 'tree').length >= 12, 'the forest keeps its oaks');
  assert.deepEqual(objectsOn(env.world, 'in', FACE), [], 'the inside pots are not a second copy on the map');
});

test('botanical-mirror: the pots are solid on both sides, in every state; the ring never is', () => {
  const fresh = game(5).state;
  const done = game(5);
  for (const colour of FLOWER_COLOURS) {
    hold(done.state, colour);
    plant(done.t, potOf(done.state, colour));
  }
  assert.ok(done.state.solved.includes(FACE));
  for (const state of [fresh, done.state])
    for (const side of SIDES)
      for (let y = 0; y < FACE_SIZE; y++)
        for (let x = 0; x < FACE_SIZE; x++) {
          const pot = POTS.some((p) => p.x === x && p.y === y);
          const blocked = isBlocked(state, side, { face: FACE, x, y }, env);
          if (onRing(x, y)) assert.equal(blocked, false, `${side} ring tile ${x},${y} is blocked`);
          if (pot) assert.equal(blocked, true, `${side} can walk onto the pot at ${x},${y}`);
          else assert.equal(blocked, isSolidTile(env.world, side, FACE, x, y), `${side} ${x},${y}`);
        }
  // walking into one is a bump that turns the player towards it
  const { state, t } = game(5);
  const pot = POTS[0]!;
  const evs = t.face('in', tileOf(pot));
  assert.equal(evs.at(-1)!.type, 'bump');
  assert.deepEqual(facedTile(state, 'in'), tileOf(pot));
  assert.notDeepEqual([state.players.in.pose.x, state.players.in.pose.y], [pot.x, pot.y]);
});

test('botanical-mirror: the inside colours are a shuffle of all five, different from game to game', () => {
  const layouts = new Set<string>();
  for (let seed = 0; seed < 300; seed++) {
    const colours = potColours(seed);
    assert.deepEqual([...colours].sort(), [...FLOWER_COLOURS].sort(), `seed ${seed}: ${colours.join(', ')}`);
    layouts.add(colours.join());
    // what the inside player is shown is that shuffle, pot by pot
    if (seed < 20) assert.deepEqual(sees(createGame(0, env, seed), 'in').map((o) => o.state), colours);
  }
  assert.ok(layouts.size > 60, `only ${layouts.size} layouts in 300 games`);
  assert.notDeepEqual(potColours(1), potColours(2));
});

test('botanical-mirror: the outside sees empty pots, the inside sees the flowers, on the same tiles', () => {
  const { state } = game(11);
  const out = sees(state, 'out');
  const inn = sees(state, 'in');
  assert.deepEqual(out.map((o) => [o.type, o.x, o.y, o.state]), POTS.map((p) => ['f4-pot', p.x, p.y, 'empty']));
  assert.deepEqual(inn.map((o) => [o.type, o.x, o.y]), POTS.map((p) => ['f4-flowerpot', p.x, p.y]));
  assert.equal(new Set(inn.map((o) => o.state)).size, FLOWER_COLOURS.length, 'five different colours');
  // the secret never reaches the outside player
  for (const colour of FLOWER_COLOURS) assert.ok(!JSON.stringify(out).includes(colour), `the outside player can see "${colour}"`);
});

test('botanical-mirror: four flowers lie about from the start, one on each of faces 1, 2, 3 and 5; the fifth colour is the crate\'s', () => {
  const where = new Map<number, Set<string>>();
  for (let seed = 0; seed < 200; seed++) {
    const state = createGame(0, defaultEnv, seed);
    const flowers = Object.values(state.items).filter((i) => i.kind.startsWith('flower-'));
    assert.equal(flowers.length, 4, `seed ${seed}`);
    assert.deepEqual(flowers.map((f) => f.face).sort(), [...START_FLOWER_FACES], `seed ${seed}: one per face, never face 4 or 6`);
    assert.deepEqual([...flowers.map((f) => f.kind.slice(7)), flowerColour(seed)].sort(), [...FLOWER_COLOURS].sort(), `seed ${seed}: the five colours`);
    assert.deepEqual(flowers.map((f) => f.id).sort(), startFlowers(seed).map((f) => f.id).sort());
    assert.ok(!state.items[FLOWER_ID], 'the crate has not burnt yet');
    for (const f of flowers) {
      const at = `seed ${seed}: the ${f.kind} at face ${f.face} ${f.x},${f.y}`;
      assert.deepEqual([f.side, f.carriedBy, f.placedOn], ['out', null, null], at);
      assert.ok(!onRing(f.x, f.y), `${at} is on the ring`);
      assert.ok(!isBlocked(state, 'out', f), `${at} is on a tile nobody can stand on`);
      // nothing of any puzzle on its tile: no map object but its own spot, nothing a puzzle shows, no other item
      assert.deepEqual(objectsOn(defaultEnv.world, 'out', f.face).filter((o) => o.x === f.x && o.y === f.y).map((o) => o.type), [FLOWER_SPOT], at);
      assert.ok(!visibleObjects(state, 'out', f.face).some((o) => o.x === f.x && o.y === f.y), `${at} lies on a puzzle object`);
      assert.equal(flowers.filter((o) => o.face === f.face && o.x === f.x && o.y === f.y).length, 1, at);
      // the outside player can walk to it, with the real blockers of a fresh game
      assert.ok(pathTo(state, 'out', f), `${at} cannot be reached`);
      // and the inside player never sees it
      assert.deepEqual(itemsOn(state, 'in', f.face), []);
      where.set(f.face, (where.get(f.face) ?? new Set()).add(`${f.x},${f.y}`));
    }
    // a spot is never shown, to either side
    for (const face of START_FLOWER_FACES) for (const side of SIDES) assert.ok(!visibleObjects(state, side, face).some((o) => o.type === FLOWER_SPOT));
  }
  // the seed moves them: every spot of a face is used over 200 games, and there are several
  for (const face of START_FLOWER_FACES) {
    const spots = objectsOn(defaultEnv.world, 'out', face, FLOWER_SPOT);
    assert.ok(spots.length >= 8, `face ${face} has only ${spots.length} flower spots`);
    assert.equal(where.get(face)!.size, spots.length, `face ${face}: ${where.get(face)!.size} of ${spots.length} spots used`);
  }
  // the same seed lays them out the same way (the server and both clients agree)
  assert.deepEqual(createGame(0, defaultEnv, 77).items, createGame(5, defaultEnv, 77).items);
});

test('botanical-mirror: plant from the tile next to the pot, facing it, with E or with Q; the flower stays for good', () => {
  for (const only of [undefined, 'drop'] as const) {
    const { state, t } = game(3);
    const colour = flowerColour(3);
    const id = hold(state, colour);
    const pot = potOf(state, colour);
    t.face('out', tileOf(pot));
    const stood = { x: state.players.out.pose.x, y: state.players.out.pose.y };
    const evs = applyInteract(state, 'out', 2000, env, only);
    assert.deepEqual(evs.map((e) => e.type), ['place', 'puzzle']);
    assert.ok(named(evs, 'chime'));
    assert.deepEqual([state.players.out.carrying, state.strikes], [null, 0]);
    // it is in the pot, not under the player's feet
    assert.deepEqual([state.items[id]!.x, state.items[id]!.y, !!state.items[id]!.placedOn], [pot.x, pot.y, true]);
    assert.notDeepEqual(stood, { x: pot.x, y: pot.y });
    assert.equal(sees(state, 'out').find((o) => o.x === pot.x && o.y === pot.y)!.state, `bloom-${colour}`);
    assert.equal(sees(state, 'in').find((o) => o.x === pot.x && o.y === pot.y)!.state, colour, 'nothing changes inside');
    assert.ok(!state.solved.includes(FACE), 'one flower is not five');
    // locked: E and Q in front of it take nothing out
    for (const again of [undefined, 'pick', 'drop'] as const) applyInteract(state, 'out', 2100, env, again);
    assert.deepEqual([state.players.out.carrying, !!state.items[id]!.placedOn], [null, true]);
    // and a second flower does not go in on top of it
    const other = hold(state, FLOWER_COLOURS.find((c) => c !== colour)!);
    assert.deepEqual(applyInteract(state, 'out', 2200, env).map((e) => e.type), ['bump']);
    assert.deepEqual([state.players.out.carrying, state.strikes], [other, 0]);
  }
});

test('botanical-mirror: next to a pot but not facing it, the flower is only dropped on the floor', () => {
  const { state, t } = game(3);
  const colour = flowerColour(3);
  const id = hold(state, colour);
  const pot = potOf(state, colour);
  t.face('out', tileOf(pot));
  assert.deepEqual(facedTile(state, 'out'), tileOf(pot));
  // turn away: a step to the side and back leaves the player on the same tile, looking along the pot
  const [fx, fy] = state.players.out.facing!;
  const stood = { ...state.players.out.pose };
  const aside = ([[fy, fx], [-fy, -fx]] as const).find(([dx, dy]) => t.move('out', dx, dy).some((e) => e.type === 'step'))!;
  t.move('out', -aside[0], -aside[1]);
  assert.deepEqual([state.players.out.pose.x, state.players.out.pose.y], [stood.x, stood.y]);
  assert.notDeepEqual(facedTile(state, 'out'), tileOf(pot));
  const at = { x: state.players.out.pose.x, y: state.players.out.pose.y };
  assert.deepEqual(t.interact('out').map((e) => e.type), ['drop']);
  assert.deepEqual([state.items[id]!.x, state.items[id]!.y, state.items[id]!.placedOn], [at.x, at.y, null]);
  assert.ok(sees(state, 'out').every((o) => o.state === 'empty'));
  // it can be picked up again and planted
  t.interact('out');
  assert.equal(state.players.out.carrying, id);
  assert.ok(plant(t, pot).some((e) => e.type === 'place'));
});

test('botanical-mirror: a wrong pot is a strike and the flower is back in the outside hands', () => {
  const { state, t } = game(7);
  const colour = flowerColour(7);
  const id = hold(state, colour);
  const right = potOf(state, colour);
  let strikes = 0;
  for (const p of POTS.filter((o) => o.x !== right.x || o.y !== right.y)) {
    const evs = plant(t, p);
    assert.equal(state.strikes, ++strikes, `pot at ${p.x},${p.y}`);
    assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'out'));
    assert.equal(state.players.out.carrying, id);
    assert.deepEqual([state.items[id]!.carriedBy, state.items[id]!.placedOn], ['out', null]);
    assert.ok(sees(state, 'out').every((o) => o.state === 'empty'));
  }
  // and it can still be planted afterwards
  plant(t, right);
  assert.equal(state.players.out.carrying, null);
  assert.equal(sees(state, 'out').filter((o) => o.state?.startsWith('bloom-')).length, 1);
});

test('botanical-mirror: all five in their pots solve the face, in any order, and not before', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const { state, t } = game(seed);
    const order = [...FLOWER_COLOURS].sort((a, b) => potColours(seed + 1).indexOf(a) - potColours(seed + 1).indexOf(b));
    order.forEach((colour, i) => {
      assert.ok(!state.solved.includes(FACE), `seed ${seed}: solved with ${i} flowers`);
      assert.match(objective(state, 'out'), new RegExp(`${i} of 5 planted`));
      assert.match(objective(state, 'in'), new RegExp(`${i} of 5 planted`));
      hold(state, colour);
      assert.ok(named(plant(t, potOf(state, colour)), 'chime'));
    });
    assert.ok(state.solved.includes(FACE), `seed ${seed}`);
    assert.equal(state.strikes, 0);
    assert.deepEqual(sees(state, 'out').map((o) => o.state), potColours(seed).map((c) => `bloom-${c}`));
    assert.ok(Object.values(state.items).filter((i) => i.kind.startsWith('flower-')).every((i) => i.placedOn && !i.carriedBy));
  }
});

test('botanical-mirror: a pot never sleeps: the crate\'s flower is planted while face 6 is still unsolved', () => {
  // THE BUG: the pots used to wait for face 6 to be SOLVED (the button in the lava), but the
  // flower is out as soon as the crate burns. Planting it early handed it straight back.
  const { state, t } = game(7);
  assert.ok(!state.solved.includes(6));
  const colour = flowerColour(7);
  hold(state, colour);
  const evs = plant(t, potOf(state, colour));
  assert.ok(named(evs, 'chime'));
  assert.deepEqual([state.players.out.carrying, state.strikes, !!state.items[FLOWER_ID]!.placedOn], [null, 0, true]);
});

test('botanical-mirror: something that is not a flower is no strike', () => {
  const { state, t } = game(7);
  state.items.rock = { id: 'rock', kind: 'rock', side: 'out', face: 1, x: 0, y: 0, carriedBy: 'out', placedOn: null, props: {} };
  state.players.out.carrying = 'rock';
  for (const p of POTS) {
    assert.ok(plant(t, p).some((e) => e.type === 'place'));
    assert.equal(state.players.out.carrying, 'rock');
    assert.equal(state.items.rock.placedOn, null);
  }
  assert.deepEqual([state.strikes, state.solved.includes(FACE)], [0, false]);
});

test('botanical-mirror: the inside player cannot solve it', () => {
  const { state, t } = game(7);
  // a flower of the right colour in the inside hands: an inside pot is not a target
  state.items.twin = { id: 'twin', kind: `flower-${flowerColour(7)}`, side: 'in', face: 1, x: 0, y: 0, carriedBy: 'in', placedOn: null, props: {} };
  state.players.in.carrying = 'twin';
  for (const p of POTS) {
    t.face('in', tileOf(p));
    assert.deepEqual(t.interact('in').map((e) => e.type), ['drop'], 'a plain drop at their feet, not a place');
    assert.notDeepEqual([state.items.twin.x, state.items.twin.y], [p.x, p.y]);
    t.interact('in'); // pick it up again
    assert.equal(state.players.in.carrying, 'twin');
  }
  // and with empty hands E in front of a pot does nothing
  t.interact('in');
  t.face('in', tileOf(POTS[0]!));
  t.interact('in');
  assert.deepEqual([state.strikes, state.solved.includes(FACE)], [0, false]);
});

test('botanical-mirror: the objective says what each side has to do', () => {
  const { state, t } = game(5);
  assert.equal(objective(state, 'out'), 'Five empty pots. A flower lies on every other face. Stand by a pot, face it, plant. 0 of 5 planted.');
  assert.equal(objective(state, 'in'), 'Five flowers bloom here. Your partner plants their twins outside. 0 of 5 planted.');
  for (const colour of FLOWER_COLOURS) {
    hold(state, colour);
    plant(t, potOf(state, colour));
  }
  for (const side of SIDES) assert.equal(objective(state, side), 'Every pot is in bloom.');
});

test('botanical-mirror: 200 seeds: every start flower can be walked to and picked up, and every flower planted in its pot', () => {
  for (let seed = 0; seed < 200; seed++) {
    // the real maps and the real blockers of every puzzle; the crate's flower is put in the hands at the end
    const state = createGame(0, defaultEnv, seed);
    const t = solver(state);
    const ids = startFlowers(seed).map((f) => f.id);
    assert.equal(ids.length, 4, `seed ${seed}`);
    for (const id of [...ids, FLOWER_ID]) {
      if (id === FLOWER_ID) hold(state, flowerColour(seed));
      else {
        t.go('out', t.item(id));
        assert.deepEqual(t.interact('out').map((e) => e.type), ['pickup'], `seed ${seed}: ${id}`);
      }
      const colour = state.items[id]!.kind.slice('flower-'.length);
      const pot = visibleObjects(state, 'in', FACE).find((o) => o.state === colour)!;
      // every pot has a tile beside it that can be reached and faced from
      t.face('out', tileOf(pot));
      assert.deepEqual(facedTile(state, 'out'), tileOf(pot), `seed ${seed}: the pot at ${pot.x},${pot.y} cannot be faced`);
      assert.ok(t.interact('out').some((e) => e.type === 'place'), `seed ${seed}: ${id}`);
      assert.deepEqual([state.players.out.carrying, !!state.items[id]!.placedOn], [null, true], `seed ${seed}: ${id}`);
    }
    assert.deepEqual([state.solved.includes(FACE), state.strikes], [true, 0], `seed ${seed}`);
  }
});

test('botanical-mirror: the real game: fetch the five flowers and plant them, for many seeds', () => {
  for (let seed = 0; seed < 25; seed++) {
    const state = createGame(0, defaultEnv, seed);
    const t = solver(state);
    SOLUTIONS['botanical-mirror']!(t);
    assert.ok(state.solved.includes(FACE), `seed ${seed}`);
    assert.equal(state.strikes, 0, `seed ${seed}`);
    assert.deepEqual(visibleObjects(state, 'out', FACE).map((o) => o.state), potColours(seed).map((c) => `bloom-${c}`));
  }
});
