import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CANON_UP,
  FACES,
  FACE_SIZE,
  SPAWN,
  defaultEnv,
  LEASH_ERROR,
  applyInteract,
  applyMove,
  chooseGoal,
  createGame,
  faceDistance,
  hearPartner,
  leashAllows,
  leashBroken,
  newMemory,
  observe,
  parseAction,
  pathTo,
  planAction,
  remember,
  stepPose,
  type BotMemory,
  type BotStep,
  type FaceId,
  type GameState,
  type Side,
} from '../src/index';

function run(state: GameState, side: Side, steps: BotStep[]) {
  for (const s of steps) {
    if (s === 'interact') applyInteract(state, side, 1);
    else applyMove(state, side, s[0], s[1], 1);
  }
}

test('observe() never leaks what only the other side can see', () => {
  const s = createGame(0);
  const inside = JSON.stringify(observe(s, 'in'));
  for (const hidden of ['door', 'crystal', 'rose', 'target', 'Grass', 'T']) assert.ok(!inside.includes(`"${hidden}"`), `inside sees ${hidden}`);
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
  const mirror = (x: number) => FACE_SIZE - 1 - x; // the inside sees the wall from behind
  const plate = defaultEnv.world.in[1].objects.find((o) => o.type === 'plate')!;
  assert.deepEqual(out.position, { col: SPAWN.out.x, row: SPAWN.out.y });
  assert.deepEqual(inn.position, { col: mirror(SPAWN.in.x), row: SPAWN.in.y });
  assert.deepEqual(inn.objects, [{ type: 'plate', state: 'off', col: mirror(plate.x), row: plate.y }]);
  assert.equal(out.grid[SPAWN.out.y]![SPAWN.out.x], '@');
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
  assert.ok(path.length >= FACE_SIZE);
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
  const crystal = defaultEnv.world.out[1].objects.find((o) => o.type === 'crystal')!;
  assert.equal(pathTo(s, 'out', { face: 1, x: crystal.x, y: crystal.y }), null);
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
  assert.deepEqual(parseAction({ type: 'move', dir: 'left', steps: 500 }), { type: 'move', dir: 'left', steps: FACE_SIZE * 2 });
  assert.deepEqual(parseAction({ type: 'wait', args: {} }), { type: 'wait' });
  assert.ok('error' in planAction(createGame(0), 'out', { type: 'drop' }));
});

/** Put a player somewhere without walking (test setup only). */
function place(state: GameState, side: Side, face: FaceId, x = 5, y = 8) {
  state.players[side].pose = { side, face, up: CANON_UP[face], x, y, dir: 1 };
}

/** What the bot knows after looking around from where it stands. */
const look = (state: GameState, side: Side, memory: BotMemory = newMemory()) => remember(memory, observe(state, side));

test('observe() tells nothing about the partner except how far their face is', () => {
  for (const side of ['in', 'out'] as const) {
    const partner = side === 'in' ? 'out' : 'in';
    const s = createGame(0);
    const base = observe(s, side);
    // Anywhere on the same wall, facing any way: the observation is identical.
    for (const [x, y] of [[0, 0], [FACE_SIZE - 1, FACE_SIZE - 1], [6, 1], [1, 6]] as const) {
      place(s, partner, 1, x, y);
      s.players[partner].pose.dir = -1;
      s.players[partner].steps += 7;
      assert.deepEqual(observe(s, side), base);
    }
    // On another face only the voice signal changes, and it is the same for all four next faces.
    for (const face of FACES) {
      place(s, partner, face);
      const signal = [3, 1, 0][faceDistance(1, face)];
      assert.deepEqual(observe(s, side), { ...base, voiceSignal: signal });
    }
  }
});

test('the partner face is only ever guessed from the voice signal', () => {
  assert.equal(hearPartner(null, { face: 1, voiceSignal: 3 }), 1); // clear: same wall
  assert.equal(hearPartner(null, { face: 1, voiceSignal: 0 }), 3); // silent: the opposite face
  assert.equal(hearPartner(5, { face: 2, voiceSignal: 0 }), 4);
  assert.equal(hearPartner(null, { face: 1, voiceSignal: 1 }), null); // faint: one of four, no idea which
  assert.equal(hearPartner(1, { face: 2, voiceSignal: 1 }), 1); // still fits what it heard before
  assert.equal(hearPartner(1, { face: 1, voiceSignal: 1 }), null); // they left this wall
  assert.equal(hearPartner(1, { face: 3, voiceSignal: 1 }), null); // no longer fits

  // The belief follows the bot as it walks away from a partner who stays put.
  const s = createGame(0);
  let m = look(s, 'in');
  assert.equal(m.partnerFace, 1);
  place(s, 'in', 2);
  m = look(s, 'in', m);
  assert.equal(m.partnerFace, 1);
  // Two states that look the same from the inside give the same memory, wherever the partner really is.
  place(s, 'out', 5);
  assert.deepEqual(look(s, 'in', m), m);
});

