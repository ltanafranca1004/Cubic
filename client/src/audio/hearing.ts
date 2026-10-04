import type { GameEvent, GameState, Side } from '@cubic/shared';

// WHO HEARS WHAT. Sound follows the cube: the partner is on the other side of a wall, so
// what they do is only heard through that wall. No DOM in here, so the tests can import it.
//
//  - The partner's footsteps are heard only while they are on the same face number as you
//    (outside N and inside N are the two sides of one wall). Any other face: silent.
//    The same goes for the small sounds of their hands: E on a puzzle tile (`use`) and a
//    box being pushed (`push`).
//  - The face-change ding is yours alone: the partner's never plays for you.
//  - Everything else (your own sounds, puzzle and game events) is heard as before.

/** Should `me` hear the sound of this event? `state` is the game after the event. */
export function hears(event: GameEvent, me: Side, state: GameState): boolean {
  if (!('side' in event) || event.side === me) return true;
  if (event.type === 'flip') return false;
  if (event.type === 'step' || event.type === 'use' || event.type === 'push') return state.players[event.side].pose.face === state.players[me].pose.face;
  return true;
}

/**
 * The effect a game event plays (a key of the synthesized table in game/sfx.ts), or null
 * for none. `known` says which keys exist: a puzzle event with no sound of its own gets
 * the generic `puzzle` blip.
 */
export function sfxFor(event: GameEvent, known: (id: string) => boolean): string | null {
  // The solved sting is a sample, played once per batch by the caller.
  if (event.type === 'solve') return null;
  if (event.type === 'puzzle') return known(event.name) ? event.name : 'puzzle';
  return known(event.type) ? event.type : null;
}

/** The effects `me` hears for a batch of events, in order. */
export function heardSfx(events: readonly GameEvent[], me: Side, state: GameState, known: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of events) {
    const id = hears(e, me, state) ? sfxFor(e, known) : null;
    if (id) out.push(id);
  }
  return out;
}
