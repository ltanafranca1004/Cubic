import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, FACE_SIZE, SIDES, SPAWN, isSolidTile, loadWorld, objectsOn, parseStringMap, parseTmj } from '../src/index';

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

test('face 6 has portals on the same tiles on both sides', () => {
  const world = loadWorld();
  const tiles = (side: 'out' | 'in') =>
    objectsOn(world, side, 6, 'portal')
      .map((o) => `${o.x},${o.y}`)
      .sort();
  assert.ok(tiles('out').length > 0);
  assert.deepEqual(tiles('out'), tiles('in'));
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
