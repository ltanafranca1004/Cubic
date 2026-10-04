import { FACE_SIZE, type Side } from '@cubic/shared';
import { NARRATOR, narratorLine } from '../../content/narrator';

// THE HINT RULES: what is on screen, and when. Pure: no DOM, no Phaser, no timers, no
// clock of its own. The DOM layer (index.ts) feeds it a snapshot a few times a second and
// draws the view it returns. test/onboarding.test.ts covers every rule in this file.
//
//   side card      at the start of a game, once per side per session
//   controls       from the first spawn until the player has moved AND interacted
//   context hints  cube (the first time the HUD is on screen), edge (the first face edge
//                  reached), voice (the first time the partner gets quieter). Once each
//                  per session, one at a time, never under the side card.
//   narrator       an intro line at every game start and a line at its first solve.
//                  It is story, not a hint: the "hints" setting does not silence it.

export type ContextHint = 'cube' | 'edge' | 'voice';
/** When two are due at once, the earlier one in this list goes first. */
export const CONTEXT_ORDER: readonly ContextHint[] = ['cube', 'edge', 'voice'];

export const HINT_TEXT = {
  card: {
    out: { lead: "You're ", word: 'ON', tail: ' the cube' },
    in: { lead: "You're ", word: 'INSIDE', tail: ' the cube' },
  } satisfies Record<Side, { lead: string; word: string; tail: string }>,
  cardLine: 'Your partner is in the same spot on the other side. Their left is your right.',
  context: {
    cube: 'This is the cube. Your face is the one in front.',
    edge: 'Walk off the edge to fold onto the next face.',
    voice: 'Your partner sounds farther away. Voice fades by face distance.',
  } satisfies Record<ContextHint, string>,
  /** The keys of the brief. Q and F are bound by the keyboard task; the hint lists them anyway. */
  controls: [
    { keys: ['WASD', 'Arrows'], does: 'move' },
    { keys: ['E'], does: 'interact' },
    { keys: ['Q'], does: 'drop' },
    { keys: ['Enter'], does: 'chat' },
    { keys: ['V'], does: 'talk' },
    { keys: ['F'], does: 'ping' },
  ],
};

/** The side card stays at least this long, so a player who walks at once can still read it. */
export const CARD_MIN_MS = 2500;
/** ... and goes by itself after this long. */
export const CARD_MAX_MS = 9000;
/** How long a context hint stays. */
export const HINT_MS = 6500;
/** A game id that changes this soon after a start is the same start settling, not a new game. */
export const START_SETTLE_MS = 1500;
/** A breath between two context hints. */
export const HINT_GAP_MS = 500;
export const CAPTION_MS = 5500;
/** The controls hint never sticks forever, even if the player never interacts. */
export const CONTROLS_MAX_MS = 90_000;

/** What the rules need to know about the running game. */
export interface GameSnapshot {
  /** Changes when a new game starts (GameState.startedAt). */
  id: number;
  side: Side;
  face: number;
  /** Canonical tile, 0..FACE_SIZE-1. */
  x: number;
  y: number;
  /** voiceMix gain while a partner is present and voice is on; null otherwise. */
  gain: number | null;
  /** Number of solved puzzles. */
  solved: number;
  won: boolean;
}

export interface Snapshot {
  now: number;
  /** The "Hints" setting. */
  hints: boolean;
  /** null while not on the game screen. */
  game: GameSnapshot | null;
  /** The player pressed an interact key since the last snapshot. */
  interacted: boolean;
}

export interface OnboardingView {
  /** The side intro card, for this side. */
  card: Side | null;
  controls: boolean;
  /** At most one context hint at a time. */
  hint: ContextHint | null;
  /** The narrator's line. */
  caption: string | null;
}

export const EMPTY_VIEW: OnboardingView = { card: null, controls: false, hint: null, caption: null };

export const atFaceEdge = (x: number, y: number): boolean => x <= 0 || y <= 0 || x >= FACE_SIZE - 1 || y >= FACE_SIZE - 1;

export interface Onboarding {
  step(s: Snapshot): OnboardingView;
  /** What has been shown this session (for tests and debugging). */
  seen(): string[];
}

