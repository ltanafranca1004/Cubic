import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUZZLES, createGame, defaultEnv } from '../src/index';
import { isSolvedNow, solver } from './harness';
import { SOLUTIONS } from './solutions';

// Every registered puzzle is solved here with real moves, by its script in ./solutions.ts.
// Adding a puzzle? You only touch solutions.ts. Guide: /docs/puzzle-tests.md.
// Run just this file: npx tsx --test shared/test/puzzles.test.ts

const HOW = 'add one to shared/test/solutions.ts (see docs/puzzle-tests.md)';

test('puzzle registry: every registered puzzle has a solution script', () => {
  const missing = PUZZLES.map((p) => p.id).filter((id) => !SOLUTIONS[id]);
  assert.deepEqual(missing, [], `no solution script for: ${missing.join(', ')}. ${HOW}`);
});

test('puzzle registry: every solution script belongs to a registered puzzle', () => {
  const ids = PUZZLES.map((p) => p.id);
  const stale = Object.keys(SOLUTIONS).filter((id) => !ids.includes(id));
  assert.deepEqual(stale, [], `solutions.ts has scripts for unknown puzzle ids: ${stale.join(', ')} (registered: ${ids.join(', ')})`);
});

test('puzzle registry: ids are unique and each face has at most one puzzle', () => {
  const ids = PUZZLES.map((p) => p.id);
  const faces = PUZZLES.map((p) => p.face);
  assert.deepEqual(ids, [...new Set(ids)], 'two puzzles share an id (it is the key of their state)');
  // The engine latches "solved" per face, so a second puzzle on a face would never be checked.
  assert.deepEqual(faces, [...new Set(faces)], 'two puzzles share a face');
  for (const face of faces) assert.ok(Number.isInteger(face) && face >= 1 && face <= 6, `bad face ${face}`);
});

for (const puzzle of PUZZLES) {
  test(`puzzle solution: ${puzzle.id} (face ${puzzle.face}) is solvable with real moves`, () => {
    const script = SOLUTIONS[puzzle.id];
    assert.ok(script, `no solution script for "${puzzle.id}": ${HOW}`);

    const state = createGame(0);
    assert.equal(isSolvedNow(state, defaultEnv, puzzle), false, 'a fresh game must not start solved');
    assert.ok(!state.solved.includes(puzzle.face));

    const t = solver(state);
    script(t);

    assert.equal(isSolvedNow(state, defaultEnv, puzzle), true, `${puzzle.id}: isSolved() is still false after the solution script`);
    assert.ok(state.solved.includes(puzzle.face), `face ${puzzle.face} is not latched in state.solved`);
    const solves = t.events.filter((e) => e.type === 'solve' && e.puzzle === puzzle.id);
    assert.equal(solves.length, 1, 'expected exactly one solve event');
    // The server broadcasts the state as JSON: it has to survive the round trip.
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state, 'puzzle state is not plain JSON');
  });
}
