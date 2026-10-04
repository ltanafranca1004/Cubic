import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACES, FACE_SIZE, SIDES, canonToScreen, defaultEnv, upsOn } from '@cubic/shared';
import { isTall, propAt } from '../src/world/biomes/decor';
import { FADE_ALPHA, PROP_FADE_MS, PropFades, fadingProps, inFront, liftedProps, overlaps, propKey, propTiles, tallProps, turtleTiles, type Tile } from '../src/world/biomes/depth';

// The depth sort between the turtle and the tall props, and the fade (world/biomes/depth.ts).

const prop = (sx: number, sy: number): Tile & { key: string } => ({ sx, sy, key: `${sx},${sy}` });
const keys = (list: readonly { key: string }[]) => list.map((p) => p.key);

test('a tall prop stands on its base and the tile above; off the face it is clipped, not wrapped', () => {
  assert.deepEqual(propTiles(prop(4, 6)), [{ sx: 4, sy: 6 }, { sx: 4, sy: 5 }]);
  assert.deepEqual(propTiles(prop(4, 0)), [{ sx: 4, sy: 0 }], 'the crown of a prop on the top row is off the face');
  assert.ok(!propTiles(prop(4, 0)).some((t) => t.sy === FACE_SIZE - 1), 'it does not come back in at the bottom');
  assert.deepEqual(turtleTiles({ sx: 2, sy: 3, carrying: false }), [{ sx: 2, sy: 3 }]);
  assert.deepEqual(turtleTiles({ sx: 2, sy: 3, carrying: true }), [{ sx: 2, sy: 3 }, { sx: 2, sy: 2 }], 'the carried item rides over the tile above');
  assert.deepEqual(turtleTiles({ sx: 2, sy: 0, carrying: true }), [{ sx: 2, sy: 0 }]);
});

test('the sort: whatever is lower on the screen is in front', () => {
  const tree = prop(5, 5);
  assert.equal(inFront(tree, { sx: 5, sy: 4 }), true, 'the turtle on the tile above (behind the crown) is behind the tree');
  assert.equal(inFront(tree, { sx: 5, sy: 6 }), false, 'the turtle on the tile below is in front of it');
  assert.equal(inFront(tree, { sx: 4, sy: 5 }), false, 'beside it, on the same row: the turtle is not behind');
  assert.equal(inFront(tree, { sx: 6, sy: 5 }), false);
  assert.equal(inFront(tree, { sx: 5, sy: 3 }), true);
});

test('the fade: the five places round a tree, with empty hands', () => {
  const tree = prop(5, 5);
  const at = (sx: number, sy: number, carrying = false) => keys(fadingProps({ sx, sy, carrying }, [tree]));
  assert.deepEqual(at(5, 4), ['5,5'], 'behind the crown: the tree is in front and covers the turtle, it fades');
  assert.deepEqual(at(5, 6), [], 'below: the turtle is in front, nothing fades');
  assert.deepEqual(at(4, 5), [], 'left of the base');
  assert.deepEqual(at(6, 5), [], 'right of the base');
  assert.deepEqual(at(5, 3), [], 'two above: the crown does not reach');
  assert.deepEqual(at(4, 4), [], 'beside the crown');
  assert.deepEqual(at(6, 4), []);
});

test('the fade: the carried item sorts with the turtle', () => {
  const tree = prop(5, 5);
  const at = (sx: number, sy: number) => keys(fadingProps({ sx, sy, carrying: true }, [tree]));
  assert.deepEqual(at(5, 4), ['5,5'], 'behind the crown');
  assert.deepEqual(at(5, 3), [], 'two above: the item rides UP from the turtle, away from the crown below');
  assert.equal(overlaps(tree, { sx: 5, sy: 6, carrying: true }), true, 'below: the item is over the trunk...');
  assert.deepEqual(at(5, 6), [], '...but the turtle is in front, and the item with it: the tree behind keeps its colour');
  assert.deepEqual(at(4, 5), []);
  assert.deepEqual(at(6, 5), []);
});

test('two tall props over the turtle at once both fade, each on its own', () => {
  // Props are one tile wide and the turtle stands on one tile, so standing still only ONE
  // prop covers it: the one based on the tile below. With a second tree below that one, the
  // first fades and the second is lifted with it at full colour (it is in front of both).
  const a = prop(5, 4);
  const b = prop(5, 5);
  assert.deepEqual(keys(fadingProps({ sx: 5, sy: 3, carrying: true }, [a, b])), ['5,4']);
  assert.deepEqual(keys(liftedProps([a, b], (p) => p === a)), ['5,4', '5,5']);
  // Two at once happens in TIME: walking along a row of trees, leaving one and entering
  // the next. Both are part faded for a moment, each on its own clock.
  const fades = new PropFades();
  fades.aim(['left']);
  fades.step(PROP_FADE_MS, false);
  assert.equal(fades.alpha('left'), FADE_ALPHA);
  fades.aim(['right']);
  fades.step(PROP_FADE_MS / 2, false);
  assert.equal(fades.alpha('left'), 0.75);
  assert.equal(fades.alpha('right'), 0.75);
  assert.ok(fades.faded('left') && fades.faded('right') && fades.moving);
  fades.step(PROP_FADE_MS / 2, false);
  assert.equal(fades.alpha('left'), 1);
  assert.equal(fades.alpha('right'), FADE_ALPHA);
  assert.deepEqual(fades.entries(), [['right', FADE_ALPHA]], 'the one that is back to full is forgotten');
  assert.equal(fades.moving, false);
});

