import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FACE_SIZE,
  SPAWN,
  applyInteract,
  applyMove,
  brightFace,
  createGame,
  devSolve,
  linesOn,
  loadWorld,
  objectiveFor,
  parseStringMap,
  pathTo,
  portalFace,
  portalOpen,
  seedOf,
  visibleObjects,
  type GameEnv,
  type GameEvent,
  type GameState,
  type PuzzleModule,
  type Side,
  type TileRef,
} from '../src/index';
import { mix } from '../src/puzzles/util';
import { FIX, fixtureEnv } from './fixture';

// The engine, on the fixture world (./fixture.ts), never on the shipped puzzles.

/** Walk `side` to a tile with real moves. Fails the test if there is no path. */
function go(state: GameState, side: Side, target: TileRef, env: GameEnv): GameEvent[] {
  const path = pathTo(state, side, target, env);
  assert.ok(path, `no path for ${side} to face ${target.face} ${target.x},${target.y}`);
  const events: GameEvent[] = [];
  for (const [dx, dy] of path) events.push(...applyMove(state, side, dx, dy, 1000, env));
  const p = state.players[side].pose;
  assert.deepEqual([p.face, p.x, p.y], [target.face, target.x, target.y]);
  return events;
}

test('a new game starts both players on face 1 with nothing solved, as plain JSON', () => {
  for (const s of [createGame(0), createGame(0, fixtureEnv())]) {
    assert.equal(s.players.out.pose.face, 1);
    assert.equal(s.players.in.pose.face, 1);
    assert.deepEqual(s.solved, []);
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
  }
});

test('seed: given, or derived from the start time; it is what ctx.rand mixes from', () => {
  const env = fixtureEnv();
  assert.equal(createGame(5, env, 1234).seed, 1234);
  assert.equal(createGame(5, env).seed, mix(5));
  assert.notEqual(createGame(5, env).seed, createGame(6, env).seed);
  // A hand-built state without a seed reads as 0.
  assert.equal(seedOf(createGame(5, env, 1234)), 1234);
  assert.equal(seedOf({}), 0);
  const seen: number[] = [];
  const probe: PuzzleModule<{ seed: number }> = {
    id: 'probe',
    face: 2,
    init: (ctx) => ({ seed: ctx.seed }),
    onEnter: (_s, ctx) => void seen.push(ctx.seed, ctx.rand(1, 2), ctx.rand(1, 2), ctx.rand(2, 1)),
    isSolved: () => false,
  };
  const env2: GameEnv = { world: env.world, puzzles: [probe] };
  const s = createGame(0, env2, 77);
  assert.deepEqual(s.puzzles.probe, { seed: 77 });
  go(s, 'in', { face: 2, x: 3, y: 3 }, env2);
  assert.deepEqual(seen.slice(0, 4), [77, mix(77, 1, 2), mix(77, 1, 2), mix(77, 2, 1)]);
  assert.notEqual(seen[1], seen[3]);
});

test('walls block and report a bump; invalid moves are ignored', () => {
  const env = fixtureEnv();
  const s = createGame(0, env);
  const before = { ...s.players.out.pose };
  assert.deepEqual(applyMove(s, 'out', 1, 1, 0, env), []);
  assert.deepEqual(applyMove(s, 'out', 2, 0, 0, env), []);
  assert.deepEqual(s.players.out.pose, before);
  // The crystal is walled in: the tile left of it is a wall.
  go(s, 'out', { face: 1, x: FIX.crystal.x - 2, y: FIX.crystal.y }, env);
  assert.deepEqual(applyMove(s, 'out', 1, 0, 0, env), [{ type: 'bump', side: 'out' }]);
  assert.equal(s.players.out.pose.x, FIX.crystal.x - 2);
});

