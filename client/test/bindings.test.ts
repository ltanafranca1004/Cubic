import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GameKeys } from '../src/game/keys';
import { InputBuffer, type Buffered } from '../src/game/transition';
import { ACTION_MARK, BIND_ACTIONS, DEFAULT_BINDINGS, actionFor, canBind, cleanBindings, keyFor, keyId, keyLabel, keyName, rebind, useBindings, type BindAction, type Bindings } from '../src/input/bindings';
import { controls, gameAction, moveKeys, padKey, type KeyLike } from '../src/input/keymap';
import { DEFAULT_SETTINGS, cleanSettings } from '../src/style/settings';
import { controlsHint } from '../src/ui/onboarding/rules';

// Key bindings: the swap rule, what may be bound, saving, and that every key path (the
// game scene's steps, E, Q and V; the UI's M, Tab and quick chats; the hints and the pause
// menu's table) follows the binding. tools/screens/controls.ts rebinds in the real game.

const key = (k: string, more: Partial<KeyLike> = {}): KeyLike => ({ key: k, ...more });
const bound = (over: Partial<Bindings>): Bindings => ({ ...DEFAULT_BINDINGS, ...over });
afterEach(() => useBindings(DEFAULT_BINDINGS));

// ---------- the rule ----------

test('bindings: the defaults are WASD, E, Q, V, M, Tab and 1 to 4, one key each', () => {
  assert.deepEqual(DEFAULT_BINDINGS, { up: 'w', down: 's', left: 'a', right: 'd', interact: 'e', drop: 'q', talk: 'v', mute: 'm', map: 'tab', quick1: '1', quick2: '2', quick3: '3', quick4: '4' });
  assert.equal(new Set(Object.values(DEFAULT_BINDINGS)).size, BIND_ACTIONS.length);
});

test('bindings: a free key is simply taken', () => {
  const { bindings, swapped } = rebind(DEFAULT_BINDINGS, 'up', 'i');
  assert.equal(bindings.up, 'i');
  assert.equal(swapped, null);
  assert.deepEqual({ ...bindings, up: 'w' }, DEFAULT_BINDINGS, 'nothing else moved');
});

test('bindings: a key in use swaps the two, so nothing is ever left without a key', () => {
  const { bindings, swapped } = rebind(DEFAULT_BINDINGS, 'up', 'e');
  assert.equal(swapped, 'interact');
  assert.equal(bindings.up, 'e');
  assert.equal(bindings.interact, 'w', 'the other action takes the key that was given up');
  // any chain of rebinds keeps every action on its own key
  let b: Bindings = { ...DEFAULT_BINDINGS };
  const keys = ['e', 'q', '1', 'tab', 'space', 'w', 'x', 'm', 'x', 'a', '4', 'v'];
  BIND_ACTIONS.forEach((action, i) => {
    b = rebind(b, action, keys[i % keys.length]!).bindings;
    assert.equal(new Set(Object.values(b)).size, BIND_ACTIONS.length, `after ${action}`);
    assert.ok(BIND_ACTIONS.every((a) => canBind(b[a])));
  });
});

test('bindings: the same key again, or a fixed key, changes nothing', () => {
  assert.deepEqual(rebind(DEFAULT_BINDINGS, 'up', 'w'), { bindings: { ...DEFAULT_BINDINGS }, swapped: null });
  for (const fixed of ['escape', 'enter', 'arrowup', 'arrowleft', 'shift', 'control', 'meta', 'f5', 'f12', '']) {
    assert.equal(canBind(fixed), false, fixed);
    assert.deepEqual(rebind(DEFAULT_BINDINGS, 'drop', fixed).bindings, DEFAULT_BINDINGS, fixed);
  }
  for (const ok of ['i', 'space', 'tab', '7', ';', 'backspace', 'f']) assert.equal(canBind(ok), true, ok);
});

test('bindings: a key is named by what it types, the space bar and the digits by the key itself', () => {
  assert.equal(keyId(key('W')), 'w');
  assert.equal(keyId(key(' ')), 'space');
  assert.equal(keyId(key('Tab')), 'tab');
  assert.equal(keyId(key('!', { code: 'Digit1' })), '1');
  assert.equal(keyId(key('1', { code: 'Numpad1' })), '1');
  assert.deepEqual(['w', 'tab', 'space', ';', 'backspace'].map(keyName), ['W', 'Tab', 'Space', ';', 'Bksp']);
  assert.equal(keyLabel('map'), 'Tab');
  assert.equal(keyFor('map'), 'Tab');
  assert.equal(keyFor('up', bound({ up: 'space' })), ' ');
});

// ---------- saving ----------

test('saved bindings are checked: a missing, fixed or doubled key means the defaults', () => {
  const good = bound({ up: 'i', interact: 'space' });
  assert.deepEqual(cleanBindings(JSON.parse(JSON.stringify(good))), good);
  for (const bad of [null, 'w', 7, {}, { ...DEFAULT_BINDINGS, up: 'escape' }, { ...DEFAULT_BINDINGS, up: 's' }, { ...DEFAULT_BINDINGS, drop: 3 }, { up: 'i' }]) {
    assert.deepEqual(cleanBindings(bad), DEFAULT_BINDINGS, JSON.stringify(bad));
  }
});

