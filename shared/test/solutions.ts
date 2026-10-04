import { visibleObjects, type FaceId, type Side } from '../src/index';
import type { SolutionScript, Solver } from './harness';
// face 4: botanical-mirror
import assert from 'node:assert/strict';
import { visibleObjects } from '../src/index';
import { FLOWER_ID } from '../src/puzzles/chain';

// ONE SOLUTION SCRIPT PER PUZZLE, keyed by the module's `id`.
// A script plays the puzzle the way two players would: it walks (t.go / t.move), presses E
// (t.interact) and waits (t.wait). `npm test` fails if a module registered in
// shared/src/puzzles/index.ts has no entry here. How to add one: /docs/puzzle-tests.md.
//
// Rules:
//  - Real moves only. Never write to t.state.
//  - Look things up (t.find, t.item) instead of hardcoding tiles, so a map edit does not
//    break the script.
//  - A script must work from a fresh game AND after the other scripts have run (the
//    end-to-end test runs all of them on one game), so do not assume where anyone stands.

//  - A script may only use what a player on that side can SEE: visibleObjects(t.state, side,
//    face, t.env) is the same list the screen is drawn from. Reading the puzzle state would
//    be cheating.
//  - One delimited block per puzzle. Edit only yours.

/** The stub puzzles: walk to the crystal of the face and press E. */
const stub = (face: FaceId, side: Side = 'out') => (t: Solver) => {
  t.go(side, t.find(side, face, 'crystal'));
  t.interact(side);
};

export const SOLUTIONS: Record<string, SolutionScript> = {
  // ---------- face 1: hidden-code ----------
  'hidden-code': stub(1),
  // ---------- end face 1 ----------

  // ---------- face 2: equation-safe ----------
  'equation-safe': stub(2, 'in'),
  // ---------- end face 2 ----------

  // ---------- face 3: mirrored-glyph ----------
  // Outside reads the symbol off the snow; inside flips every tile that is not yet as the
  // symbol says, row by row in a snake so the walk stays short.
  'mirrored-glyph': (t) => {
    const symbol = new Set(visibleObjects(t.state, 'out', 3, t.env).filter((o) => o.type === 'f3-glyph').map((o) => `${o.x},${o.y}`));
    const wrong = visibleObjects(t.state, 'in', 3, t.env).filter((o) => o.type === 'f3-tile' && (o.state !== 'off') !== symbol.has(`${o.x},${o.y}`));
    wrong.sort((a, b) => a.y - b.y || (a.y % 2 ? b.x - a.x : a.x - b.x));
    for (const o of wrong) {
      t.go('in', { face: 3, x: o.x, y: o.y });
      t.interact('in');
    }
  },
  // ---------- end face 3 ----------

  // ---------- face 4: botanical-mirror ----------
  'botanical-mirror': (t) => {
    // The flower comes from face 6: play that first when it is still to do.
    if (!t.state.solved.includes(6)) SOLUTIONS['laser-path']!(t);
    const flower = t.state.items[FLOWER_ID];
    assert.ok(flower, 'face 6 is solved but left no flower');
    if (flower.carriedBy !== 'out') {
      t.go('out', t.item(FLOWER_ID));
      t.interact('out');
    }
    // Outside says the colour they carry; inside finds the pot with that flower and names it.
    const colour = flower.kind.replace('flower-', '');
    const pot = visibleObjects(t.state, 'in', 4, t.env).find((o) => o.type === 'f4-flowerpot' && o.state === colour);
    assert.ok(pot, `the inside player sees no ${colour} flower on face 4`);
    t.go('out', { face: 4, x: pot.x, y: pot.y });
    t.interact('out');
  },
  // ---------- end face 4 ----------

  // ---------- face 5: sequence-laser ----------
  'sequence-laser': stub(5),
  // ---------- end face 5 ----------

  // ---------- face 6: laser-path ----------
  'laser-path': stub(6, 'in'),
  // ---------- end face 6 ----------
};
