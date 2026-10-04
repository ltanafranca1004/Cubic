import assert from 'node:assert/strict';
import { visibleObjects } from '../src/index';
import { readCode } from '../src/puzzles/hiddenCode';
import type { SolutionScript, Solver } from './harness';
// face 4: botanical-mirror
import { FLOWER_ID } from '../src/puzzles/chain';
import { solveLaserPath, solveSequenceLaser } from './laser-solutions'; // faces 5 and 6

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

export const SOLUTIONS: Record<string, SolutionScript> = {
  // ---------- face 1: hidden-code ----------
  // Outside reads the number in the grass and says it; inside types it and presses ENTER.
  'hidden-code': (t) => {
    const code = readCode(visibleObjects(t.state, 'out', 1, t.env));
    assert.ok(code, 'the outside player sees no number on face 1');
    for (const name of [...code, 'enter']) {
      t.go('in', t.find('in', 1, 'key', name));
      t.interact('in');
    }
  },
  // ---------- end face 1 ----------

  // ---------- face 2: equation-safe ----------
  // The outside player counts what they see, the inside player types 3 x bushes x 2 x birds x
  // rocks on the keys they see and ENTER. The battery is left LYING in front of the safe.
  'equation-safe': (t) => {
    const seen = (type: string) => visibleObjects(t.state, 'out', 2, t.env).filter((o) => o.type === type).length;
    const answer = 3 * seen('f2-bush') * 2 * seen('f2-bird') * seen('f2-rock');
    const key = (name: string) => visibleObjects(t.state, 'in', 2, t.env).find((o) => o.type === 'key' && o.state === name)!;
    for (const name of [...String(answer), 'enter']) {
      const k = key(name);
      t.go('in', { face: 2, x: k.x, y: k.y });
      t.interact('in');
    }
  },
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
  // Needs the battery: plays face 2 first on a fresh game. Scripts: ./laser-solutions.ts.
  'sequence-laser': (t) => t.state.solved.includes(5) || solveSequenceLaser(SOLUTIONS['equation-safe']!)(t),
  // ---------- end face 5 ----------

  // ---------- face 6: laser-path ----------
  // Needs the laser: plays face 5 (and so face 2) first on a fresh game.
  'laser-path': (t) => t.state.solved.includes(6) || solveLaserPath(SOLUTIONS['sequence-laser']!)(t),
  // ---------- end face 6 ----------
};
