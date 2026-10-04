import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SOLID, canonToScreen, createGame, defaultEnv, isBlocked, onRing, visibleObjects, type GameState, type Side, type VisibleObject } from '../src/index';
import { BATTERY_ID, BATTERY_KIND } from '../src/puzzles/chain';
import { EQUATION_MAX, EQUATION_TILES, equationAnswer, equationCounts } from '../src/puzzles/equationSafe';
import { around, at, keyOf } from '../src/puzzles/util';
import { solver, type Solver } from './harness';

// Equation Safe (face 2). Run just this file: npx tsx --test shared/test/equation-safe.test.ts

const FACE = 2;
const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const game = (seed: number) => createGame(0, defaultEnv, seed);
const sees = (state: GameState, side: Side, type: string): VisibleObject[] => visibleObjects(state, side, FACE).filter((o) => o.type === type);
/** What the outside player can count. */
const counted = (state: GameState) => ({ bushes: sees(state, 'out', 'f2-bush').length, rocks: sees(state, 'out', 'f2-rock').length, birds: sees(state, 'out', 'f2-bird').length });
/** What the inside player's display shows, left to right on THEIR screen. */
const shown = (state: GameState) =>
  sees(state, 'in', 'display')
    .sort((a, b) => canonToScreen('in', FACE, [0, 1, 0], a.x, a.y)[0] - canonToScreen('in', FACE, [0, 1, 0], b.x, b.y)[0])
    .map((d) => d.state);

/** The inside player walks to each key the keypad shows and presses E. */
function type(t: Solver, keys: string[]) {
  for (const name of keys) {
    const k = sees(t.state, 'in', 'key').find((o) => o.state === name);
    assert.ok(k, `no key "${name}"`);
    t.go('in', { face: FACE, x: k.x, y: k.y });
    t.interact('in');
  }
}

test('equation-safe: the right answer opens the safe and puts the battery in front of it', () => {
  const state = game(42);
  const t = solver(state);
  const c = counted(state);
  const answer = 3 * c.bushes * 2 * c.birds * c.rocks;
  type(t, [...String(answer)]);
  assert.deepEqual(shown(state).slice(0, String(answer).length), [...String(answer)], 'the digits read left to right on the inside screen');
  assert.ok(!state.solved.includes(FACE) && !(BATTERY_ID in state.items), 'nothing happens before ENTER');
  type(t, ['enter']);

  assert.ok(state.solved.includes(FACE));
  assert.equal(state.strikes, 0);
  assert.ok(t.events.some((e) => e.type === 'puzzle' && e.name === 'chime'));
  assert.equal(sees(state, 'in', 'f2-safe')[0]!.state, 'open');
  assert.ok(sees(state, 'in', 'key').every((k) => k.state!.endsWith('-green')), 'the keypad is green');
  assert.deepEqual(shown(state).slice(0, String(answer).length), [...String(answer)].map((d) => `${d}-green`));

  // The battery: a normal inside item, on a free floor tile next to the safe, not on a key.
  const battery = state.items[BATTERY_ID]!;
  assert.deepEqual([battery.kind, battery.side, battery.face, battery.carriedBy], [BATTERY_KIND, 'in', FACE, null]);
  assert.ok(around(EQUATION_TILES.safe).some((n) => at(n, battery)), 'next to the safe');
  assert.equal(defaultEnv.world.in[FACE].tiles[battery.y]![battery.x], 'floor');
  assert.ok(!visibleObjects(state, 'in', FACE).some((o) => at(o, battery)), 'nothing else is on the battery tile');
  assert.ok(!isBlocked(state, 'in', { face: FACE, x: battery.x, y: battery.y }));

  // E on its tile picks it up (no onUse in the way), and it leaves the face with the player.
  t.go('in', t.item(BATTERY_ID));
  t.interact('in');
  assert.equal(state.players.in.carrying, BATTERY_ID);
  t.go('in', { face: 5, x: 5, y: 5 });
  assert.deepEqual([state.players.in.pose.face, state.players.in.carrying], [5, BATTERY_ID]);
});

test('equation-safe: a wrong answer is a strike and clears the display; the next try still works', () => {
  const state = game(42);
  const t = solver(state);
  const wrong = String(equationAnswer(42) + 1);
  type(t, [...wrong, 'enter']);
  assert.equal(state.strikes, 1);
  assert.ok(t.events.some((e) => e.type === 'strike' && e.side === 'in'));
  assert.deepEqual(shown(state), ['empty', 'empty', 'empty']);
  assert.ok(!state.solved.includes(FACE) && !(BATTERY_ID in state.items));
  assert.equal(sees(state, 'in', 'f2-safe')[0]!.state, 'locked');

  // ENTER on an empty display is nothing at all, and a fourth digit is not taken.
  type(t, ['enter']);
  assert.equal(state.strikes, 1);
  type(t, ['1', '2', '3', '4']);
  assert.deepEqual(shown(state), ['1', '2', '3']);
  type(t, ['enter']);
  assert.equal(state.strikes, equationAnswer(42) === 123 ? 1 : 2);

  type(t, [...String(equationAnswer(42)), 'enter']);
  assert.ok(state.solved.includes(FACE));
});

