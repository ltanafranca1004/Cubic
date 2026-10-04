// INPUT MAPPING. What every key and gamepad button means, as pure functions with no DOM
// and no Phaser, so the rules can be tested (client/test/input.test.ts). The listeners
// that feed them live in ui/cubicUI.ts (keys), input/gamepad.ts (pad) and the menu scenes.

/** The parts of a KeyboardEvent the mapping reads. */
export interface KeyLike {
  key: string;
  code?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
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
  /** F: a ping marker on your tile. */
  | { type: 'ping' }
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

function rawGameAction(e: KeyLike): GameAction | null {
  const dir = keyDir(e);
  if (dir) return { type: 'move', dir };
  const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code ?? '') ?? /^([1-4])$/.exec(e.key);
  if (digit) return { type: 'quick', index: (Number(digit[1]) - 1) as 0 | 1 | 2 | 3 };
  switch (e.key.toLowerCase()) {
    case 'e':
      return { type: 'interact' };
    case 'q':
      return { type: 'drop' };
    case 'f':
      return { type: 'ping' };
    case 'm':
      return { type: 'mute' };
    case 'v':
      return { type: 'talk' };
    case 'enter':
      return { type: 'chat' };
    case 'escape':
      return { type: 'pause' };
    case 'tab':
      return { type: 'map' };
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

// ---------- gamepad ----------

/** A pad as the Gamepad API reports it, in the standard mapping. */
export interface PadLike {
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

export type PadInput = Dir | 'a' | 'b' | 'x' | 'start';
/** How far the stick must lean before it counts. */
export const STICK_DEADZONE = 0.5;
/** Standard-mapping button numbers. */
const PAD_BUTTON = { a: 0, b: 1, x: 2, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

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
  for (const b of ['a', 'b', 'x', 'start'] as const) if (on(PAD_BUTTON[b])) out.push(b);
  return out;
}

/**
 * The pad plays through the keyboard's own mapping: each input stands for a key.
 * Stick or d-pad = arrows. In game: A = E (interact), B = Q (drop), X = F (ping),
 * Start = Esc (pause). In a menu: A = Enter (select), B and Start = Esc (back).
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
    case 'a':
      return where === 'game' ? 'e' : 'Enter';
    case 'b':
      return where === 'game' ? 'q' : 'Escape';
    case 'x':
      return where === 'game' ? 'f' : '';
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
  keys: string;
  pad?: string;
  does: string;
  /** The game action this line documents (the test checks none is missing). */
  action: GameAction['type'];
}

export const CONTROLS: readonly ControlLine[] = [
  { keys: 'WASD / Arrows', pad: 'Stick / D-pad', does: 'Move', action: 'move' },
  { keys: 'E', pad: 'A', does: 'Pick up / use', action: 'interact' },
  { keys: 'Q', pad: 'B', does: 'Drop', action: 'drop' },
  { keys: 'F', pad: 'X', does: 'Ping your tile', action: 'ping' },
  { keys: '1 2 3 4', does: 'Here! / Wait / Yes / No', action: 'quick' },
  { keys: 'Enter', does: 'Chat (Enter sends, Esc closes)', action: 'chat' },
  { keys: 'V (hold)', does: 'Push to talk', action: 'talk' },
  { keys: 'M', does: 'Mute mic', action: 'mute' },
  { keys: 'Tab (hold)', does: 'Cube map (arrows turn it)', action: 'map' },
  { keys: 'Esc', pad: 'Start', does: 'Pause', action: 'pause' },
];