test('chooseGoal: the nearest unsolved puzzle it knows about, otherwise stay with the partner', () => {
  const s = createGame(0);
  assert.deepEqual(chooseGoal(observe(s, 'in'), newMemory()), { kind: 'puzzle', face: 1, here: true, inReach: true });

  // Face 1 solved: the inside has seen nothing else, so it stays.
  run(s, 'in', planActionSteps(s, 'in', { type: 'step_on', object: 'plate' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'crystal' }));
  let m = look(s, 'in');
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'stay' });

  // A face it has not stood on is not known, even though a puzzle is there.
  place(s, 'in', 2);
  m = look(s, 'in', m);
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'stay' });

  // Once seen, face 6 is the goal, from wherever the leash lets it go.
  place(s, 'in', 6);
  m = look(s, 'in', m);
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'puzzle', face: 6, here: true, inReach: true });
  place(s, 'in', 1);
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'puzzle', face: 6, here: false, inReach: true });
  // Partner on the far side of face 6 (face 5): the puzzle is known but out of reach.
  place(s, 'in', 2);
  place(s, 'out', 5);
  m = look(s, 'in', m); // faint, and no idea which face
  place(s, 'in', 5);
  m = look(s, 'in', m); // clear: partner is here
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'puzzle', face: 6, here: false, inReach: false });

  // Out of earshot: get back first.
  place(s, 'in', 6);
  assert.deepEqual(chooseGoal(observe(s, 'in'), m), { kind: 'regroup' });
});

test('chooseGoal: carrying an item and the open portal come first, and lift the leash', () => {
  const s = createGame(0);
  run(s, 'in', planActionSteps(s, 'in', { type: 'step_on', object: 'plate' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'crystal' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'rose' }));
  let m = look(s, 'out');
  assert.equal(leashAllows(observe(s, 'out'), m, 3), false);
  run(s, 'out', planActionSteps(s, 'out', { type: 'pick_up' }));
  assert.deepEqual(chooseGoal(observe(s, 'out'), m), { kind: 'carry', item: 'rose', face: null });
  assert.equal(leashAllows(observe(s, 'out'), m, 3), true); // the puzzle needs the two apart

  place(s, 'out', 6);
  m = look(s, 'out', m);
  assert.equal(leashBroken(observe(s, 'out')), false);
  assert.deepEqual(chooseGoal(observe(s, 'out'), m), { kind: 'carry', item: 'rose', face: 6 }); // it has seen the pot now
  run(s, 'out', planActionSteps(s, 'out', { type: 'step_on', object: 'target' }));
  run(s, 'out', planActionSteps(s, 'out', { type: 'drop' }));
  place(s, 'out', 1);
  assert.deepEqual(chooseGoal(observe(s, 'out'), m), { kind: 'portal', face: 6 });
  assert.deepEqual(chooseGoal(observe(s, 'in'), newMemory()), { kind: 'portal', face: 6 }); // told by the rules
});

test('the leash: a far go_face is refused, a near one is planned, and paths stay inside it', () => {
  const s = createGame(0);
  const m = look(s, 'in');
  const leash = (face: FaceId) => leashAllows(observe(s, 'in'), m, face);
  assert.deepEqual(FACES.filter(leash), [1, 2, 4, 5, 6]); // partner on face 1: everything but the opposite face

  assert.deepEqual(planAction(s, 'in', { type: 'go_face', face: 3 }, undefined, leash), { error: LEASH_ERROR });
  assert.ok('steps' in planAction(s, 'in', { type: 'go_face', face: 3 })); // only the leash is in the way
  assert.ok('steps' in planAction(s, 'in', { type: 'go_face', face: 2 }, undefined, leash));

  // From the next face the opposite one is a single edge away, and still refused.
  place(s, 'in', 2);
  const m2 = look(s, 'in', m);
  const leash2 = (face: FaceId) => leashAllows(observe(s, 'in'), m2, face);
  assert.equal(leash2(3), false);
  assert.deepEqual(planAction(s, 'in', { type: 'go_face', face: 3 }, undefined, leash2), { error: LEASH_ERROR });
  // A straight line that runs over that edge is refused too (inside, face 3 is to the left of face 2).
  assert.equal(observe(s, 'in').edges.left.face, 3);
  assert.deepEqual(planAction(s, 'in', { type: 'move', dir: 'left', steps: 20 }, undefined, leash2), { error: LEASH_ERROR });
  assert.ok('steps' in planAction(s, 'in', { type: 'move', dir: 'left', steps: 3 }, undefined, leash2));
  assert.ok('steps' in planAction(s, 'in', { type: 'move', dir: 'right', steps: 20 }, undefined, leash2)); // back over face 1

  // A walk never cuts through a forbidden face: fence off 2 and 4 and the way to 3 goes over the top or bottom.
  place(s, 'in', 1);
  const plan = planAction(s, 'in', { type: 'go_face', face: 3 }, undefined, (f) => f !== 2 && f !== 4);
  assert.ok('steps' in plan);
  const faces = new Set<number>();
  for (const step of plan.steps) {
    run(s, 'in', [step]);
    faces.add(s.players.in.pose.face);
  }
  assert.equal(s.players.in.pose.face, 3);
  assert.ok(!faces.has(2) && !faces.has(4), [...faces].join());
});
