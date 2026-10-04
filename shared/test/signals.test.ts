import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUBBLE_MS,
  CANON_UP,
  QUICK_CHATS,
  applyInteract,
  applyMove,
  canonToScreen,
  createGame,
  quickIndex,
  sameWall,
  signalsFor,
  type FaceId,
  type GameState,
  type QuickChat,
  type Side,
} from '../src/index';
import { fixtureEnv } from './fixture';

// Quick-chat rules, and the Q key's drop-only interact.

/** A game with `side` put on `face` (canonical up), without walking there. */
function put(state: GameState, side: Side, face: FaceId, x: number, y: number): void {
  state.players[side].pose = { side, face, up: CANON_UP[face], x, y, dir: 1 };
}

test('same wall: outside N and inside N are one face, every other pair is not', () => {
  for (const a of [1, 2, 3, 4, 5, 6] as FaceId[]) for (const b of [1, 2, 3, 4, 5, 6] as FaceId[]) assert.equal(sameWall(a, b), a === b);
});

test('the inside view is mirrored: the same bubble lands on a different screen column', () => {
  const s = createGame(0);
  put(s, 'out', 1, 2, 5);
  put(s, 'in', 1, 9, 9);
  const say: QuickChat = { id: 1, from: 'out', index: 0, chatId: 1, at: 0 };
  const out = signalsFor(s, 'out', [say], 0).bubbles[0]!;
  const inn = signalsFor(s, 'in', [say], 0).bubbles[0]!;
  assert.equal(out.sy, inn.sy);
  assert.notEqual(out.sx, inn.sx, 'the inside player sees the wall from behind');
});

test('quick chat: four fixed lines, and only 0..3 is a valid index', () => {
  assert.deepEqual([...QUICK_CHATS], ['Here!', 'Wait', 'Yes', 'No']);
  for (const i of [0, 1, 2, 3]) assert.equal(quickIndex(i), i);
  for (const bad of [-1, 4, 1.5, '1', null, undefined, NaN, {}]) assert.equal(quickIndex(bad), null);
});

test('quick chat: a bubble over the speaker, for a partner on the same face, for 3 s', () => {
  const s = createGame(0);
  put(s, 'out', 4, 6, 1);
  put(s, 'in', 4, 2, 2);
  const say = (from: Side, index: number, at: number, id = at): QuickChat => ({ id, from, index, chatId: id, at });

  const v = signalsFor(s, 'in', [say('out', 0, 0)], 10);
  assert.equal(v.bubbles.length, 1);
  assert.equal(v.bubbles[0]!.text, 'Here!');
  assert.equal(v.bubbles[0]!.mine, false);
  const pose = s.players.in.pose;
  assert.deepEqual([v.bubbles[0]!.sx, v.bubbles[0]!.sy], canonToScreen('in', pose.face, pose.up, 6, 1), 'where the partner stands, seen from my side');

  // it follows the speaker: they walk, the bubble walks
  applyMove(s, 'out', 0, 1, 0);
  const moved = signalsFor(s, 'in', [say('out', 0, 0)], 10).bubbles[0]!;
  const now = s.players.out.pose;
  assert.deepEqual([moved.sx, moved.sy], canonToScreen('in', pose.face, pose.up, now.x, now.y));

  assert.equal(signalsFor(s, 'in', [say('out', 0, 0)], BUBBLE_MS).bubbles.length, 0, 'gone after 3 s');
  // only the latest line per speaker
  const two = signalsFor(s, 'in', [say('out', 1, 0, 1), say('out', 3, 500, 2)], 600);
  assert.deepEqual(two.bubbles.map((b) => b.text), ['No']);
  // your own bubble shows wherever your partner is
  put(s, 'in', 5, 2, 2);
  assert.equal(signalsFor(s, 'in', [say('out', 0, 0)], 10).bubbles.length, 0, 'not from another face');
  assert.equal(signalsFor(s, 'out', [say('out', 0, 0)], 10).bubbles[0]!.mine, true);
  // a bad index from the wire draws nothing
  assert.equal(signalsFor(s, 'out', [say('out', 9, 0)], 10).bubbles.length, 0);
});

test('Q (drop only) drops what you carry and never picks up; E still does both', () => {
  const env = fixtureEnv();
  const s = createGame(0, env);
  const item = Object.values(s.items)[0];
  assert.ok(item, 'the fixture has an item to carry');
  put(s, item.side, item.face, item.x, item.y);

  assert.deepEqual(applyInteract(s, item.side, 0, env, 'drop'), [], 'Q with empty hands does nothing');
  assert.equal(s.players[item.side].carrying, null);

  assert.deepEqual(applyInteract(s, item.side, 0, env).map((e) => e.type), ['pickup'], 'E picks up');
  assert.equal(s.players[item.side].carrying, item.id);
  assert.deepEqual(applyInteract(s, item.side, 0, env, 'pick'), [], 'pick-only never drops');

  const dropped = applyInteract(s, item.side, 0, env, 'drop').map((e) => e.type);
  assert.ok(dropped.includes('drop') || dropped.includes('place'), 'Q drops');
  assert.equal(s.players[item.side].carrying, null);

  applyInteract(s, item.side, 0, env);
  if (s.players[item.side].carrying) {
    const again = applyInteract(s, item.side, 0, env).map((e) => e.type);
    assert.ok(again.includes('drop') || again.includes('place'), 'E still drops too');
  }
});
