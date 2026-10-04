import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import {
  FACES,
  FACE_SIZE,
  PUZZLES,
  SIDES,
  SOLID,
  SPAWN,
  STRING_MAPS,
  TILE_KINDS,
  createGame,
  defaultEnv,
  findPath,
  isBlocked,
  isSolidTile,
  linesOn,
  loadWorld,
  objectiveFor,
  objectsOn,
  parseStringMap,
  parseTmj,
  portalFace,
  portalOpen,
  visibleObjects,
  type FaceId,
  type Side,
  type TileRef,
} from '../src/index';
import { TMJ_MAPS } from '../src/maps/generated';
import { recordingEnv, solver } from './harness';
import { SOLUTIONS } from './solutions';

// Smoke tests for the world the game actually ships: all 12 maps, the spawn tiles, the
// things puzzles look up, reachability, and a whole game won with the solution scripts.
// Run just this file: npx tsx --test shared/test/smoke.test.ts

const HOW = 'add one to shared/test/solutions.ts (see docs/puzzle-tests.md)';
const each = (fn: (side: Side, face: FaceId) => void) => {
  for (const side of SIDES) for (const face of FACES) fn(side, face);
};
const key = (o: { x: number; y: number }) => `${o.x},${o.y}`;

/** Run every registered puzzle's solution script on one game, in registry order. */
function solveAll(t: ReturnType<typeof solver>) {
  for (const p of t.env.puzzles) {
    const script = SOLUTIONS[p.id];
    assert.ok(script, `no solution script for "${p.id}": ${HOW}`);
    script(t);
    assert.ok(t.state.solved.includes(p.face), `${p.id}: face ${p.face} is not solved after its script (run after: ${t.state.solved.join(', ') || 'nothing'})`);
  }
}

// ---------- maps ----------

test('smoke: all 12 maps load (outside 1-6, inside 1-6) as FACE_SIZE x FACE_SIZE known terrain', () => {
  const world = loadWorld();
  let count = 0;
  each((side, face) => {
    const map = world[side][face];
    const where = `${side}-${face}`;
    assert.deepEqual([map.side, map.face], [side, face], where);
    assert.equal(map.tiles.length, FACE_SIZE, where);
    for (const row of map.tiles) {
      assert.equal(row.length, FACE_SIZE, where);
      for (const tile of row) assert.ok(TILE_KINDS.includes(tile), `${where}: unknown terrain "${tile}"`);
    }
    for (const o of map.objects) {
      assert.ok(o.type, `${where}: object without a type at ${key(o)}`);
      assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y) && o.x >= 0 && o.x < FACE_SIZE && o.y >= 0 && o.y < FACE_SIZE, `${where}: ${o.type} is off the map at ${key(o)}`);
    }
    count++;
  });
  assert.equal(count, 12);
});

test('smoke: every string map parses, also the ones a Tiled map replaces', () => {
  each((side, face) => {
    const rows = STRING_MAPS[side]?.[face];
    assert.ok(rows, `no string map for ${side}-${face}`);
    assert.doesNotThrow(() => parseStringMap(side, face, rows));
  });
});

test('smoke: every bundled .tmj parses, and /maps/*.tmj matches the bundle', () => {
  const name = /^(out|in)-([1-6])$/;
  for (const [id, json] of Object.entries(TMJ_MAPS)) {
    const m = name.exec(id);
    assert.ok(m, `generated.ts has a map with a bad key "${id}"`);
    assert.doesNotThrow(() => parseTmj(m[1] as Side, Number(m[2]) as FaceId, json), `${id}.tmj`);
  }
  // A .tmj saved in /maps but not bundled (or edited after bundling) is silently ignored by the game.
  const dir = new URL('../../maps/', import.meta.url);
  const onDisk = readdirSync(dir).filter((f) => f.endsWith('.tmj') && f !== 'template.tmj');
  for (const file of onDisk) {
    const id = file.slice(0, -'.tmj'.length);
    assert.ok(name.test(id), `maps/${file}: the game only loads <side>-<face>.tmj (out|in, 1-6)`);
    assert.deepEqual(TMJ_MAPS[id], JSON.parse(readFileSync(new URL(file, dir), 'utf8')), `maps/${file} is not what is bundled: run "npm run maps" and commit`);
  }
  assert.deepEqual(Object.keys(TMJ_MAPS).sort(), onDisk.map((f) => f.slice(0, -'.tmj'.length)).sort(), 'generated.ts bundles a map that is no longer in /maps: run "npm run maps"');
});

