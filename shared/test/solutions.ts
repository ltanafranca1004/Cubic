import { around, type XY } from '../src/puzzles/util';
import { isSolidTile, pathTo, visibleObjects, type FaceId, type Side } from '../src/index';
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

//  - A script may only use what a player on that side can SEE: `sees` is visibleObjects, the
//    same list the screen is drawn from. Reading the puzzle state would be cheating.

/** What `side` sees of one type on `face`, right now. */
const sees = (t: Solver, side: Side, face: FaceId, type: string) => visibleObjects(t.state, side, face, t.env).filter((o) => o.type === type);
const tile = (face: FaceId, o: XY) => ({ face, x: o.x, y: o.y });

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

  // Face 3. Inside stands on the plate and reads the tablet one sign at a time; outside
  // steps on the stone with that sign. Four signs.
  'glyph-code': (t) => {
    t.go('in', t.find('in', 3, 'plate'));
    for (let i = 0; i < 4 && !t.state.solved.includes(3); i++) {
      const sign = sees(t, 'in', 3, 'tablet')[0]!.state; // inside: "it shows a moon"
      const stone = sees(t, 'out', 3, 'glyph').find((g) => g.state === sign)!; // outside: finds the moon stone
      t.go('out', tile(3, stone));
    }
  },

  // Face 4. Outside reads the pale stones in order, inside walks exactly those tiles.
  'mirror-maze': (t) => {
    t.go('out', { face: 4, x: 0, y: 0 }); // has to be on the forest face to see them
    t.go('in', t.find('in', 4, 'entry'));
    for (const stone of sees(t, 'out', 4, 'trail')) t.go('in', tile(4, stone));
  },

  // Face 5. Outside holds pane a while inside crosses the first bridge onto the dry ring,
  // then moves to pane b while inside crosses the second bridge to the crystal.
  skylight: (t) => {
    const second = t.find('in', 5, 'bridge', 'b');
    t.go('out', t.find('out', 5, 'skylight', 'a'));
    // The dry tile next to the second bridge that the first bridge leads to.
    const ring = around(second)
      .map((n) => tile(5, n))
      .find((n) => !isSolidTile(t.env.world, 'in', 5, n.x, n.y) && pathTo(t.state, 'in', n, t.env));
    t.go('in', ring!);
    t.go('out', t.find('out', 5, 'skylight', 'b'));
    t.go('in', t.find('in', 5, 'crystal'));
  },
};
