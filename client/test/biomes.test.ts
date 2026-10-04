import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, FACE_SIZE, createGame, defaultEnv, visibleObjects, type FaceId } from '@cubic/shared';
import { DECOR, DECOR_LEGEND, TREES, WIND_STEPS, decorAt, decorSpots, dressed, dripPoints, isTall, overhangTiles, propAt, propCell, shoreMask, skinAt, wadeAt, windStep } from '../src/world/biomes/decor';
import { PROPS, PROP_CELLS, PROP_COLS, PROP_H, PROP_LIST, PROP_SHEET, PROP_VEIL, PROP_W, TALL, WATER_CELL, WATER_FRAMES, WATER_MASKS, WATER_SHEET, type PropName } from '../src/world/biomes/sheet';

const ASSETS = new URL('../public/assets/', import.meta.url);
const out = (face: FaceId) => defaultEnv.world.out[face];
const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
const size = (path: string) => {
  const png = readFileSync(new URL(path, ASSETS));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

/**
 * Every tile of an outside face a puzzle object or an item can be drawn on: what the map
 * has, and what the puzzles show over many games (the stepping stones move every game).
 */
function objectTiles(face: FaceId): Set<string> {
  const tiles = new Set(out(face).objects.map(key));
  for (let game = 0; game < 60; game++) {
    const state = createGame(game * 7919);
    for (const o of visibleObjects(state, 'out', face)) tiles.add(key(o));
    for (const item of Object.values(state.items)) if (item.side === 'out' && item.face === face) tiles.add(key(item));
  }
  return tiles;
}

test('the decor maps are face sized and use only legend characters', () => {
  for (const face of FACES) {
    assert.equal(DECOR[face].length, FACE_SIZE, `face ${face} rows`);
    for (const row of DECOR[face]) {
      assert.equal(row.length, FACE_SIZE, `face ${face}: "${row}"`);
      for (const ch of row) assert.ok(ch === '.' || DECOR_LEGEND[ch], `face ${face}: unknown "${ch}"`);
    }
  }
});

test('every decor tile stands on what it says, and never on a puzzle object or an item', () => {
  for (const face of FACES) {
    const taken = objectTiles(face);
    for (const s of decorSpots(face)) {
      const kind = out(face).tiles[s.y]![s.x]!;
      const where = `face ${face} "${s.ch}" at ${s.x},${s.y}`;
      if (s.entry.on === 'floor') assert.equal(kind, 'floor', `${where} is on ${kind}`);
      else if (s.entry.on === 'water') assert.equal(kind, 'water', `${where} is on ${kind}`);
      else assert.ok(kind === 'wall' || kind === 'tree', `${where}: a landmark needs a solid tile, this is ${kind}`);
      assert.ok(!taken.has(key(s)), `${where} covers a puzzle object or an item`);
      assert.equal(decorAt(face, s.x, s.y), s);
      if (s.prop) assert.equal(propAt(out(face).tiles, face, s.x, s.y), s.prop, where);
    }
  }
});

test('a tall prop never hangs over a puzzle object, whichever way the face is turned', () => {
  for (const face of FACES) {
    const taken = objectTiles(face);
    const { tiles } = out(face);
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const prop = propAt(tiles, face, x, y);
        if (!prop || !isTall(prop)) continue;
        assert.notEqual(tiles[y]![x], 'floor', `face ${face}: tall ${prop} at ${x},${y} must be on a solid tile`);
        for (const t of overhangTiles(x, y)) assert.ok(!taken.has(key(t)), `face ${face}: ${prop} at ${x},${y} hangs over the object at ${t.x},${t.y}`);
      }
  }
});

test('the forest clearing is left to the stepping stones: no decor in it, no tree beside it', () => {
  // the stones mirror the floor of the inside room: every tile inside its walls
  const room = defaultEnv.world.in[4].tiles;
  const walls = room.flatMap((row, y) => row.flatMap((k, x) => (k === 'wall' ? [{ x, y }] : [])));
  const lo = { x: Math.min(...walls.map((w) => w.x)), y: Math.min(...walls.map((w) => w.y)) };
  const hi = { x: Math.max(...walls.map((w) => w.x)), y: Math.max(...walls.map((w) => w.y)) };
  const inside = (t: { x: number; y: number }) => t.x > lo.x && t.x < hi.x && t.y > lo.y && t.y < hi.y;
  const { tiles } = out(4);
  for (let y = 0; y < FACE_SIZE; y++)
    for (let x = 0; x < FACE_SIZE; x++) {
      const prop = propAt(tiles, 4, x, y);
      if (!prop) continue;
      assert.ok(!inside({ x, y }), `${prop} at ${x},${y} is in the clearing`);
      if (isTall(prop)) for (const t of overhangTiles(x, y)) assert.ok(!inside(t), `${prop} at ${x},${y} hangs into the clearing at ${t.x},${t.y}`);
    }
});

test('terrain skins: every tree and every water tile of an outside face is dressed, plain walls are not', () => {
  for (const face of FACES) {
    const { tiles } = out(face);
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const kind = tiles[y]![x]!;
        const skin = skinAt(tiles, face, x, y);
        if (kind === 'tree') assert.ok(skin, `face ${face}: the tree at ${x},${y} has no skin`);
        if (kind === 'floor' || kind === 'water') assert.equal(skin, null);
        assert.equal(dressed(tiles, face, x, y), kind === 'water' || skin !== null);
        if (kind === 'wall' && !decorAt(face, x, y)) assert.equal(skin, null, 'a plain wall keeps its own tile');
      }
    for (const name of TREES[face]) assert.ok(PROPS[name], name);
  }
});