// ---------- spawn ----------

test('smoke: spawn tiles are free of terrain and of puzzle blockers', () => {
  const state = createGame(0);
  for (const side of SIDES) {
    const pose = state.players[side].pose;
    const tile: TileRef = { face: pose.face, x: pose.x, y: pose.y };
    assert.deepEqual([tile.face, tile.x, tile.y], [1, SPAWN[side].x, SPAWN[side].y]);
    assert.equal(isSolidTile(defaultEnv.world, side, tile.face, tile.x, tile.y), false, `${side} spawns inside terrain`);
    assert.equal(isBlocked(state, side, tile), false, `${side} spawn is blocked by a puzzle`);
    // Not walled in either: there is somewhere to step.
    assert.ok(
      findPath(state, side, (p) => p.x !== tile.x || p.y !== tile.y || p.face !== tile.face),
      `${side} cannot move off the spawn tile`,
    );
  }
});

// ---------- required items and objects ----------

test('smoke: items, targets and portals stand on walkable terrain', () => {
  const world = loadWorld();
  each((side, face) => {
    for (const o of world[side][face].objects) {
      if (!['item', 'target', 'portal'].includes(o.type)) continue;
      assert.equal(SOLID[world[side][face].tiles[o.y]![o.x]!], false, `${side}-${face}: ${o.type} "${o.name}" at ${key(o)} is inside solid terrain`);
    }
  });
});

test('smoke: item ids are unique and every target accepts something that exists', () => {
  const state = createGame(0); // throws on a duplicate item id
  const items = Object.values(state.items);
  each((side, face) => {
    for (const target of objectsOn(defaultEnv.world, side, face, 'target')) {
      const want = target.props.accepts;
      if (want === undefined || want === '') continue; // accepts anything
      // Items never change side, so the item has to live on the target's side.
      const ok = items.some((i) => i.side === side && (i.id === want || i.kind === want));
      assert.ok(ok, `${side}-${face}: target "${target.name}" accepts "${want}", but no ${side} item has that id or kind`);
    }
  });
});

test('smoke: portals, if any, are on the same tiles of the same faces on both sides', () => {
  const world = loadWorld();
  const tiles = (side: Side) =>
    FACES.flatMap((face) => objectsOn(world, side, face, 'portal').map((o) => `face ${face} ${key(o)}`)).sort();
  assert.deepEqual(tiles('out'), tiles('in'));
});

test('smoke: every object and item a registered puzzle looks up exists in the world', () => {
  // Play the whole game with the puzzles wrapped, so every hook runs at least once
  // (init, isBlocked, onEnter, onLeave, onUse, onPush, onItem, isSolved), then ask for what each side sees.
  const { env, missing, found } = recordingEnv(defaultEnv);
  const state = createGame(0, env);
  const look = () => {
    each((side, face) => {
      visibleObjects(state, side, face, env);
      linesOn(state, side, face, env);
    });
    for (const side of SIDES) objectiveFor(state, side, env);
  };
  look();
  const t = solver(state, env);
  for (const p of env.puzzles) {
    try {
      SOLUTIONS[p.id]?.(t);
    } catch {
      // A script that cannot finish is reported by the tests around this one. Here the
      // useful message is which lookup came back empty.
    }
  }
  t.wait(1000);
  look();
  assert.deepEqual([...missing].sort(), [], 'a puzzle looked up something the maps do not have (wrong side, face, type or id?)');
  assert.ok(found.size > 0, 'the recorder saw no lookups at all');
});

// ---------- reachability ----------

test('smoke: every face is reachable from spawn, for both sides', () => {
  const state = createGame(0);
  each((side, face) => {
    assert.ok(findPath(state, side, (p) => p.face === face), `${side} cannot reach face ${face} from spawn`);
  });
});

// ---------- the whole game ----------

test('smoke: the whole game is winnable with the registered puzzles', () => {
  const state = createGame(0);
  const t = solver(state);
  assert.equal(portalOpen(state), PUZZLES.length === 0);

  solveAll(t);
  assert.deepEqual(state.solved, PUZZLES.map((p) => p.face).sort());
  assert.equal(portalOpen(state), true);
  assert.equal(portalFace(), null);

  // The shipped world has no portal: the last solve is the win.
  assert.ok(t.events.some((e) => e.type === 'win'), 'no win event');
  assert.notEqual(state.wonAt, null);
  assert.deepEqual(t.move('out', 1, 0), [], 'the game goes on after the win');
});
