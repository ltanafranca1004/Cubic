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
// Every FIXED line of all three goes into the committed voice bank (server/tts/bank): the
// bank script reads fixedLines() at run time, so a new line only needs `npm run tts:bank
// -w server` (a dry run that lists what is missing) and then `-- --buy`.
//
// Lines that carry protocol words (a sign, a direction, what to type) are the same in
// every persona: the persona changes tone, never the instructions. A RELAY line (its words
// are {placeholders}) is never banked as a whole: it is built from the pieces of
// shared/src/bot/vocab.ts, each banked once, and played as a chain (relay.ts).

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

/** What the server says by itself on a strike and on a quiet minute (see aiPlayer.ts). */
export type EventKey = 'strike' | 'stuck';
const EVENT: Record<EventKey, string> = {
  strike: 'Oops, that was a strike. Slow and steady.',
  stuck: 'You have gone quiet. Tell me what you see.',
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
const PUZZLE: Record<string, string> = {};

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

/**
 * Every FIXED line the partner can say, all personas: the core, the event lines and the
 * puzzle lines that have no {placeholder}. This is what the voice bank holds as whole
 * clips. Read at run time, so lines added to PUZZLE later are picked up by themselves.
 */
export const fixedLines = (): string[] => [...new Set([...allScriptedLines(), ...PERSONAS.flatMap((p) => (['strike', 'stuck'] as const).map((k) => eventLine(p, k)))])].filter((l) => !/\{\w+\}/.test(l));

/** The old name of fixedLines(). */
export const bankedScriptLines = fixedLines;
