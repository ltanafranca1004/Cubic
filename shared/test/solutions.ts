import type { SolutionScript } from './harness';

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

export const SOLUTIONS: Record<string, SolutionScript> = {
  // Face 6. Outside carries the rose (face 1) to the pot (face 6).
  'rose-pot': (t) => {
    t.go('out', t.item('rose'));
    t.interact('out'); // pick up
    t.go('out', t.find('out', 6, 'target'));
    t.interact('out'); // place
  },

  // Face 1. Inside holds the plate down, outside walks through the door to the crystal.
  'plate-door': (t) => {
    t.go('in', t.find('in', 1, 'plate'));
    t.go('out', t.find('out', 1, 'crystal'));
  },
};
