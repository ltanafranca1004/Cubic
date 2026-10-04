import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hazardEnter } from '../src/puzzles/lib/hazard';

test('hazard: stepping on one teleports to the respawn tile with a strike, anything else is safe', () => {
  const log: string[] = [];
  const ctx = { teleport: (side: string, x: number, y: number) => void log.push(`tp ${side} ${x},${y}`), strike: (side: string) => void log.push(`strike ${side}`) };
  const lava = [{ x: 3, y: 3 }, { x: 4, y: 3 }];
  assert.equal(hazardEnter(ctx, 'in', { x: 5, y: 3 }, lava, { x: 1, y: 1 }), false);
  assert.deepEqual(log, []);
  assert.equal(hazardEnter(ctx, 'in', { x: 4, y: 3 }, lava, { x: 1, y: 1 }), true);
  assert.deepEqual(log, ['tp in 1,1', 'strike in']);
});
