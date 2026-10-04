import { CORE_LINES, isPuzzleLine, lineKeys, type LineArgs, type LineKey } from '@cubic/shared';
import type { Persona } from './prompt';

// The words of the scripted partner (shared/src/bot/partner.ts and its puzzle scripts).
// The bot picks a line by key; this file is what it sounds like.
//
//  - CORE lines are not about any puzzle. They are in the committed voice bank
//    (server/tts/bank), so they are spoken for free.
//  - PUZZLE lines belong to one puzzle script (keys start with the puzzle's id). A new
//    script adds its lines to PUZZLE below. They are not banked while the puzzles are
//    still changing: until then they are read by the browser voice. To bank them later,
//    add them to bankedScriptLines() and run `npm run tts:bank -w server` (only the new
//    clips are generated).
//
// Lines that carry protocol words (a sign, a direction, what to type) are the same in
// every persona: the persona changes tone, never the instructions. A relay line (with
// {placeholders}) is never in the bank: its words change, so the browser voice reads it.

type CoreKey = (typeof CORE_LINES)[number];

const CORE: Record<CoreKey, string> = {
  'hello.out': 'Hi! I am outside the cube. I will tell you what I see. Short words work best.',
  'hello.in': 'Hi! I am inside the cube. I will tell you what I see. Short words work best.',
  solved: 'It worked!',
  win: 'We did it!',
  huh: 'Sorry, I did not get that. Short words work best: go, wait, yes, no.',
  'wait.ok': 'Okay, waiting. Say go when you are ready.',
  'follow.where': 'I can barely hear you. Tell me your face, like: face 3.',
  'follow.far': 'I cannot hear you at all. I am coming around to your side.',
  next: 'There is more to solve. Lead the way, I will follow.',
  unknown: 'I do not know this puzzle yet. I will stay close and keep my hands off.',
};

const CORE_TSUNDERE: Partial<Record<CoreKey, string>> = {
  'hello.out': 'Oh. It is you. I am outside the cube. Keep your messages short.',
  'hello.in': 'Oh. It is you. I am inside the cube. Keep your messages short.',
  solved: 'It worked. I knew it would.',
  win: 'We did it. I mean, I did most of it.',
  huh: 'What? Use short words: go, wait, yes, no. Honestly.',
  'wait.ok': 'Fine, I am waiting. Say go. Not that I mind.',
  unknown: 'No idea what this one is. I am not touching it. You figure it out.',
};

/**
 * The lines of the puzzle scripts, by key. One block per script. A RELAY line has
 * {placeholders} that the script fills with what it sees: say('hidden-code.read', { args:
 * { code: '4 7 2' } }) with the words 'The number is {code}.' (Empty: no V2 script yet.)
 */
