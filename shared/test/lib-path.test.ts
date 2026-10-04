import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onLine, safeLine } from '../src/puzzles/lib/path';
import { keyOf, type XY } from '../src/puzzles/util';

const field: XY[] = [];
for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) field.push({ x, y });
const start = { x: 1, y: 10 };
const goal = { x: 10, y: 1 };

test('safe line: connected, inside the field, from start to goal, never touching itself', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const line = safeLine(seed, 0, field, start, goal);
    assert.deepEqual([line[0], line.at(-1)], [start, goal]);
    assert.equal(new Set(line.map(keyOf)).size, line.length);
    for (let i = 1; i < line.length; i++) assert.equal(Math.abs(line[i]!.x - line[i - 1]!.x) + Math.abs(line[i]!.y - line[i - 1]!.y), 1);
    for (const t of line) assert.ok(field.some((f) => f.x === t.x && f.y === t.y));
    // No shortcut: two tiles of the line are only neighbours when they follow each other.
    for (let i = 0; i < line.length; i++) for (let j = i + 2; j < line.length; j++) assert.notEqual(Math.abs(line[i]!.x - line[j]!.x) + Math.abs(line[i]!.y - line[j]!.y), 1, `seed ${seed}`);
  }
});

test('safe line: the same for the same seed, different for another seed or attempt', () => {
  const a = safeLine(7, 0, field, start, goal);
  assert.deepEqual(safeLine(7, 0, field, start, goal), a);
  assert.notDeepEqual(safeLine(8, 0, field, start, goal), a);
  assert.notDeepEqual(safeLine(7, 1, field, start, goal), a);
  assert.equal(onLine(a, a[3]!), true);
  assert.equal(onLine(a, { x: 0, y: 0 }), false);
});

test('safe line: no way gives an empty line', () => {
  assert.deepEqual(safeLine(1, 0, field, { x: 0, y: 0 }, goal), []);
  assert.deepEqual(safeLine(1, 0, [start, goal], start, goal), []);
});