test('equation-safe: the battery appears exactly once, and the locked keypad ignores every key', () => {
  const state = game(7);
  const t = solver(state);
  type(t, [...String(equationAnswer(7)), 'enter']);
  const before = JSON.stringify(state.puzzles['equation-safe']);
  // More presses (they would throw on a second spawn of the same id).
  for (const k of EQUATION_TILES.keys) {
    t.go('in', { face: FACE, x: k.x, y: k.y });
    t.interact('in');
  }
  assert.deepEqual(Object.keys(state.items).filter((id) => state.items[id]!.kind === BATTERY_KIND), [BATTERY_ID]);
  assert.equal(state.strikes, 0);
  const pad = (json: string) => JSON.stringify((JSON.parse(json) as { pad: unknown }).pad);
  assert.equal(pad(JSON.stringify(state.puzzles['equation-safe'])), pad(before));
});

test('equation-safe: only the inside player can press the keys', () => {
  const state = game(42);
  const t = solver(state);
  for (const k of EQUATION_TILES.keys) {
    if (SOLID[defaultEnv.world.out[FACE].tiles[k.y]![k.x]!]) continue;
    t.go('out', { face: FACE, x: k.x, y: k.y });
    t.interact('out');
  }
  assert.deepEqual(shown(state), ['empty', 'empty', 'empty']);
  assert.equal(state.strikes, 0);
});

test('equation-safe: each side sees only its own half', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const state = game(seed);
    const t = solver(state);
    const check = () => {
      const inside = new Set(visibleObjects(state, 'in', FACE).map((o) => o.type));
      const outside = new Set(visibleObjects(state, 'out', FACE).map((o) => o.type));
      assert.deepEqual([...inside].sort(), ['display', 'f2-clue', 'f2-safe', 'key']);
      assert.deepEqual([...outside].sort(), ['f2-bird', 'f2-bush', 'f2-rock']);
    };
    check();
    t.wait(1000);
    check();
  }
  // The carved row: nine tiles in one row, and it says nothing about this game's numbers.
  const rows = [1, 2].map((seed) => sees(game(seed), 'in', 'f2-clue').sort((a, b) => a.x - b.x));
  assert.deepEqual(rows[0], rows[1]);
  assert.equal(rows[0]!.length, 9);
  assert.equal(new Set(rows[0]!.map((o) => o.y)).size, 1);
  assert.deepEqual(rows[0]!.map((o) => o.state).sort(), ['bird', 'bush', 'rock', 'three', 'times', 'times', 'times', 'times', 'two']);
  // On the inside screen it reads ||| x bush x || x bird x rock.
  const onScreen = [...rows[0]!].sort((a, b) => canonToScreen('in', FACE, [0, 1, 0], a.x, a.y)[0] - canonToScreen('in', FACE, [0, 1, 0], b.x, b.y)[0]);
  assert.deepEqual(onScreen.map((o) => o.state), ['three', 'times', 'bush', 'times', 'two', 'times', 'bird', 'times', 'rock']);
});

test('equation-safe: counts are 1 to 4 for every seed, the answer is 6 x bushes x birds x rocks, and seeds differ', () => {
  const answers = new Set<number>();
  const layouts = new Set<string>();
  const each = { bushes: new Set<number>(), rocks: new Set<number>(), birds: new Set<number>() };
  for (const seed of SEEDS) {
    const state = game(seed);
    const c = counted(state);
    assert.deepEqual(c, equationCounts(seed), 'what is drawn is what is counted');
    for (const kind of ['bushes', 'rocks', 'birds'] as const) {
      assert.ok(c[kind] >= 1 && c[kind] <= EQUATION_MAX, `seed ${seed}: ${c[kind]} ${kind}`);
      each[kind].add(c[kind]);
    }
    assert.equal(equationAnswer(seed), 6 * c.bushes * c.birds * c.rocks);
    assert.ok(equationAnswer(seed) <= 384);
    answers.add(equationAnswer(seed));
    const all = visibleObjects(state, 'out', FACE);
    assert.equal(new Set(all.map(keyOf)).size, all.length, 'one thing per tile');
    layouts.add(all.map((o) => `${o.type}@${keyOf(o)}`).sort().join(' '));
  }
  for (const kind of ['bushes', 'rocks', 'birds'] as const) assert.deepEqual([...each[kind]].sort(), [1, 2, 3, 4], `${kind}: every count turns up`);
  assert.ok(answers.size > 10, 'different games, different answers');
  assert.ok(layouts.size > SEEDS.length / 2, 'different games, different places');
  assert.notEqual(equationAnswer(1), equationAnswer(2));
});

