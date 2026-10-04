import type { VisibleObject } from '../types';
import { at, type XY } from '../util';

// KEYPAD: digit keys, an ENTER key and a display, pressed with E (onUse).
// Map objects: type "key" with name "0".."9" or "enter", one per tile; type "display", one
// per digit (left to right by x). State: a KeypadState inside your puzzle state.
//
//   onUse(s, ctx, side, tile) {
//     const name = keyAt(ctx.objects('in', FACE, 'key'), tile);
//     if (side !== 'in' || name === null) return;
//     const res = keypadUse(s.pad, name);
//     if (res.kind !== 'submit') return;
//     if (res.code === code(ctx)) keypadLock(s.pad, res.code); // solved: stays green
//     else ctx.strike(side); // the display is already cleared
//   },
//   visible: (s, ctx, side) => (side === 'in' ? keypadVisible(s.pad, ctx.objects('in', FACE, 'key'), ctx.objects('in', FACE, 'display')) : []),
//
// What keypadVisible returns (the client picks art by type + state):
//   { type: 'key', state: '<name>' }          idle, e.g. '7' or 'enter'
//   { type: 'key', state: '<name>-green' }    after keypadLock
//   { type: 'display', state: 'empty' | '<digit>' | '<digit>-green' }

/** Most digits a keypad takes. */
export const KEYPAD_MAX = 3;

export interface KeypadState {
  /** Digits typed so far, e.g. "42". After keypadLock: the accepted code. */
  typed: string;
  /** Set by keypadLock: the keypad no longer reacts. */
  locked: boolean;
}

export type KeypadResult =
  /** Nothing happened: locked, display full, ENTER on an empty display, or not a key. */
  | { kind: 'none' }
  | { kind: 'typed'; digit: string }
  /** ENTER with at least one digit. The display is cleared; call keypadLock if `code` is right. */
  | { kind: 'submit'; code: string };

export const newKeypad = (): KeypadState => ({ typed: '', locked: false });

/** The name of the key on `tile` ("0".."9", "enter"), or null. `keys` = ctx.objects(side, face, 'key'). */
export const keyAt = (keys: readonly (XY & { name: string })[], tile: XY): string | null => keys.find((k) => at(k, tile))?.name ?? null;

/** Press the key called `name`. Mutates `k`. */
export function keypadUse(k: KeypadState, name: string, max: number = KEYPAD_MAX): KeypadResult {
  if (k.locked) return { kind: 'none' };
  if (name === 'enter') {
    if (!k.typed) return { kind: 'none' };
    const code = k.typed;
    k.typed = '';
    return { kind: 'submit', code };
  }
  if (!/^[0-9]$/.test(name) || k.typed.length >= max) return { kind: 'none' };
  k.typed += name;
  return { kind: 'typed', digit: name };
}

/** The code was right: show it for good, in green, and stop reacting. */
export function keypadLock(k: KeypadState, code: string): void {
  k.typed = code;
  k.locked = true;
}

/** The keys and the display cells as the keypad's side sees them. */
export function keypadVisible(k: KeypadState, keys: readonly (XY & { name: string })[], displays: readonly XY[]): VisibleObject[] {
  const green = k.locked ? '-green' : '';
  const cells = [...displays].sort((a, b) => a.x - b.x || a.y - b.y);
  return [
    ...keys.map((o) => ({ type: 'key', x: o.x, y: o.y, state: `${o.name}${green}` })),
    ...cells.map((o, i) => ({ type: 'display', x: o.x, y: o.y, state: k.typed[i] === undefined ? 'empty' : `${k.typed[i]}${green}` })),
  ];
}
