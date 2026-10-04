import assert from 'node:assert/strict';
import { MOVES, findPath, stepPose, visibleObjects, type Pose, type TileRef } from '../src/index';
import { BATTERY_ID } from '../src/puzzles/chain';
import type { SolutionScript, Solver } from './harness';

// The solution scripts of faces 5 (sequence-laser) and 6 (laser-path), and the helpers
// their unit tests share. Not a test file. Everything goes through real moves, and each
// player only uses what their own side can see (visibleObjects).

const LAVA_FACE = 6;
const onTile = (t: TileRef) => (p: Pose) => p.face === t.face && p.x === t.x && p.y === t.y;

/** One step onto the tile next to `side` (canonical), whichever way their screen is turned. */
export function stepTo(t: Solver, side: 'out' | 'in', tile: TileRef) {
  const pose = t.state.players[side].pose;
  const move = MOVES.find((m) => onTile(tile)(stepPose(pose, m[0], m[1]).pose));
  assert.ok(move, `${side} at ${pose.x},${pose.y} is not next to ${tile.x},${tile.y}`);
  return t.move(side, move[0], move[1]);
}

/**
 * Walk the INSIDE player somewhere without wading through the lava of face 6: other faces
 * are reached around it, and a ring tile of face 6 is entered from the face next door.
 */
export function insideGo(t: Solver, target: TileRef): void {
  const here = () => t.state.players.in.pose;
  const walk = (goal: (p: Pose) => boolean, what: string) => {
    const path = findPath(t.state, 'in', goal, t.env, (face) => face !== LAVA_FACE);
    assert.ok(path, `inside: no way to ${what}`);
    for (const [dx, dy] of path) t.move('in', dx, dy);
  };
  if (t.state.solved.includes(LAVA_FACE)) return void t.go('in', target); // the lava is cold
  if (onTile(target)(here())) return;
  if (here().face === LAVA_FACE) walk((p) => p.face !== LAVA_FACE, 'leave face 6'); // from the ring: one step
  if (target.face !== LAVA_FACE) walk(onTile(target), `face ${target.face} ${target.x},${target.y}`);
  else {
    const beside = (p: Pose) => p.face !== LAVA_FACE && MOVES.some((m) => onTile(target)(stepPose(p, m[0], m[1]).pose));
    walk(beside, 'the tile next to face 6');
    stepTo(t, 'in', target);
  }
  assert.ok(onTile(target)(here()), `inside did not arrive at face ${target.face} ${target.x},${target.y}`);
}

const symbols = (t: Solver, side: 'out' | 'in') => visibleObjects(t.state, side, 5, t.env).filter((o) => o.type === 'f5-symbol');

/** The name of the symbol the OUTSIDE player sees lit right now, or null. */
export const litSymbol = (t: Solver): string | null => symbols(t, 'out').find((o) => o.state?.endsWith('-lit'))?.state?.slice(0, -4) ?? null;

/** The outside player presses REPLAY and watches: the symbol names in the order they light up. */
export function watchSequence(t: Solver): string[] {
  const replay = visibleObjects(t.state, 'out', 5, t.env).find((o) => o.type === 'f5-replay');
  assert.ok(replay, 'the outside player sees no REPLAY tile on face 5');
  t.go('out', { face: 5, x: replay.x, y: replay.y });
  t.interact('out');
  const order: string[] = [];
  for (let i = 0; i < 40 && order.length < symbols(t, 'out').length; i++) {
    const lit = litSymbol(t);
    if (lit && !order.includes(lit)) order.push(lit);
    t.wait(250);
  }
  for (let i = 0; i < 8 && litSymbol(t); i++) t.wait(250); // until the last one goes dark
  return order;
}

/** The inside player presses the button that shows `name`. */
export function pressSymbol(t: Solver, name: string) {
  const button = symbols(t, 'in').find((o) => o.state === name || o.state === `${name}-lit`);
  assert.ok(button, `the inside player sees no "${name}" button`);
  insideGo(t, { face: 5, x: button.x, y: button.y });
  return t.interact('in');
}

