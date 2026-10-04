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

test('back: nothing is drawn over it, it fades in with the menu and waits while connecting', () => {
  // the only scenery in the mode scene itself is the menu panel, and Back is made after it
  const panel = mode.indexOf("const panel = slice(this,");
  assert.ok(panel > 0 && mode.indexOf('this.back = new Button') > panel, 'Back is created after the panel');
  assert.doesNotMatch(mode, /this\.add\.(rectangle|image|tileSprite)\(/, 'the mode scene draws scenery of its own again: make sure Back is above it');
  // the cube that replaced the net is a scene of its own, underneath the mode scene and kept there
  const order = src('scenes/stage.ts').match(/scene: \[([^\]]*)\]/)![1]!.split(',').map((s) => s.trim());
  assert.ok(order.indexOf('CubeBackdropScene') >= 0 && order.indexOf('CubeBackdropScene') < order.indexOf('ModeScene'), 'the cube scene is drawn before (under) the mode scene');
  assert.match(src('scenes/CubeBackdropScene.ts'), /this\.scene\.sendToBack\(\)/);
  assert.doesNotMatch(src('scenes/flow.ts'), /bringToTop\('cube'\)/);
  assert.match(mode, /this\.status, this\.back\.root\]\.forEach/);
  assert.match(mode, /this\.back\.setEnabled\(s\.status !== 'connecting' && !this\.popup\)/);
});

test('back: the flow only goes back from the mode screen, never mid-fade or mid-dive', () => {
  assert.match(src('scenes/flow.ts'), /back\(\): void \{\s*if \(!this\.loaded \|\| this\.busy \|\| this\.current !== 'mode'\) return;\s*this\.go\('start'\);/);
});
