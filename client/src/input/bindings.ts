import type { KeyLike } from './keymap';

// KEY BINDINGS. Which keyboard key does which game action, and the one resolver every key
// path goes through (`actionFor`). Pure apart from `sendAction`: no DOM state, no Phaser,
// so the rules are tested (client/test/bindings.test.ts).
//
// The player can rebind the actions below in the settings (Controls). Esc (pause, back),
// Enter (chat) and the arrow keys (always a second way to move) are fixed.
//
// GAMEPAD AND TOUCH are not rebindable and must work whatever the keyboard bindings are.
// They play through synthetic KeyboardEvents, and there are two ways to send one:
//   1. sendAction('drop', 'keydown')   the event carries the action itself, the key is
//                                      only for show. Preferred.
//   2. a plain synthetic event with the DEFAULT key (new KeyboardEvent('keydown',
//      { key: 'q' })). An event the browser did not make (isTrusted === false) is always
//      read with DEFAULT_BINDINGS, never with the player's own. input/gamepad.ts does this.

export const BIND_ACTIONS = ['up', 'down', 'left', 'right', 'interact', 'drop', 'talk', 'mute', 'map', 'quick1', 'quick2', 'quick3', 'quick4'] as const;
export type BindAction = (typeof BIND_ACTIONS)[number];
/** One key id (see `keyId`) per action. No two actions share a key. */
export type Bindings = Record<BindAction, string>;

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd',
  interact: 'e',
  drop: 'q',
  talk: 'v',
  mute: 'm',
  map: 'tab',
  quick1: '1',
  quick2: '2',
  quick3: '3',
  quick4: '4',
};

/** What each action is called in the settings and in the pause menu. */
export const ACTION_LABEL: Record<BindAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  interact: 'Pick up / use',
  drop: 'Drop',
  talk: 'Push to talk',
  mute: 'Mute mic',
  map: 'Cube map',
  quick1: 'Say "Here!"',
  quick2: 'Say "Wait"',
  quick3: 'Say "Yes"',
  quick4: 'Say "No"',
};

