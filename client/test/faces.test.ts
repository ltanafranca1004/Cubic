import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACES, FACE_NAMES } from '@cubic/shared';
import { FACE_STYLE } from '../src/style/tokens';

test('face names: one table, and the art follows it', () => {
  assert.deepEqual(FACE_NAMES.out, { 1: 'Grass', 2: 'Desert', 3: 'Snow', 4: 'Forest', 5: 'Rooftop', 6: 'Cave' });
  for (const face of FACES) assert.equal(FACE_STYLE[face].name, FACE_NAMES.out[face], `face ${face}`);
  // the biome each face is drawn with matches its name
  assert.deepEqual(FACES.map((f) => FACE_STYLE[f].biome), ['grass', 'desert', 'snow', 'forest', 'sky', 'cave']);
});