/** One per page load: its memory IS "once per session". */
export function createOnboarding(): Onboarding {
  const seen = new Set<string>();
  let gameId: number | null = null;
  let games = 0;
  let startedAt = 0;
  let last: GameSnapshot | null = null;
  let solvedAtStart = 0;
  let solveSaid = false;

  let moved = false;
  let interacted = false;
  let controlsSince: number | null = null;

  let card: { side: Side; since: number; moved: boolean } | null = null;
  let hint: { id: ContextHint; since: number } | null = null;
  let hintFreeAt = 0;
  let caption: { text: string; since: number } | null = null;

  function step(s: Snapshot): OnboardingView {
    const g = s.game;
    if (!g) {
      // off the game screen: nothing is shown, and the previous position is forgotten
      last = null;
      card = null;
      hint = null;
      caption = null;
      controlsSince = null;
      return EMPTY_VIEW;
    }

    // The room says "playing" a moment before the new game's state arrives, so the id can
    // change right after a start: that is still the same start.
    if (g.id !== gameId && gameId !== null && last && s.now - startedAt < START_SETTLE_MS) {
      gameId = g.id;
      solvedAtStart = g.solved;
    }
    if (g.id !== gameId) {
      gameId = g.id;
      startedAt = s.now;
      last = null;
      solvedAtStart = g.solved;
      solveSaid = false;
      caption = { text: narratorLine(NARRATOR.intro[g.side], games), since: s.now };
      games++;
      const key = `card:${g.side}`;
      card = s.hints && !seen.has(key) ? { side: g.side, since: s.now, moved: false } : null;
      if (card) seen.add(key);
    }

    const stepped = !!last && (last.x !== g.x || last.y !== g.y || last.face !== g.face);
    const folded = !!last && last.face !== g.face;
    if (stepped) moved = true;
    if (s.interacted) interacted = true;
    if (stepped && card) card.moved = true;

    // the narrator's second line: the first solve of this game
    if (!solveSaid && g.solved > solvedAtStart) {
      solveSaid = true;
      caption = { text: narratorLine(NARRATOR.firstSolve, games - 1), since: s.now };
    }
    if (caption && s.now - caption.since >= CAPTION_MS) caption = null;

    // folding onto another face teaches the edge hint better than the hint does
    if (folded) {
      seen.add('edge');
      if (hint?.id === 'edge') hint = null;
    }
    // controls: done once the player has moved and interacted, shown or not
    if (moved && interacted) seen.add('controls');

    if (!s.hints || g.won) {
      // hints off (or the win screen is up): everything goes at once. A hint that has not
      // been shown yet is not used up, so it can still show once the setting is back on.
      card = null;
      hint = null;
      controlsSince = null;
      last = g;
      return { ...EMPTY_VIEW, caption: g.won ? null : (caption?.text ?? null) };
    }

    if (card && ((card.moved && s.now - card.since >= CARD_MIN_MS) || s.now - card.since >= CARD_MAX_MS)) card = null;

    if (!seen.has('controls')) {
      controlsSince ??= s.now;
      if (s.now - controlsSince >= CONTROLS_MAX_MS) seen.add('controls');
    }

    if (hint && s.now - hint.since >= HINT_MS) {
      hint = null;
      hintFreeAt = s.now + HINT_GAP_MS;
    }
    // One context hint at a time, never under the side card. A hint shows when its moment
    // is true right now and the slot is free; if the slot is busy the moment simply comes
    // again later (the next edge, the next time the voice drops).
    if (!hint && !card && s.now >= hintFreeAt) {
      const due: Record<ContextHint, boolean> = {
        cube: true, // the HUD is on screen whenever a game is
        edge: atFaceEdge(g.x, g.y),
        voice: g.gain !== null && g.gain < 1,
      };
      const id = CONTEXT_ORDER.find((h) => due[h] && !seen.has(h));
      if (id) {
        seen.add(id);
        hint = { id, since: s.now };
      }
    }

    last = g;
    return { card: card?.side ?? null, controls: !seen.has('controls'), hint: hint?.id ?? null, caption: caption?.text ?? null };
  }

  return { step, seen: () => [...seen] };
}