/** Keys with a fixed meaning: never bindable. */
const FIXED = new Set(['escape', 'enter', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
/** Keys that are not a press of their own, or that belong to the browser or the system. */
const NOT_A_KEY = new Set(['shift', 'control', 'alt', 'altgraph', 'meta', 'os', 'capslock', 'numlock', 'scrolllock', 'fn', 'dead', 'unidentified', 'process', 'contextmenu', '']);

/**
 * The id of the key an event is about: its `key` in lower case, "space" for the space
 * bar, and the digit itself for the number row and the numpad (by physical key, so 1 to 4
 * work on layouts where the number row types something else).
 */
export function keyId(e: KeyLike): string {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code ?? '');
  if (digit) return digit[1]!;
  if (e.key === ' ' || e.key === 'Spacebar') return 'space';
  return e.key.toLowerCase();
}

/** Can this key be given to an action? Not Esc, Enter, the arrows, a modifier or an F key. */
export function canBind(id: string): boolean {
  return !FIXED.has(id) && !NOT_A_KEY.has(id) && !/^f\d{1,2}$/.test(id);
}

/** How a key id is written on screen: "W", "Tab", "Space". */
export function keyName(id: string): string {
  if (id.length === 1) return id.toUpperCase();
  const named: Record<string, string> = { space: 'Space', tab: 'Tab', backspace: 'Bksp', delete: 'Del', escape: 'Esc', enter: 'Enter', pageup: 'PgUp', pagedown: 'PgDn', insert: 'Ins' };
  return named[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

// ---------- the live bindings ----------

let live: Bindings = { ...DEFAULT_BINDINGS };

/** The bindings in use right now. */
export const bindings = (): Readonly<Bindings> => live;

/** Set the bindings in use (style/settings.ts calls this when the setting loads or changes). */
export function useBindings(next: Readonly<Bindings>): void {
  live = { ...next };
}

/** The label of the key an action is on right now, for every place that shows a key. */
export function keyLabel(action: BindAction, b: Readonly<Bindings> = live): string {
  return keyName(b[action]);
}

/**
 * The key an action is on right now, as a `KeyboardEvent.key` value ("w", "Tab", " ").
 * Use it to show or to dispatch the bound key; `sendAction` is the safer way to send one.
 */
export function keyFor(action: BindAction, b: Readonly<Bindings> = live): string {
  const id = b[action];
  return id === 'space' ? ' ' : id === 'tab' ? 'Tab' : id;
}

// ---------- resolving a key ----------

/** The property a synthetic event carries its action in (see `sendAction`). */
export const ACTION_MARK = 'cubicAction';

const isAction = (v: unknown): v is BindAction => typeof v === 'string' && (BIND_ACTIONS as readonly string[]).includes(v);

/**
 * THE RESOLVER: the bindable action a key event stands for, or null. Every key path uses
 * it (through `gameAction` in keymap.ts). In order: an event that names its action
 * (`sendAction`), then an untrusted (synthetic) event read with the default keys, then
 * the player's own bindings.
 */
export function actionFor(e: KeyLike, b: Readonly<Bindings> = live): BindAction | null {
  const marked = (e as unknown as Record<string, unknown>)[ACTION_MARK];
  if (isAction(marked)) return marked;
  const id = keyId(e);
  const table = e.isTrusted === false ? DEFAULT_BINDINGS : b;
  return BIND_ACTIONS.find((a) => table[a] === id) ?? null;
}

/**
 * Press or release an action from code (touch controls, a gamepad). The event carries the
 * action, so it does the same thing whatever the keyboard bindings are, also if they
 * change between the press and the release.
 */
export function sendAction(action: BindAction, type: 'keydown' | 'keyup', target?: ActionTarget): void {
  // (the browser's own names, typed here by shape: this file is also compiled without the DOM, for the tests)
  const dom = globalThis as unknown as { KeyboardEvent: new (type: string, init: object) => object; document: { activeElement: ActionTarget | null; body: ActionTarget } };
  const e = new dom.KeyboardEvent(type, { key: keyFor(action), bubbles: true, cancelable: true });
  Object.defineProperty(e, ACTION_MARK, { value: action });
  (target ?? dom.document.activeElement ?? dom.document.body).dispatchEvent(e as never);
}

/** Anything a key event can be sent to: an element, the document, the window. */
export interface ActionTarget {
  dispatchEvent(event: never): boolean;
}

// ---------- changing them ----------

/**
 * Give `action` the key `id`. If another action has that key, the two swap, so nothing is
 * ever left without a key; `swapped` names the other one. A key that cannot be bound
 * changes nothing.
 */
export function rebind(b: Readonly<Bindings>, action: BindAction, id: string): { bindings: Bindings; swapped: BindAction | null } {
  if (!canBind(id) || b[action] === id) return { bindings: { ...b }, swapped: null };
  const other = BIND_ACTIONS.find((a) => a !== action && b[a] === id) ?? null;
  const next = { ...b, [action]: id };
  if (other) next[other] = b[action];
  return { bindings: next, swapped: other };
}

/** Saved bindings, checked: every action has a bindable key and no key is used twice. Else the defaults. */
export function cleanBindings(raw: unknown): Bindings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BINDINGS };
  const r = raw as Record<string, unknown>;
  const out = {} as Bindings;
  for (const a of BIND_ACTIONS) {
    const id = r[a];
    if (typeof id !== 'string' || !canBind(id)) return { ...DEFAULT_BINDINGS };
    out[a] = id;
  }
  return new Set(Object.values(out)).size === BIND_ACTIONS.length ? out : { ...DEFAULT_BINDINGS };
}

export const sameBindings = (a: Readonly<Bindings>, b: Readonly<Bindings>): boolean => BIND_ACTIONS.every((k) => a[k] === b[k]);
