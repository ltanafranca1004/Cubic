import { menuAction, stepFocus, type KeyLike } from '../input/keymap';

// Keyboard (and gamepad) focus inside the DOM panels: settings, pause, win. The focus is
// kept inside the open panel; up/down (or W/S, Tab) walk its controls, left/right (A/D)
// change the focused control or walk a row of buttons, Enter or Space press.
// A control that takes left/right marks itself with `data-step` and listens for STEP_EVENT.

export const STEP_EVENT = 'cu-step';
export interface StepDetail {
  /** -1 = left / less, 1 = right / more. */
  by: -1 | 1;
  /** Enter on a choice: go round to the first after the last. */
  wrap: boolean;
}

/** The panel on top right now (the last open one in the DOM), or null. */
export function topModal(root: ParentNode = document): HTMLElement | null {
  const open = root.querySelectorAll<HTMLElement>('.cu-modal.on');
  return open[open.length - 1] ?? null;
}

/** Everything in the panel the focus can land on, in reading order. */
export function focusables(modal: HTMLElement): HTMLElement[] {
  return [...modal.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].filter((n) => !(n as HTMLButtonElement).disabled && n.offsetParent !== null && !n.closest('.off'));
}

/** Put the focus in a panel that just opened: on `[data-first]`, else its first control. */
export function focusFirst(modal: HTMLElement): void {
  const items = focusables(modal);
  (items.find((n) => n.hasAttribute('data-first')) ?? items[0])?.focus();
}

const step = (node: HTMLElement, by: -1 | 1, wrap = false) => node.dispatchEvent(new CustomEvent<StepDetail>(STEP_EVENT, { detail: { by, wrap } }));

/** A key while a panel is open. True if the panel used it. */
export function modalKey(modal: HTMLElement, e: KeyLike): boolean {
  const action = menuAction(e);
  if (!action || action === 'back') return false;
  const items = focusables(modal);
  const at = items.indexOf(document.activeElement as HTMLElement);
  const current = items[at];
  const move = (delta: number) => items[stepFocus(at, items.length, delta, true)]?.focus();
  switch (action) {
    case 'up':
    case 'prev':
      move(-1);
      return true;
    case 'down':
    case 'next':
      move(1);
      return true;
    case 'left':
    case 'right': {
      const by = action === 'left' ? -1 : 1;
      if (current?.hasAttribute('data-step')) step(current, by);
      else move(by);
      return true;
    }
    case 'select':
      if (!current) move(1);
      else if (current.dataset.step === 'cycle') step(current, 1, true);
      else if (current instanceof HTMLButtonElement) current.click();
      return true;
  }
}
