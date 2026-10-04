import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANON_UP, FACES, createGame, type FaceId, type GameEvent, type GameState, type Side } from '@cubic/shared';
import { heardSfx, hears, sfxFor } from '../src/audio/hearing';

// Sound follows the cube: the partner's footsteps come through the shared wall only, and
// the face-change ding is never the partner's.

// The keys of the synthesized table in game/sfx.ts (it needs Web Audio types, so it is not imported here).
const SFX = new Set(['step', 'bump', 'flip', 'push', 'solve', 'strike', 'win', 'pickup', 'drop', 'place', 'use', 'chime', 'key', 'toggle', 'burn', 'laser', 'splash', 'puzzle']);
const known = (id: string) => SFX.has(id);
const other = (side: Side): Side => (side === 'out' ? 'in' : 'out');

/** A game with the two players on the given faces. */
function game(faces: Record<Side, FaceId>): GameState {
  const s = createGame(0);
  for (const side of ['out', 'in'] as const) s.players[side].pose = { side, face: faces[side], up: CANON_UP[faces[side]], x: 3, y: 3, dir: 1 };
  return s;
}

test('footsteps: the partner is heard only on the same face number, outside N = inside N', () => {
  for (const me of ['out', 'in'] as const) {
    const partner = other(me);
    const step: GameEvent = { type: 'step', side: partner };
    for (const mine of FACES) {
      for (const theirs of FACES) {
        const state = game({ [me]: mine, [partner]: theirs } as Record<Side, FaceId>);
        assert.equal(hears(step, me, state), mine === theirs, `${me} on ${mine}, partner on ${theirs}`);
        assert.deepEqual(heardSfx([step], me, state, known), mine === theirs ? ['step'] : []);
      }
    }
  }
});

test('footsteps: where the partner stands on the shared wall does not matter', () => {
  const state = game({ out: 2, in: 2 });
  state.players.in.pose.x = 11;
  state.players.in.pose.y = 0;
  assert.equal(hears({ type: 'step', side: 'in' }, 'out', state), true);
});

test('footsteps: your own are always heard', () => {
  for (const me of ['out', 'in'] as const) {
    const state = game({ [me]: 1, [other(me)]: 3 } as Record<Side, FaceId>);
    assert.deepEqual(heardSfx([{ type: 'step', side: me }], me, state, known), ['step']);
  }
});

test('ding: the partner changing face is never heard, even onto your own face', () => {
  for (const me of ['out', 'in'] as const) {
    const partner = other(me);
    for (const mine of FACES) {
      for (const to of FACES) {
        const state = game({ [me]: mine, [partner]: to } as Record<Side, FaceId>);
        const flip: GameEvent = { type: 'flip', side: partner, from: 1, to, dx: 1, dy: 0 };
        assert.equal(hears(flip, me, state), false, `${me} on ${mine}, partner arrives on ${to}`);
        assert.deepEqual(heardSfx([flip], me, state, known), []);
      }
    }
  }
});

test('ding: your own face change plays, wherever the partner is', () => {
  for (const me of ['out', 'in'] as const) {
    for (const theirs of FACES) {
      const state = game({ [me]: 2, [other(me)]: theirs } as Record<Side, FaceId>);
      assert.deepEqual(heardSfx([{ type: 'flip', side: me, from: 1, to: 2, dx: 1, dy: 0 }], me, state, known), ['flip']);
    }
  }
});

test('use and push: your own always, those of the partner only through the shared wall', () => {
  for (const type of ['use', 'push'] as const) {
    for (const theirs of FACES) {
      const state = game({ out: 1, in: theirs });
      assert.deepEqual(heardSfx([{ type, side: 'out' }], 'out', state, known), [type]);
      assert.deepEqual(heardSfx([{ type, side: 'in' }], 'out', state, known), theirs === 1 ? [type] : [], `${type}, partner on ${theirs}`);
    }
  }
});

test('a mixed batch keeps its order and drops only what the wall hides', () => {
  const state = game({ out: 1, in: 4 });
  const events: GameEvent[] = [
    { type: 'step', side: 'out' },
    { type: 'step', side: 'in' },
    { type: 'flip', side: 'in', from: 1, to: 4, dx: 1, dy: 0 },
    { type: 'puzzle', puzzle: 'hidden-code', name: 'chime' },
    { type: 'flip', side: 'out', from: 2, to: 1, dx: -1, dy: 0 },
    { type: 'solve', face: 1, puzzle: 'hidden-code' },
  ];
  assert.deepEqual(heardSfx(events, 'out', state, known), ['step', 'chime', 'flip']);
  assert.deepEqual(heardSfx(events, 'in', state, known), ['step', 'flip', 'chime']);
});

test('everything else is heard as before', () => {
  const state = game({ out: 1, in: 3 });
  for (const type of ['bump', 'strike'] as const) assert.deepEqual(heardSfx([{ type, side: 'in' }], 'out', state, known), [type]);
  assert.deepEqual(heardSfx([{ type: 'pickup', side: 'in', item: 'rose' }, { type: 'win' }], 'out', state, known), ['pickup', 'win']);
  // A puzzle event without a sound of its own gets the generic blip; the solve sting is a sample.
  assert.equal(sfxFor({ type: 'puzzle', puzzle: 'x', name: 'no-such-sound' }, known), 'puzzle');
  assert.equal(sfxFor({ type: 'solve', face: 1, puzzle: 'x' }, known), null);
});
