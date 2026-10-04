import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUBBLE_MS,
  CANON_UP,
  PING_COOLDOWN_MS,
  PING_FADE_MS,
  QUICK_CHATS,
  applyInteract,
  applyMove,
  canPing,
  canonToScreen,
  createGame,
  defaultEnv,
  makePing,
  pingAlpha,
  pingAlive,
  quickIndex,
  sameWall,
  signalsFor,
  type FaceId,
  type GameState,
  type Ping,
  type QuickChat,
  type Side,
} from '../src/index';

// Ping and quick-chat rules, and the Q key's drop-only interact.

/** A game with `side` put on `face` (canonical up), without walking there. */
function put(state: GameState, side: Side, face: FaceId, x: number, y: number): void {
  state.players[side].pose = { side, face, up: CANON_UP[face], x, y, dir: 1 };
}

test('ping: 2 s cooldown per player', () => {
  assert.equal(PING_COOLDOWN_MS, 2000);
  assert.equal(canPing(null, 0), true, 'the first ping is always allowed');
  assert.equal(canPing(1000, 1000), false);
  assert.equal(canPing(1000, 2999), false);
  assert.equal(canPing(1000, 3000), true);
});

test('ping: it is dropped on the sender\'s own tile', () => {
  const s = createGame(0);
  put(s, 'in', 3, 7, 2);
  assert.deepEqual(makePing(s, 'in', 9, 500), { id: 9, from: 'in', face: 3, x: 7, y: 2, at: 500 });
});

test('ping: it fades out and is gone after 4 s', () => {
  assert.equal(PING_FADE_MS, 4000);
  assert.equal(pingAlpha(0, 0), 1);
  assert.equal(pingAlpha(0, 1999), 1, 'full for the first half');
  assert.ok(pingAlpha(0, 3000) > 0 && pingAlpha(0, 3000) < 1, 'then it fades');
  assert.ok(pingAlpha(0, 3900) < pingAlpha(0, 3000));
  assert.equal(pingAlpha(0, 4000), 0);
  assert.equal(pingAlive(0, 3999), true);
  assert.equal(pingAlive(0, 4000), false);
});

test('same wall: outside N and inside N are one face, every other pair is not', () => {
  for (const a of [1, 2, 3, 4, 5, 6] as FaceId[]) for (const b of [1, 2, 3, 4, 5, 6] as FaceId[]) assert.equal(sameWall(a, b), a === b);
});

test('ping: the partner sees it only on the same face number, on the tile behind it', () => {
  const s = createGame(0);
  put(s, 'out', 2, 3, 4);
  put(s, 'in', 2, 8, 8);
  const ping = makePing(s, 'out', 1, 0);

  const theirs = signalsFor(s, 'in', [ping], [], 100);
  assert.equal(theirs.pings.length, 1, 'inside 2 sees a ping dropped on outside 2');
  assert.equal(theirs.pings[0]!.mine, false);
  // same canonical tile, drawn through the viewer's own (mirrored) view
  const pose = s.players.in.pose;
  assert.deepEqual([theirs.pings[0]!.sx, theirs.pings[0]!.sy], canonToScreen('in', pose.face, pose.up, 3, 4));

  const mine = signalsFor(s, 'out', [ping], [], 100);
  assert.equal(mine.pings.length, 1);
  assert.equal(mine.pings[0]!.mine, true);

  put(s, 'in', 3, 8, 8);
  assert.equal(signalsFor(s, 'in', [ping], [], 100).pings.length, 0, 'not from another face');
  put(s, 'in', 2, 1, 1);
  assert.equal(signalsFor(s, 'in', [ping], [], 100).pings.length, 1, 'walking onto the face shows it again');
  assert.equal(signalsFor(s, 'in', [ping], [], PING_FADE_MS).pings.length, 0, 'gone after the fade');
});

test('the inside view is mirrored: the same ping lands on a different screen column', () => {
  const s = createGame(0);
  put(s, 'out', 1, 2, 5);
  put(s, 'in', 1, 2, 5);
  const ping: Ping = makePing(s, 'out', 1, 0);
  const out = signalsFor(s, 'out', [ping], [], 0).pings[0]!;
  const inn = signalsFor(s, 'in', [ping], [], 0).pings[0]!;
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

  const v = signalsFor(s, 'in', [], [say('out', 0, 0)], 10);
  assert.equal(v.bubbles.length, 1);
  assert.equal(v.bubbles[0]!.text, 'Here!');
  assert.equal(v.bubbles[0]!.mine, false);
  const pose = s.players.in.pose;
  assert.deepEqual([v.bubbles[0]!.sx, v.bubbles[0]!.sy], canonToScreen('in', pose.face, pose.up, 6, 1), 'where the partner stands, seen from my side');

  // it follows the speaker: they walk, the bubble walks
  applyMove(s, 'out', 0, 1, 0);
  const moved = signalsFor(s, 'in', [], [say('out', 0, 0)], 10).bubbles[0]!;
  const now = s.players.out.pose;
  assert.deepEqual([moved.sx, moved.sy], canonToScreen('in', pose.face, pose.up, now.x, now.y));

  assert.equal(signalsFor(s, 'in', [], [say('out', 0, 0)], BUBBLE_MS).bubbles.length, 0, 'gone after 3 s');
  // only the latest line per speaker
  const two = signalsFor(s, 'in', [], [say('out', 1, 0, 1), say('out', 3, 500, 2)], 600);
  assert.deepEqual(two.bubbles.map((b) => b.text), ['No']);
  // your own bubble shows wherever your partner is
  put(s, 'in', 5, 2, 2);
  assert.equal(signalsFor(s, 'in', [], [say('out', 0, 0)], 10).bubbles.length, 0, 'not from another face');
  assert.equal(signalsFor(s, 'out', [], [say('out', 0, 0)], 10).bubbles[0]!.mine, true);
  // a bad index from the wire draws nothing
  assert.equal(signalsFor(s, 'out', [], [say('out', 9, 0)], 10).bubbles.length, 0);
});

test('Q (drop only) drops what you carry and never picks up; E still does both', () => {
  const item = Object.values(createGame(0).items)[0];
  assert.ok(item, 'the default map has an item to carry');
  const s = createGame(0);
  put(s, item.side, item.face, item.x, item.y);

  assert.deepEqual(applyInteract(s, item.side, 0, defaultEnv, 'drop'), [], 'Q with empty hands does nothing');
  assert.equal(s.players[item.side].carrying, null);

  assert.deepEqual(applyInteract(s, item.side, 0).map((e) => e.type), ['pickup'], 'E picks up');
  assert.equal(s.players[item.side].carrying, item.id);
  assert.deepEqual(applyInteract(s, item.side, 0, defaultEnv, 'pick'), [], 'pick-only never drops');

  const dropped = applyInteract(s, item.side, 0, defaultEnv, 'drop').map((e) => e.type);
  assert.ok(dropped.includes('drop') || dropped.includes('place'), 'Q drops');
  assert.equal(s.players[item.side].carrying, null);

  applyInteract(s, item.side, 0);
  if (s.players[item.side].carrying) {
    const again = applyInteract(s, item.side, 0).map((e) => e.type);
    assert.ok(again.includes('drop') || again.includes('place'), 'E still drops too');
  }
});
