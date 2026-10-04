import type { FaceId, Side } from '../types';

// String maps (legend in ./strings.ts and /maps/README.md).
// Any face with a /maps/<side>-<face>.tmj file is replaced by that file (npm run maps).
// Rows are canonical: the INSIDE player sees their maps mirrored left-right, and inside
// (x, y) is directly behind outside (x, y). Never write a mirrored copy.
//
// One banner section per face and side. Each puzzle owns the two sections of its face:
// edit only yours. Outside terrain (T, ~, #) is the biome: move it only with the biome
// test (client/test/biomes.test.ts) green.
//
// EDGE RULE: no solid terrain (#, T, ~) on the outer ring of any face (row 0, row 11,
// column 0, column 11), so a player crossing in from a neighbouring face can always step
// in. shared/test/maps.test.ts fails if a map breaks it. Objects may stand on the ring.
//
// Not everything is on these maps: a puzzle also draws tiles of its own through visible()
// (the number of face 1, all of face 2, the symbol and flip tiles of face 3, the lava and
// the mirrors of face 6). The banner comments say which tiles to keep free for them.

export const STRING_MAPS: Record<Side, Record<FaceId, string[]>> = {
  out: {
    // ============================================================
    // FACE 1 OUTSIDE: Grass (hidden-code)
    // ============================================================
    // Rows 2-6, columns 0-10 are where the number is laid out (CODE_ORIGIN in hiddenCode.ts):
    // keep that block floor.
    // f = a spot where one of face 4's loose flowers may lie (one per game on this face, picked by the seed).
    1: [
      '............',
      '.T.T.....TT.',
      '............',
      '............',
      '............',
      '............',
      '............',
      '........~~..',
      '....ff.~~~T.',
      '..f.f.f.f...',
      '.T...f.ff.T.',
      '............',
    ],
    // ============================================================
    // FACE 2 OUTSIDE: Desert (equation-safe)
    // ============================================================
    // No walls here: a grey block would pass for one of the rocks the puzzle has counted.
    // f = a spot where one of face 4's loose flowers may lie (one per game on this face, picked by the seed).
    2: [
      '............',
      '.T..ff..f.f.',
      '.....ff..T..',
      '.......ff...',
      '.....T~~....',
      '....~~~~T...',
      '.....~~~....',
      '.......T....',
      '........f...',
      '.T.......f..',
      '..........T.',
      '............',
    ],
    // ============================================================
    // FACE 3 OUTSIDE: Snow (mirrored-glyph)
    // ============================================================
    // The symbol is drawn by the puzzle (GLYPH in puzzles/mirroredGlyph.ts) and covers most of
    // the face: the pines, the snowman's tile (#) and the pond stand clear of it.
    // f = a spot where one of face 4's loose flowers may lie (one per game on this face, picked by the seed).
    3: [
      '............',
      '.T........T.',
      '..f.......T.',
      '............',
      '............',
      '..f.........',
      '...f......T.',
      '.TT.f....f..',
      '...f......#.',
      '..ff.....~~.',
      '.f...f...~~.',
      '............',
    ],
    // ============================================================
    // FACE 4 OUTSIDE: Forest (botanical-mirror)
    // ============================================================
    // p = a pot (five of them). The inside pots stand on the same tiles (drawn by the puzzle).
    // Pots are SOLID on both sides: none on the ring, and each needs a free tile next to it
    // (shared/test/botanical-mirror.test.ts checks both).
    4: [
      '............',
      '.T.T...T.TT.',
      '.........TT.',
      '.T......p.T.',
      '...p........',
      '.T........T.',
      '.....p......',
      '..p.........',
      '.T......p.T.',
      '.TT......TT.',
      '.TT.T..T.TT.',
      '............',
    ],
    // ============================================================
    // FACE 5 OUTSIDE: Rooftop (sequence-laser)
    // ============================================================
    // f = a spot where one of face 4's loose flowers may lie (one per game on this face, picked by the seed).
    5: [
      '............',
      '.##.f.f...f.',
      '.#...u..T...',
      '...u...u....',
      '..f..~~..f..',
      '....~~~...f.',
      '..u..~..u...',
      '.f........f.',
      '..T.u.u.....',
      '.....v..##..',
      '...f.f...#..',
      '............',
    ],
    // ============================================================
    // FACE 6 OUTSIDE: Cave (laser-path)
    // ============================================================
    // y = the crate, ON THE RING (the one solid thing allowed there: it burns away). Keep
    // its column free of terrain and rocks: the beam comes down it.
    6: [
      '............',
      '.T........T.',
      '............',
      '.T.....x....',
      '............',
      '.....Y......',
      '...x........',
      '..........T.',
      '...z..x.....',
      '.#...~~~....',
      '.#T...~~..#.',
      '.........y..',
    ],
  },
  in: {
    // ============================================================
    // FACE 1 INSIDE: Keypad room (hidden-code)
    // ============================================================
    // The inside view is mirrored, so on screen the keys read 1 2 3 / 4 5 6 / 7 8 9 / 0 ENTER.
    1: [
      '............',
      '............',
      '....ddd.....',
      '............',
      '....321.....',
      '....654.....',
      '....987.....',
      '....e0......',
      '............',
      '............',
      '............',
      '............',
    ],
    // ============================================================
    // FACE 2 INSIDE: Vault (equation-safe)
    // ============================================================
    // The safe stands in the gap of the wall; everything else (clue row, keypad, display) is
    // laid out in shared/src/puzzles/equationSafe.ts.
    2: [
      '............',
      '............',
      '............',
      '....#.#.....',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
    // ============================================================
    // FACE 3 INSIDE: Tile room (mirrored-glyph)
    // ============================================================
    // All floor: the puzzle lays a flip tile on every tile, and CLEAR in the corner.
    3: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
    // ============================================================
    // FACE 4 INSIDE: Greenhouse (botanical-mirror)
    // ============================================================
    // Empty: the five flowerpots are the outside pots, seen from behind.
    4: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
    // ============================================================
    // FACE 5 INSIDE: Laser room (sequence-laser)
    // ============================================================
    5: [
      '............',
      '............',
      '.....u......',
      '...u...u....',
      '............',
      '.....w......',
      '..u.....u...',
      '............',
      '....u.u.....',
      '............',
      '............',
      '............',
    ],
    // ============================================================
    // FACE 6 INSIDE: Lava room (laser-path)
    // ============================================================
    // X = the button. It must stand on the tile behind the outside beam source (Y on the
    // outside map): the beam is the safe path through the lava and ends there.
    6: [
      '............',
      '............',
      '............',
      '............',
      '............',
      '.....X......',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ],
  },
};

/** Where each player starts (face 1, facing canonical up). */
export const SPAWN: Record<Side, { x: number; y: number }> = {
  out: { x: 5, y: 9 },
  in: { x: 3, y: 9 },
};