test('the fade is a short tween, and instant with reduce motion', () => {
  const fades = new PropFades();
  assert.equal(fades.alpha('t'), 1);
  fades.aim(['t']);
  assert.ok(fades.faded('t') && fades.moving, 'about to fade: already drawn over the turtle');
  let last = 1;
  for (let ms = 0; ms < PROP_FADE_MS; ms += 10) {
    fades.step(10, false);
    assert.ok(fades.alpha('t') < last && fades.alpha('t') >= FADE_ALPHA);
    assert.ok(last - fades.alpha('t') <= (1 - FADE_ALPHA) / 10, 'no jump');
    last = fades.alpha('t');
  }
  fades.step(10, false);
  assert.equal(fades.alpha('t'), FADE_ALPHA);
  fades.step(1000, false);
  assert.equal(fades.alpha('t'), FADE_ALPHA, 'it stays faded while the turtle is behind it');
  fades.aim([]);
  fades.step(PROP_FADE_MS / 2, false);
  assert.equal(fades.alpha('t'), 0.75);
  fades.step(PROP_FADE_MS, false);
  assert.equal(fades.alpha('t'), 1, 'back to full when the turtle leaves');
  assert.equal(fades.faded('t'), false);

  const still = new PropFades();
  still.aim(['t']);
  still.step(0, true);
  assert.equal(still.alpha('t'), FADE_ALPHA, 'reduce motion: at once, whatever the frame time');
  still.aim([]);
  still.step(0, true);
  assert.equal(still.alpha('t'), 1);
  still.aim(['t']);
  still.clear();
  assert.equal(still.alpha('t'), 1);
});

test('a face left behind: its props come back to full by themselves', () => {
  // the keys are canonical and carry the face, so the fade of the old face keeps running during the transition
  const fades = new PropFades();
  const old = propKey(4, 3, 3);
  fades.aim([old]);
  fades.step(PROP_FADE_MS, false);
  fades.aim([propKey(2, 5, 5)]); // now on face 2, behind a cactus
  fades.step(PROP_FADE_MS, false); // well inside the 500 ms roll
  assert.equal(fades.alpha(old), 1, 'nothing is left half faded on the old face');
  assert.equal(fades.alpha(propKey(2, 5, 5)), FADE_ALPHA);
});

test('lifted over the turtle: the faded prop, and the tall props right below it in its column', () => {
  const a = prop(5, 5);
  const below = prop(5, 6);
  const belowThat = prop(5, 7);
  const gap = prop(5, 9);
  const beside = prop(6, 5);
  const all = [a, beside, below, belowThat, gap];
  assert.deepEqual(keys(liftedProps(all, (p) => p === a)), ['5,5', '5,6', '5,7'], 'top row first: the paint order');
  assert.deepEqual(liftedProps(all, () => false), []);
  assert.deepEqual(keys(liftedProps(all, (p) => p === gap)), ['5,9']);
});

test('the real faces: tall props per view, and where the turtle can stand behind one', () => {
  let behind = 0;
  for (const face of FACES) {
    const { tiles } = defaultEnv.world.out[face];
    for (const up of upsOn(face)) {
      const props = tallProps('out', face, up);
      // every tall prop of the map, once, at its screen tile
      const want = new Set<string>();
      for (let y = 0; y < FACE_SIZE; y++)
        for (let x = 0; x < FACE_SIZE; x++) {
          const p = propAt(tiles, face, x, y);
          if (p && isTall(p)) want.add(propKey(face, x, y));
        }
      assert.deepEqual(new Set(keys(props)), want);
      for (const p of props) assert.deepEqual([p.sx, p.sy], canonToScreen('out', face, up, p.x, p.y));
      // on every floor tile: what fades is exactly the tall prop on the screen tile below (and two below when carrying)
      for (let sy = 0; sy < FACE_SIZE; sy++)
        for (let sx = 0; sx < FACE_SIZE; sx++) {
          const at = (dy: number) => props.filter((p) => p.sx === sx && p.sy === sy + dy);
          assert.deepEqual(fadingProps({ sx, sy, carrying: false }, props), at(1));
          assert.deepEqual(fadingProps({ sx, sy, carrying: true }, props), at(1), 'the item rides up, away from the prop below');
          behind += at(1).length;
        }
    }
    assert.ok(tallProps('out', face, upsOn(face)[0]!).length > 0 || face === 1, `face ${face} has tall props`);
  }
  assert.ok(behind > 0);
});

test('inside: no biome layer, nothing tall, nothing fades or is lifted', () => {
  for (const face of FACES)
    for (const up of upsOn(face)) {
      assert.deepEqual(tallProps('in', face, up), []);
      for (let sy = 0; sy < FACE_SIZE; sy++) assert.deepEqual(fadingProps({ sx: 3, sy, carrying: true }, tallProps('in', face, up)), []);
    }
  assert.equal(SIDES.length, 2);
});
