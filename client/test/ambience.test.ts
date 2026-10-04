import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FACES, FACE_SIZE, SIDES, defaultEnv, type TileKind } from '@cubic/shared';
import { FX, FX_CELL, FX_FRAME_COUNT, FX_SHEET } from '../src/world/ambience/frames';
import {
  Budget,
  DECOR_CAP,
  FLEE_TILES,
  LAND_TILES,
  LIGHT_FAR,
  LIGHT_NEAR,
  PARTICLE_CAP,
  PARTICLE_CAP_REDUCED,
  besideSolid,
  effectCount,
  faceKey,
  facePlan,
  fleeVector,
  lightAt,
  pickTiles,
  shouldFlee,
  type EffectId,
  type Motion,
} from '../src/world/ambience/plan';

const FULL: Motion = { reduceMotion: false, screenShake: true };
const REDUCED: Motion = { reduceMotion: true, screenShake: true };
const NO_SHAKE: Motion = { reduceMotion: false, screenShake: false };
const ASSETS = new URL('../public/assets/', import.meta.url);

test('every outside face has its own effects and sound; every room shares the inside set', () => {
  const out = (face: 1 | 2 | 3 | 4 | 5 | 6) => facePlan('out', face, FULL);
  assert.deepEqual(out(1).effects, ['tufts', 'flowers', 'butterflies', 'wind', 'waterGlints', 'wade', 'canopy']);
  assert.deepEqual(out(2).effects, ['sand', 'shimmer', 'tumbleweed', 'waterGlints', 'canopy']);
  assert.deepEqual(out(3).effects, ['snow', 'breath', 'iceSparkle', 'footprints', 'canopy']);
  assert.deepEqual(out(4).effects, ['fireflies', 'leaves', 'birds', 'waterGlints', 'canopy']);
  assert.deepEqual(out(5).effects, ['cloudShadows', 'gulls', 'flags', 'waterGlints', 'canopy']);
  assert.deepEqual(out(6).effects, ['drips', 'crystals', 'waterGlints', 'canopy']);
  assert.deepEqual(FACES.map((f) => out(f).loop), ['grass', 'desert', 'snow', 'forest', 'rooftop', 'cave']);
  assert.deepEqual(FACES.map((f) => out(f).surface), ['grass', 'sand', 'snow', 'leaves', 'roof', 'stone']);
  for (const face of FACES) {
    const room = facePlan('in', face, FULL);
    assert.deepEqual(room.effects, ['tint', 'wallLights', 'motes']);
    assert.equal(room.loop, 'hum');
    assert.equal(room.surface, 'room');
  }
  // each room hums at its own pitch
  assert.equal(new Set(FACES.map((f) => facePlan('in', f, FULL).loopRate)).size, FACES.length);
});

test('particle caps: what a face asks for always fits, and reduce motion asks for less', () => {
  const still: EffectId[] = ['tufts', 'flowers', 'flags', 'crystals', 'wallLights', 'tint', 'breath', 'canopy', 'wade', 'footprints'];
  for (const side of SIDES) {
    for (const face of FACES) {
      for (const motion of [FULL, REDUCED]) {
        const plan = facePlan(side, face, motion);
        assert.equal(plan.cap, motion.reduceMotion ? PARTICLE_CAP_REDUCED : PARTICLE_CAP);
        const moving = plan.effects.filter((e) => !still.includes(e)).reduce((n, e) => n + effectCount(e, motion), 0);
        assert.ok(moving <= plan.cap - 4, `${side} ${face}: ${moving} moving things leave room for footsteps under ${plan.cap}`);
        const decor = plan.effects.filter((e) => still.includes(e) && e !== 'tint' && e !== 'breath' && e !== 'canopy' && e !== 'wade').reduce((n, e) => n + effectCount(e, motion), 0);
        assert.ok(decor <= DECOR_CAP, `${side} ${face}: ${decor} decorations`);
      }
    }
  }
  assert.ok(PARTICLE_CAP_REDUCED * 2 < PARTICLE_CAP);
  assert.ok(effectCount('snow', REDUCED) < effectCount('snow', FULL) / 2);
  assert.equal(effectCount('tufts', REDUCED), effectCount('tufts', FULL), 'plants stay, they just stop swaying');
});

test('reduce motion and screen shake off: no shimmer, nothing that sweeps the view', () => {
  assert.ok(facePlan('out', 2, FULL).effects.includes('shimmer'));
  assert.ok(!facePlan('out', 2, REDUCED).effects.includes('shimmer'));
  assert.ok(!facePlan('out', 2, NO_SHAKE).effects.includes('shimmer'));
  assert.ok(facePlan('out', 2, NO_SHAKE).effects.includes('sand'), 'screen shake off only drops the jitter');
  for (const gone of ['wind', 'tumbleweed', 'cloudShadows'] as const) {
    for (const face of FACES) assert.ok(!facePlan('out', face, REDUCED).effects.includes(gone), gone);
  }
});

