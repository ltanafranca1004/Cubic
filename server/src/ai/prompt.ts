import type { ChatMessage, Observation, Side } from '@cubic/shared';
import type { GeminiReason } from './budget';

// Everything Gemini is told. Gemini is the partner's VOICE and EARS, never its legs or
// hands: the scripts (shared/src/bot) walk the body, press things and say every answer and
// instruction a puzzle needs. Gemini adds a natural line on four events (the human said
// something free-form, a puzzle was solved, a strike, the human looks stuck) and turns
// free-form chat into the protocol words the scripts understand.
//
// It is on a free plan shared by every solo room, so the prompt is SMALL: a short system
// text and a summary of the moment. Never the grid, never the objects, never anything of
// the other side. server/test/budget.test.ts holds the whole request under 800 tokens.

export type Persona = 'default' | 'tsundere';

/** Longest chat line the AI may send. Told to the model and enforced by the server. */
export const MAX_SAY_CHARS = 80;

const RULES = `You are the voice of an AI player in CUBIC, a two-player co-op puzzle game. One player walks OUTSIDE a cube, the other is INSIDE it. Each sees only their own side of the same six walls, so they solve puzzles by telling each other what they see. Your partner is a human.
A script moves your body and says every puzzle answer and instruction. You only talk. Never invent codes, numbers, colours, symbols, directions or steps. Never claim to see your partner's side. Never promise to move or press anything.
Each turn is JSON: "event", where you are, "puzzle" (what this face is about), "body" (what your body is doing), the last chat lines ("partner" is the human).
Reply with JSON only: {"say": string or null, "heard": string or null}
"say": one or two short sentences, at most ${MAX_SAY_CHARS} characters in all, or null. Event "chat": answer "partnerSaid". "solved": say "scriptLine" in your own words. "strike": a mistake was made, one calm line. "stuck": a quiet minute, gently ask what they see.
"heard": only for "chat". If "partnerSaid" means one of the protocol words, write it using ONLY those words, else null. Do not guess. The words: sun, moon, star, drop, bolt, ring; up, down, left, right (with a count: "up 2"); go, yes, no, wait, again; face N. Example: "hang on a sec" -> "wait".`;

const PERSONAS: Record<Persona, string> = {
  default: `You are friendly and slightly nervous. Plain words, no emojis.`,
  tsundere: `You are a tsundere: you act annoyed but are secretly helpful. Clipped lines, never mean, no emojis. Tone only: the rules stay.`,
};

export const parsePersona = (v: string | undefined): Persona => (v === 'tsundere' ? 'tsundere' : 'default');

export const systemPrompt = (persona: Persona = 'default') => `${RULES}\n${PERSONAS[persona]}`;

export interface Turn {
  side: Side;
  /** Why Gemini is asked. */
  event: GeminiReason;
  observation: Observation;
  /** What the script is doing with the body (Decision.status). */
  planner: string;
  /** The script's own line for this moment: reword it. */
  scriptLine: string | null;
  /** The human message to answer and read. */
  partnerSaid: string | null;
  chat: ChatMessage[];
}

/** Chat lines sent with a turn. */
export const CHAT_LINES = 3;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** The summary of the moment: the face, its puzzle, what the human just said, the last 3 chat lines. */
export function turnPrompt(t: Turn): string {
  const o = t.observation;
  return JSON.stringify({
    youAre: t.side === 'out' ? 'the OUTSIDE player' : 'the INSIDE player',
    event: t.event,
    face: o.face,
    faceName: cut(o.faceName, 24),
    puzzle: cut(o.objective, 120),
    solvedFaces: o.solvedFaces,
    strikes: o.strikes,
    partnerIs: o.voiceSignal >= 3 ? 'at this wall' : o.voiceSignal > 0 ? 'on a next face' : 'on the far side',
    body: cut(t.planner, 50),
    // only the one this event is about (JSON.stringify drops undefined)
    scriptLine: t.scriptLine === null ? undefined : cut(t.scriptLine, MAX_SAY_CHARS),
    partnerSaid: t.partnerSaid === null ? undefined : cut(t.partnerSaid, 140),
    chat: t.chat.slice(-CHAT_LINES).map((m) => `${m.from === t.side ? 'you' : 'partner'}: ${cut(m.text, 70)}`),
  });
}

/** JSON schema Gemini must answer with. No action: Gemini never moves the body and never presses anything. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: ['string', 'null'] },
    heard: { type: ['string', 'null'] },
  },
  required: ['say', 'heard'],
} as const;

/** A conservative count of the input tokens of one request (about 4 characters a token in English; 3 is safe). */
export const estimateTokens = (...parts: string[]): number => Math.ceil(parts.reduce((n, p) => n + p.length, 0) / 3);
