import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PUZZLE_SPRITES, drawPuzzleObject, puzzleFrames } from '../src/game/puzzleArt';
import { C } from '../src/style/tokens';
import { createGame, visibleObjects } from '@cubic/shared';

// THE LAVA OF THE LAVA ROOM (inside face 6). The room once looked empty: cold lava was drawn
// as dark rock. Both states have to read as lava, and only the hot one moves. It is hot from
// the start of the game, and the safe path through it has no art at all.

const T = 16;
/** The colours lava is drawn in. Nothing else in the room uses them (tools/screens/lava.ts counts them on screen). */
const LAVA = new Set<string>([C.maroon, C.brick, C.vermilion, C.red, C.orange, C.amberDark, C.amber, C.lemon]);
/** Colours that glow: enough of them and the tile cannot be taken for rock. */
const GLOW = new Set<string>([C.vermilion, C.red, C.orange, C.amber, C.lemon]);

function cell(type: string, state: string, frame = 0): string[] {
  const px = new Array<string>(T * T).fill('');
  const drawn = drawPuzzleObject(
    (x, y, w, h, c) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < T && j < T) px[j * T + i] = c;
    },
    type,
    state,
    frame,
  );
  assert.ok(drawn, `${type} has art`);
  return px;
}

test('lava: hot and cold both fill the tile with lava colours, and are not the same picture', () => {
  for (const state of ['hot', 'cold']) {
    const px = cell('f6-lava', state);
    assert.ok(px.every((c) => LAVA.has(c)), `${state}: every pixel is a lava colour (no floor shows through, no rock)`);
    const glow = px.filter((c) => GLOW.has(c)).length;
    assert.ok(glow >= 8, `${state}: ${glow} glowing pixels`);
  }
  const glowing = (state: string) => cell('f6-lava', state).filter((c) => GLOW.has(c)).length;
  assert.ok(glowing('hot') > glowing('cold') * 4, 'hot is far brighter than cold');
  assert.notDeepEqual(cell('f6-lava', 'hot'), cell('f6-lava', 'cold'));
});

test('lava: hot has four different frames, cold stands still', () => {
  assert.equal(puzzleFrames('f6-lava', 'hot'), 4);
  assert.equal(puzzleFrames('f6-lava', 'cold'), 1);
  assert.equal(puzzleFrames('button', 'off'), 1);
  assert.equal(puzzleFrames('no-such-thing', undefined), 1);
  const frames = [0, 1, 2, 3].map((f) => cell('f6-lava', 'hot', f).join(''));
  assert.equal(new Set(frames).size, 4);
  assert.equal(cell('f6-lava', 'hot', 4).join(''), frames[0], 'the frames loop');
  assert.equal(cell('f6-lava', 'cold', 2).join(''), cell('f6-lava', 'cold', 0).join(''));
});

test('lava: the sheet has a cell for every frame, and no older cell moved', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')) as { objects: Record<string, { frames: Record<string, number | number[]> }> };
  const lava = manifest.objects['f6-lava']!.frames;
  assert.ok(Array.isArray(lava.hot) && lava.hot.length === 4, 'run `npm run art` in /tools after changing puzzleArt');
  assert.equal(typeof lava.cold, 'number');
  assert.equal(lava.default, (lava.hot as number[])[0]);
  // the extra frames come last in SPRITES, so the cells before them keep their place
  const firstExtra = PUZZLE_SPRITES.findIndex((s) => s.frame);
  assert.ok(PUZZLE_SPRITES.slice(firstExtra).every((s) => s.frame), 'animation frames are listed after every first frame');
  // the old drawn path is gone: the safe path is the beam, and nothing marks it on the floor
  assert.equal(manifest.objects['f6-path'], undefined);
  assert.equal(PUZZLE_SPRITES.some((s) => s.type === 'f6-path'), false);
  assert.equal(drawPuzzleObject(() => {}, 'f6-path', 'path'), false);
});

test('lava: the room is hot lava at the start of a game, before anything is solved', () => {
  const state = createGame(7);
  assert.deepEqual(state.solved, []);
  const seen = visibleObjects(state, 'in', 6);
  const lava = seen.filter((o) => o.type === 'f6-lava');
  assert.equal(lava.length, 99);
  assert.ok(lava.every((o) => o.state === 'hot'));
  assert.equal(puzzleFrames('f6-lava', lava[0]!.state), 4, 'and it is the animated sprite');
});
