import { CORE_LINES, isPuzzleLine, lineKeys, type LineKey } from '@cubic/shared';
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
// every persona: the persona changes tone, never the instructions.

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
  'portal.go': 'Everything is solved. Heading to the portal.',
  'portal.in': 'The portal is awake. Stepping in.',
};

const CORE_TSUNDERE: Partial<Record<CoreKey, string>> = {
  'hello.out': 'Oh. It is you. I am outside the cube. Keep your messages short.',
  'hello.in': 'Oh. It is you. I am inside the cube. Keep your messages short.',
  solved: 'It worked. I knew it would.',
  win: 'We did it. I mean, I did most of it.',
  huh: 'What? Use short words: go, wait, yes, no. Honestly.',
  'wait.ok': 'Fine, I am waiting. Say go. Not that I mind.',
  unknown: 'No idea what this one is. I am not touching it. You figure it out.',
  'portal.go': 'All solved. To the portal. Do not make me wait.',
  'portal.in': 'The portal is awake. I am going in. Keep up.',
};

/** The lines of the puzzle scripts, by key. One block per script. */
const PUZZLE: Record<string, string> = {
  // plate-door
  'plate-door.go': 'I can see a plate on my floor. Standing on it now.',
  'plate-door.on': 'I am on the plate. Tell me when you are through.',
  'plate-door.shut': 'A sealed door here. Is there a plate on your floor? Stand on it.',
  'plate-door.open': 'The door just opened! Going for the crystal.',
  // glyph-code
  'glyph-code.plate': 'A plate under a tablet. I will stand on it and read you the signs.',
  'glyph-code.sign.sun': 'The tablet shows a sun. Step on the sun stone.',
  'glyph-code.sign.moon': 'The tablet shows a moon. Step on the moon stone.',
  'glyph-code.sign.star': 'The tablet shows a star. Step on the star stone.',
  'glyph-code.sign.drop': 'The tablet shows a drop. Step on the drop stone.',
  'glyph-code.sign.bolt': 'The tablet shows a bolt. Step on the bolt stone.',
  'glyph-code.sign.ring': 'The tablet shows a ring. Step on the ring stone.',
  'glyph-code.wrong': 'That was the wrong stone. The code changed.',
  'glyph-code.asleep': 'Six sign stones here, all asleep. Stand on the plate inside to wake them.',
  'glyph-code.ready': 'The stones are awake. Type the sign: sun, moon, star, drop, bolt or ring.',
  'glyph-code.going': 'Okay, walking to that stone.',
  'glyph-code.oops': 'That was the wrong stone, sorry. Read me the new sign.',
  'glyph-code.next': 'Stepped on it. What is the next sign?',
  // mirror-maze
  'mirror-maze.calib': 'From the doorway, where is the crystal on your screen? Type like: up left',
  'mirror-maze.stepin': 'Stand in the doorway, take one step into the room, then say yes.',
  'mirror-maze.go.up': 'Next step: up. Say yes when you are there.',
  'mirror-maze.go.down': 'Next step: down. Say yes when you are there.',
  'mirror-maze.go.left': 'Next step: left. Say yes when you are there.',
  'mirror-maze.go.right': 'Next step: right. Say yes when you are there.',
  'mirror-maze.fell': 'You fell and the path moved. Step in from the doorway again and say yes.',
  'mirror-maze.toDoor': 'A room full of trap floor. I am walking to its doorway.',
  'mirror-maze.askCalib': 'Where is the pink stone from the amber one on your screen? Type like: up left',
  'mirror-maze.guide': 'I am on the amber stone. Type up, down, left or right, one step at a time.',
  'mirror-maze.wall': 'That way is a wall for me. Try again?',
  'mirror-maze.ok': 'Okay. Next?',
  'mirror-maze.fellIn': 'I fell! The stones moved. I am back on the amber stone: guide me again.',
  // skylight
  'skylight.on': 'I am on a glass pane. Cross the lit bridge and type go. No bridge? Type no.',
  'skylight.switch': 'Okay, walking to the other pane.',
  'skylight.need': 'I need light on a bridge. Stand on a glass pane on the roof and stay there.',
  'skylight.other': 'That lit the far bridge. Try the other pane first.',
  'skylight.across1': 'I am across the first bridge. Now stand on the other pane.',
  'skylight.crossing2': 'The way is lit. Stay on that pane! I am going for the crystal.',
  'skylight.fell': 'The light went out under me! Please stay on the pane.',
  // rose-pot
  'rose-pot.take': 'I am taking the rose to the pot. Back soon.',
  'rose-pot.yours': 'This pot wants the rose from face 1. That one is yours to carry.',
};

/** What a line sounds like. A key with no words yet (a new script) falls back to "I do not know this one". */
export function lineText(persona: Persona, key: LineKey): string {
  const core = (persona === 'tsundere' ? CORE_TSUNDERE[key as CoreKey] : undefined) ?? CORE[key as CoreKey];
  return core ?? PUZZLE[key] ?? lineText(persona, 'unknown');
}

/** Does this key have words of its own? (A test checks every registered key does.) */
export const hasLine = (key: LineKey): boolean => key in CORE || key in PUZZLE;

const PERSONAS: Persona[] = ['default', 'tsundere'];
const textsOf = (keys: readonly LineKey[]) => [...new Set(PERSONAS.flatMap((p) => keys.map((k) => lineText(p, k))))];

/** Every distinct line the scripted partner can say, all personas. */
export const allScriptedLines = (): string[] => textsOf(lineKeys());

/** The scripted lines that go into the committed voice bank: the core, not the puzzles (yet). */
export const bankedScriptLines = (): string[] => textsOf(lineKeys().filter((k) => !isPuzzleLine(k)));
