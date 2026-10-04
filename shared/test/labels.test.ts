import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SIDES, SYMBOL_NAMES, SYMBOL_OBJECT, VOCAB, VOCAB_SYMBOLS, createGame, isVocab, relayText, symbolAt, symbolLabel, symbolLabelText, symbolOf, visibleObjects, type GameState, type Side } from '../src/index';
import { SYMBOLS } from '../src/puzzles/sequenceLaser';
import { symbolsIn } from '../src/bot/scripts/kit456';

// SYMBOL LABELS (face 5). Run just this file: npx tsx --test shared/test/labels.test.ts

const FACE = 5;
const stand = (state: GameState, side: Side, x: number, y: number) => Object.assign(state.players[side].pose, { face: FACE, x, y });

test('labels: one vocabulary: the puzzle, the bot and the label use the same seven words', () => {
  assert.deepEqual([...SYMBOL_NAMES], ['sun', 'moon', 'star', 'bolt', 'drop', 'leaf', 'eye'], 'the words (and their order) are fixed: the voice bank has a clip per word');
  assert.equal(SYMBOLS, SYMBOL_NAMES, 'the puzzle reads the shared list');
  assert.equal(VOCAB_SYMBOLS, SYMBOL_NAMES, 'the bot vocabulary reads the shared list');
  for (const name of SYMBOL_NAMES) {
    assert.ok(isVocab(name) && VOCAB.includes(name), `${name} is in the bot vocabulary`);
    assert.equal(relayText(['the order is', name]), `the order is ${name}`, 'the bot can say it');
    assert.deepEqual(symbolsIn(symbolLabelText(name)), [name], 'the bot understands the label when a human reads it out');
  }
});

test('labels: a symbol state names its symbol, lit or not; nothing else does', () => {
  assert.equal(symbolOf('bolt'), 'bolt');
  assert.equal(symbolOf('bolt-lit'), 'bolt');
  for (const state of [undefined, '', 'on', 'lit', '-lit', 'bolts', 'powered']) assert.equal(symbolOf(state), null);
  assert.equal(symbolLabelText('bolt'), 'BOLT');
});

test('labels: the tile to name lookup is the same on both sides, for every symbol', () => {
  const state = createGame(7);
  const seen = new Set<string>();
  for (const side of SIDES) {
    const symbols = visibleObjects(state, side, FACE).filter((o) => o.type === SYMBOL_OBJECT);
    assert.equal(symbols.length, SYMBOL_NAMES.length);
    symbols.forEach((o, i) => {
      assert.equal(symbolAt(symbols, o.x, o.y), SYMBOL_NAMES[i], 'the i-th symbol tile in map order is the i-th name');
      stand(state, side, o.x, o.y);
      assert.deepEqual(symbolLabel(state, side), { x: o.x, y: o.y, name: SYMBOL_NAMES[i] });
      seen.add(`${o.x},${o.y}=${SYMBOL_NAMES[i]}`);
    });
  }
  assert.equal(seen.size, SYMBOL_NAMES.length, 'inside and outside agree: the same canonical tile has the same name (no mirror in the data)');
});

test('labels: only symbol tiles have one: not the floor, REPLAY, the emitter or another face', () => {
  const state = createGame(7);
  for (const side of SIDES) {
    const objects = visibleObjects(state, side, FACE);
    let labelled = 0;
    for (let y = 0; y < FACE_SIZE; y++) {
      for (let x = 0; x < FACE_SIZE; x++) {
        stand(state, side, x, y);
        const here = objects.find((o) => o.x === x && o.y === y);
        const label = symbolLabel(state, side);
        assert.equal(label !== null, here?.type === SYMBOL_OBJECT, `${side} ${x},${y}`);
        if (label) labelled++;
      }
    }
    assert.equal(labelled, SYMBOL_NAMES.length);
    // the same tile on a face without symbols
    const symbol = objects.find((o) => o.type === SYMBOL_OBJECT)!;
    stand(state, side, symbol.x, symbol.y);
    state.players[side].pose.face = 1;
    assert.equal(symbolLabel(state, side), null);
  }
});

test('labels: a label is about your own tile only: the partner standing on a symbol gives you none', () => {
  const state = createGame(7);
  const symbol = visibleObjects(state, 'out', FACE).find((o) => o.type === SYMBOL_OBJECT)!;
  stand(state, 'out', symbol.x, symbol.y);
  stand(state, 'in', 0, 0);
  assert.equal(symbolLabel(state, 'out')?.name, 'sun');
  assert.equal(symbolLabel(state, 'in'), null);
});
