import { AI_VOICES, type AiVoice } from '@cubic/shared';
import { ACTION_LABEL, BIND_ACTIONS, DEFAULT_BINDINGS, canBind, keyId, keyName, rebind, sameBindings, type BindAction } from '../input/bindings';
import type { KeyLike } from '../input/keymap';
import { onSettings, setSetting, settings, type Settings } from '../style/settings';
import { STEP_EVENT, type StepDetail } from './focus';

// The settings panel behind the gear. The same panel on every screen, menus and game.
// Every control writes straight to the settings store, which applies it at once and saves
// it: volumes to the AudioManager (style/audioApi), voice to the Voice class, the key
// bindings to input/bindings.ts.
//
// Three tabs in one box of a fixed size: SOUND, ACCESS, CONTROLS. The rows of the first
// two are data: to add a setting, add one line to ROWS (and the key to Settings in
// style/settings.ts). Keyboard: up/down walk the controls, left/right change the focused
// one (or the tab), Enter or Space flips a switch, Esc or Done closes (ui/focus.ts).
//
// CONTROLS: one row per action with the key it is on. Click the key (or Enter on it), it
// says PRESS A KEY..., and the next key pressed is the new binding (Esc cancels). A key
// that another action has swaps the two, so nothing is ever left without a key.

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type NumberKey = KeysOf<number>;
type ToggleKey = KeysOf<boolean>;
type ChoiceKey = 'micMode' | 'textSize' | 'aiVoice';

type Tab = 'sound' | 'access' | 'controls';
type Section = 'sound' | 'voice' | 'look' | 'motion';
type Row = { section: Section; label: string; icon?: string; aria?: string; needsVoice?: boolean } & (
  | { kind: 'slider'; key: NumberKey }
  | { kind: 'toggle'; key: ToggleKey }
  | { kind: 'choice'; key: ChoiceKey; options: { value: string; label: string }[]; preview?: boolean }
);

const TABS: { id: Tab; title: string }[] = [
  { id: 'sound', title: 'Sound' },
  { id: 'access', title: 'Access' },
  { id: 'controls', title: 'Controls' },
];
const SECTIONS: { id: Section; title: string; tab: Tab }[] = [
  { id: 'sound', title: 'Sound', tab: 'sound' },
  { id: 'voice', title: 'Voice', tab: 'sound' },
  { id: 'look', title: 'Reading', tab: 'access' },
  { id: 'motion', title: 'Motion and help', tab: 'access' },
];

const ROWS: Row[] = [
  { section: 'sound', kind: 'slider', key: 'master', label: 'Master', icon: 'speaker', aria: 'Master volume' },
  { section: 'sound', kind: 'slider', key: 'music', label: 'Music', icon: 'music' },
  { section: 'sound', kind: 'slider', key: 'sfx', label: 'Effects', icon: 'sfx', aria: 'Sound effects' },
  // the AI partner of a solo game; `preview` adds the button that plays a greeting in the chosen voice
  { section: 'sound', kind: 'choice', key: 'aiVoice', label: 'Partner voice', aria: 'AI partner voice', preview: true, options: AI_VOICES.map((v) => ({ value: v.key, label: v.label })) },
  { section: 'voice', kind: 'toggle', key: 'voiceOn', label: 'Voice chat', icon: 'chat', aria: 'Proximity chat' },
  { section: 'voice', kind: 'slider', key: 'voiceVolume', label: 'Volume', icon: 'speaker', aria: 'Proximity chat volume', needsVoice: true },
  { section: 'voice', kind: 'toggle', key: 'micMuted', label: 'Mute my mic', icon: 'micOff', aria: 'Mute my microphone', needsVoice: true },
  { section: 'voice', kind: 'choice', key: 'micMode', label: 'Mic', icon: 'mic', aria: 'Mic mode', needsVoice: true, options: [{ value: 'open', label: 'Open' }, { value: 'ptt', label: 'Push to talk' }] },
  { section: 'look', kind: 'choice', key: 'textSize', label: 'Text size', options: [{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }] },
  { section: 'look', kind: 'toggle', key: 'highContrast', label: 'High contrast' },
  { section: 'motion', kind: 'toggle', key: 'reduceMotion', label: 'Reduce motion', icon: 'hand' },
  { section: 'motion', kind: 'toggle', key: 'screenShake', label: 'Screen shake' },
  { section: 'motion', kind: 'toggle', key: 'hints', label: 'Hints' },
  // PostHog (analytics/analytics.ts): no names, chat or voice. Off = nothing is sent.
  { section: 'motion', kind: 'toggle', key: 'shareStats', label: 'Share anonymous usage stats' },
];