test('fixture puzzle: the plate inside opens the door outside, and it can be solved', () => {
  const env = fixtureEnv();
  const s = createGame(0, env);
  const door = (): string | undefined => visibleObjects(s, 'out', 1, env).find((o) => o.type === 'door')!.state;

  // Door shut: the crystal is unreachable.
  assert.equal(pathTo(s, 'out', FIX.crystal, env), null);
  assert.equal(door(), 'closed');
  go(s, 'out', { face: 1, x: FIX.door.x, y: FIX.door.y + 1 }, env);
  assert.deepEqual(applyMove(s, 'out', 0, -1, 0, env), [{ type: 'bump', side: 'out' }]);

  const pressed = go(s, 'in', FIX.plate, env);
  assert.ok(pressed.some((e) => e.type === 'puzzle' && e.name === 'door-open'));
  assert.equal(door(), 'open');

  // Stepping off closes it again.
  const released = applyMove(s, 'in', 0, 1, 0, env);
  assert.ok(released.some((e) => e.type === 'puzzle' && e.name === 'door-close'));
  assert.equal(pathTo(s, 'out', FIX.crystal, env), null);
  applyMove(s, 'in', 0, -1, 0, env);

  const events = go(s, 'out', FIX.crystal, env);
  assert.ok(events.some((e) => e.type === 'solve' && e.face === 1));
  assert.deepEqual(s.solved, [1]);

  // Solved: the door stays open even with the plate released, nobody is sealed in.
  applyMove(s, 'in', 0, 1, 0, env);
  assert.ok(pathTo(s, 'out', { face: 1, ...SPAWN.out }, env));
});

test('per-side visibility: each side only sees its own half of the puzzle', () => {
  const env = fixtureEnv();
  const s = createGame(0, env);
  const out = visibleObjects(s, 'out', 1, env).map((o) => o.type);
  const inn = visibleObjects(s, 'in', 1, env).map((o) => o.type);
  assert.deepEqual(out.sort(), ['crystal', 'door']);
  assert.deepEqual(Object.keys(s.items), ['rose']);
  assert.deepEqual(inn, ['plate']);
  assert.notEqual(objectiveFor(s, 'out', env), objectiveFor(s, 'in', env));
});

/** Solve both fixture puzzles with real moves. */
function solveFixture(s: GameState, env: GameEnv): GameEvent[] {
  go(s, 'in', FIX.plate, env);
  go(s, 'out', FIX.crystal, env);
  go(s, 'out', FIX.rose, env);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'pickup', side: 'out', item: 'rose' }]);
  go(s, 'out', FIX.pot, env);
  return applyInteract(s, 'out', 1000, env);
}

test('win without a portal: the last solve wins, wherever the players stand', () => {
  const env = fixtureEnv();
  assert.equal(portalFace(env), null);
  const s = createGame(0, env);
  const planted = solveFixture(s, env);
  assert.deepEqual(planted.map((e) => e.type), ['place', 'puzzle', 'solve', 'win']);
  assert.deepEqual(s.solved, [1, 6]);
  assert.equal(s.wonAt, 1000);
  assert.deepEqual(applyMove(s, 'out', 1, 0, 2000, env), []); // game over: no more moves
  assert.deepEqual(applyInteract(s, 'out', 2000, env), []);
});

test('a world without puzzles is never won', () => {
  const env: GameEnv = { world: fixtureEnv().world, puzzles: [] };
  const s = createGame(0, env);
  applyMove(s, 'out', 1, 0, 0, env);
  assert.equal(s.wonAt, null);
});

test('portal win: needs every puzzle solved and both players on the portal', () => {
  const env = fixtureEnv({ portal: true });
  assert.equal(portalFace(env), 6);
  const s = createGame(0, env);
  go(s, 'out', FIX.portal, env);
  go(s, 'in', FIX.portal, env);
  assert.equal(s.wonAt, null);
  assert.equal(portalOpen(s, env), false);
  assert.equal(visibleObjects(s, 'in', 6, env).find((o) => o.type === 'portal')!.state, 'closed');

  go(s, 'in', FIX.plate, env);
  go(s, 'out', FIX.crystal, env);
  assert.equal(portalOpen(s, env), false); // the rose is still on face 1
  devSolve(s, 6, 1, env);
  assert.equal(portalOpen(s, env), true);
  assert.equal(s.wonAt, null); // all solved is not enough here
  go(s, 'out', FIX.portal, env);
  assert.equal(s.wonAt, null);
  // The win fires the moment the second player touches any portal tile.
  const events = pathTo(s, 'in', FIX.portal, env)!.flatMap(([dx, dy]) => applyMove(s, 'in', dx, dy, 1000, env));
  assert.ok(events.some((e) => e.type === 'win'));
  assert.equal(s.wonAt, 1000);
  assert.deepEqual(applyMove(s, 'out', 1, 0, 1000, env), []);
});

// ---------- onUse, onPush, lines, bright and the item helpers, with a test-only puzzle ----------

