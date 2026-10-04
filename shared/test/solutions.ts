import type { FaceId, Side } from '../src/index';
import type { SolutionScript, Solver } from './harness';

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
  'mirrored-glyph': stub(3),
  // ---------- end face 3 ----------

  // ---------- face 4: botanical-mirror ----------
  'botanical-mirror': stub(4, 'in'),
  // ---------- end face 4 ----------

  // ---------- face 5: sequence-laser ----------
  'sequence-laser': stub(5),
  // ---------- end face 5 ----------

  // ---------- face 6: laser-path ----------
  'laser-path': stub(6, 'in'),
  // ---------- end face 6 ----------
};
