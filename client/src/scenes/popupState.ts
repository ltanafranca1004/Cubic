import type { MenuAction } from '../input/keymap';

// What the mode screen's popups keep over a rebuild, and how the keyboard walks the solo
// popup. Pure: no Phaser, no DOM (client/test/solo.test.ts).

/** Where the keyboard is in the solo popup. `resume` only exists while a left game is held. */
export type SoloFocus = 'out' | 'in' | 'resume' | 'cancel';

/**
 * What an open popup hands over when a resize or rotation rebuilds the scene under it
 * (MenuScene restarts the scene on the one re-fit): enough to put the same popup back,
 * where the player was, without it dropping in again.
 */
export type PopupDraft = { kind: 'join'; code: string } | { kind: 'solo'; focus: SoloFocus };

export interface Restorable {
  /** Still up (not cancelled). */
  readonly open: boolean;
  draft(): PopupDraft;
}

/** The popup to put back after a rebuild, or null: nothing was open, or the scene is new. */
export function draftOf(popup: Restorable | null, rebuilt: boolean | undefined): PopupDraft | null {
  return rebuilt && popup?.open ? popup.draft() : null;
}

/** The solo popup, top to bottom and left to right: the order Tab walks. */
export function soloOrder(resume: boolean): SoloFocus[] {
  return resume ? ['out', 'in', 'resume', 'cancel'] : ['out', 'in', 'cancel'];
}

/**
 * Where a key moves the focus in the solo popup. Left and right pick between the two
 * sides, down and up walk the rows (the sides, CONTINUE when there is one, CANCEL), Tab
 * walks everything in order and wraps.
 */
export function soloFocus(focus: SoloFocus, action: MenuAction | null, resume: boolean): SoloFocus {
  const order = soloOrder(resume);
  // a rebuild may come back after the held game ran out
  const at = order.includes(focus) ? focus : 'out';
  const side = at === 'out' || at === 'in';
  switch (action) {
    case 'left':
      return 'out';
    case 'right':
      return 'in';
    case 'down':
      return side ? (resume ? 'resume' : 'cancel') : 'cancel';
    case 'up':
      return side ? at : at === 'cancel' && resume ? 'resume' : 'out';
    case 'next':
      return order[(order.indexOf(at) + 1) % order.length]!;
    case 'prev':
      return order[(order.indexOf(at) + order.length - 1) % order.length]!;
    default:
      return at;
  }
}
