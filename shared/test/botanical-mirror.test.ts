import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SIDES, createGame, defaultEnv, isBlocked, objectsOn, onRing, visibleObjects, type GameEnv, type GameEvent, type GameState, type PuzzleModule, type Side } from '../src/index';
import { botanicalMirror, potColours } from '../src/puzzles/botanicalMirror';
import { FLOWER_COLOURS, FLOWER_ID, flowerColour, flowerKind } from '../src/puzzles/chain';
import { puzzleCtx, solver } from './harness';
import { SOLUTIONS } from './solutions';

// Botanical Mirror (face 4). Played on the shipped maps with a stand-in for face 6, so this
// file does not depend on how the real face 6 is solved: `game` hands the outside player
// the flower directly, and "face 6 solved" is the engine's own latch.
// Run just this file: npx tsx --test shared/test/botanical-mirror.test.ts

const FACE = 4;
/** A face 6 that never solves itself: the tests latch it by hand (state.solved). */
const six: PuzzleModule<null> = { id: 'six', face: 6, init: () => null, isSolved: () => false };
const env: GameEnv = { world: defaultEnv.world, puzzles: [botanicalMirror, six] };
const POTS = objectsOn(env.world, 'out', FACE, 'target');

/** A game where the outside player holds the flower. `unlocked` = face 6 is solved. */
function game(seed: number, unlocked = true, kind = flowerKind(seed)) {
  const state = createGame(0, env, seed);
  if (unlocked) state.solved.push(6);
  state.items[FLOWER_ID] = { id: FLOWER_ID, kind, side: 'out', face: 1, x: 0, y: 0, carriedBy: 'out', placedOn: null, props: {} };
  state.players.out.carrying = FLOWER_ID;
  return { state, t: solver(state, env) };
}

const sees = (state: GameState, side: Side) => visibleObjects(state, side, FACE, env);
/** The pot the INSIDE player would name for this game's flower. */
const rightPot = (state: GameState) => sees(state, 'in').find((o) => o.state === flowerColour(state.seed ?? 0))!;
const named = (evs: GameEvent[], name: string) => evs.some((e) => e.type === 'puzzle' && e.puzzle === botanicalMirror.id && e.name === name);
const objective = (state: GameState, side: Side) => botanicalMirror.objective!(state.puzzles[botanicalMirror.id] as never, puzzleCtx(state, env, botanicalMirror), side);

test('botanical-mirror: five pots, off the ring, with no tree right next to one', () => {
  assert.equal(POTS.length, FLOWER_COLOURS.length);
  const { tiles } = env.world.out[FACE];
  for (const p of POTS) {
    assert.ok(!onRing(p.x, p.y), `pot at ${p.x},${p.y} is on the ring`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) assert.notEqual(tiles[p.y + dy]![p.x + dx], 'tree', `a tree stands next to the pot at ${p.x},${p.y}`);
  }
  assert.ok(tiles.flat().filter((k) => k === 'tree').length >= 12, 'the forest keeps its oaks');
  assert.deepEqual(objectsOn(env.world, 'in', FACE), [], 'the inside pots are not a second copy on the map');
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
  for (const unlocked of [false, true]) {
    const { state } = game(11, unlocked);
    const out = sees(state, 'out');
    const inn = sees(state, 'in');
    assert.deepEqual(out.map((o) => [o.type, o.x, o.y, o.state]), POTS.map((p) => ['f4-pot', p.x, p.y, unlocked ? 'empty' : 'locked']));
    assert.deepEqual(inn.map((o) => [o.type, o.x, o.y]), POTS.map((p) => ['f4-flowerpot', p.x, p.y]));
    assert.equal(new Set(inn.map((o) => o.state)).size, FLOWER_COLOURS.length, 'five different colours');
    // the secret never reaches the outside player
    for (const colour of FLOWER_COLOURS) assert.ok(!JSON.stringify(out).includes(colour), `the outside player can see "${colour}"`);
  }
});

test('botanical-mirror: the right pot solves it, and the pot blooms', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const { state, t } = game(seed);
    const pot = rightPot(state);
    t.go('out', { face: FACE, x: pot.x, y: pot.y });
    const evs = t.interact('out');
    assert.ok(state.solved.includes(FACE), `seed ${seed}`);
    assert.ok(named(evs, 'chime'));
    assert.equal(state.strikes, 0);
    assert.equal(state.players.out.carrying, null);
    assert.ok(state.items[FLOWER_ID]!.placedOn, 'the flower stays in the pot');
    assert.equal(sees(state, 'out').find((o) => o.x === pot.x && o.y === pot.y)!.state, `bloom-${flowerColour(seed)}`);
    assert.equal(sees(state, 'out').filter((o) => o.state?.startsWith('bloom-')).length, 1);
  }
});

test('botanical-mirror: a wrong pot is a strike and the flower is back in the outside hands', () => {
  const { state, t } = game(7);
  const right = rightPot(state);
  let strikes = 0;
  for (const p of POTS.filter((o) => o.x !== right.x || o.y !== right.y)) {
    t.go('out', { face: FACE, x: p.x, y: p.y });
    const evs = t.interact('out');
    assert.equal(state.strikes, ++strikes, `pot at ${p.x},${p.y}`);
    assert.ok(evs.some((e) => e.type === 'strike' && e.side === 'out'));
    assert.equal(state.players.out.carrying, FLOWER_ID);
    assert.deepEqual([state.items[FLOWER_ID]!.carriedBy, state.items[FLOWER_ID]!.placedOn], ['out', null]);
    assert.ok(!state.solved.includes(FACE));
    assert.ok(sees(state, 'out').every((o) => o.state === 'empty'));
  }
  // and it can still be solved afterwards
  t.go('out', { face: FACE, x: right.x, y: right.y });
  t.interact('out');
  assert.ok(state.solved.includes(FACE));
});

