import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, FACE_SIZE, LEGEND, SIDES, SPAWN, isSolidTile, loadWorld, objectsOn, onRing, parseStringMap, parseTmj } from '../src/index';

test('every face loads as a FACE_SIZE x FACE_SIZE map', () => {
  const world = loadWorld();
  for (const side of SIDES) {
    for (const face of FACES) {
      const map = world[side][face];
      assert.equal(map.tiles.length, FACE_SIZE);
      for (const row of map.tiles) assert.equal(row.length, FACE_SIZE);
    }
  }
});

test('spawn tiles are walkable', () => {
  const world = loadWorld();
  for (const side of SIDES) assert.equal(isSolidTile(world, side, 1, SPAWN[side].x, SPAWN[side].y), false);
});

test('edge rule: no solid terrain on the outer ring of any face, on either side', () => {
  const world = loadWorld();
  const bad: string[] = [];
  for (const side of SIDES) {
    for (const face of FACES) {
      for (let y = 0; y < FACE_SIZE; y++) {
        for (let x = 0; x < FACE_SIZE; x++) {
          if (onRing(x, y) && isSolidTile(world, side, face, x, y)) bad.push(`${side}-${face} ${x},${y} (${world[side][face].tiles[y]![x]})`);
        }
      }
    }
  }
  // A player walking in over the edge must always be able to step in: move the terrain inward.
  assert.deepEqual(bad, [], `solid terrain on the ring: ${bad.join('; ')}`);
});

test('onRing is the outer row and column of a face', () => {
  assert.deepEqual([onRing(0, 5), onRing(5, 0), onRing(FACE_SIZE - 1, 5), onRing(5, FACE_SIZE - 1)], [true, true, true, true]);
  assert.deepEqual([onRing(1, 1), onRing(FACE_SIZE - 2, FACE_SIZE - 2), onRing(5, 5)], [false, false, false]);
});

test('the shipped world has no portal: the game is won on the last solve', () => {
  const world = loadWorld();
  for (const side of SIDES) for (const face of FACES) assert.deepEqual(objectsOn(world, side, face, 'portal'), []);
});

test('every legend character is one character and means one thing', () => {
  for (const ch of Object.keys(LEGEND)) assert.equal(ch.length, 1, `legend key "${ch}"`);
  for (const ch of ['.', '#', 'T', '~', 'I', 'U']) assert.ok(LEGEND[ch], `legend lost "${ch}"`);
});

test('string maps reject bad input', () => {
  assert.throws(() => parseStringMap('out', 1, ['.'.repeat(FACE_SIZE)]), new RegExp(`expected ${FACE_SIZE} rows`));
  assert.throws(() => parseStringMap('out', 1, Array(FACE_SIZE).fill('....?'.padEnd(FACE_SIZE, '.'))), /unknown character/);
});

test('the Tiled template parses: terrain kinds and typed objects', () => {
  const json = JSON.parse(readFileSync(new URL('../../maps/template.tmj', import.meta.url), 'utf8'));
  const map = parseTmj('in', 2, json);
  assert.equal(map.tiles[2]![2], 'wall');
  assert.equal(map.tiles[2]![9], 'tree');
  assert.equal(map.tiles[5]![5], 'water');
  assert.equal(map.tiles[0]![0], 'floor');
  assert.deepEqual(
    map.objects.map((o) => [o.type, o.name, o.x, o.y]),
    [
      ['plate', '', 3, 3],
      ['item', 'rose', 8, 7],
      ['target', 'pot', 2, 8],
    ],
  );
  assert.equal(map.objects[2]!.props.accepts, 'rose');
});
