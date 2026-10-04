import type { FaceId } from '../types';

// The words the AI partner understands in chat: a tiny protocol, so the two players can
// pass what they see through the wall. The AI's own lines tell the human which words to
// type. Quick chat (keys 1 to 4: Here! / Wait / Yes / No) is part of it.
//
//   sign   sun | moon | star | drop | bolt | ring      the code relay (face 3)
//   dir    up | down | left | right (+ a count)        the mirror maze (face 4)
//   go     go | across | next | switch | other         "I am across, move on" (face 5)
//   yes    yes | ok | done | here                      "I took that step"
//   no     no | wrong                                  "that did not work"
//   wait   wait | stop | hold
//   again  again | repeat | what | ?
//   face   face 3                                      "I am on face 3, come here"

export const SIGNS = ['sun', 'moon', 'star', 'drop', 'bolt', 'ring'] as const;
export type Sign = (typeof SIGNS)[number];
export const DIRS = ['up', 'down', 'left', 'right'] as const;
export type Dir = (typeof DIRS)[number];

export type Token =
  | { t: 'sign'; sign: Sign }
  | { t: 'dir'; dir: Dir; n: number }
  | { t: 'face'; face: FaceId }
  | { t: 'yes' | 'no' | 'go' | 'wait' | 'again' };

const SIGN_WORDS: Record<string, Sign> = {
  sun: 'sun',
  moon: 'moon',
  crescent: 'moon',
  star: 'star',
  drop: 'drop',
  droplet: 'drop',
  water: 'drop',
  bolt: 'bolt',
  lightning: 'bolt',
  ring: 'ring',
  circle: 'ring',
};
const DIR_WORDS: Record<string, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right', u: 'up', d: 'down', l: 'left', r: 'right' };
const WORDS: Record<string, 'yes' | 'no' | 'go' | 'wait' | 'again'> = {
  yes: 'yes',
  y: 'yes',
  yep: 'yes',
  yeah: 'yes',
  ok: 'yes',
  okay: 'yes',
  k: 'yes',
  done: 'yes',
  here: 'yes',
  ready: 'yes',
  go: 'go',
  across: 'go',
  crossed: 'go',
  through: 'go',
  next: 'go',
  switch: 'go',
  other: 'go',
  no: 'no',
  nope: 'no',
  n: 'no',
  wrong: 'no',
  wait: 'wait',
  stop: 'wait',
  hold: 'wait',
  again: 'again',
  repeat: 'again',
  what: 'again',
  huh: 'again',
  '?': 'again',
};
const COUNT_WORDS: Record<string, number> = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** Words that carry nothing: a line made of protocol words and these is still "plain". */
const FILLER = new Set(
  'a an the it is its it\'s i im i\'m am on at to of in my me you your now then and please pls step steps stone sign tile pane bridge shows show one more times time x im going go'.split(' '),
);

export interface Heard {
  tokens: Token[];
  /** Every word was a protocol word, a number or a filler: nothing left for a model to interpret. */
  plain: boolean;
}

/** Read one chat line. Never throws; an empty or unknown line gives no tokens. */
export function parseHuman(text: string): Heard {
  const words = text
    .toLowerCase()
    .replace(/([?])/g, ' $1 ')
    .replace(/[^a-z0-9?' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tokens: Token[] = [];
  let plain = words.length > 0;
  const count = (w: string | undefined): number | null => {
    if (!w) return null;
    const m = /^x?([1-9])x?$/.exec(w);
    return m ? Number(m[1]) : (COUNT_WORDS[w] ?? null);
  };
  /** Index of the last word already used as a count. */
  let used = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const faceJoined = /^face([1-6])$/.exec(w);
    if (faceJoined) {
      tokens.push({ t: 'face', face: Number(faceJoined[1]) as FaceId });
    } else if (w === 'face' && /^[1-6]$/.test(words[i + 1] ?? '')) {
      tokens.push({ t: 'face', face: Number(words[++i]) as FaceId });
    } else if (SIGN_WORDS[w]) {
      tokens.push({ t: 'sign', sign: SIGN_WORDS[w] });
    } else if (DIR_WORDS[w]) {
      // "up 3", "up x3", "up twice", or the count first: "3 up"
      const after = count(words[i + 1]);
      const before = after === null && i - 1 > used ? count(words[i - 1]) : null;
      tokens.push({ t: 'dir', dir: DIR_WORDS[w], n: after ?? before ?? 1 });
      if (after !== null) used = ++i;
    } else if (WORDS[w]) {
      tokens.push({ t: WORDS[w] });
    } else if (count(w) === null && !FILLER.has(w)) {
      plain = false;
    }
  }
  return { tokens, plain };
}