test('botanical-mirror: locked until face 6 is solved: the flower comes straight back, no strike', () => {
  const { state, t } = game(7, false);
  for (const p of POTS) {
    t.go('out', { face: FACE, x: p.x, y: p.y });
    const evs = t.interact('out');
    assert.ok(named(evs, 'puzzle'));
    assert.equal(state.players.out.carrying, FLOWER_ID);
    assert.equal(state.items[FLOWER_ID]!.placedOn, null);
  }
  assert.equal(state.strikes, 0);
  assert.ok(!state.solved.includes(FACE));
  // face 6 done: the same right pot now takes it
  state.solved.push(6);
  const right = rightPot(state);
  t.go('out', { face: FACE, x: right.x, y: right.y });
  t.interact('out');
  assert.ok(state.solved.includes(FACE));
});

test('botanical-mirror: something that is not a flower is no strike', () => {
  // an item with the flower's id but another kind is handed back
  const { state, t } = game(7, true, 'rose');
  for (const p of POTS) {
    t.go('out', { face: FACE, x: p.x, y: p.y });
    t.interact('out');
    assert.equal(state.players.out.carrying, FLOWER_ID);
  }
  // and so is any other item
  const other = game(7);
  delete other.state.items[FLOWER_ID];
  other.state.items.rock = { id: 'rock', kind: 'rock', side: 'out', face: 1, x: 0, y: 0, carriedBy: 'out', placedOn: null, props: {} };
  other.state.players.out.carrying = 'rock';
  other.t.go('out', { face: FACE, x: POTS[0]!.x, y: POTS[0]!.y });
  assert.ok(other.t.interact('out').some((e) => e.type === 'place'));
  assert.equal(other.state.players.out.carrying, 'rock');
  assert.equal(other.state.items.rock!.placedOn, null);
  assert.deepEqual([state.strikes, other.state.strikes, state.solved.includes(FACE), other.state.solved.includes(FACE)], [0, 0, false, false]);
});

test('botanical-mirror: the inside player cannot solve it', () => {
  const { state, t } = game(7);
  // a flower of the right colour in the inside hands: an inside pot is not a target
  state.items.twin = { id: 'twin', kind: flowerKind(7), side: 'in', face: 1, x: 0, y: 0, carriedBy: 'in', placedOn: null, props: {} };
  state.players.in.carrying = 'twin';
  for (const p of POTS) {
    t.go('in', { face: FACE, x: p.x, y: p.y });
    assert.ok(t.interact('in').some((e) => e.type === 'drop'), 'a plain drop, not a place');
    t.interact('in'); // pick it up again
    assert.equal(state.players.in.carrying, 'twin');
  }
  // and with empty hands E on a pot does nothing
  t.interact('in');
  t.move('in', 1, 0);
  t.move('in', -1, 0);
  t.interact('in');
  assert.deepEqual([state.strikes, state.solved.includes(FACE)], [0, false]);
});

test('botanical-mirror: never blocks: the ring is free and the pots are walked over, on both sides', () => {
  const states = [game(5, false).state, game(5).state];
  const solved = game(5);
  const right = rightPot(solved.state);
  solved.t.go('out', { face: FACE, x: right.x, y: right.y });
  solved.t.interact('out');
  states.push(solved.state);
  for (const state of states)
    for (const side of SIDES)
      for (let y = 0; y < FACE_SIZE; y++)
        for (let x = 0; x < FACE_SIZE; x++) {
          const tile = { face: FACE, x, y } as const;
          if (onRing(x, y)) assert.equal(isBlocked(state, side, tile, env), false, `${side} ring tile ${x},${y} is blocked`);
          assert.equal(botanicalMirror.isBlocked?.(state.puzzles[botanicalMirror.id] as never, puzzleCtx(state, env, botanicalMirror), side, tile) ?? false, false);
        }
  for (const p of POTS) for (const side of SIDES) assert.equal(isBlocked(states[1]!, side, { face: FACE, x: p.x, y: p.y }, env), false);
});

test('botanical-mirror: the objective says what each side has to do', () => {
  const locked = game(5, false).state;
  assert.equal(objective(locked, 'out'), 'Five empty pots wait. Life comes from beyond.');
  const { state, t } = game(5);
  assert.equal(objective(state, 'out'), 'Five empty pots wait. One holds the color your partner sees.');
  assert.match(objective(state, 'in'), /^Five flowers bloom\. Find the matching pair\.$/);
  assert.equal(objective(locked, 'in'), objective(state, 'in'));
  const right = rightPot(state);
  t.go('out', { face: FACE, x: right.x, y: right.y });
  t.interact('out');
  for (const side of SIDES) assert.equal(objective(state, side), 'The flower is in bloom.');
});

test('botanical-mirror: the real game: fetch the flower from face 6 and plant it, for many seeds', () => {
  for (let seed = 0; seed < 25; seed++) {
    const state = createGame(0, defaultEnv, seed);
    const t = solver(state);
    SOLUTIONS['botanical-mirror']!(t);
    assert.ok(state.solved.includes(FACE), `seed ${seed}`);
    assert.equal(state.strikes, 0, `seed ${seed}`);
    assert.equal(JSON.stringify(visibleObjects(state, 'out', FACE)).includes(`bloom-${flowerColour(seed)}`), true);
  }
});
