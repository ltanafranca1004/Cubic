import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, SIDES, SPAWN, isSolidTile, loadWorld, objectsOn, parseStringMap, parseTmj } from '../src/index';

test('every face loads as a 10x10 map', () => {
  const world = loadWorld();
  for (const side of SIDES) {
    for (const face of FACES) {
      const map = world[side][face];
      assert.equal(map.tiles.length, 10);
      for (const row of map.tiles) assert.equal(row.length, 10);
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
  assert.throws(() => parseStringMap('out', 1, ['..........']), /expected 10 rows/);
  assert.throws(() => parseStringMap('out', 1, Array(10).fill('....?.....')), /unknown character/);
});

test('the Tiled template parses: terrain kinds and typed objects', () => {
  const json = JSON.parse(readFileSync(new URL('../../maps/template.tmj', import.meta.url), 'utf8'));
  const map = parseTmj('in', 2, json);
  assert.equal(map.tiles[1]![1], 'wall');
  assert.equal(map.tiles[1]![8], 'tree');
  assert.equal(map.tiles[4]![4], 'water');
  assert.equal(map.tiles[0]![0], 'floor');
  assert.deepEqual(
    map.objects.map((o) => [o.type, o.name, o.x, o.y]),
    [
      ['plate', '', 2, 2],
      ['item', 'rose', 7, 6],
      ['target', 'pot', 1, 7],
    ],
  );
  assert.equal(map.objects[2]!.props.accepts, 'rose');
});