interface LabState {
  used: string[];
  box: { x: number; y: number };
  given: boolean;
}

/**
 * Face 2: E is logged; a box at (6,6) can be pushed (not into x = 9); a target at (2,2)
 * hands every placed item straight back; using (0,0) spawns an item, (1,0) removes it.
 */
function labEnv(): { env: GameEnv; calls: string[] } {
  const world = fixtureEnv().world;
  world.out[2] = parseStringMap('out', 2, Array(FACE_SIZE).fill('.'.repeat(FACE_SIZE)));
  world.out[2].objects = [
    { type: 'target', x: 2, y: 2, name: 'tray', props: {} },
    { type: 'item', x: 4, y: 4, name: 'coin', props: { kind: 'coin' } },
    { type: 'item', x: 4, y: 5, name: 'gem', props: { kind: 'gem' } },
  ];
  const calls: string[] = [];
  const lab: PuzzleModule<LabState> = {
    id: 'lab',
    face: 2,
    bright: true,
    init: () => ({ used: [], box: { x: 6, y: 6 }, given: false }),
    isBlocked: (s, _ctx, _side, tile) => tile.x === s.box.x && tile.y === s.box.y,
    onUse(s, ctx, side, tile) {
      s.used.push(`${side}:${tile.x},${tile.y}`);
      if (tile.x === 0 && tile.y === 0) ctx.spawnItem({ id: 'key', kind: 'key', side, face: 2, x: 0, y: 1, props: { teeth: 3 } });
      if (tile.x === 1 && tile.y === 0) ctx.removeItem('key');
      if (tile.x === 3 && tile.y === 0) s.given = ctx.giveItem(side, 'gem');
    },
    onPush(s, _ctx, side, tile, dx, dy) {
      calls.push(`${side}:${tile.x},${tile.y}:${dx},${dy}`);
      if (tile.x !== s.box.x || tile.y !== s.box.y || s.box.x + dx === 9) return false;
      s.box = { x: s.box.x + dx, y: s.box.y + dy };
      return true;
    },
    onItem(_s, ctx, ev) {
      if (ev.kind === 'placed') ctx.giveItem(ev.side, ev.item.id);
    },
    isSolved: (s, ctx) => s.box.x === 8 && ctx.faceSolved(2) === false,
    lines: (s, _ctx, side) => (side === 'out' ? [{ from: [0, 0], to: [s.box.x, s.box.y], colour: '#f00' }] : []),
  };
  return { env: { world, puzzles: [lab] }, calls };
}

/** Put a player on a tile of face 2 without walking (test setup only). */
function put(s: GameState, side: Side, x: number, y: number): void {
  s.players[side].pose = { side, face: 2, up: [0, 1, 0], x, y, dir: 1 };
}
const lab = (s: GameState) => s.puzzles.lab as LabState;

test('onUse: E with empty hands and nothing to pick up, on the own face only, with a use event', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  assert.deepEqual(applyInteract(s, 'out', 1, env), []); // face 1 has no puzzle that listens
  put(s, 'out', 7, 7);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'use', side: 'out' }]);
  assert.deepEqual(lab(s).used, ['out:7,7']);
  put(s, 'in', 3, 3);
  applyInteract(s, 'in', 1, env);
  assert.deepEqual(lab(s).used, ['out:7,7', 'in:3,3']);
  // Q (drop only) and pick-only never use.
  assert.deepEqual(applyInteract(s, 'out', 1, env, 'drop'), []);
  assert.deepEqual(applyInteract(s, 'out', 1, env, 'pick'), []);
  assert.equal(lab(s).used.length, 2);
});

test('onUse comes last: a lying item is picked up, a carried one is dropped, neither uses', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  put(s, 'out', 4, 4);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'pickup', side: 'out', item: 'coin' }]);
  put(s, 'out', 7, 7);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'drop', side: 'out', item: 'coin' }]);
  assert.deepEqual(lab(s).used, []);
  assert.deepEqual(applyInteract(s, 'out', 1, env).map((e) => e.type), ['pickup']); // not a use: the coin lies here
  assert.deepEqual(lab(s).used, []);
});

