import { keyId } from '../input/bindings';
import { DIR_VEC, gameAction, type KeyLike } from '../input/keymap';
import type { Buffered } from './transition';

// THE GAME'S KEYS, without Phaser (the tests drive this file with plain objects). It turns
// key presses into what the game scene sends: steps, interact, drop and push-to-talk. What
// a key means comes from gameAction (input/keymap.ts), so the player's own bindings, the
// arrow keys, the gamepad and the touch controls all arrive here the same way.
//
// Everything that changes the world (a step, E, Q) goes out through `act`, which the scene
// routes through its InputBuffer: a press made during a face transition is applied after
// it, in the order it was pressed.

export interface GameKeysOut {
  /** A fresh press. `fresh` moves restart the held-key repeat. */
  act(input: Buffered): void;
  /** Push-to-talk went down or up. */
  talk(down: boolean): void;
}

export class GameKeys {
  /** Held direction keys, most recent last. */
  private held: { id: string; dx: number; dy: number }[] = [];
  /** The key that is holding push-to-talk down. */
  private talkId: string | null = null;

  constructor(private out: GameKeysOut) {}

  /** A key went down. Returns 'move' for a fresh step (the caller restarts its repeat clock), 'used' for any other game key, else null. */
  down(e: KeyLike): 'move' | 'used' | null {
    const action = gameAction(e);
    if (!action) return null;
    const id = keyId(e);
    switch (action.type) {
      case 'move': {
        if (this.held.some((h) => h.id === id)) return 'used'; // the key's own auto-repeat
        const [dx, dy] = DIR_VEC[action.dir];
        this.held.push({ id, dx, dy });
        this.out.act({ kind: 'move', dx, dy });
        return 'move';
      }
      case 'interact':
        this.out.act({ kind: 'interact' });
        return 'used';
      case 'drop':
        this.out.act({ kind: 'interact', only: 'drop' });
        return 'used';
      case 'talk':
        if (!e.repeat && this.talkId === null) {
          this.talkId = id;
          this.out.talk(true);
        }
        return 'used';
      default:
        return null; // chat, pause, map, mute, quick chat: the UI's (ui/cubicUI.ts)
    }
  }

  up(e: KeyLike): void {
    const id = keyId(e);
    this.held = this.held.filter((h) => h.id !== id);
    if (this.talkId === id) {
      this.talkId = null;
      this.out.talk(false);
    }
  }

  /** The direction of the key held last, if any. */
  heldDir(): { dx: number; dy: number } | null {
    return this.held[this.held.length - 1] ?? null;
  }

  /** Let go of the direction keys (typing, a menu on top). */
  releaseMoves(): void {
    this.held = [];
  }

  /** Let go of everything (the window lost the focus). */
  releaseAll(): void {
    this.held = [];
    this.talkId = null;
    this.out.talk(false);
  }
}
