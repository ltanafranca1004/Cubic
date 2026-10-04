import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYPAD_MAX, keyAt, keypadLock, keypadUse, keypadVisible, newKeypad } from '../src/puzzles/lib/keypad';

const keys = [
  { x: 1, y: 1, name: '4' },
  { x: 2, y: 1, name: '2' },
  { x: 3, y: 1, name: 'enter' },
];
const displays = [
  { x: 6, y: 0 },
  { x: 4, y: 0 },
  { x: 5, y: 0 },
];

test('keypad: types up to three digits, ENTER submits and clears', () => {
  const k = newKeypad();
  assert.deepEqual(keypadUse(k, 'enter'), { kind: 'none' }); // nothing typed
  assert.deepEqual(keypadUse(k, '4'), { kind: 'typed', digit: '4' });
  keypadUse(k, '2');
  keypadUse(k, '4');
  assert.equal(k.typed.length, KEYPAD_MAX);
  assert.deepEqual(keypadUse(k, '2'), { kind: 'none' }); // full
  assert.deepEqual(keypadUse(k, 'x'), { kind: 'none' }); // not a key
  assert.deepEqual(keypadUse(k, 'enter'), { kind: 'submit', code: '424' });
  assert.equal(k.typed, '');
});

test('keypad: locks on success, shows the code in green and stops reacting', () => {
  const k = newKeypad();
  keypadUse(k, '4');
  assert.deepEqual(
    keypadVisible(k, keys, displays).map((v) => `${v.type}@${v.x}:${v.state}`),
    ['key@1:4', 'key@2:2', 'key@3:enter', 'display@4:4', 'display@5:empty', 'display@6:empty'],
  );
  keypadUse(k, '2');
  const res = keypadUse(k, 'enter');
  assert.deepEqual(res, { kind: 'submit', code: '42' });
  keypadLock(k, '42');
  assert.deepEqual(keypadUse(k, '4'), { kind: 'none' });
  assert.deepEqual(keypadUse(k, 'enter'), { kind: 'none' });
  assert.deepEqual(
    keypadVisible(k, keys, displays).map((v) => v.state),
    ['4-green', '2-green', 'enter-green', '4-green', '2-green', 'empty'],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(k)), k);
});

test('keypad: keyAt finds the key under a tile', () => {
  assert.equal(keyAt(keys, { x: 3, y: 1 }), 'enter');
  assert.equal(keyAt(keys, { x: 3, y: 2 }), null);
});
