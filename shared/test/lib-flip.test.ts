import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flipClear, flipEquals, flipHas, flipTiles, flipToggle, newFlipSet } from '../src/puzzles/lib/flip';

test('flip set: toggle, clear, equals a target whatever the order', () => {
  const set = newFlipSet();
  assert.equal(flipToggle(set, { x: 3, y: 1 }), true);
  assert.equal(flipToggle(set, { x: 0, y: 0 }), true);
  assert.equal(flipHas(set, { x: 3, y: 1 }), true);
  assert.equal(flipEquals(set, [{ x: 0, y: 0 }, { x: 3, y: 1 }]), true);
  assert.equal(flipEquals(set, [{ x: 3, y: 1 }]), false);
  assert.equal(flipEquals(set, [{ x: 0, y: 0 }, { x: 3, y: 1 }, { x: 5, y: 5 }]), false);
  assert.deepEqual(set, newFlipSet([{ x: 3, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }])); // same JSON, any order
  assert.deepEqual(flipTiles(set), [{ x: 0, y: 0 }, { x: 3, y: 1 }]);
  assert.equal(flipToggle(set, { x: 3, y: 1 }), false);
  assert.equal(flipHas(set, { x: 3, y: 1 }), false);
  flipClear(set);
  assert.deepEqual(set, []);
  assert.equal(flipEquals(set, []), true);
});