/** The inside player brings the battery to the emitter of face 5 and puts it in. */
export function powerLaser(t: Solver): void {
  const battery = t.state.items[BATTERY_ID];
  assert.ok(battery, 'there is no battery yet: face 2 hands it over');
  if (battery.carriedBy !== 'in') {
    insideGo(t, t.item(BATTERY_ID));
    t.interact('in');
  }
  insideGo(t, t.find('in', 5, 'target', 'f5-emitter'));
  t.interact('in');
}

/** Face 5. `before` is the script of face 2 (the battery), run only if it has not been yet. */
export const solveSequenceLaser =
  (before: SolutionScript): SolutionScript =>
  (t) => {
    if (!t.state.items[BATTERY_ID]) before(t);
    powerLaser(t);
    // the outside player watches the symbols light up and says the order out loud
    const order = watchSequence(t);
    for (const name of order) pressSymbol(t, name);
  };

/** The pushes that solve face 6 from the mirrors' start: stand on `from`, step onto `box`. */
export const LASER_PUSHES: readonly { from: [number, number]; box: [number, number] }[] = [
  { from: [3, 2], box: [4, 2] }, // "/" east, into the beam's column
  { from: [9, 5], box: [9, 4] }, // "\" north ...
  { from: [9, 4], box: [9, 3] }, // ... and north again, onto the row of the "/"
];

/** The outside player walks to the RESET tile of face 6 and presses E. */
export function resetMirrors(t: Solver): void {
  t.go('out', t.find('out', 6, 'reset'));
  t.interact('out');
}

/** The outside player pushes the mirrors into the beam (from their start tiles). */
export function pushMirrors(t: Solver): void {
  for (const { from, box } of LASER_PUSHES) {
    t.go('out', { face: 6, x: from[0], y: from[1] });
    const evs = stepTo(t, 'out', { face: 6, x: box[0], y: box[1] });
    assert.ok(evs.some((e) => e.type === 'push'), `nothing moved when pushing the mirror on ${box[0]},${box[1]}`);
  }
}

/** The safe path as the OUTSIDE player sees it drawn, from its start to the button. */
export const shownPath = (t: Solver) => visibleObjects(t.state, 'out', 6, t.env).filter((o) => o.type === 'f6-path');

/** The inside player goes to the ring tile next to the start of the path. Returns the path. */
export function toPathStart(t: Solver): TileRef[] {
  const path = shownPath(t).map((o) => ({ face: 6 as const, x: o.x, y: o.y }));
  assert.ok(path.length > 1, 'the outside player sees no path on face 6');
  const first = path[0]!;
  // the outside player says where it starts: the edge tile beside the first path tile
  const edge = [
    { x: first.x - 1, y: first.y },
    { x: first.x + 1, y: first.y },
    { x: first.x, y: first.y - 1 },
    { x: first.x, y: first.y + 1 },
  ].find((n) => n.x === 0 || n.y === 0 || n.x === 11 || n.y === 11);
  assert.ok(edge, 'the path does not start beside the ring');
  insideGo(t, { face: 6, ...edge });
  return path;
}

/** Face 6. `before` is the script of face 5 (the laser), run only if it is not solved yet. */
export const solveLaserPath =
  (before: SolutionScript): SolutionScript =>
  (t) => {
    if (!t.state.solved.includes(5)) before(t);
    resetMirrors(t);
    pushMirrors(t);
    // the crate is burnt. RESET takes the mirrors off whatever path tile they may cover
    resetMirrors(t);
    const strikes = t.state.strikes;
    for (const tile of toPathStart(t)) stepTo(t, 'in', tile);
    t.interact('in'); // the button, at the end of the path
    assert.equal(t.state.strikes, strikes, 'the inside player fell in the lava');
    // the flower stays where it lies: face 4's script picks it up
  };