test('saved settings are checked field by field, and survive a round trip', () => {
  const mine = { ...DEFAULT_SETTINGS, music: 0.1, textSize: 'l' as const, highContrast: true, micMode: 'open' as const, keys: bound({ up: 'i' }) };
  assert.deepEqual(cleanSettings(JSON.parse(JSON.stringify(mine))), mine);
  assert.deepEqual(cleanSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(cleanSettings('nonsense'), DEFAULT_SETTINGS);
  const mixed = cleanSettings({ music: 7, sfx: 'loud', textSize: 'xl', hints: 'no', reduceMotion: true, keys: { up: 'i' }, extra: 1 });
  assert.equal(mixed.music, 1, 'a volume is kept inside 0..1');
  assert.equal(mixed.sfx, DEFAULT_SETTINGS.sfx);
  assert.equal(mixed.textSize, 'm');
  assert.equal(mixed.hints, true);
  assert.equal(mixed.reduceMotion, true);
  assert.deepEqual(mixed.keys, DEFAULT_BINDINGS);
  assert.ok(!('extra' in mixed));
});

// ---------- every key path follows the binding ----------

test('the resolver: a rebound key does its new action and the old key does nothing', () => {
  useBindings(bound({ up: 'i', interact: 'space', drop: 'x', talk: 'b', mute: 'n', map: 'c', quick1: '7' }));
  const want: Record<string, unknown> = {
    i: { type: 'move', dir: 'up' },
    ' ': { type: 'interact' },
    x: { type: 'drop' },
    b: { type: 'talk' },
    n: { type: 'mute' },
    c: { type: 'map' },
    '7': { type: 'quick', index: 0 },
    '2': { type: 'quick', index: 1 },
    s: { type: 'move', dir: 'down' },
  };
  for (const [k, action] of Object.entries(want)) assert.deepEqual(gameAction(key(k)), action, k);
  for (const old of ['w', 'e', 'q', 'v', 'm', 'Tab', '1']) assert.equal(gameAction(key(old)), null, old);
});

test('the resolver: Esc, Enter and the arrows are fixed whatever is bound', () => {
  useBindings(bound({ up: 'i', down: 'k', left: 'j', right: 'l' }));
  assert.deepEqual(gameAction(key('ArrowUp')), { type: 'move', dir: 'up' });
  assert.deepEqual(gameAction(key('ArrowRight')), { type: 'move', dir: 'right' });
  assert.deepEqual(gameAction(key('Escape')), { type: 'pause' });
  assert.deepEqual(gameAction(key('Enter')), { type: 'chat' });
});

test('gamepad and touch: a synthetic event is read with the DEFAULT keys, whatever is bound', () => {
  useBindings(bound({ interact: 'space', drop: 'x', up: 'e' })); // E is now "move up" on the keyboard
  assert.deepEqual(gameAction(key('e')), { type: 'move', dir: 'up' });
  assert.deepEqual(gameAction(key('e', { isTrusted: false })), { type: 'interact' });
  assert.deepEqual(gameAction(key('q', { isTrusted: false })), { type: 'drop' });
  assert.deepEqual(gameAction(key('w', { isTrusted: false })), { type: 'move', dir: 'up' });
  // the pad sends exactly those keys
  assert.deepEqual(gameAction(key(padKey('a', 'game'), { isTrusted: false })), { type: 'interact' });
  assert.deepEqual(gameAction(key(padKey('b', 'game'), { isTrusted: false })), { type: 'drop' });
  assert.deepEqual(gameAction(key(padKey('up', 'game'), { isTrusted: false })), { type: 'move', dir: 'up' });
  assert.deepEqual(gameAction(key(padKey('start', 'game'), { isTrusted: false })), { type: 'pause' });
});

test('gamepad and touch: an event that names its action does that action, whatever its key', () => {
  useBindings(bound({ drop: 'x' }));
  const marked = (action: BindAction, k: string): KeyLike => Object.assign(key(k, { isTrusted: false }), { [ACTION_MARK]: action });
  assert.equal(actionFor(marked('drop', 'x')), 'drop');
  assert.equal(actionFor(marked('talk', 'zzz')), 'talk');
  assert.deepEqual(gameAction(marked('quick3', 'x')), { type: 'quick', index: 2 });
  assert.equal(actionFor(Object.assign(key('x'), { [ACTION_MARK]: 'fly' })), 'drop', 'a made-up action is ignored: the key decides');
});

/** The game scene's key handling, with what it sends recorded. */
function scene() {
  const sent: Buffered[] = [];
  const talk: boolean[] = [];
  const keys = new GameKeys({ act: (input) => sent.push(input), talk: (down) => talk.push(down) });
  return { keys, sent, talk };
}

test('game scene: movement, pick up, drop and push-to-talk all follow the bindings', () => {
  useBindings(bound({ up: 'i', left: 'j', interact: 'space', drop: 'x', talk: 'b' }));
  const { keys, sent, talk } = scene();
  assert.equal(keys.down(key('i')), 'move');
  assert.equal(keys.down(key('j')), 'move');
  assert.equal(keys.down(key(' ')), 'used');
  assert.equal(keys.down(key('x')), 'used');
  assert.equal(keys.down(key('b')), 'used');
  assert.deepEqual(sent, [{ kind: 'move', dx: 0, dy: -1 }, { kind: 'move', dx: -1, dy: 0 }, { kind: 'interact' }, { kind: 'interact', only: 'drop' }]);
  assert.deepEqual(talk, [true]);
  keys.up(key('b'));
  assert.deepEqual(talk, [true, false]);
  // the old keys are not the game's any more
  for (const old of ['w', 'a', 'e', 'q', 'v']) assert.equal(keys.down(key(old)), null, old);
  assert.equal(sent.length, 4);
  // keys of the UI (mute, map, quick chat, chat, pause) are never the scene's
  for (const ui of ['m', 'Tab', '1', 'Enter', 'Escape']) assert.equal(keys.down(key(ui)), null, ui);
});

test('game scene: a held key steps once per press and repeats from the key held last', () => {
  const { keys, sent } = scene();
  keys.down(key('w'));
  keys.down(key('w', { repeat: true }));
  keys.down(key('w', { repeat: true }));
  assert.equal(sent.length, 1, 'the auto-repeat of the keyboard is not a new press');
  keys.down(key('ArrowRight'));
  assert.deepEqual(keys.heldDir(), { id: 'arrowright', dx: 1, dy: 0 });
  keys.up(key('ArrowRight'));
  assert.deepEqual(keys.heldDir(), { id: 'w', dx: 0, dy: -1 });
  keys.up(key('W'));
  assert.equal(keys.heldDir(), null, 'Shift went down in between: still the same key');
  keys.down(key('e', { repeat: true }));
  keys.down(key('q', { repeat: true }));
  assert.equal(sent.length, 2, 'E and Q do not repeat');
});

test('game scene: push-to-talk is let go by the key that holds it, and when the window loses focus', () => {
  const { keys, talk } = scene();
  keys.down(key('v'));
  keys.down(key('v', { repeat: true }));
  keys.up(key('w'));
  assert.deepEqual(talk, [true]);
  keys.up(key('v'));
  keys.down(key('v'));
  keys.releaseAll();
  assert.deepEqual(talk, [true, false, true, false]);
});

test('drop is buffered: Q pressed during a face transition lands after the buffered steps', () => {
  // GameScene.act: while a transition plays (or presses already wait) a press goes into the
  // buffer; after it they come out in the order they were pressed.
  const buffer = new InputBuffer();
  const applied: Buffered[] = [];
  const playing = { transition: true };
  const keys = new GameKeys({ act: (input) => (playing.transition || buffer.length ? buffer.push(input) : applied.push(input)), talk: () => {} });
  keys.down(key('d'));
  keys.up(key('d'));
  keys.down(key('d'));
  keys.up(key('d'));
  keys.down(key('q'));
  keys.down(key('e'));
  assert.equal(applied.length, 0, 'nothing is applied while the transition plays: the item is not dropped a tile early');
  playing.transition = false;
  buffer.release(0);
  for (let input = buffer.next(0); input; input = buffer.next(0)) applied.push(input);
  assert.deepEqual(applied, [{ kind: 'move', dx: 1, dy: 0 }, { kind: 'move', dx: 1, dy: 0 }, { kind: 'interact', only: 'drop' }, { kind: 'interact' }]);
});

// ---------- every place that shows a key ----------

test('the pause table, the controls hint and the labels show the live binding', () => {
  assert.equal(moveKeys(), 'WASD');
  assert.equal(controls().find((c) => c.action === 'move')!.keys, 'WASD / Arrows');
  useBindings(bound({ up: 'i', left: 'j', down: 'k', right: 'l', interact: 'space', drop: 'x', talk: 'b', mute: 'n', map: 'c', quick1: '7' }));
  const table = Object.fromEntries(controls().map((c) => [c.action, c.keys]));
  assert.deepEqual(table, { move: 'IJKL / Arrows', interact: 'Space', drop: 'X', quick: '7 2 3 4', chat: 'Enter', talk: 'B', mute: 'N', map: 'C', pause: 'Esc' });
  assert.deepEqual(
    controlsHint().map((c) => `${c.keys.join('/')} ${c.does}`),
    ['IJKL/Arrows move', 'Space interact', 'X drop', 'Enter chat', 'B talk'],
  );
  assert.equal(keyLabel('talk'), 'B');
  useBindings(bound({ up: 'space' }));
  assert.equal(moveKeys(), 'Space A S D', 'a long key name: the four are spaced out');
});