test('giveItem: an item that was just placed goes straight back into the hands', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  put(s, 'out', 4, 4);
  applyInteract(s, 'out', 1, env);
  put(s, 'out', 2, 2);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'place', side: 'out', item: 'coin', target: 'tray' }]);
  assert.equal(s.players.out.carrying, 'coin');
  assert.deepEqual([s.items.coin!.carriedBy, s.items.coin!.placedOn], ['out', null]);
  // Hands full: another item is refused and nothing changes.
  put(s, 'out', 3, 0);
  applyInteract(s, 'out', 1, env, 'drop');
  put(s, 'out', 3, 0);
  assert.deepEqual(applyInteract(s, 'out', 1, env).map((e) => e.type), ['pickup']);
  put(s, 'out', 3, 1);
  applyInteract(s, 'out', 1, env); // drop the coin at 3,1
  put(s, 'out', 3, 0);
  applyInteract(s, 'out', 1, env); // use: gives the gem from where it lies
  assert.equal(lab(s).given, true);
  assert.equal(s.players.out.carrying, 'gem');
  assert.equal(s.items.gem!.carriedBy, 'out');
});

test('spawnItem adds an item (and throws on a used id), removeItem deletes it', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  put(s, 'out', 0, 0);
  applyInteract(s, 'out', 1, env);
  assert.deepEqual(s.items.key, { id: 'key', kind: 'key', side: 'out', face: 2, x: 0, y: 1, carriedBy: null, placedOn: null, props: { teeth: 3 } });
  assert.throws(() => applyInteract(s, 'out', 1, env), /duplicate item id "key"/);
  // A spawned item is a normal item: pick it up, and E on the remove tile drops it (no use).
  put(s, 'out', 0, 1);
  assert.deepEqual(applyInteract(s, 'out', 1, env).map((e) => e.type), ['pickup']);
  put(s, 'out', 1, 0);
  assert.deepEqual(applyInteract(s, 'out', 1, env).map((e) => e.type), ['drop']);
  assert.equal(s.items.key!.carriedBy, null);
  // The inside player has nothing to pick up on that tile (items live on one side): a use.
  put(s, 'in', 1, 0);
  applyInteract(s, 'in', 1, env);
  assert.equal(s.items.key, undefined);
});

test('removeItem also empties the hands of whoever carries it', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  put(s, 'out', 0, 0);
  applyInteract(s, 'out', 1, env); // spawn the key at 0,1
  put(s, 'in', 1, 0);
  s.items.key!.carriedBy = 'out';
  s.players.out.carrying = 'key';
  applyInteract(s, 'in', 1, env); // the inside player uses the remove tile
  assert.equal(s.items.key, undefined);
  assert.equal(s.players.out.carrying, null);
});

test('onPush: canonical delta, same face only; a moved box frees the tile and emits push', () => {
  const { env, calls } = labEnv();
  const s = createGame(0, env);
  put(s, 'out', 5, 6);
  // Canonical up on face 2 outside: screen right is canonical +x.
  assert.deepEqual(applyMove(s, 'out', 1, 0, 1, env), [{ type: 'push', side: 'out' }, { type: 'step', side: 'out' }]);
  assert.deepEqual(calls, ['out:6,6:1,0']);
  assert.deepEqual(lab(s).box, { x: 7, y: 6 });
  assert.equal(s.players.out.pose.x, 6);
  // The second push lands the box on x = 8: solved in the same move.
  const events = applyMove(s, 'out', 1, 0, 1, env);
  assert.deepEqual(events.map((e) => e.type), ['push', 'step', 'solve', 'win']);
  assert.deepEqual(lab(s).box, { x: 8, y: 6 });
});

test('onPush: a box that will not move still blocks (bump, no push); plain steps ask too', () => {
  const { env, calls } = labEnv();
  const s = createGame(0, env);
  lab(s).box = { x: 8, y: 2 };
  put(s, 'out', 7, 2);
  assert.deepEqual(applyMove(s, 'out', 1, 0, 1, env), [{ type: 'bump', side: 'out' }]);
  assert.deepEqual(lab(s).box, { x: 8, y: 2 });
  assert.equal(s.players.out.pose.x, 7);
  // The inside player sees the wall from behind: screen right is canonical -x.
  put(s, 'in', 5, 9);
  applyMove(s, 'in', 1, 0, 1, env);
  assert.equal(calls.at(-1), 'in:4,9:-1,0');
  // Walking onto the face over an edge never pushes.
  const before = calls.length;
  const s2 = createGame(0, env);
  go(s2, 'out', { face: 2, x: 0, y: 5 }, env);
  assert.ok(calls.slice(before).every((c) => !c.startsWith('out:0,')), 'onPush fired for an edge crossing');
});

