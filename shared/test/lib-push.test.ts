import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStringMap } from '../src/index';
import { boxAt, floorOf, pushBox, resetBoxes, type Box } from '../src/puzzles/lib/push';

const rows = Array.from({ length: 12 }, (_, y) => (y === 5 ? '.......#....' : '............'));
const free = floorOf(parseStringMap('out', 1, rows).tiles);
const start: Box[] = [
  { id: 'a', x: 4, y: 5 },
  { id: 'b', x: 5, y: 5 },
  { id: 'c', x: 9, y: 9 },
];
const fresh = () => start.map((b) => ({ ...b }));

test('push: a box moves one tile, stops at a box, at terrain and at the ring', () => {
  const boxes = fresh();
  assert.equal(pushBox(boxes, { x: 3, y: 3 }, 1, 0, free), null); // no box there
  assert.equal(pushBox(boxes, { x: 4, y: 5 }, 1, 0, free), null); // box b in the way
  assert.deepEqual(pushBox(boxes, { x: 5, y: 5 }, 1, 0, free), { id: 'b', x: 6, y: 5 });
  assert.equal(pushBox(boxes, { x: 6, y: 5 }, 1, 0, free), null); // wall at 7,5
  assert.deepEqual(boxAt(boxes, { x: 6, y: 5 })?.id, 'b');
  // c goes to 10,9 but never onto the ring (x = 11).
  assert.ok(pushBox(boxes, { x: 9, y: 9 }, 1, 0, free));
  assert.equal(pushBox(boxes, { x: 10, y: 9 }, 1, 0, free), null);
  assert.deepEqual(pushBox(boxes, { x: 10, y: 9 }, 1, 0, free, true), { id: 'c', x: 11, y: 9 }); // allowed on request
  assert.equal(pushBox(boxes, { x: 11, y: 9 }, 1, 0, free, true), null); // never off the face
});

test('push: reset puts every box back, as plain JSON', () => {
  const boxes = fresh();
  pushBox(boxes, { x: 5, y: 5 }, 0, 1, free);
  assert.notDeepEqual(boxes, start);
  resetBoxes(boxes, start);
  assert.deepEqual(boxes, start);
  assert.notEqual(boxes[0], start[0]); // copies: the start layout is never mutated
});