test('the budget never goes over its cap', () => {
  const b = new Budget(3);
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
  assert.equal(b.count, 3);
  b.release();
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  for (let i = 0; i < 10; i++) b.release();
  assert.equal(b.count, 0);
});

test('birds flee when the player is near, upwards and away', () => {
  const bird = { x: 5, y: 5 };
  assert.equal(shouldFlee(bird, { x: 5, y: 7 }), true);
  assert.equal(shouldFlee(bird, { x: 6, y: 6 }), true);
  assert.equal(shouldFlee(bird, { x: 7, y: 7 }), false, 'two tiles diagonally is far enough');
  assert.equal(shouldFlee(bird, { x: 5, y: 8 }), false);
  assert.equal(shouldFlee(bird, { x: 5 + FLEE_TILES, y: 5 }), true);
  assert.ok(LAND_TILES > FLEE_TILES + 1, 'a bird never lands where it would flee at once');
  for (const player of [{ x: 4, y: 5 }, { x: 6, y: 4 }, { x: 5, y: 6 }, { x: 5, y: 5 }]) {
    const v = fleeVector(bird, player);
    assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
    assert.ok(v.y < 0, 'always up the screen');
    if (player.x !== bird.x) assert.equal(Math.sign(v.x), Math.sign(bird.x - player.x), 'away from the player');
  }
});

test('decoration tiles: the same every time, only where asked, never more than the limit', () => {
  for (const side of SIDES) {
    for (const face of FACES) {
      const tiles = defaultEnv.world[side][face].tiles;
      const floor = (k: TileKind) => k === 'floor';
      const a = pickTiles(tiles, floor, 14, 11);
      assert.deepEqual(a, pickTiles(tiles, floor, 14, 11));
      assert.ok(a.length <= 14);
      assert.equal(new Set(a.map((t) => `${t.x},${t.y}`)).size, a.length);
      for (const t of a) {
        assert.equal(tiles[t.y]![t.x], 'floor');
        assert.ok(t.x >= 0 && t.x < FACE_SIZE && t.y >= 0 && t.y < FACE_SIZE);
      }
      for (const t of pickTiles(tiles, (k, x, y) => k === 'floor' && besideSolid(tiles, x, y), 99, 41)) {
        const near = [tiles[t.y]?.[t.x + 1], tiles[t.y]?.[t.x - 1], tiles[t.y + 1]?.[t.x], tiles[t.y - 1]?.[t.x]];
        assert.ok(near.some((k) => k !== undefined && k !== 'floor'));
      }
    }
  }
  assert.deepEqual(pickTiles(defaultEnv.world.out[1].tiles, () => true, 0, 1), []);
  assert.notDeepEqual(pickTiles(defaultEnv.world.out[2].tiles, () => true, 5, 1), pickTiles(defaultEnv.world.out[2].tiles, () => true, 5, 2));
});

test('the inside light falls off like the room does', () => {
  assert.equal(lightAt(0), 1);
  assert.equal(lightAt(LIGHT_NEAR), 1);
  assert.equal(lightAt(LIGHT_FAR), 0);
  assert.equal(lightAt(99), 0);
  assert.equal(lightAt((LIGHT_NEAR + LIGHT_FAR) / 2), 0.5);
});

test('only the shown face has effects: the key changes with side, face, orientation and settings', () => {
  const k = faceKey('out', 1, [0, 1, 0], FULL);
  assert.equal(k, faceKey('out', 1, [0, 1, 0], FULL));
  for (const other of [faceKey('in', 1, [0, 1, 0], FULL), faceKey('out', 2, [0, 1, 0], FULL), faceKey('out', 1, [1, 0, 0], FULL), faceKey('out', 1, [0, 1, 0], REDUCED), faceKey('out', 1, [0, 1, 0], NO_SHAKE)]) {
    assert.notEqual(k, other);
  }
});

test('the fx sheet has every frame the table names, and every loop has both files', () => {
  const png = readFileSync(new URL(FX_SHEET, ASSETS));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const frames = (width / FX_CELL) * (height / FX_CELL);
  const all = Object.values(FX).flat();
  assert.equal(width % FX_CELL, 0);
  assert.ok(frames >= FX_FRAME_COUNT);
  assert.deepEqual([...all].sort((a, b) => a - b), Array.from({ length: FX_FRAME_COUNT }, (_, i) => i), 'the table covers the sheet with no gaps or repeats');
  const loops = new Set(SIDES.flatMap((side) => FACES.map((face) => facePlan(side, face, FULL).loop)));
  assert.equal(loops.size, 7);
  for (const loop of loops) {
    for (const ext of ['ogg', 'mp3']) assert.ok(existsSync(new URL(`audio/ambience/${loop}.${ext}`, ASSETS)), `${loop}.${ext}`);
  }
});