test('equation-safe: the spots are free floor off the ring, on both sides', () => {
  const { bushSpots, rockSpots, birdSpots, keys, display, safe, battery } = EQUATION_TILES;
  for (const [name, spots] of [['bush', bushSpots], ['rock', rockSpots], ['bird', birdSpots]] as const) {
    assert.ok(spots.length >= 4, `${name}: at least four candidates`);
    for (const t of spots) {
      assert.equal(defaultEnv.world.out[FACE].tiles[t.y]![t.x], 'floor', `${name} spot ${keyOf(t)}`);
      assert.ok(!onRing(t.x, t.y), `${name} spot ${keyOf(t)} is on the ring`);
    }
  }
  const all = [...bushSpots, ...rockSpots, ...birdSpots].map(keyOf);
  assert.equal(new Set(all).size, all.length, 'a tile is for one kind only');
  for (const t of [...keys, ...display, safe, battery]) assert.equal(defaultEnv.world.in[FACE].tiles[t.y]![t.x], 'floor', `inside ${keyOf(t)}`);
  assert.deepEqual(keys.map((k) => k.name).sort(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'enter']);
  assert.equal(display.length, 3);
  // Every patch of bird tiles is bigger than the most birds there can be: nobody is ever stuck.
  for (const t of birdSpots) {
    const patch = [t];
    for (const p of patch) for (const n of around(p)) if (birdSpots.some((s) => at(s, n)) && !patch.some((q) => at(q, n))) patch.push(n);
    assert.ok(patch.length > EQUATION_MAX, `the bird patch at ${keyOf(t)} has only ${patch.length} tiles`);
  }
});

test('equation-safe: over 200 ticks the birds move, stay on the face, never stack, and their number never changes', () => {
  for (const seed of SEEDS.slice(0, 25)) {
    const state = game(seed);
    const t = solver(state);
    const still = [...sees(state, 'out', 'f2-bush'), ...sees(state, 'out', 'f2-rock')];
    const n = equationCounts(seed).birds;
    const start = sees(state, 'out', 'f2-bird').map(keyOf).join(' ');
    let moved = false;
    let last = sees(state, 'out', 'f2-bird');
    for (let i = 0; i < 200; i++) {
      t.wait(250);
      const birds = sees(state, 'out', 'f2-bird');
      assert.equal(birds.length, n, `seed ${seed} tick ${i}: the bird count changed`);
      assert.equal(new Set(birds.map(keyOf)).size, n, 'two birds on one tile');
      for (const b of birds) {
        assert.ok(b.x > 0 && b.y > 0 && b.x < FACE_SIZE - 1 && b.y < FACE_SIZE - 1, `a bird left the face or sits on the ring: ${keyOf(b)}`);
        assert.equal(defaultEnv.world.out[FACE].tiles[b.y]![b.x], 'floor');
        assert.ok(!still.some((o) => at(o, b)), `a bird landed on the ${keyOf(b)} bush or rock`);
        assert.ok(EQUATION_TILES.birdSpots.some((s) => at(s, b)));
      }
      // One tile at a time: every bird is where one was, or next to it.
      for (const b of birds) assert.ok(last.some((p) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) <= 1));
      last = birds;
      if (birds.map(keyOf).join(' ') !== start) moved = true;
      // Bushes and rocks stand still.
      assert.deepEqual([...sees(state, 'out', 'f2-bush'), ...sees(state, 'out', 'f2-rock')], still);
    }
    assert.ok(moved, `seed ${seed}: the birds never moved`);
    assert.deepEqual(counted(state), equationCounts(seed));
  }
});

test('equation-safe: never blocks a ring tile, and only the safe blocks (inside)', () => {
  const blocked = (state: GameState, side: Side) => {
    const out: string[] = [];
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        if (SOLID[defaultEnv.world[side][FACE].tiles[y]![x]!]) continue;
        if (!isBlocked(state, side, { face: FACE, x, y })) continue;
        assert.ok(!onRing(x, y), `${side} ring tile ${x},${y} is blocked`);
        out.push(`${x},${y}`);
      }
    return out;
  };
  const state = game(42);
  const t = solver(state);
  const check = () => {
    assert.deepEqual(blocked(state, 'out'), []);
    assert.deepEqual(blocked(state, 'in'), [keyOf(EQUATION_TILES.safe)]);
  };
  check();
  type(t, ['1', '2']);
  check();
  type(t, ['enter']);
  check();
  t.wait(5000);
  check();
  type(t, [...String(equationAnswer(42)), 'enter']);
  assert.ok(state.solved.includes(FACE));
  check();
});
