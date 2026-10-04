import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEQ_STEP_MS, makeSequence, newSeqShow, seqAdvance, seqLitIndex, seqPress, seqStart } from '../src/puzzles/lib/sequence';
import { mix } from '../src/puzzles/util';

test('sequence: 500 ms per step on a 250 ms tick, any length', () => {
  assert.equal(SEQ_STEP_MS, 500);
  for (const length of [3, 5, 7]) {
    const q = newSeqShow();
    assert.equal(seqLitIndex(q, length), null);
    assert.equal(seqAdvance(q, 250, length), false); // not playing
    seqStart(q);
    const lit: (number | null)[] = [seqLitIndex(q, length)];
    let changes = 0;
    for (let i = 0; i < length * 2; i++) {
      if (seqAdvance(q, 250, length)) changes++;
      lit.push(seqLitIndex(q, length));
    }
    assert.deepEqual(lit, [...Array.from({ length }, (_, i) => [i, i]).flat(), null]);
    assert.equal(changes, length); // each next step, and the end
    assert.equal(q.playing, false);
    seqStart(q); // replay
    assert.equal(seqLitIndex(q, length), 0);
  }
});

test('sequence: seven presses over seven symbols use each symbol once; seeds differ', () => {
  const make = (seed: number, length = 7) => makeSequence((i) => mix(seed, i), length, 7);
  const a = make(1);
  assert.deepEqual([...a].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(a, make(1));
  assert.ok([2, 3, 4, 5].some((seed) => make(seed).join() !== a.join()));
  const long = make(1, 20);
  assert.equal(long.length, 20);
  for (let i = 1; i < long.length; i++) assert.notEqual(long[i], long[i - 1]);
  assert.ok(long.every((n) => n >= 0 && n < 7));
});

test('sequence: presses are checked in order, a wrong one resets', () => {
  const order = [2, 0, 1];
  const entered: number[] = [];
  assert.equal(seqPress(entered, order, 2), 'next');
  assert.equal(seqPress(entered, order, 1), 'wrong');
  assert.deepEqual(entered, []);
  assert.equal(seqPress(entered, order, 2), 'next');
  assert.equal(seqPress(entered, order, 0), 'next');
  assert.equal(seqPress(entered, order, 1), 'done');
});
