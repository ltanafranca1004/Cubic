import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONTROLS, STICK_DEADZONE, gameAction, keyDir, menuAction, padEdges, padInputs, padKey, pasteCode, stepFocus, typeCode, type GameAction, type KeyLike, type PadLike } from '../src/input/keymap';
import { netCellLabel, textScale } from '../src/ui/a11y';
import { CAPTION_MAX_MS, CAPTION_MIN_MS, SPEAK_HOLD_MS, caption, captionMs, clearCaption, onCaption, showCaption, speakStep } from '../src/ui/captions';

// The input mapping (keyboard, gamepad, focus) and the caption rules. All of it is pure:
// no DOM, no Phaser. tools/screens/a11y.ts plays the real game with the keyboard only.

const key = (k: string, more: Partial<KeyLike> = {}): KeyLike => ({ key: k, ...more });
const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// ---------- in game ----------

test('game keys: WASD and the arrows move, in screen directions', () => {
  const dirs = { w: 'up', a: 'left', s: 'down', d: 'right', ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right', W: 'up', D: 'right' } as const;
  for (const [k, dir] of Object.entries(dirs)) assert.deepEqual(gameAction(key(k)), { type: 'move', dir }, k);
});

test('game keys: E interact, Q drop, M mute, V talk, Enter chat, Esc pause, Tab map', () => {
  const want: Record<string, GameAction['type']> = { e: 'interact', q: 'drop', m: 'mute', v: 'talk', Enter: 'chat', Escape: 'pause', Tab: 'map', E: 'interact', Q: 'drop' };
  for (const [k, type] of Object.entries(want)) assert.equal(gameAction(key(k))?.type, type, k);
  for (const k of ['f', 'x', 'z', '5', '0', ' ', 'Backspace', 'Shift']) assert.equal(gameAction(key(k)), null, k);
});

test('game keys: 1 to 4 are the quick chats, by key or by physical key', () => {
  for (const n of [1, 2, 3, 4]) {
    assert.deepEqual(gameAction(key(String(n))), { type: 'quick', index: n - 1 });
    assert.deepEqual(gameAction(key('!', { code: `Digit${n}` })), { type: 'quick', index: n - 1 }, 'another layout, same key');
    assert.deepEqual(gameAction(key(String(n), { code: `Numpad${n}` })), { type: 'quick', index: n - 1 });
  }
  assert.equal(gameAction(key('5', { code: 'Digit5' })), null);
  assert.equal(gameAction(key('6', { code: 'Digit6' })), null);
});

test('game keys: a held key repeats only for move, talk and the map', () => {
  for (const k of ['w', 'ArrowLeft', 'v', 'Tab']) assert.ok(gameAction(key(k, { repeat: true })), k);
  for (const k of ['e', 'q', 'm', '1', 'Enter', 'Escape']) assert.equal(gameAction(key(k, { repeat: true })), null, k);
});

test('game keys: browser shortcuts (Ctrl, Cmd, Alt) are never game keys', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    assert.equal(gameAction(key('e', { [mod]: true })), null);
    assert.equal(gameAction(key('w', { [mod]: true })), null);
    assert.equal(menuAction(key('Enter', { [mod]: true })), null);
  }
});

test('the pause menu documents every game action', () => {
  const all: GameAction['type'][] = ['move', 'interact', 'drop', 'quick', 'mute', 'talk', 'chat', 'pause', 'map'];
  assert.deepEqual([...new Set(CONTROLS.map((c) => c.action))].sort(), [...all].sort());
  for (const c of CONTROLS) assert.ok(c.keys && c.does, c.action);
});

// ---------- menus ----------

test('menu keys: arrows or WASD move, Enter or Space select, Esc is back, Tab walks', () => {
  assert.equal(menuAction(key('ArrowUp')), 'up');
  assert.equal(menuAction(key('s')), 'down');
  assert.equal(menuAction(key('A')), 'left');
  assert.equal(menuAction(key('ArrowRight')), 'right');
  assert.equal(menuAction(key('Enter')), 'select');
  assert.equal(menuAction(key(' ')), 'select');
  assert.equal(menuAction(key('Escape')), 'back');
  assert.equal(menuAction(key('Tab')), 'next');
  assert.equal(menuAction(key('Tab', { shiftKey: true })), 'prev');
  assert.equal(menuAction(key('x')), null);
});

