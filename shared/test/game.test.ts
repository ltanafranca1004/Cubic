import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyInteract,
  applyMove,
  createGame,
  defaultEnv,
  loadWorld,
  objectiveFor,
  parseStringMap,
  pathTo,
  portalOpen,
  visibleObjects,
  type GameEnv,
  type GameEvent,
  type GameState,
  type PuzzleModule,
  type Side,
  type TileRef,
} from '../src/index';

/** Walk `side` to a tile with real moves. Fails the test if there is no path. */
function go(state: GameState, side: Side, target: TileRef, env: GameEnv = defaultEnv): GameEvent[] {
  const path = pathTo(state, side, target, env);
  assert.ok(path, `no path for ${side} to face ${target.face} ${target.x},${target.y}`);
  const events: GameEvent[] = [];
  for (const [dx, dy] of path) events.push(...applyMove(state, side, dx, dy, 1000, env));
  const p = state.players[side].pose;
  assert.deepEqual([p.face, p.x, p.y], [target.face, target.x, target.y]);
  return events;
}

const obj = (env: GameEnv, side: Side, face: 1 | 6, type: string) => {
  const o = env.world[side][face].objects.find((x) => x.type === type)!;
  return { face, x: o.x, y: o.y } as TileRef;
};

test('a new game starts both players on face 1 with nothing solved', () => {
  const s = createGame(0);
  assert.equal(s.players.out.pose.face, 1);
  assert.equal(s.players.in.pose.face, 1);
  assert.deepEqual(s.solved, []);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
});

test('walls block and report a bump; invalid moves are ignored', () => {
  const s = createGame(0);
  const before = { ...s.players.out.pose };
  assert.deepEqual(applyMove(s, 'out', 1, 1), []);
  assert.deepEqual(applyMove(s, 'out', 2, 0), []);
  assert.deepEqual(s.players.out.pose, before);
  go(s, 'out', { face: 1, x: 2, y: 4 });
  assert.deepEqual(applyMove(s, 'out', 1, 0), [{ type: 'bump', side: 'out' }]); // wall at 3,4
  assert.equal(s.players.out.pose.x, 2);
});

test('example puzzle: the plate inside opens the door outside, and it can be solved', () => {
  const env = defaultEnv;
  const s = createGame(0);
  const door = obj(env, 'out', 1, 'door');
  const crystal = obj(env, 'out', 1, 'crystal');
  const plate = obj(env, 'in', 1, 'plate');

  // Door shut: the crystal is unreachable.
  assert.equal(pathTo(s, 'out', crystal), null);
  assert.equal(visibleObjects(s, 'out', 1).find((o) => o.type === 'door')!.state, 'closed');
  go(s, 'out', { face: 1, x: door.x, y: door.y + 1 });
  assert.deepEqual(applyMove(s, 'out', 0, -1), [{ type: 'bump', side: 'out' }]);

  const pressed = go(s, 'in', plate);
  assert.ok(pressed.some((e) => e.type === 'puzzle' && e.name === 'door-open'));
  assert.equal(visibleObjects(s, 'out', 1).find((o) => o.type === 'door')!.state, 'open');

  // Stepping off closes it again.
  const released = applyMove(s, 'in', 0, 1);
  assert.ok(released.some((e) => e.type === 'puzzle' && e.name === 'door-close'));
  assert.equal(pathTo(s, 'out', crystal), null);
  applyMove(s, 'in', 0, -1);

  const events = go(s, 'out', crystal);
  assert.ok(events.some((e) => e.type === 'solve' && e.face === 1));
  assert.deepEqual(s.solved, [1]);

  // Solved: the door stays open even with the plate released, nobody is sealed in.
  applyMove(s, 'in', 0, 1);
  assert.ok(pathTo(s, 'out', { face: 1, x: 4, y: 8 }));
});

test('per-side visibility: each side only sees its own half of the puzzle', () => {
  const s = createGame(0);
  const out = visibleObjects(s, 'out', 1).map((o) => o.type);
  const inn = visibleObjects(s, 'in', 1).map((o) => o.type);
  assert.deepEqual(out.sort(), ['crystal', 'door']);
  assert.deepEqual(inn, ['plate']);
  assert.notEqual(objectiveFor(s, 'out'), objectiveFor(s, 'in'));
});

test('portal win: needs every puzzle solved and both players on the portal', () => {
  const env = defaultEnv;
  const s = createGame(0);
  const portalOut = obj(env, 'out', 6, 'portal');
  go(s, 'out', portalOut);
  go(s, 'in', portalOut);
  assert.equal(s.wonAt, null);
  assert.equal(portalOpen(s), false);

  go(s, 'in', obj(env, 'in', 1, 'plate'));
  go(s, 'out', obj(env, 'out', 1, 'crystal'));
  assert.equal(portalOpen(s), true);
  go(s, 'out', portalOut);
  // The win fires the moment the second player touches any portal tile.
  const events = pathTo(s, 'in', portalOut)!.flatMap(([dx, dy]) => applyMove(s, 'in', dx, dy, 1000));
  assert.ok(events.some((e) => e.type === 'win'));
  assert.equal(s.wonAt, 1000);
  assert.deepEqual(applyMove(s, 'out', 1, 0), []); // game over: no more moves
});

// ---------- items, with a test-only world and puzzle ----------

function itemEnv(): { env: GameEnv; log: string[] } {
  const world = loadWorld();
  const blank = Array(10).fill('..........');
  const row = (r: string[], y: number, s: string) => r.map((v, i) => (i === y ? s : v));
  world.out[1] = parseStringMap('out', 1, row(row(blank, 5, '....I.....'), 2, '..I.......'));
  world.out[6] = parseStringMap('out', 6, row(blank, 4, '....U.....'));
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
