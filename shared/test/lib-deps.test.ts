import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockedUntil } from '../src/puzzles/lib/deps';

test('deps: locked until the other face is solved', () => {
  const solved = [5];
  const ctx = { faceSolved: (face: number) => solved.includes(face) };
  assert.equal(lockedUntil(ctx, 6), true);
  assert.equal(lockedUntil(ctx, 5), false);
  solved.push(6);
  assert.equal(lockedUntil(ctx, 6), false);
});
