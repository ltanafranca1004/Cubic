import { CORE_LINES, lineKeys, type LineArgs, type LineKey } from '@cubic/shared';
import type { Persona } from './prompt';

// The words of the scripted partner (shared/src/bot/partner.ts and its puzzle scripts).
// The bot picks a line by key; this file is what it sounds like.
//
//  - CORE lines are not about any puzzle.
//  - EVENT lines are said by the server itself on a strike and on a quiet minute, when
//    Gemini is not asked (no key, a cap, the kill switch).
//  - PUZZLE lines belong to one puzzle script (keys start with the puzzle's id). A new
//    script adds its lines to PUZZLE below.
//
// Every FIXED line of all three, in the ACTIVE persona (AI_PERSONA, default "default"),
// goes into the committed voice bank (server/tts/bank): the bank script reads fixedLines()
// at run time, so a new line only needs `npm run tts:bank -w server` (a dry run that lists
// what is missing) and then `-- --buy`. The other persona's lines are not bought.
//
// Lines that carry protocol words (a sign, a direction, what to type) are the same in
// every persona: the persona changes tone, never the instructions. A RELAY line (its words
// are {placeholders}) is never banked as a whole: it is built from the pieces of
// shared/src/bot/vocab.ts, each banked once, and played as a chain (relay.ts).

type CoreKey = (typeof CORE_LINES)[number];

