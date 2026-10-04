import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The mode screen's Back button must not silently disappear. The scene cannot be loaded
// here (Phaser needs a browser), so this reads its source; tools/screens/check.ts clicks
// the real one in WebGL and Canvas.

const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const mode = src('scenes/ModeScene.ts');

test('back: the mode screen has a Back button that returns to the title', () => {
  assert.match(mode, /this\.back = new Button\(this, \{ label: 'BACK',[^\n]*onClick: \(\) => this\.ctx\.flow\.back\(\) \}\)/);
  assert.match(mode, /'Escape'\) this\.back\.press\(\)/, 'Esc no longer goes back');
});

test('back: it is drawn over the cube net, fades in with the menu and waits while connecting', () => {
  assert.ok(mode.indexOf('this.back = new Button') > mode.indexOf('this.buildNet(cx, cy)'), 'Back is created after the net');
  assert.match(mode, /this\.status, this\.back\.root\]\.forEach/);
  assert.match(mode, /this\.back\.setEnabled\(s\.status !== 'connecting' && !this\.popup\)/);
});

test('back: the flow only goes back from the mode screen, never mid-fade or mid-dive', () => {
  assert.match(src('scenes/flow.ts'), /back\(\): void \{\s*if \(!this\.loaded \|\| this\.busy \|\| this\.current !== 'mode'\) return;\s*this\.go\('start'\);/);
});
