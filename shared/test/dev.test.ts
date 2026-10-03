import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, applyInteract, applyMove, compassDrift, createGame, defaultEnv, devSolve, devTeleport, isBlocked, pathTo, portalOpen, type GameState, type Side, type TileRef } from '../src/index';

// The dev-only engine helpers behind the dev tools (teleport, solve current puzzle).

const obj = (side: Side, face: 1 | 6, type: string): TileRef => {
  const o = defaultEnv.world[side][face].objects.find((x) => x.type === type)!;
  return { face, x: o.x, y: o.y };
};

function go(state: GameState, side: Side, target: TileRef): void {
  const path = pathTo(state, side, target, defaultEnv);
  assert.ok(path, `no path for ${side}`);
  for (const [dx, dy] of path) applyMove(state, side, dx, dy, 1000);
}

test('devSolve force-latches a face once, without touching the puzzle state', () => {
  const s = createGame(0);
  const before = JSON.stringify(s.puzzles);
  assert.deepEqual(devSolve(s, 1, 1000), [{ type: 'solve', face: 1, puzzle: 'plate-door' }]);
  assert.deepEqual(s.solved, [1]);
  assert.equal(JSON.stringify(s.puzzles), before);
  assert.deepEqual(devSolve(s, 1, 1000), []); // already latched
  assert.deepEqual(devSolve(s, 3, 1000), []); // no puzzle on face 3
  assert.deepEqual(s.solved, [1]);
  assert.equal(portalOpen(s), false);
});

test('devSolve on every puzzle wakes the portal, and the game can then be won', () => {
  const s = createGame(0);
  devSolve(s, 6, 1000);
  devSolve(s, 1, 1000);
  assert.deepEqual(s.solved, [1, 6]); // kept sorted
  assert.equal(portalOpen(s), true);
  devTeleport(s, 'out', 6, 1000);
  devTeleport(s, 'in', 6, 1000);
  go(s, 'out', obj('out', 6, 'portal'));
  go(s, 'in', obj('in', 6, 'portal'));
  assert.notEqual(s.wonAt, null);
  assert.deepEqual(devSolve(s, 1, 2000), []); // nothing after a win
  assert.deepEqual(devTeleport(s, 'out', 2, 2000), []);
});

test('devTeleport lands on a free tile of every face, facing the canonical up', () => {
  for (const side of ['out', 'in'] as const) {
    const s = createGame(0);
    applyMove(s, side, 0, -1, 1000);
    for (const face of [...FACES].reverse()) {
      devTeleport(s, side, face, 1000);
      const p = s.players[side].pose;
      assert.equal(p.face, face);
      assert.equal(p.side, side);
      assert.deepEqual(p.up, CANON_UP[face]);
      assert.equal(compassDrift(p), 0);
      assert.equal(isBlocked(s, side, { face, x: p.x, y: p.y }), false, `${side} face ${face} ${p.x},${p.y}`);
    }
    assert.equal(s.players[side === 'out' ? 'in' : 'out'].pose.face, 1); // the other player stays put
  }
});

test('devTeleport carries the held item along and tells the puzzles the tile was left', () => {
  const s = createGame(0);
  const rose = s.items.rose!;
  go(s, 'out', { face: 1, x: rose.x, y: rose.y });
  applyInteract(s, 'out', 1000);
  devTeleport(s, 'out', 6, 1000);
  assert.equal(s.players.out.carrying, 'rose');
  go(s, 'out', obj('out', 6, 'target'));
  applyInteract(s, 'out', 1000);
  assert.deepEqual(s.solved, [6]); // the real puzzle still works after a teleport

  // Inside stands on the plate (door open), then is teleported away: the door shuts again.
  const door = obj('out', 1, 'door');
  go(s, 'in', obj('in', 1, 'plate'));
  assert.equal(isBlocked(s, 'out', door), false);
  const events = devTeleport(s, 'in', 3, 1000);
  assert.ok(events.some((e) => e.type === 'puzzle' && e.name === 'door-close'));
  assert.equal(isBlocked(s, 'out', door), true);
});