function control(row: Row): string {
  const aria = row.aria ?? row.label;
  if (row.kind === 'slider')
    return `<div class="cu-slider" data-key="${row.key}" data-step role="slider" tabindex="0" aria-label="${aria}" aria-valuemin="0" aria-valuemax="100"><div class="track"></div><div class="fill"></div><div class="knob"></div></div><span class="val" data-val="${row.key}"></span>`;
  if (row.kind === 'toggle') return `<button class="cu-toggle" data-key="${row.key}" role="switch" aria-label="${aria}"></button><span class="cu-state" data-state="${row.key}"></span>`;
  return `<div class="cu-seg" data-key="${row.key}" data-step="cycle" role="radiogroup" tabindex="0" aria-label="${aria}">${row.options.map((o) => `<span role="radio" data-value="${o.value}">${o.label}</span>`).join('')}</div>${row.preview ? `<button class="cu-key cu-preview" data-preview="${row.key}" aria-label="Play a sample of the ${aria}"><span>Play</span></button>` : ''}`;
}

const rowHtml = (row: Row) => `<div class="cu-set"${row.needsVoice ? ' data-needs-voice' : ''}>${row.icon ? `<i class="cu-ico ${row.icon}"></i>` : ''}<label>${row.label}</label>${control(row)}</div>`;
const sectionHtml = (s: (typeof SECTIONS)[number]) => `<div class="cu-setcol"><div class="cu-sub">${s.title}</div>${ROWS.filter((r) => r.section === s.id).map(rowHtml).join('')}</div>`;
const tabHtml = (tab: Tab) => `<div class="cu-setgrid" data-pane="${tab}" role="tabpanel">${SECTIONS.filter((s) => s.tab === tab).map(sectionHtml).join('')}</div>`;

/** The controls tab: two columns of seven. The last cell says what cannot be changed. */
const HALF = Math.ceil(BIND_ACTIONS.length / 2);
const keyRow = (a: BindAction) => `<div class="cu-set" data-bind-row="${a}"><label>${ACTION_LABEL[a]}</label><button class="cu-key" data-bind="${a}"><span></span></button></div>`;
const controlsHtml = `<div class="cu-setgrid" data-pane="controls" role="tabpanel">
  <div class="cu-setcol">${BIND_ACTIONS.slice(0, HALF).map(keyRow).join('')}</div>
  <div class="cu-setcol">${BIND_ACTIONS.slice(HALF).map(keyRow).join('')}<div class="cu-set fixed"><span>Fixed: Esc, Enter, arrows, gamepad.</span></div></div>
</div>`;

/** CC BY needs the credit wherever the game is shown (the full list is in /CREDITS.md). */
export const MUSIC_CREDIT = 'Music: Kevin MacLeod (incompetech.com), CC BY 4.0';
/** What a key button says while it waits for the new key. */
export const CAPTURE_TEXT = 'Press a key...';
/** How long the other row of a swap stays marked. */
const SWAP_MS = 1200;

const HTML = `
<div class="cu-panel cu-settings" role="dialog" aria-label="Settings">
  <div class="cu-title">Settings</div>
  <div class="cu-tabs" data-step role="tablist" tabindex="0" aria-label="Settings sections">${TABS.map((t) => `<span role="tab" data-tab="${t.id}"><b>${t.title}</b></span>`).join('')}</div>
  <div class="cu-setbody">${tabHtml('sound')}${tabHtml('access')}${controlsHtml}</div>
  <div class="cu-credit">${MUSIC_CREDIT}</div>
  <div class="cu-actions"><button class="cu-btn light" data-reset hidden><span>Reset to defaults</span></button><button class="cu-btn" data-close><span>Done</span></button></div>
</div>`;

/** Art pixels the knob can travel: the 72px track minus the 8px knob. */
const TRAVEL = 64;
const KNOB = 8;

export interface SettingsPanel {
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onToggle(fn: (open: boolean) => void): () => void;
  /** Show a tab ('sound' when the panel opens). */
  showTab(tab: Tab): void;
  /**
   * A key while the panel is open. True if a key button was waiting for it (the key is
   * then used up: bound, refused or, for Esc, the wait cancelled).
   */
  captureKey(e: KeyLike): boolean;
  destroy(): void;
}

export interface SettingsPanelOptions {
  /** Does a text size differ from the next one up at the current scale? (S and M are the same at scale 1.) */
  sizeDiffers?(a: Settings['textSize'], b: Settings['textSize']): boolean;
  /** Play one greeting in this AI partner voice (the Play button of the "Partner voice" row). */
  previewVoice?(voice: AiVoice): void;
}

