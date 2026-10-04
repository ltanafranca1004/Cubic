import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_SIZE, SIDES, SYMBOL_NAMES, SYMBOL_OBJECT, TILE_PX, canonToScreen, createGame, upsOn, visibleObjects, type GameState, type Side } from '@cubic/shared';
import { CARRY_PX } from '../src/game/turtle';
import { LABEL_GAP, labelSpot, tileLabel } from '../src/ui/label';

const FACE = 5;
const VIEW = FACE_SIZE * TILE_PX;
const symbols = (state: GameState, side: Side) => visibleObjects(state, side, FACE).filter((o) => o.type === SYMBOL_OBJECT);

test('label: standing on a symbol names it over your own screen tile, on both sides and every up', () => {
  const state = createGame(11);
  for (const side of SIDES) {
    for (const up of upsOn(FACE)) {
      symbols(state, side).forEach((o, i) => {
        Object.assign(state.players[side].pose, { face: FACE, up, x: o.x, y: o.y });
        const [sx, sy] = canonToScreen(side, FACE, up, o.x, o.y);
        assert.deepEqual(tileLabel(state, side), { sx, sy, text: SYMBOL_NAMES[i]!.toUpperCase(), lift: 0 });
      });
    }
  }
});

test('label: the inside view is mirrored on screen, the name is not', () => {
  const state = createGame(11);
  const up = upsOn(FACE)[0]!;
  const o = symbols(state, 'out')[3]!; // the bolt
  for (const side of SIDES) Object.assign(state.players[side].pose, { face: FACE, up, x: o.x, y: o.y });
  const out = tileLabel(state, 'out')!;
  const inside = tileLabel(state, 'in')!;
  assert.equal(out.text, 'BOLT');
  assert.equal(inside.text, 'BOLT');
  assert.equal(inside.sx, FACE_SIZE - 1 - out.sx, 'the same wall seen from behind');
  assert.equal(inside.sy, out.sy);
});

test('label: none off a symbol, and it clears the item carried over the head', () => {
  const state = createGame(11);
  const o = symbols(state, 'in')[0]!;
  Object.assign(state.players.in.pose, { face: FACE, x: 0, y: 0 });
  assert.equal(tileLabel(state, 'in'), null);
  Object.assign(state.players.in.pose, { x: o.x, y: o.y });
  state.players.in.carrying = 'anything';
  assert.equal(tileLabel(state, 'in')!.lift, CARRY_PX);
});

test('label: placed above the turtle, under it on the top rows, inside the view, never on its own tile', () => {
  const box = { w: 30, h: 14 };
  for (const lift of [0, CARRY_PX]) {
    for (let sy = 0; sy < FACE_SIZE; sy++) {
      for (let sx = 0; sx < FACE_SIZE; sx++) {
        const at = labelSpot({ sx, sy, text: 'BOLT', lift }, box);
        assert.ok(at.left >= 0 && at.left + box.w <= VIEW, `${sx},${sy}: inside the side edges`);
        assert.ok(at.top >= 0 && at.top + box.h <= VIEW, `${sx},${sy}: inside the top and bottom`);
        // never over the tile the turtle stands on (the symbol), nor over the item on its head
        if (at.under) assert.ok(at.top >= (sy + 1) * TILE_PX + LABEL_GAP);
        else assert.ok(at.top + box.h <= sy * TILE_PX - lift - LABEL_GAP);
        assert.equal(at.under, sy * TILE_PX - lift - LABEL_GAP < box.h);
      }
    }
  }
  // centred over the turtle away from the edges
  const mid = labelSpot({ sx: 5, sy: 5, text: 'BOLT', lift: 0 }, box);
  assert.equal(mid.left + box.w / 2, 5 * TILE_PX + TILE_PX / 2);
  assert.equal(mid.under, false);
});