test('menu keys while typing a code: letters are letters, only the arrows move', () => {
  for (const k of ['w', 'a', 's', 'd', ' ']) assert.equal(menuAction(key(k), false), null, k);
  assert.equal(menuAction(key('ArrowDown'), false), 'down');
  assert.equal(menuAction(key('Enter'), false), 'select');
  assert.equal(menuAction(key('Escape'), false), 'back');
  assert.equal(keyDir(key('w'), false), null);
});

test('join code: type letters, Backspace deletes, four at most, the rest is ignored', () => {
  let code = '';
  for (const k of ['a', 'B', '7', '!', 'ArrowLeft', 'c', 'd', 'e']) code = typeCode(code, key(k));
  assert.equal(code, 'ABCD');
  assert.equal(typeCode(code, key('Backspace')), 'ABC');
  assert.equal(typeCode('', key('Backspace')), '');
  assert.equal(typeCode('AB', key('v', { ctrlKey: true })), 'AB', 'Ctrl+V is not a letter');
});

test('join code: pasted text is cut down to four upper-case letters', () => {
  assert.equal(pasteCode('abcd'), 'ABCD');
  assert.equal(pasteCode('  qz-7w k\n'), 'QZWK');
  assert.equal(pasteCode('ABCDEFG'), 'ABCD');
  assert.equal(pasteCode('ab'), 'AB', 'a short paste is kept: the rest can be typed');
  assert.equal(pasteCode('12 34 !'), '', 'nothing usable');
  assert.equal(pasteCode('Join me, the code is QZWK!'), 'QZWK', 'the code as the game shows it wins over the words around it');
  assert.equal(pasteCode('room QZWKX'), 'ROOM', 'five capitals are not a code');
});

test('focus: steps stop at the ends, or wrap; the first key lands on the first item', () => {
  assert.equal(stepFocus(-1, 3, 1), 0);
  assert.equal(stepFocus(-1, 3, -1), 0);
  assert.equal(stepFocus(0, 3, 1), 1);
  assert.equal(stepFocus(2, 3, 1), 2, 'stops at the end');
  assert.equal(stepFocus(0, 3, -1), 0);
  assert.equal(stepFocus(2, 3, 1, true), 0, 'wraps');
  assert.equal(stepFocus(0, 3, -1, true), 2);
  assert.equal(stepFocus(-1, 3, -1, true), 2);
  assert.equal(stepFocus(0, 0, 1), -1, 'nothing to focus');
});

// ---------- gamepad ----------

const pad = (pressed: number[] = [], axes: number[] = [0, 0]): PadLike => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });

test('gamepad: d-pad and left stick move, A B X Start are buttons', () => {
  assert.deepEqual(padInputs(pad()), []);
  assert.deepEqual(padInputs(pad([12])), ['up']);
  assert.deepEqual(padInputs(pad([13])), ['down']);
  assert.deepEqual(padInputs(pad([14])), ['left']);
  assert.deepEqual(padInputs(pad([15])), ['right']);
  assert.deepEqual(padInputs(pad([], [-1, 0])), ['left']);
  assert.deepEqual(padInputs(pad([], [0.2, 0.9])), ['down'], 'the stronger axis wins');
  assert.deepEqual(padInputs(pad([], [STICK_DEADZONE - 0.01, 0])), [], 'inside the dead zone');
  assert.deepEqual(padInputs(pad([0, 1, 2, 9])), ['a', 'b', 'start'], 'X (button 2) is not bound');
  assert.deepEqual(padInputs(pad([12], [1, 0])), ['up'], 'the d-pad beats the stick');
  assert.deepEqual(padInputs({ buttons: [], axes: [] }), [], 'a pad with nothing on it');
});

test('gamepad: every input is a key the keyboard mapping already knows', () => {
  const act = (input: Parameters<typeof padKey>[0]) => gameAction(key(padKey(input, 'game')))?.type;
  assert.deepEqual([act('up'), act('a'), act('b'), act('start')], ['move', 'interact', 'drop', 'pause']);
  const menu = (input: Parameters<typeof padKey>[0]) => menuAction(key(padKey(input, 'menu')));
  assert.deepEqual([menu('left'), menu('a'), menu('b'), menu('start')], ['left', 'select', 'back', 'back']);
});