export function createSettingsPanel(parent: HTMLElement, opts: SettingsPanelOptions = {}): SettingsPanel {
  const modal = document.createElement('div');
  modal.className = 'cu-modal';
  modal.id = 'cu-settings';
  modal.innerHTML = HTML;
  parent.appendChild(modal);
  modal.querySelector('[data-key="master"]')!.setAttribute('data-first', ''); // the focus starts on the first row, not on the tabs
  const listeners = new Set<(open: boolean) => void>();
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...modal.querySelectorAll<T>(sel)];
  let tab: Tab = 'sound';
  /** The action whose key button is waiting for a key. */
  let capturing: BindAction | null = null;
  let swapTimer = 0;

  function render(s: Readonly<Settings>): void {
    for (const node of $$('.cu-slider')) {
      const v = s[node.dataset.key as NumberKey];
      // the knob moves in whole art pixels, so it never sits between two of them
      const px = Math.round(v * TRAVEL);
      node.querySelector<HTMLElement>('.knob')!.style.left = `calc(${px}px * var(--u))`;
      node.querySelector<HTMLElement>('.fill')!.style.width = `calc(${px + KNOB / 2}px * var(--u))`;
      node.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      modal.querySelector<HTMLElement>(`[data-val="${node.dataset.key}"]`)!.textContent = String(Math.round(v * 100));
    }
    for (const node of $$('.cu-toggle')) {
      const on = s[node.dataset.key as ToggleKey];
      node.classList.toggle('on', on);
      node.setAttribute('aria-checked', String(on));
      // the word as well as the colour of the switch
      modal.querySelector<HTMLElement>(`[data-state="${node.dataset.key}"]`)!.textContent = on ? 'On' : 'Off';
    }
    for (const node of $$('.cu-seg')) {
      const value = s[node.dataset.key as ChoiceKey];
      for (const opt of node.querySelectorAll<HTMLElement>('[role="radio"]')) {
        const on = opt.dataset.value === value;
        opt.classList.toggle('on', on);
        opt.setAttribute('aria-checked', String(on));
      }
    }
    // A size that would look exactly like the next one is not offered (S at scale 1, where
    // the font is already at its own size): no option does nothing.
    const small = modal.querySelector<HTMLElement>('[data-key="textSize"] [data-value="s"]');
    if (small) small.hidden = s.textSize !== 's' && opts.sizeDiffers?.('s', 'm') === false;
    for (const row of $$('[data-needs-voice]')) row.classList.toggle('off', !s.voiceOn);
    for (const btn of $$<HTMLButtonElement>('[data-bind]')) {
      const action = btn.dataset.bind as BindAction;
      const waiting = capturing === action;
      btn.classList.toggle('cap', waiting);
      btn.firstElementChild!.textContent = waiting ? CAPTURE_TEXT : keyName(s.keys[action]);
      btn.setAttribute('aria-label', waiting ? `${ACTION_LABEL[action]}: press a key, or Esc to cancel` : `${ACTION_LABEL[action]}: ${keyName(s.keys[action])}. Press to change`);
    }
    const reset = modal.querySelector<HTMLButtonElement>('[data-reset]')!;
    reset.hidden = tab !== 'controls';
    reset.disabled = sameBindings(s.keys, DEFAULT_BINDINGS);
    modal.querySelector<HTMLElement>('.cu-credit')!.style.visibility = tab === 'sound' ? '' : 'hidden';
    for (const t of $$('[role="tab"]')) {
      const on = t.dataset.tab === tab;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    }
    for (const pane of $$('[data-pane]')) pane.classList.toggle('on', pane.dataset.pane === tab);
  }
  const redraw = () => render(settings());

  function showTab(next: Tab): void {
    if (tab === next) return;
    capturing = null;
    tab = next;
    redraw();
  }

  function setCapturing(action: BindAction | null): void {
    if (capturing === action) return;
    capturing = action;
    redraw();
  }

  /** Mark the row that just changed keys with another, for a moment. */
  function markSwap(action: BindAction | null): void {
    window.clearTimeout(swapTimer);
    for (const row of $$('[data-bind-row]')) row.classList.toggle('swap', row.dataset.bindRow === action);
    if (action) swapTimer = window.setTimeout(() => markSwap(null), SWAP_MS);
  }

  function captureKey(e: KeyLike): boolean {
    if (!capturing) return false;
    if (e.key === 'Escape') {
      setCapturing(null);
      return true;
    }
    // a held key, a gamepad or touch press, or a key that cannot be bound: keep waiting
    if (e.repeat || e.isTrusted === false) return true;
    const id = keyId(e);
    if (!canBind(id)) return true;
    const action = capturing;
    const { bindings, swapped } = rebind(settings().keys, action, id);
    capturing = null;
    setSetting('keys', bindings);
    redraw(); // (the same key again changes no setting, but the button still has to stop waiting)
    markSwap(swapped);
    return true;
  }

  /** Drag anywhere on the slider: the value follows the pointer. */
  function drag(node: HTMLElement, e: PointerEvent): void {
    const rect = node.getBoundingClientRect();
    const knob = (rect.width * KNOB) / (TRAVEL + KNOB);
    const v = (e.clientX - rect.left - knob / 2) / (rect.width - knob);
    setSetting(node.dataset.key as NumberKey, Math.round(Math.min(1, Math.max(0, v)) * 20) / 20);
  }
  for (const node of $$('.cu-slider')) {
    node.addEventListener('pointerdown', (e) => {
      node.setPointerCapture(e.pointerId);
      node.focus();
      drag(node, e);
    });
    node.addEventListener('pointermove', (e) => {
      if (node.hasPointerCapture(e.pointerId)) drag(node, e);
    });
    // left / right on the keyboard (ui/focus.ts sends the step)
    node.addEventListener(STEP_EVENT, (e) => {
      const key = node.dataset.key as NumberKey;
      setSetting(key, Math.round((settings()[key] + (e as CustomEvent<StepDetail>).detail.by * 0.05) * 20) / 20);
    });
  }
  for (const node of $$('.cu-toggle')) {
    node.addEventListener('click', () => {
      const key = node.dataset.key as ToggleKey;
      setSetting(key, !settings()[key]);
    });
  }
  for (const node of $$('.cu-seg')) {
    const key = node.dataset.key as ChoiceKey;
    const pick = (value: string) => setSetting(key, value as Settings[ChoiceKey]);
    node.addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')?.dataset.value;
      if (value) pick(value);
    });
    // left / right step and stop at the ends; Enter (a "cycle" step) wraps around
    node.addEventListener(STEP_EVENT, (e) => {
      const { by, wrap } = (e as CustomEvent<StepDetail>).detail;
      const values = [...node.querySelectorAll<HTMLElement>('[role="radio"]')].filter((o) => !o.hidden).map((o) => o.dataset.value!);
      const at = values.indexOf(settings()[key]) + by;
      pick(values[wrap ? (at + values.length) % values.length : Math.min(values.length - 1, Math.max(0, at))]!);
    });
  }
  // Play: one greeting in the voice that is chosen right now (a click, a tap, or Enter on it)
  for (const btn of $$<HTMLButtonElement>('[data-preview]')) btn.addEventListener('click', () => opts.previewVoice?.(settings().aiVoice));
  const tabs = modal.querySelector<HTMLElement>('.cu-tabs')!;
  tabs.addEventListener('click', (e) => {
    const next = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')?.dataset.tab;
    if (next) showTab(next as Tab);
  });
  tabs.addEventListener(STEP_EVENT, (e) => {
    const at = TABS.findIndex((t) => t.id === tab) + (e as CustomEvent<StepDetail>).detail.by;
    showTab(TABS[Math.min(TABS.length - 1, Math.max(0, at))]!.id);
  });
  for (const btn of $$<HTMLButtonElement>('[data-bind]')) {
    // a second press on the waiting button takes it back (the way out on a touch screen)
    btn.addEventListener('click', () => setCapturing(capturing === btn.dataset.bind ? null : (btn.dataset.bind as BindAction)));
    btn.addEventListener('blur', () => capturing === btn.dataset.bind && setCapturing(null));
  }
  modal.querySelector('[data-reset]')!.addEventListener('click', () => {
    capturing = null;
    markSwap(null);
    setSetting('keys', { ...DEFAULT_BINDINGS });
    redraw();
    modal.querySelector<HTMLElement>('[data-close]')!.focus(); // Reset is disabled now: the focus moves on
  });

  const set = (open: boolean) => {
    if (modal.classList.contains('on') === open) return;
    capturing = null;
    markSwap(null);
    if (open) tab = 'sound';
    modal.classList.toggle('on', open);
    redraw();
    for (const l of listeners) l(open);
  };
  modal.querySelector('[data-close]')!.addEventListener('click', () => set(false));
  // A click on the veil closes; a click in the panel does not. It closes on the CLICK, not
  // on the press: the veil is still there when the button comes up, so that click cannot
  // land on whatever is under it (the gear would open the panel again, Leave would leave).
  let pressedVeil = false;
  modal.addEventListener('pointerdown', (e) => {
    pressedVeil = e.target === modal;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && pressedVeil) set(false);
    pressedVeil = false;
  });

  const off = onSettings(render);
  redraw();

  return {
    toggle: (open) => set(open ?? !modal.classList.contains('on')),
    isOpen: () => modal.classList.contains('on'),
    onToggle(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    showTab,
    captureKey,
    destroy() {
      off();
      window.clearTimeout(swapTimer);
      modal.remove();
    },
  };
}
