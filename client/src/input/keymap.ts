// INPUT MAPPING. What every key and gamepad button means, as pure functions with no DOM
// and no Phaser, so the rules can be tested (client/test/input.test.ts). The listeners
// that feed them live in ui/cubicUI.ts (keys), game/keys.ts (movement and the buffered
// actions), input/gamepad.ts (pad) and the menu scenes. Which key is which game action is
// in input/bindings.ts (the player can change them); the menus keep fixed keys.
import { actionFor, keyFor, keyLabel, type BindAction, type Bindings } from './bindings';

/** The parts of a KeyboardEvent the mapping reads. */
export interface KeyLike {
  key: string;
  code?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** False on a synthetic event (gamepad, touch): those speak the default keys (bindings.ts). */
  isTrusted?: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIR_VEC: Record<Dir, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const ARROWS: Record<string, Dir> = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
const WASD: Record<string, Dir> = { w: 'up', s: 'down', a: 'left', d: 'right' };

const modified = (e: KeyLike) => !!(e.ctrlKey || e.metaKey || e.altKey);

/** The direction a key stands for. `letters: false` reads the arrows only (typing a code). */
export function keyDir(e: KeyLike, letters = true): Dir | null {
  const k = e.key.toLowerCase();
  return ARROWS[k] ?? (letters ? WASD[k] : undefined) ?? null;
}

// ---------- in game ----------

export type GameAction =
  | { type: 'move'; dir: Dir }
  /** E: pick up, or use what is here. */
  | { type: 'interact' }
  /** Q: put down what you carry. */
  | { type: 'drop' }
  /** 1 to 4: a quick-chat line (index 0..3). */
  | { type: 'quick'; index: 0 | 1 | 2 | 3 }
  /** M: mute or unmute the mic. */
  | { type: 'mute' }
  /** V, held: push to talk. */
  | { type: 'talk' }
  /** Enter: open the chat field. */
  | { type: 'chat' }
  /** Esc: the pause menu. */
  | { type: 'pause' }
  /** Tab, held: the full cube map. */
  | { type: 'map' };

/** Actions that mean something while the key stays down; the rest fire once per press. */
const HELD: ReadonlySet<GameAction['type']> = new Set(['move', 'talk', 'map']);

/** What a key does while playing (not typing, no menu open). Null = not a game key. */
export function gameAction(e: KeyLike): GameAction | null {
  if (modified(e)) return null;
  const a = rawGameAction(e);
  if (a && e.repeat && !HELD.has(a.type)) return null;
  return a;
}

const BOUND: Record<BindAction, GameAction> = {
  up: { type: 'move', dir: 'up' },
  down: { type: 'move', dir: 'down' },
  left: { type: 'move', dir: 'left' },
  right: { type: 'move', dir: 'right' },
  interact: { type: 'interact' },
  drop: { type: 'drop' },
  talk: { type: 'talk' },
  mute: { type: 'mute' },
  map: { type: 'map' },
  quick1: { type: 'quick', index: 0 },
  quick2: { type: 'quick', index: 1 },
  quick3: { type: 'quick', index: 2 },
  quick4: { type: 'quick', index: 3 },
};

function rawGameAction(e: KeyLike): GameAction | null {
  // the player's bindings first (bindings.ts), then the keys that are never rebound
  const bound = actionFor(e);
  if (bound) return BOUND[bound];
  const arrow = keyDir(e, false);
  if (arrow) return { type: 'move', dir: arrow };
  switch (e.key) {
    case 'Enter':
      return { type: 'chat' };
    case 'Escape':
      return { type: 'pause' };
    default:
      return null;
  }
}

// ---------- menus ----------

export type MenuAction = Dir | 'select' | 'back' | 'next' | 'prev';

/**
 * What a key does in a menu, a popup or a panel: arrows or WASD move the focus, Enter or
 * Space select, Esc goes back, Tab walks on. `letters: false` while a code is being
 * typed: then only the arrows move and Space is not a select.
 */
export function menuAction(e: KeyLike, letters = true): MenuAction | null {
  if (modified(e)) return null;
  const dir = keyDir(e, letters);
  if (dir) return dir;
  switch (e.key) {
    case 'Enter':
      return 'select';
    case ' ':
    case 'Spacebar':
      return letters ? 'select' : null;
    case 'Escape':
      return 'back';
    case 'Tab':
      return e.shiftKey ? 'prev' : 'next';
    default:
      return null;
  }
}

/** Move a focus index by `delta` in a list of `count`. It stops at the ends, or wraps. */
export function stepFocus(index: number, count: number, delta: number, wrap = false): number {
  if (count <= 0) return -1;
  if (index < 0) return delta < 0 && wrap ? count - 1 : 0; // nothing focused yet: start at the top
  const next = index + delta;
  if (wrap) return ((next % count) + count) % count;
  return Math.min(count - 1, Math.max(0, next));
}

/** The join popup's code field: what a key does to the code typed so far. */
export function typeCode(code: string, e: KeyLike, length = 4): string {
  if (modified(e)) return code;
  if (e.key === 'Backspace') return code.slice(0, -1);
  if (/^[a-zA-Z]$/.test(e.key) && code.length < length) return code + e.key.toUpperCase();
  return code;
}

/**
 * The join popup's code field: what pasted text becomes. A word of exactly `length`
 * capitals standing on its own is the code as the game shows it ("Join me: QZWK"), so it
 * wins; otherwise the letters, upper-cased and cut to length.
 */
export function pasteCode(text: string, length = 4): string {
  const shown = text.match(new RegExp(`(?<![A-Za-z])[A-Z]{${length}}(?![A-Za-z])`));
  return (shown?.[0] ?? text.replace(/[^a-zA-Z]/g, '')).toUpperCase().slice(0, length);
}

// ---------- gamepad ----------

/** A pad as the Gamepad API reports it, in the standard mapping. */
export interface PadLike {
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

export type PadInput = Dir | 'a' | 'b' | 'start';
/** How far the stick must lean before it counts. */
export const STICK_DEADZONE = 0.5;
/** Standard-mapping button numbers. */
const PAD_BUTTON = { a: 0, b: 1, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

/** What is held on the pad right now. The stick gives one direction: the stronger axis. */
export function padInputs(pad: PadLike): PadInput[] {
  const on = (i: number) => !!pad.buttons[i]?.pressed;
  const out: PadInput[] = [];
  let dir: Dir | null = on(PAD_BUTTON.up) ? 'up' : on(PAD_BUTTON.down) ? 'down' : on(PAD_BUTTON.left) ? 'left' : on(PAD_BUTTON.right) ? 'right' : null;
  if (!dir) {
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) >= STICK_DEADZONE) dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
  }
  if (dir) out.push(dir);
  for (const b of ['a', 'b', 'start'] as const) if (on(PAD_BUTTON[b])) out.push(b);
  return out;
}

/**
 * The pad plays through the keyboard's own mapping: each input stands for a key.
 * Stick or d-pad = arrows. In game: A = E (interact), B = Q (drop), Start = Esc (pause). In a menu: A = Enter (select), B and Start = Esc (back).
 */
export function padKey(input: PadInput, where: 'game' | 'menu'): string {
  switch (input) {
    case 'up':
      return 'ArrowUp';
    case 'down':
      return 'ArrowDown';
    case 'left':
      return 'ArrowLeft';
    case 'right':
      return 'ArrowRight';
    // (default keys: a synthetic event is read with the default bindings, see bindings.ts)
    case 'a':
      return where === 'game' ? 'e' : 'Enter';
    case 'b':
      return where === 'game' ? 'q' : 'Escape';
    case 'start':
      return 'Escape';
  }
}

/** Which inputs went down and which came up between two polls. */
export function padEdges(before: readonly PadInput[], now: readonly PadInput[]): { down: PadInput[]; up: PadInput[] } {
  return { down: now.filter((i) => !before.includes(i)), up: before.filter((i) => !now.includes(i)) };
}

// ---------- the controls reference (pause menu) ----------

export interface ControlLine {
  /** What it does, as a short name. */
  does: string;
  /** The key or keys, as shown: the live binding. */
  keys: string;
  /** The same on a gamepad, if it has one. */
  pad?: string;
  /** The game action this line documents (the test checks none is missing). */
  action: GameAction['type'];
}

/** The four move keys as one word when they are single letters ("WASD"), else spaced. */
export function moveKeys(b?: Readonly<Bindings>): string {
  const keys = (['up', 'left', 'down', 'right'] as const).map((a) => keyLabel(a, b));
  return keys.join(keys.every((k) => k.length === 1) ? '' : ' ');
}

/** The controls as they are bound right now. Short lines: the pause menu shows them as a table. */
export function controls(b?: Readonly<Bindings>): ControlLine[] {
  const k = (a: BindAction) => keyLabel(a, b);
  return [
    { does: 'Move', keys: `${moveKeys(b)} / Arrows`, pad: 'Stick', action: 'move' },
    { does: 'Pick up / use', keys: k('interact'), pad: 'A', action: 'interact' },
    { does: 'Drop', keys: k('drop'), pad: 'B', action: 'drop' },
    { does: 'Quick chat', keys: (['quick1', 'quick2', 'quick3', 'quick4'] as const).map(k).join(' '), action: 'quick' },
    { does: 'Chat', keys: 'Enter', action: 'chat' },
    { does: 'Push to talk', keys: k('talk'), action: 'talk' },
    { does: 'Mute mic', keys: k('mute'), action: 'mute' },
    { does: 'Cube map', keys: k('map'), action: 'map' },
    { does: 'Pause', keys: 'Esc', pad: 'Start', action: 'pause' },
  ];
}

export { keyFor };