const PUZZLE: Record<string, string> = {
  // ---- faces 1-3 (scripts-a) ----
  // A '{words}' line is a relay line: vocabulary pieces only (shared/src/bot/vocab.ts), joined.
  'hidden-code.out.intro': 'I see a number in the grass. Type it on your keypad, then press ENTER.',
  'hidden-code.relay': '{words}',
  'hidden-code.ask.first': "What's the first digit?",
  'hidden-code.ask.next': "What's the next digit?",
  'hidden-code.wrong': 'That code was wrong. Tell me the three digits again.',
  'equation-safe.out.intro': 'I will count for you: the bushes, the birds and the rocks I see.',
  'equation-safe.relay': '{words}',
  'equation-safe.ask.bushes': 'How many bushes do you see?',
  'equation-safe.ask.birds': 'How many birds do you see?',
  'equation-safe.ask.rocks': 'How many rocks do you see?',
  'equation-safe.wrong': 'The safe said no. Count again: bushes, birds, rocks.',
  'mirrored-glyph.out.intro': 'Rows from the top. Upright, count from YOUR RIGHT. Say next or again.',
  'mirrored-glyph.relay': '{words}',
  'mirrored-glyph.out.done': 'That was the last row. Say row and a number to hear one again.',
  'mirrored-glyph.in.ask': 'Upright, count from your left. Tell me a row like: row 1 skip 3 flip 7.',
  'mirrored-glyph.in.next': 'Row done. What is the next row?',
  'mirrored-glyph.in.cleared': 'All tiles are off. Start again from row 1.',
  // ---- end faces 1-3 ----
  // ---- faces 4-6 (scripts-b) ----
  // face 4, botanical-mirror. A pot is named by row and column, counted from the edges beside faces 5 and 3.
  'botanical-mirror.relay': '{words}',
  'botanical-mirror.out.ask': 'Which pot? Say row and column. Rows from the face 5 edge, columns from face 3.',
  'botanical-mirror.out.nopot': 'I see no pot there. Rows count from the face 5 edge, columns from face 3.',
  'botanical-mirror.out.strike': 'That was the wrong pot. I have the flower back. Which row and column?',
  'botanical-mirror.in.ask': 'What colour is your flower? Red, blue, yellow, pink or white?',
  'botanical-mirror.in.how': 'Rows count from the edge by face 5, columns from the edge by face 3.',
  'botanical-mirror.in.strike': 'That was the wrong pot. Count from the edges by face 5 and face 3.',
  // face 5, sequence-laser
  'sequence-laser.relay': '{words}',
  'sequence-laser.in.battery': 'The laser is dead. I am getting the battery from the vault on face 2.',
  'sequence-laser.in.how': 'The laser has power. Tell me the symbols in the order they light up.',
  'sequence-laser.in.first': 'What is the first symbol?',
  'sequence-laser.in.next': 'What is next?',
  'sequence-laser.in.strike': 'That one was wrong, it all went dark. Tell me the order again from the start.',
  'sequence-laser.out.dark': 'The symbols are dark. The laser on your side needs the battery from face 2.',
  'sequence-laser.out.how': 'I watched the symbols light up. Say again to hear the order once more.',
  'sequence-laser.out.strike': 'That one was wrong. Start over, from the first symbol.',
  // face 6, laser-path. Directions are always on the walker's own screen.
  'laser-path.relay': '{words}',
  'laser-path.out.mirrors': 'I am pushing the mirrors to burn the crate. Stay on the ring, the lava is hot.',
  'laser-path.out.side.1': 'I see the path. It starts from the side of the ring next to face 1. Go there.',
  'laser-path.out.side.2': 'I see the path. It starts from the side of the ring next to face 2. Go there.',
  'laser-path.out.side.3': 'I see the path. It starts from the side of the ring next to face 3. Go there.',
  'laser-path.out.side.4': 'I see the path. It starts from the side of the ring next to face 4. Go there.',
  'laser-path.out.lava': 'On that side, which way is the lava from you? Say up, down, left or right.',
  'laser-path.out.tile': 'Now the tile to start from. Rows count from your top, columns from your left.',
  'laser-path.out.ready': 'Say yes when you are there, and yes after each part. Say again to hear it.',
  'laser-path.out.fell': 'You fell in. You are back on the ring, right beside the start of the path.',
  'laser-path.in.side': 'I am staying on the ring. Which face does the path start next to? Say face 4.',
  'laser-path.in.lava.up': 'I am on that side of the ring. On my screen the lava is up.',
  'laser-path.in.lava.down': 'I am on that side of the ring. On my screen the lava is down.',
  'laser-path.in.lava.left': 'I am on that side of the ring. On my screen the lava is left.',
  'laser-path.in.lava.right': 'I am on that side of the ring. On my screen the lava is right.',
  'laser-path.in.tile': 'Which tile do I start from? Say row or column and a number, on my screen.',
  'laser-path.in.ready': 'I am on that tile. Which way now? Say it like: right 2 then up 1.',
  'laser-path.in.done': 'Done. Which way now?',
  'laser-path.in.ask': 'Which way now?',
  'laser-path.in.fell': 'I fell in the lava. I am back beside the start of the path. Which way from here?',
  // ---- end faces 4-6 ----
};

/** Fill the {placeholders} of a line. One that has no value stays as written. */
export const fillLine = (words: string, args: LineArgs = {}): string => words.replace(/\{(\w+)\}/g, (all, name: string) => (name in args ? String(args[name]) : all));

/** What a line sounds like. A key with no words yet (a new script) falls back to "I do not know this one". */
export function lineText(persona: Persona, key: LineKey, args?: LineArgs): string {
  const core = (persona === 'tsundere' ? CORE_TSUNDERE[key as CoreKey] : undefined) ?? CORE[key as CoreKey];
  return fillLine(core ?? PUZZLE[key] ?? lineText(persona, 'unknown'), args);
}

/** Does this key have words of its own? (A test checks every registered key does.) */
export const hasLine = (key: LineKey): boolean => key in CORE || key in PUZZLE;

const PERSONAS: Persona[] = ['default', 'tsundere'];
const textsOf = (keys: readonly LineKey[]) => [...new Set(PERSONAS.flatMap((p) => keys.map((k) => lineText(p, k))))];

/** Every distinct line the scripted partner can say, all personas. */
export const allScriptedLines = (): string[] => textsOf(lineKeys());

/** The scripted lines that go into the committed voice bank: the core, not the puzzles (yet). */
export const bankedScriptLines = (): string[] => textsOf(lineKeys().filter((k) => !isPuzzleLine(k)));
