import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIX, fixtureEnv } from './fixture';
import { CANON_UP, FACES, applyInteract, applyMove, compassDrift, createGame, devSolve, devTeleport, isBlocked, pathTo, portalOpen, type GameState, type Side, type TileRef } from '../src/index';

// The dev-only engine helpers behind the dev tools (teleport, solve current puzzle).

// On the fixture world (./fixture.ts), with its portal.
const env = fixtureEnv({ portal: true });

function go(state: GameState, side: Side, target: TileRef): void {
  const path = pathTo(state, side, target, env);
  assert.ok(path, `no path for ${side}`);
  for (const [dx, dy] of path) applyMove(state, side, dx, dy, 1000, env);
}

test('devSolve force-latches a face once, without touching the puzzle state', () => {
  const s = createGame(0, env);
  const before = JSON.stringify(s.puzzles);
  assert.deepEqual(devSolve(s, 1, 1000, env), [{ type: 'solve', face: 1, puzzle: 'plate-door' }]);
  assert.deepEqual(s.solved, [1]);
  assert.equal(JSON.stringify(s.puzzles), before);
  assert.deepEqual(devSolve(s, 1, 1000, env), []); // already latched
  assert.deepEqual(devSolve(s, 2, 1000, env), []); // no puzzle on face 2
  assert.deepEqual(s.solved, [1]);
  assert.equal(portalOpen(s, env), false);
});

test('devSolve on every puzzle wakes the portal, and the game can then be won', () => {
  const s = createGame(0, env);
  devSolve(s, 6, 1000, env);
  devSolve(s, 1, 1000, env);
  assert.deepEqual(s.solved, [1, 6]); // kept sorted
  assert.equal(portalOpen(s, env), true);
  devTeleport(s, 'out', 6, 1000, env);
  devTeleport(s, 'in', 6, 1000, env);
  go(s, 'out', FIX.portal);
  assert.equal(s.wonAt, null); // one player on the portal is not enough
  go(s, 'in', FIX.portal);
  assert.notEqual(s.wonAt, null);
  assert.deepEqual(devSolve(s, 1, 2000, env), []); // nothing after a win
  assert.deepEqual(devTeleport(s, 'out', 2, 2000, env), []);
});

test('devTeleport lands on a free tile of every face, facing the canonical up', () => {
  for (const side of ['out', 'in'] as const) {
    const s = createGame(0, env);
    applyMove(s, side, 0, -1, 1000, env);
    for (const face of [...FACES].reverse()) {
      devTeleport(s, side, face, 1000, env);
      const p = s.players[side].pose;
      assert.equal(p.face, face);
      assert.equal(p.side, side);
      assert.deepEqual(p.up, CANON_UP[face]);
      assert.equal(compassDrift(p), 0);
      assert.equal(isBlocked(s, side, { face, x: p.x, y: p.y }, env), false, `${side} face ${face} ${p.x},${p.y}`);
    }
    assert.equal(s.players[side === 'out' ? 'in' : 'out'].pose.face, 1); // the other player stays put
  }
});

test('devTeleport carries the held item along and tells the puzzles the tile was left', () => {
  const s = createGame(0, env);
  go(s, 'out', FIX.rose);
  applyInteract(s, 'out', 1000, env);
  devTeleport(s, 'out', 6, 1000, env);
  assert.equal(s.players.out.carrying, 'rose');
  go(s, 'out', FIX.pot);
  applyInteract(s, 'out', 1000, env);
  assert.deepEqual(s.solved, [6]); // the real puzzle still works after a teleport

  // Inside stands on the plate (door open), then is teleported away: the door shuts again.
  const door = FIX.door;
  go(s, 'in', FIX.plate);
  assert.equal(isBlocked(s, 'out', door, env), false);
  const events = devTeleport(s, 'in', 3, 1000, env);
  assert.ok(events.some((e) => e.type === 'puzzle' && e.name === 'door-close'));
  assert.equal(isBlocked(s, 'out', door, env), true);
});

test('devSolve on the last puzzle wins at once in a world without a portal', () => {
  const plain = fixtureEnv();
  const s = createGame(0, plain);
  devSolve(s, 1, 1000, plain);
  assert.equal(s.wonAt, null);
  assert.deepEqual(devSolve(s, 6, 1000, plain), [{ type: 'solve', face: 6, puzzle: 'rose-pot' }, { type: 'win' }]);
  assert.equal(s.wonAt, 1000);
});
