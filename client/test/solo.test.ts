import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ENABLE_AI } from '../src/config';
import { SEAT_HOLD_MS, soloLeftUntil } from '../src/net/left';
import { draftOf, soloFocus, soloOrder, type PopupDraft, type SoloFocus } from '../src/scenes/popupState';

// PLAY SOLO on the mode screen: what a resize keeps of the side popup, how the keyboard
// walks it, and when a left solo game is offered again. The scenes cannot be loaded here
// (Phaser needs a browser), so the popup's logic is in pure modules and the wiring is read
// from the source, like back.test.ts.

const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const mode = src('scenes/ModeScene.ts');
const popup = src('scenes/AiPopup.ts');

const up = (focus: SoloFocus, open = true) => ({ open, draft: (): PopupDraft => ({ kind: 'solo', focus }) });

test('solo: the mode screen offers PLAY SOLO as the third choice, in the same list as the other two', () => {
  assert.equal(ENABLE_AI, true);
  const items = mode.slice(mode.indexOf('const items:'), mode.indexOf('const menuH'));
  assert.deepEqual([...items.matchAll(/label: '([A-Z ]+)'/g)].map((m) => m[1]), ['CREATE LOBBY', 'JOIN LOBBY', 'PLAY SOLO']);
  // one loop makes all three: the same Button, variant, size, focus list and press
  assert.match(mode, /items\.forEach\(\(item, i\) => \{[^}]*new Button\(this, \{ label: item\.label, variant: 'in', width: bw, height: bh, onClick: item\.onClick \}\)/);
  assert.match(mode, /return \[\.\.\.this\.buttons, this\.back\];/);
  assert.doesNotMatch(mode + popup, /PLAY WITH AI/);
  assert.match(popup, /'PLAY SOLO'/);
});

test('solo: a resize puts the open popup back where it was, and only an open one', () => {
  assert.deepEqual(draftOf(up('in'), true), { kind: 'solo', focus: 'in' });
  assert.deepEqual(draftOf(up('cancel'), true), { kind: 'solo', focus: 'cancel' });
  assert.deepEqual(draftOf({ open: true, draft: () => ({ kind: 'join', code: 'ZZ' }) }, true), { kind: 'join', code: 'ZZ' });
  assert.equal(draftOf(up('in', false), true), null, 'a cancelled popup must not come back');
  assert.equal(draftOf(null, true), null);
  assert.equal(draftOf(up('in'), false), null, 'a fresh start of the scene has no popup');
  assert.equal(draftOf(up('in'), undefined), null);
});

test('solo: the restore is the join popup\'s mechanism (the scene rebuild), not a resize listener of its own', () => {
  assert.match(mode, /const draft = draftOf\(this\.popup, data\.rebuilt\);/);
  assert.match(mode, /if \(draft\?\.kind === 'join'\) this\.openJoin\(draft\.code\);\s+else if \(draft\?\.kind === 'solo'\) this\.openSolo\(draft\.focus\);/);
  assert.doesNotMatch(mode + popup, /addEventListener\('resize'|Scale\.Events\.RESIZE|onFit\(/);
  // put back, it does not drop in again
  assert.match(popup, /if \(!opts\.focus\) \{\s+\/\/ it drops in from just above/);
});

test('solo: keys in the popup', () => {
  assert.deepEqual(soloOrder(false), ['out', 'in', 'cancel']);
  assert.equal(soloFocus('out', 'right', false), 'in');
  assert.equal(soloFocus('in', 'left', false), 'out');
  assert.equal(soloFocus('in', 'down', false), 'cancel');
  assert.equal(soloFocus('cancel', 'up', false), 'out');
  assert.equal(soloFocus('in', 'up', false), 'in');
  assert.deepEqual(['out', 'in', 'cancel'].map((f) => soloFocus(f as SoloFocus, 'next', false)), ['in', 'cancel', 'out']);
  assert.deepEqual(['out', 'in', 'cancel'].map((f) => soloFocus(f as SoloFocus, 'prev', false)), ['cancel', 'out', 'in']);
  assert.equal(soloFocus('in', null, false), 'in');
  // with CONTINUE LAST GAME between the sides and Cancel
  assert.deepEqual(soloOrder(true), ['out', 'in', 'resume', 'cancel']);
  assert.equal(soloFocus('out', 'down', true), 'resume');
  assert.equal(soloFocus('resume', 'down', true), 'cancel');
  assert.equal(soloFocus('cancel', 'up', true), 'resume');
  assert.equal(soloFocus('resume', 'up', true), 'out');
  assert.equal(soloFocus('in', 'next', true), 'resume');
  // rebuilt after the held game ran out: the focus cannot stay on a button that is gone
  assert.equal(soloFocus('resume', null, false), 'out');
});

test('solo: a left solo game is offered for the 60 s the server holds it, a friend room never', () => {
  assert.equal(SEAT_HOLD_MS, 60_000);
  const left = { code: 'ABCD', token: 't', solo: true, at: 1000 };
  assert.equal(soloLeftUntil(left, 1000), 61_000);
  assert.equal(soloLeftUntil(left, 60_999), 61_000);
  assert.equal(soloLeftUntil(left, 61_000), null);
  assert.equal(soloLeftUntil({ code: 'ABCD', token: 't' }, 1000), null);
  assert.equal(soloLeftUntil({ code: 'ABCD', token: 't', solo: true }, 1000), null);
  assert.equal(soloLeftUntil(null, 1000), null);
});

test('solo: in the game there is no room code to share and the partner is the AI partner', () => {
  const ui = src('ui/cubicUI.ts');
  assert.match(ui, /const code = state\?\.mode === 'ai' \? null : state\?\.roomCode;/);
  assert.match(ui, /\$\('cu-room-v'\)\.textContent = next\.mode === 'ai' \? 'AI' : \(next\.roomCode \?\? ''\);/);
  assert.match(ui, /copyBtn\.hidden = !\(inRoom && !!next\.lobby && next\.mode !== 'ai'\);/);
  assert.match(ui, /s\.mode === 'ai' \? 'AI partner' : 'Partner'/);
  // the only banner that names the room code is not shown in a solo room
  assert.match(ui, /next\.mode === 'ai'\s+\? 'The AI partner stopped\. Leave and start a new game\.'/);
});