test('linesOn and brightFace come from the puzzle of the face, per side', () => {
  const { env } = labEnv();
  const s = createGame(0, env);
  assert.deepEqual(linesOn(s, 'out', 2, env), [{ from: [0, 0], to: [6, 6], colour: '#f00' }]);
  assert.deepEqual(linesOn(s, 'in', 2, env), []);
  assert.deepEqual(linesOn(s, 'out', 3, env), []);
  assert.equal(brightFace(2, env), true);
  assert.equal(brightFace(1, env), false);
});

// ---------- items, with a test-only world and puzzle ----------

function itemEnv(): { env: GameEnv; log: string[] } {
  const world = loadWorld();
  const blank: string[] = Array(FACE_SIZE).fill('.'.repeat(FACE_SIZE));
  const row = (r: string[], y: number, s: string) => r.map((v, i) => (i === y ? s.padEnd(FACE_SIZE, '.') : v));
  world.out[1] = parseStringMap('out', 1, row(row(blank, 5, '....I'), 2, '..I'));
  world.out[6] = parseStringMap('out', 6, row(blank, 4, '....U'));
  world.in[1] = parseStringMap('in', 1, blank);
  const log: string[] = [];
  const carry: PuzzleModule<{ done: boolean }> = {
    id: 'carry',
    face: 6,
    init: () => ({ done: false }),
    onItem(st, ctx, ev) {
      log.push(`${ev.kind}:${ev.item.id}@${ev.tile.face}`);
      if (ev.kind === 'placed') {
        st.done = true;
        ctx.emit('bloom');
      }
    },
    isSolved: (st) => st.done,
  };
  return { env: { world, puzzles: [carry] }, log };
}

test('items: pick up, carry across faces, drop, and place on a target', () => {
  const { env, log } = itemEnv();
  const s = createGame(0, env);
  const id = 'out1-4-5';
  assert.deepEqual(Object.keys(s.items).sort(), ['out1-2-2', id]);

  assert.deepEqual(applyInteract(s, 'out', 1, env), []); // nothing here
  go(s, 'out', { face: 1, x: 4, y: 5 }, env);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'pickup', side: 'out', item: id }]);
  assert.equal(s.players.out.carrying, id);
  assert.equal(s.items[id]!.carriedBy, 'out');

  // One item at a time: cannot drop onto a tile that already holds an item.
  go(s, 'out', { face: 1, x: 2, y: 2 }, env);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'bump', side: 'out' }]);
  assert.equal(s.players.out.carrying, id);

  // Drop it somewhere plain, pick it up again.
  go(s, 'out', { face: 1, x: 7, y: 7 }, env);
  assert.deepEqual(applyInteract(s, 'out', 1, env), [{ type: 'drop', side: 'out', item: id }]);
  assert.deepEqual([s.items[id]!.face, s.items[id]!.x, s.items[id]!.y, s.items[id]!.carriedBy], [1, 7, 7, null]);
  applyInteract(s, 'out', 1, env);

  // Carry it over the edge to face 6 and place it on the target.
  go(s, 'out', { face: 6, x: 4, y: 4 }, env);
  assert.equal(s.players.out.carrying, id);
  const events = applyInteract(s, 'out', 1, env);
  assert.deepEqual(events[0], { type: 'place', side: 'out', item: id, target: 'out6-4-4' });
  assert.ok(events.some((e) => e.type === 'puzzle' && e.name === 'bloom'));
  assert.ok(events.some((e) => e.type === 'solve' && e.face === 6));
  assert.deepEqual([s.items[id]!.face, s.items[id]!.placedOn], [6, 'out6-4-4']);
  assert.equal(s.players.out.carrying, null);
  assert.deepEqual(applyInteract(s, 'out', 1, env), []); // placed items stay put
  assert.deepEqual(log, [`picked:${id}@1`, `dropped:${id}@1`, `picked:${id}@1`, `placed:${id}@6`]);
});

test('items belong to a side: the inside player cannot pick up an outside item', () => {
  const { env } = itemEnv();
  const s = createGame(0, env);
  go(s, 'in', { face: 1, x: 4, y: 5 }, env);
  assert.deepEqual(applyInteract(s, 'in', 1, env), []);
});
