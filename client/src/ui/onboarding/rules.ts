import { FACE_SIZE, type Side } from '@cubic/shared';
import { NARRATOR, narratorLine } from '../../content/narrator';
import { keyLabel, type Bindings } from '../../input/bindings';
import { moveKeys } from '../../input/keymap';

// THE HINT RULES: what is on screen, and when. Pure: no DOM, no Phaser, no timers, no
// clock of its own. The DOM layer (index.ts) feeds it a snapshot a few times a second and
// draws the view it returns. test/onboarding.test.ts covers every rule in this file.
//
//   side card      at the start of a game, once per side per session. It goes by itself,
//                  or at once when the player dismisses it (GOT IT, Esc, a click outside)
//   controls       at the first spawn, for CONTROLS_MS or until the first move, whichever
//                  comes first. Once it has gone it never comes back: not on another
//                  face, not after a solve or a strike, not in the next game, and not
//                  after a reload in the middle of the same game (controlsSeenFor)
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
  /** The button that closes the side card. */
  cardDismiss: 'Got it',
};

/** The keys of the brief, as they are bound right now (the default: the player's own bindings). */
export function controlsHint(b?: Readonly<Bindings>): { keys: string[]; does: string }[] {
  return [
    { keys: [moveKeys(b), 'Arrows'], does: 'move' },
    { keys: [keyLabel('interact', b)], does: 'interact' },
    { keys: [keyLabel('drop', b)], does: 'drop' },
    { keys: ['Enter'], does: 'chat' },
    { keys: [keyLabel('talk', b)], does: 'talk' },
  ];
}

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
/** The controls hint sits over the bottom of the map, so it only stays this long. */
export const CONTROLS_MS = 3000;
/** How long a part of the layer takes to fade (css.ts), and with "Reduce motion": not at all. */
export const FADE_MS = 320;
export const fadeMs = (reduceMotion: boolean): number => (reduceMotion ? 0 : FADE_MS);

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
  /** The player pressed a move key since the last snapshot (a step into a wall counts too). */
  moved: boolean;
  /** The player closed the side card since the last snapshot (GOT IT, Esc, a click outside). */
  dismissed?: boolean;
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

export interface OnboardingMemory {
  /** The game (GameSnapshot.id) whose controls hint this tab has already shown: a reload or a rejoin in the middle of it does not bring the hint back. */
  controlsSeenFor?: number | null;
}

/** One per page load: its memory IS "once per session". */
export function createOnboarding(memory: OnboardingMemory = {}): Onboarding {
  const seen = new Set<string>();
  let gameId: number | null = null;
  let games = 0;
  let startedAt = 0;
  let last: GameSnapshot | null = null;
  let solvedAtStart = 0;
  let solveSaid = false;

  /** Since when the controls hint is up; null while it is not. */
  let controlsSince: number | null = null;

  let card: { side: Side; since: number; moved: boolean } | null = null;
  let hint: { id: ContextHint; since: number } | null = null;
  let hintFreeAt = 0;
  let caption: { text: string; since: number } | null = null;

  /** The controls hint goes. If it was up, that was its one time: it does not come back. */
  function controlsOff(): void {
    if (controlsSince !== null) seen.add('controls');
    controlsSince = null;
  }

  function step(s: Snapshot): OnboardingView {
    const g = s.game;
    if (!g) {
      // off the game screen: nothing is shown, and the previous position is forgotten
      last = null;
      card = null;
      hint = null;
      caption = null;
      controlsOff();
      return EMPTY_VIEW;
    }

    // The room says "playing" a moment before the new game's state arrives, so the id can
    // change right after a start: that is still the same start.
    if (g.id !== gameId && gameId !== null && last && s.now - startedAt < START_SETTLE_MS) {
      gameId = g.id;
      solvedAtStart = g.solved;
    }
    if (g.id === memory.controlsSeenFor) seen.add('controls'); // this game, before a reload
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
    if (!s.hints || g.won) {
      // hints off (or the win screen is up): everything goes at once. A hint that has not
      // been shown yet is not used up, so it can still show once the setting is back on.
      // (The controls hint that WAS up is used up: once gone, it stays gone.)
      card = null;
      hint = null;
      controlsOff();
      last = g;
      return { ...EMPTY_VIEW, caption: g.won ? null : (caption?.text ?? null) };
    }

    if (card && (s.dismissed || (card.moved && s.now - card.since >= CARD_MIN_MS) || s.now - card.since >= CARD_MAX_MS)) card = null;

    // controls: up from the first snapshot, gone at the first move or after CONTROLS_MS
    if (!seen.has('controls')) {
      controlsSince ??= s.now;
      if (stepped || s.moved || s.now - controlsSince >= CONTROLS_MS) controlsOff();
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