test('gamepad: edges between two polls', () => {
  assert.deepEqual(padEdges([], ['up', 'a']), { down: ['up', 'a'], up: [] });
  assert.deepEqual(padEdges(['up', 'a'], ['up']), { down: [], up: ['a'] });
  assert.deepEqual(padEdges(['up'], ['left']), { down: ['left'], up: ['up'] });
});

// ---------- accessibility rules ----------

test('text size: whole pixel multiples around the UI scale, never under 1', () => {
  assert.deepEqual([textScale(2, 's'), textScale(2, 'm'), textScale(2, 'l')], [1, 2, 3]);
  assert.deepEqual([textScale(1, 's'), textScale(1, 'm'), textScale(1, 'l')], [1, 1, 2]);
  assert.deepEqual([textScale(4, 's'), textScale(4, 'm'), textScale(4, 'l')], [3, 4, 5]);
});

test('the cube net says its states in words, not only in colour', () => {
  assert.equal(netCellLabel(2, { solved: true, here: false, portal: false }), 'Face 2: solved');
  assert.equal(netCellLabel(1, { solved: false, here: true, portal: false }), 'Face 1: not solved, you are here');
  assert.equal(netCellLabel(6, { solved: true, here: true, portal: true }), 'Face 6: solved, you are here, the portal is awake');
});

test('colour cues come with a shape or a word in the HUD', () => {
  const ui = src('ui/cubicUI.ts') + src('cube/hud.ts'); // the cube HUD draws the face states
  const css = src('ui/css.ts');
  for (const shape of ['cu-tick', 'cu-pip', 'cu-ring']) {
    assert.ok(ui.includes(shape), `${shape} is drawn`);
    assert.ok(css.includes(`.${shape}`), `${shape} is styled`);
  }
});

test('captions: longer lines stay longer, inside the limits', () => {
  assert.equal(captionMs('Hi'), CAPTION_MIN_MS);
  assert.ok(captionMs('A sentence of a normal length for a narrator.') > CAPTION_MIN_MS);
  assert.equal(captionMs('x'.repeat(500)), CAPTION_MAX_MS);
});

test('captions: one line at a time, a new one replaces the old, clear takes it down', () => {
  const seen: (string | null)[] = [];
  const off = onCaption((c) => seen.push(c ? `${c.speaker}|${c.text}` : null));
  const first = showCaption('  The wall   hums. ');
  assert.equal(caption()!.text, 'The wall hums.');
  assert.equal(caption()!.speaker, '');
  showCaption('Step on the plate.', { speaker: 'AI', ms: 5000 });
  assert.equal(caption()!.ms, 5000);
  clearCaption(first); // an old id does not clear the new line
  assert.equal(caption()!.text, 'Step on the plate.');
  clearCaption();
  assert.equal(caption(), null);
  showCaption('   '); // an empty line shows nothing
  assert.equal(caption(), null);
  off();
  assert.deepEqual(seen, ['|The wall hums.', 'AI|Step on the plate.', null, null]);
});

test('captions: a line takes itself down after its time', async () => {
  showCaption('Gone soon', { ms: 30 });
  assert.ok(caption());
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(caption(), null);
});

test('"Partner speaking" follows the voice level and does not flicker between words', () => {
  let s = { on: false, lastLoudAt: -Infinity };
  s = speakStep(s, 0.02, 0);
  assert.equal(s.on, false, 'quiet');
  s = speakStep(s, 0.5, 100);
  assert.equal(s.on, true);
  s = speakStep(s, 0, 100 + SPEAK_HOLD_MS - 1);
  assert.equal(s.on, true, 'held through a short pause');
  s = speakStep(s, 0, 100 + SPEAK_HOLD_MS);
  assert.equal(s.on, false);
});

// ---------- wiring that cannot be loaded without a browser ----------

test('the game stops taking keys while a menu is open, and the camera shake obeys the setting', () => {
  const scene = src('game/GameScene.ts');
  assert.match(scene, /if \(typing\(\) \|\| inputPaused\(\)\) return;/);
  assert.match(scene, /e\.type === 'strike' && settings\(\)\.screenShake/);
  assert.match(src('input/gate.ts'), /\.cu-modal\.on/);
});

test('Tab holds the cube map through the cube API, and the arrows turn it', () => {
  const ui = src('ui/cubicUI.ts');
  assert.match(ui, /cubeMap\.show\(\)/);
  assert.match(ui, /cubeMap\.hide\(\)/);
  assert.match(ui, /cubeMap\.rotate\(action\.dir\)/);
});
