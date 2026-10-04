// RETIRED. This script had its own table of steps for the five old puzzles and walked to
// the portal. The table for the six Puzzles V2 faces lives in ONE place now:
// PUZZLE_SCRIPTS in ./playtest.ts, which plays every puzzle with real keys on two clients
// and ends on the win screen, in both renderers, with a screenshot of each solved face.
//
//   cd tools && npx tsx screens/playtest.ts puzzles              (the whole chain and the win)
//              npx tsx screens/playtest.ts puzzles:hidden-code   (one puzzle)
//
// (BASE, RENDERER, OUT and GIF are described at the top of playtest.ts.)
console.error('screens/puzzles.ts is retired: run `npx tsx screens/playtest.ts puzzles` instead (see the comment in this file).');
process.exit(1);