const CORE: Record<CoreKey, string> = {
  'hello.out': "Hi! I'm outside the cube. I'll tell you what I see. Short words work best.",
  'hello.in': "Hi! I'm inside the cube. I'll tell you what I see. Short words work best.",
  solved: 'It worked!',
  win: 'We did it!',
  huh: "Sorry, I didn't get that. Short words work best: go, wait, yes, no.",
  'wait.ok': "Okay, waiting. Say go when you're ready.",
  'follow.where': 'I can barely hear you. Tell me your face, like: face 3.',
  'follow.far': "I can't hear you at all. I'm coming around to your side.",
  next: "There's more to solve. Lead the way, I'll follow.",
  unknown: "I don't know this puzzle yet. I'll stay close and keep my hands off.",
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

/** What the server says by itself on a strike and on a quiet minute (see aiPlayer.ts). */
export type EventKey = 'strike' | 'stuck';
const EVENT: Record<EventKey, string> = {
  strike: 'Oops, that was a strike. Slow and steady.',
  stuck: "You've gone quiet. Tell me what you see.",
};
const EVENT_TSUNDERE: Record<EventKey, string> = {
  strike: 'That was a strike. Careful. Not that I am worried.',
  stuck: 'Hello? Say something. Tell me what you see.',
};
export const eventLine = (persona: Persona, key: EventKey): string => (persona === 'tsundere' ? EVENT_TSUNDERE : EVENT)[key];

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
  'equation-safe.out.intro': "I'll count for you: the bushes, the birds and the rocks I see.",
  'equation-safe.relay': '{words}',
  'equation-safe.ask.bushes': 'How many bushes do you see?',
  'equation-safe.ask.birds': 'How many birds do you see?',
  'equation-safe.ask.rocks': 'How many rocks do you see?',
  'equation-safe.wrong': 'The safe said no. Count again: bushes, birds, rocks.',
  'mirrored-glyph.out.intro': 'Rows from the top. Upright, count from YOUR RIGHT. Say next or again.',
  'mirrored-glyph.relay': '{words}',
  'mirrored-glyph.out.done': 'That was the last row. Say row and a number to hear one again.',
  'mirrored-glyph.in.ask': 'Upright, count from your left. Tell me a row like: row 1 skip 3 flip 7.',
  'mirrored-glyph.in.next': "Row done. What's the next row?",
  'mirrored-glyph.in.cleared': 'All tiles are off. Start again from row 1.',
  // ---- end faces 1-3 ----
  // ---- faces 4-6 (scripts-b) ----
  // face 4, botanical-mirror. A pot is named by row and column, counted from the edges beside faces 5 and 3.
  'botanical-mirror.relay': '{words}',
  // (out.colour and out.go are newer than the voice bank: the browser voice reads them.)
  'botanical-mirror.out.colour': 'What colour is the flower in that pot? Rows from face 5, columns from face 3.',
  'botanical-mirror.out.go': 'I know every pot now. I will fetch the flowers and plant them.',
  'botanical-mirror.out.ask': 'Which pot? Say row and column. Rows from the face 5 edge, columns from face 3.',
  'botanical-mirror.out.nopot': 'I see no pot there. Rows count from the face 5 edge, columns from face 3.',
  'botanical-mirror.out.strike': "That was the wrong pot. I've got the flower back. Which row and column?",
  'botanical-mirror.in.ask': 'What colour is your flower? Red, blue, yellow, pink or white?',
  'botanical-mirror.in.how': 'Rows count from the edge by face 5, columns from the edge by face 3.',
  'botanical-mirror.in.strike': 'That was the wrong pot. Count from the edges by face 5 and face 3.',
  // face 5, sequence-laser
  'sequence-laser.relay': '{words}',
  'sequence-laser.in.battery': "The laser is dead. I'm getting the battery from the vault on face 2.",
  'sequence-laser.in.how': 'The laser has power. Tell me the symbols in the order they light up.',
  'sequence-laser.in.first': "What's the first symbol?",
  'sequence-laser.in.next': "What's next?",
  'sequence-laser.in.strike': 'That one was wrong, it all went dark. Tell me the order again from the start.',
  'sequence-laser.out.dark': 'The symbols are dark. The laser on your side needs the battery from face 2.',
  'sequence-laser.out.how': 'I watched the symbols light up. Say again to hear the order once more.',
  'sequence-laser.out.strike': 'That one was wrong. Start over, from the first symbol.',
  // face 6, laser-path. Directions are always on the walker's own screen.
  'laser-path.relay': '{words}',
  'laser-path.out.mirrors': "I'm pushing the mirrors to burn the crate. Stay on the ring, the lava is hot.",
  'laser-path.out.side.1': 'I see the path. It starts from the side of the ring next to face 1. Go there.',
  'laser-path.out.side.2': 'I see the path. It starts from the side of the ring next to face 2. Go there.',
  'laser-path.out.side.3': 'I see the path. It starts from the side of the ring next to face 3. Go there.',
  'laser-path.out.side.4': 'I see the path. It starts from the side of the ring next to face 4. Go there.',
  'laser-path.out.lava': 'On that side, which way is the lava from you? Say up, down, left or right.',
  'laser-path.out.tile': 'Now the tile to start from. Rows count from your top, columns from your left.',
  'laser-path.out.ready': "Say yes when you're there, and yes after each part. Say again to hear it.",
  'laser-path.out.fell': "You fell in. You're back on the ring, right beside the start of the path.",
  'laser-path.in.side': "I'm on the ring. Which face does the path start next to? Say the face number.",
  'laser-path.in.lava.up': "I'm on that side of the ring. On my screen the lava is up.",
  'laser-path.in.lava.down': "I'm on that side of the ring. On my screen the lava is down.",
  'laser-path.in.lava.left': "I'm on that side of the ring. On my screen the lava is left.",
  'laser-path.in.lava.right': "I'm on that side of the ring. On my screen the lava is right.",
  'laser-path.in.tile': 'Which tile do I start from? Say row or column and a number, on my screen.',
  'laser-path.in.ready': "I'm on that tile. Which way now? Say it like: right 2 then up 1.",
  'laser-path.in.done': 'Done. Which way now?',
  'laser-path.in.ask': 'Which way now?',
  'laser-path.in.fell': "I fell in the lava. I'm back beside the start of the path. Which way from here?",
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
const EVENTS = ['strike', 'stuck'] as const;

/** Every distinct line the scripted partner can say, all personas. */
export const allScriptedLines = (): string[] => [...new Set(PERSONAS.flatMap((p) => lineKeys().map((k) => lineText(p, k))))];

/**
 * Every FIXED line of one persona, by key: the core, the event lines ("event.strike",
 * "event.stuck") and the puzzle lines that have no {placeholder}. This is what the voice
 * bank holds as whole clips. Read at run time, so lines added to PUZZLE later are picked up
 * by themselves.
 */
export const fixedLineList = (persona: Persona = 'default'): { key: string; text: string }[] =>
  [...lineKeys().map((key) => ({ key, text: lineText(persona, key) })), ...EVENTS.map((k) => ({ key: `event.${k}`, text: eventLine(persona, k) }))].filter((l) => !/\{\w+\}/.test(l.text));

/** The texts of fixedLineList(), no duplicates: the whole clips the bank holds for this persona. */
export const fixedLines = (persona: Persona = 'default'): string[] => [...new Set(fixedLineList(persona).map((l) => l.text))];

/** The old name of fixedLines(). */
export const bankedScriptLines = fixedLines;

// What the human is expected to SAY on each puzzle, by the side the AI is on: the
// conventions of the scripts' own ask lines above, in two short lines. Gemini is given the
// one for the face it is on, so that what it says never contradicts the script.
const HUMAN_SAYS: Record<string, { out: string; in: string }> = {
  'hidden-code': { out: 'Nothing: they type the code you read out. "again" repeats it.', in: 'The three digits of the code they see, in order.' },
  'equation-safe': { out: 'Nothing: they type the answer. "again" repeats the counts.', in: 'How many bushes, birds and rocks they see, each with its kind.' },
  'mirrored-glyph': { out: '"next" for the next row, "again", or "row" and a number to hear that row.', in: 'One row per line, upright, from their left, like "row 1 skip 3 flip 7". "clear" starts over.' },
  'botanical-mirror': { out: 'The colour of the flower in the pot it names. After a wrong pot: the row and column for its flower.', in: 'Nothing: it names each pot and its colour. "again" or the colour of their flower repeats.' },
  'sequence-laser': { out: '"again" to hear the order once more.', in: 'They press REPLAY (E on its tile), then say the symbols in the order they light up.' },
  'laser-path': { out: 'Which way the lava is (up, down, left, right), then "yes" after each part. "again" repeats.', in: '"face" and the number the path starts by, a row or column, then steps like "right 2 then up 1".' },
};
/** What the human is expected to say on this puzzle when the AI is on `aiSide`, or null (no puzzle here, or no script). */
export const humanSays = (puzzleId: string | null, aiSide: 'out' | 'in'): string | null => (puzzleId ? (HUMAN_SAYS[puzzleId]?.[aiSide] ?? null) : null);
