import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyInteract, applyMove, createGame, observe, parseAction, pathTo, planAction, stepPose, type BotStep, type GameState, type Side } from '../src/index';

function run(state: GameState, side: Side, steps: BotStep[]) {
  for (const s of steps) {
    if (s === 'interact') applyInteract(state, side, 1);
    else applyMove(state, side, s[0], s[1], 1);
  }
}

test('observe() never leaks what only the other side can see', () => {
  const s = createGame(0);
  const inside = JSON.stringify(observe(s, 'in'));
  for (const hidden of ['door', 'crystal', 'rose', 'target', 'Meadow', 'T']) assert.ok(!inside.includes(`"${hidden}"`), `inside sees ${hidden}`);
  assert.ok(!/[T~]/.test(observe(s, 'in').grid.join('')), 'inside grid shows outside terrain');
  assert.ok(inside.includes('"plate"'));

  const outside = JSON.stringify(observe(s, 'out'));
  for (const hidden of ['plate', 'Plate room']) assert.ok(!outside.includes(hidden), `outside sees ${hidden}`);
  assert.ok(outside.includes('"door"') && outside.includes('"crystal"'));

  // No partner position, pose or puzzle internals in either.
  for (const text of [inside, outside]) for (const key of ['players', 'puzzles', 'pressed', 'taken', 'pose']) assert.ok(!text.includes(`"${key}"`), `leaks ${key}`);
});

test('observe() is in the observer own orientation: inside is mirrored', () => {
  const s = createGame(0);
  const out = observe(s, 'out');
  const inn = observe(s, 'in');
  assert.deepEqual(out.position, { col: 4, row: 8 });
  assert.deepEqual(inn.position, { col: 7, row: 8 }); // canonical x=2, seen from behind
  assert.deepEqual(inn.objects, [{ type: 'plate', state: 'off', col: 2, row: 2 }]); // canonical x=7
  assert.equal(out.grid[8]![4], '@');
  assert.equal(out.edges.right.face, 2);
  assert.equal(inn.edges.right.face, 4);
});

test('observe() follows the state the side can perceive', () => {
  const s = createGame(0);
  assert.equal(observe(s, 'out').objects.find((o) => o.type === 'door')!.state, 'closed');
  run(s, 'in', planActionSteps(s, 'in', { type: 'step_on', object: 'plate' }));
  assert.equal(observe(s, 'out').objects.find((o) => o.type === 'door')!.state, 'open');
  assert.equal(observe(s, 'in').objects[0]!.state, 'on');
});

function planActionSteps(state: GameState, side: Side, raw: unknown): BotStep[] {
  const action = parseAction(raw);
  assert.ok(action, `bad action ${JSON.stringify(raw)}`);
  const plan = planAction(state, side, action);
  assert.ok('steps' in plan, 'error' in plan ? plan.error : '');
  return plan.steps;
}

test('pathTo crosses face edges and every step is a legal move', () => {
  const s = createGame(0);
  const path = pathTo(s, 'out', { face: 3, x: 5, y: 5 })!; // the far side of the cube
  assert.ok(path.length >= 10);
  let pose = s.players.out.pose;
  const faces = new Set([pose.face]);
  for (const [dx, dy] of path) {
    const events = applyMove(s, 'out', dx, dy, 1);
    assert.notEqual(events[0]?.type, 'bump');
    assert.equal(events.length > 0, true);
    pose = s.players.out.pose;
    faces.add(pose.face);
  }
  assert.deepEqual([pose.face, pose.x, pose.y], [3, 5, 5]);
  assert.ok(faces.size >= 3);
  // Shortest: no route around the cube is shorter than straight over one neighbour.
  const again = pathTo(createGame(0), 'out', { face: 3, x: 5, y: 5 })!;
  assert.equal(again.length, path.length);
  assert.equal(stepPose(pose, 0, -1).pose.face, 3);
});

test('pathTo respects puzzle blockers: no path through a shut door', () => {
  const s = createGame(0);
  assert.equal(pathTo(s, 'out', { face: 1, x: 4, y: 4 }), null);
  const blocked = planAction(s, 'out', { type: 'step_on', object: 'crystal' });
  assert.ok('error' in blocked);
});

test('actions: the two bodies can solve face 1 and carry the rose to face 6', () => {
  const s = createGame(0);
  run(s, 'in', planActionSteps(s, 'in', { type: 'step_on', object: 'plate' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'crystal' }));
  assert.deepEqual(s.solved, [1]);

  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'rose' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'pick_up' }));
  assert.equal(s.players.out.carrying, 'rose');
  run(s, 'out', planActionSteps(s, 'out', { type: 'go_face', args: { face: 6 } }));
  assert.equal(s.players.out.pose.face, 6);
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'target' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'drop' }));
  assert.deepEqual(s.solved, [1, 6]);
});

test('parseAction rejects junk and clamps what it accepts', () => {
  for (const bad of [null, 'goto', {}, { type: 'fly' }, { type: 'goto', col: 4 }, { type: 'goto', col: 99, row: 1 }, { type: 'go_face', face: 9 }, { type: 'move', dir: 'north' }, { type: 'step_on' }]) {
    assert.equal(parseAction(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseAction({ type: 'goto', args: { col: '3', row: 4 } }), { type: 'goto', col: 3, row: 4 });
  assert.deepEqual(parseAction({ type: 'move', dir: 'left', steps: 500 }), { type: 'move', dir: 'left', steps: 20 });
  assert.deepEqual(parseAction({ type: 'wait', args: {} }), { type: 'wait' });
  assert.ok('error' in planAction(createGame(0), 'out', { type: 'drop' }));
});