test('each biome has what was asked for, and one thing to remember it by', () => {
  const props = (face: FaceId) => {
    const all: PropName[] = [];
    for (let y = 0; y < FACE_SIZE; y++)
      for (let x = 0; x < FACE_SIZE; x++) {
        const p = propAt(out(face).tiles, face, x, y);
        if (p) all.push(p);
      }
    return all;
  };
  const water = (face: FaceId) => out(face).tiles.flat().filter((k) => k === 'water').length;
  // grass: tall grass to wade through, and bushes
  assert.ok(props(1).filter((p) => p.startsWith('tallGrass')).length >= 12);
  assert.ok(props(1).some((p) => p.startsWith('bush')));
  assert.ok(wadeAt(out(1).tiles, 1, 1, 8) && !wadeAt(out(1).tiles, 1, 5, 9));
  // desert: cacti, and an oasis with palms
  assert.ok(props(2).filter((p) => p.startsWith('cactus')).length >= 3);
  assert.ok(water(2) >= 4 && props(2).includes('palm'));
  // snow: snowy pines and exactly one snowman
  assert.ok(props(3).some((p) => p.startsWith('pine')));
  assert.equal(props(3).filter((p) => p === 'snowman').length, 1);
  // forest: trees, all of them swaying
  const oaks = props(4).filter((p) => p.startsWith('oak'));
  assert.ok(oaks.length >= 12);
  for (const oak of new Set(oaks)) assert.ok(new Set(Array.from({ length: WIND_STEPS }, (_, t) => propCell(oak, t, 0, 0, false))).size >= 3, `${oak} sways`);
  // cave: spikes, a pool, and water dripping onto rock and into the pool
  assert.ok(props(6).some((p) => p.startsWith('stalag')));
  assert.ok(water(6) >= 3);
  const drips = dripPoints(out(6).tiles, 6);
  assert.ok(drips.some((d) => d.water) && drips.some((d) => !d.water));
  for (const face of [1, 2, 3, 4, 5] as const) assert.deepEqual(dripPoints(out(face).tiles, face), [], 'only the cave drips');
});

test('the wind: a gust crosses the screen, and reduce motion stops everything', () => {
  for (let tick = 0; tick < 40; tick++) {
    for (const [sx, sy] of [[0, 0], [5, 3], [11, 11]] as const) {
      const step = windStep(tick, sx, sy);
      assert.ok(Number.isInteger(step) && step >= 0 && step < WIND_STEPS);
    }
  }
  assert.equal(windStep(8, 3, 0), windStep(5, 0, 0), 'a tree three tiles to the right is three ticks behind');
  for (const [name] of PROP_LIST) {
    const cells = new Set<number>();
    for (let tick = 0; tick < WIND_STEPS * 4; tick++) {
      const cell = propCell(name, tick, 4, 5, false);
      assert.ok(PROPS[name].includes(cell), `${name}: cell ${cell} is not one of its frames`);
      cells.add(propCell(name, tick, 4, 5, true));
    }
    assert.equal(cells.size, 1, `${name} moves with reduce motion on`);
  }
  // blades stand upright when still, not leaning
  assert.equal(propCell('tallGrassA', 0, 0, 0, true), PROPS.tallGrassA[1]);
});

test('water banks: land on a side of the screen puts a bank on that side', () => {
  const { tiles } = out(5);
  const up: [number, number, number] = [0, 0, -1];
  let checked = 0;
  for (let sy = 0; sy < FACE_SIZE; sy++)
    for (let sx = 0; sx < FACE_SIZE; sx++) {
      const mask = shoreMask(tiles, 5, up, sx, sy);
      assert.ok(mask >= 0 && mask < WATER_MASKS);
      checked++;
    }
  assert.equal(checked, FACE_SIZE * FACE_SIZE);
  const lone = Array.from({ length: FACE_SIZE }, () => Array.from({ length: FACE_SIZE }, () => 'floor' as const));
  assert.equal(shoreMask(lone, 5, up, 4, 4), 15, 'land on all four sides');
});

test('the sheets hold every cell the table names, and the manifest agrees', () => {
  const props = size(PROP_SHEET);
  assert.equal(props.width, PROP_COLS * PROP_W);
  assert.equal(props.height % PROP_H, 0);
  assert.ok((props.height / PROP_H) * PROP_COLS >= PROP_CELLS);
  assert.deepEqual(size(PROP_VEIL), props, 'the veil is the same sheet with holes');
  assert.deepEqual(Object.values(PROPS).flat(), Array.from({ length: PROP_CELLS }, (_, i) => i), 'no gaps, no repeats');
  for (const name of TALL) assert.ok(PROPS[name], name);
  assert.deepEqual(size(WATER_SHEET), { width: WATER_MASKS * WATER_CELL, height: FACES.length * WATER_FRAMES * WATER_CELL });
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', ASSETS), 'utf8')) as { biomes: { props: { image: string; veil: string; frames: Record<string, number[]> }; water: { image: string } } };
  assert.equal(manifest.biomes.props.image, PROP_SHEET);
  assert.equal(manifest.biomes.props.veil, PROP_VEIL);
  assert.equal(manifest.biomes.water.image, WATER_SHEET);
  assert.deepEqual(manifest.biomes.props.frames, PROPS);
});
