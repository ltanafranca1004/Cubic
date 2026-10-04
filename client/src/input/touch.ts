import { dpadDir } from './dpad';
import { sendAction, type BindAction } from './bindings';
import type { Dir } from './keymap';

// TOUCH. Like the gamepad (./gamepad.ts), the on-screen controls have no code paths of
// their own: every press is sent as the key it stands for, so the transition input buffer,
// the held-key repeat, the input gate and the panels react exactly as they do to a
// keyboard. The buttons themselves are drawn by ui/mobile; this file is what they do.

/** Fired on the window by the join popup (scenes/ModeScene.ts): detail true when it opens, false when it closes. */
export const CODEPAD_EVENT = 'cubic:codepad';

export type TouchAction = BindAction | 'pause';

/**
 * THE ONE PLACE a touch becomes a key. The event carries the action itself (bindings.ts
 * sendAction), so it works whatever the keyboard is bound to. Pause is Escape, a fixed key.
 */
export function sendTouch(action: TouchAction, type: 'keydown' | 'keyup'): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  if (action === 'pause') target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', bubbles: true, cancelable: true }));
  else sendAction(action, type, target);
}

/** Every action a finger is holding right now, so all of them can be let go at once. */
const held = new Map<TouchAction, number>();

function press(action: TouchAction): void {
  const n = held.get(action) ?? 0;
  held.set(action, n + 1);
  if (n === 0) sendTouch(action, 'keydown');
}

function release(action: TouchAction): void {
  const n = held.get(action) ?? 0;
  if (n <= 0) return;
  if (n === 1) {
    held.delete(action);
    sendTouch(action, 'keyup');
  } else held.set(action, n - 1);
}

type Off = () => void;
/** What to do when everything is let go (the screen turned, a panel opened, the game ended). */
const resets = new Set<Off>();

/** Let go of every control: the fingers may still be down, the keys are not. */
export function releaseAll(): void {
  for (const reset of resets) reset();
  for (const action of [...held.keys()]) {
    held.delete(action);
    sendTouch(action, 'keyup');
  }
}

const usable = (e: PointerEvent) => e.pointerType !== 'mouse' || e.button === 0;

/**
 * A button that is its key: down while a finger is on it, up when the finger lifts. Each
 * button follows its own finger, so the d-pad and a button work at the same time.
 */
export function bindKey(el: HTMLElement, action: TouchAction | (() => TouchAction | null)): Off {
  let pointer: number | null = null;
  let sent: TouchAction | null = null;
  const up = () => {
    if (sent) release(sent);
    sent = null;
    pointer = null;
    el.classList.remove('on');
  };
  const onDown = (e: PointerEvent) => {
    if (pointer !== null || !usable(e)) return;
    e.preventDefault();
    pointer = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('on');
    sent = typeof action === 'function' ? action() : action;
    if (sent) press(sent);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pointer) up();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', onUp);
  resets.add(up);
  return () => {
    up();
    resets.delete(up);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('lostpointercapture', onUp);
  };
}

/**
 * The d-pad. Hold to keep walking (the game repeats a held arrow key by itself); slide to
 * another direction without lifting. `data-dir` on the element says what is pressed.
 */
export function bindDpad(el: HTMLElement): Off {
  let pointer: number | null = null;
  let dir: Dir | null = null;
  const set = (next: Dir | null) => {
    if (next === dir) return;
    // the new key goes down before the old one comes up: the walk never stops in between
    if (next) press(next);
    if (dir) release(dir);
    dir = next;
    if (dir) el.dataset.dir = dir;
    else delete el.dataset.dir;
  };
  const read = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    set(dpadDir(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, dir));
  };
  const up = () => {
    pointer = null;
    set(null);
  };
  const onDown = (e: PointerEvent) => {
    if (pointer !== null || !usable(e)) return;
    e.preventDefault();
    pointer = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    read(e);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === pointer) read(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pointer) up();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', onUp);
  resets.add(up);
  return () => {
    up();
    resets.delete(up);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('lostpointercapture', onUp);
  };
}

/** A tap: one key press, down and up (a letter of the room code, a quick-chat line). */
export function tapKey(key: string): void {
  const target = document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
}
