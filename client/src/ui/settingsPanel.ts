import { onSettings, setSetting, settings, type Settings } from '../style/settings';
import { STEP_EVENT, type StepDetail } from './focus';

// The settings panel behind the gear. The same panel on every screen, menus and game.
// Every control writes straight to the settings store, which applies it at once:
// volumes to the AudioManager (style/audioApi), voice to the Voice class.
//
// The rows are data: to add a setting, add one line to ROWS (and the key to Settings in
// style/settings.ts). Keyboard: up/down walk the rows, left/right change the focused
// one, Enter or Space flips a switch, Esc or Done closes (ui/focus.ts).

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type NumberKey = KeysOf<number>;
type ToggleKey = KeysOf<boolean>;
type ChoiceKey = Exclude<KeysOf<string>, NumberKey | ToggleKey>;

type Section = 'sound' | 'voice' | 'access';
type Row = { section: Section; label: string; icon?: string; aria?: string; needsVoice?: boolean } & (
  | { kind: 'slider'; key: NumberKey }
  | { kind: 'toggle'; key: ToggleKey }
  | { kind: 'choice'; key: ChoiceKey; options: { value: string; label: string }[] }
);

const SECTIONS: { id: Section; title: string; column: 1 | 2 }[] = [
  { id: 'sound', title: 'Sound', column: 1 },
  { id: 'voice', title: 'Voice', column: 1 },
  { id: 'access', title: 'Accessibility', column: 2 },
];

const ROWS: Row[] = [
  { section: 'sound', kind: 'slider', key: 'master', label: 'Master volume', icon: 'speaker' },
  { section: 'sound', kind: 'slider', key: 'music', label: 'Music', icon: 'music' },
  { section: 'sound', kind: 'slider', key: 'sfx', label: 'Sound effects', icon: 'sfx' },
  { section: 'voice', kind: 'toggle', key: 'voiceOn', label: 'Proximity chat', icon: 'chat' },
  { section: 'voice', kind: 'slider', key: 'voiceVolume', label: 'Chat volume', icon: 'speaker', aria: 'Proximity chat volume', needsVoice: true },
  { section: 'voice', kind: 'toggle', key: 'micMuted', label: 'Mute my mic', icon: 'micOff', aria: 'Mute my microphone', needsVoice: true },
  { section: 'voice', kind: 'choice', key: 'micMode', label: 'Mic mode', icon: 'mic', needsVoice: true, options: [{ value: 'open', label: 'Open' }, { value: 'ptt', label: 'Hold V' }] },
  { section: 'access', kind: 'choice', key: 'textSize', label: 'Text size', options: [{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }] },
  { section: 'access', kind: 'toggle', key: 'highContrast', label: 'High contrast' },
  { section: 'access', kind: 'toggle', key: 'screenShake', label: 'Screen shake' },
  { section: 'access', kind: 'toggle', key: 'reduceMotion', label: 'Reduce motion', icon: 'hand' },
  { section: 'access', kind: 'toggle', key: 'hints', label: 'Hints' },
];

function control(row: Row): string {
  const aria = row.aria ?? row.label;
  if (row.kind === 'slider')
    return `<div class="cu-slider" data-key="${row.key}" data-step role="slider" tabindex="0" aria-label="${aria}" aria-valuemin="0" aria-valuemax="100"><div class="track"></div><div class="fill"></div><div class="knob"></div></div><span class="val" data-val="${row.key}"></span>`;
  if (row.kind === 'toggle') return `<button class="cu-toggle" data-key="${row.key}" role="switch" aria-label="${aria}"></button><span class="cu-state" data-state="${row.key}"></span>`;
  return `<div class="cu-seg" data-key="${row.key}" data-step="cycle" role="radiogroup" tabindex="0" aria-label="${aria}">${row.options.map((o) => `<span role="radio" data-value="${o.value}">${o.label}</span>`).join('')}</div>`;
}

const rowHtml = (row: Row) => `<div class="cu-set"${row.needsVoice ? ' data-needs-voice' : ''}>${row.icon ? `<i class="cu-ico ${row.icon}"></i>` : ''}<label>${row.label}</label>${control(row)}</div>`;
const sectionHtml = (s: (typeof SECTIONS)[number]) => `<div class="cu-sub">${s.title}</div>${ROWS.filter((r) => r.section === s.id).map(rowHtml).join('')}`;
const columnHtml = (column: 1 | 2) => `<div class="cu-setcol">${SECTIONS.filter((s) => s.column === column).map(sectionHtml).join('')}</div>`;

/** CC BY needs the credit wherever the game is shown (the full list is in /CREDITS.md). */
export const MUSIC_CREDIT = 'Music: Kevin MacLeod (incompetech.com), CC BY 4.0';

const HTML = `
<div class="cu-panel cu-settings" role="dialog" aria-label="Settings">
  <div class="cu-title">Settings</div>
  <div class="cu-setgrid">${columnHtml(1)}${columnHtml(2)}</div>
  <div class="cu-credit">${MUSIC_CREDIT}</div>
  <div class="cu-actions"><button class="cu-btn" data-close><span>Done</span></button></div>
</div>`;

/** Art pixels the knob can travel: the 72px track minus the 8px knob. */
const TRAVEL = 64;
const KNOB = 8;

export interface SettingsPanel {
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onToggle(fn: (open: boolean) => void): () => void;
  destroy(): void;
}

export function createSettingsPanel(parent: HTMLElement): SettingsPanel {
  const modal = document.createElement('div');
  modal.className = 'cu-modal';
  modal.id = 'cu-settings';
  modal.innerHTML = HTML;
  parent.appendChild(modal);
  const listeners = new Set<(open: boolean) => void>();

  function render(s: Readonly<Settings>): void {
    modal.querySelectorAll<HTMLElement>('.cu-slider').forEach((node) => {
      const v = s[node.dataset.key as NumberKey];
      // the knob moves in whole art pixels, so it never sits between two of them
      const px = Math.round(v * TRAVEL);
      node.querySelector<HTMLElement>('.knob')!.style.left = `calc(${px}px * var(--u))`;
      node.querySelector<HTMLElement>('.fill')!.style.width = `calc(${px + KNOB / 2}px * var(--u))`;
      node.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      modal.querySelector<HTMLElement>(`[data-val="${node.dataset.key}"]`)!.textContent = String(Math.round(v * 100));
    });
    modal.querySelectorAll<HTMLElement>('.cu-toggle').forEach((node) => {
      const on = s[node.dataset.key as ToggleKey];
      node.classList.toggle('on', on);
      node.setAttribute('aria-checked', String(on));
      // the word as well as the colour of the switch
      modal.querySelector<HTMLElement>(`[data-state="${node.dataset.key}"]`)!.textContent = on ? 'On' : 'Off';
    });
    modal.querySelectorAll<HTMLElement>('.cu-seg').forEach((node) => {
      const value = s[node.dataset.key as ChoiceKey];
      node.querySelectorAll<HTMLElement>('[role="radio"]').forEach((opt) => {
        const on = opt.dataset.value === value;
        opt.classList.toggle('on', on);
        opt.setAttribute('aria-checked', String(on));
      });
    });
    modal.querySelectorAll<HTMLElement>('[data-needs-voice]').forEach((row) => row.classList.toggle('off', !s.voiceOn));
  }

  /** Drag anywhere on the slider: the value follows the pointer. */
  function drag(node: HTMLElement, e: PointerEvent): void {
    const rect = node.getBoundingClientRect();
    const knob = (rect.width * KNOB) / (TRAVEL + KNOB);
    const v = (e.clientX - rect.left - knob / 2) / (rect.width - knob);
    setSetting(node.dataset.key as NumberKey, Math.round(Math.min(1, Math.max(0, v)) * 20) / 20);
  }
  modal.querySelectorAll<HTMLElement>('.cu-slider').forEach((node) => {
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
  });
  modal.querySelectorAll<HTMLElement>('.cu-toggle').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.dataset.key as ToggleKey;
      setSetting(key, !settings()[key]);
    });
  });
  modal.querySelectorAll<HTMLElement>('.cu-seg').forEach((node) => {
    const key = node.dataset.key as ChoiceKey;
    const values = [...node.querySelectorAll<HTMLElement>('[role="radio"]')].map((o) => o.dataset.value!);
    const pick = (value: string) => setSetting(key, value as Settings[ChoiceKey]);
    node.addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')?.dataset.value;
      if (value) pick(value);
    });
    // left / right step and stop at the ends; Enter (a "cycle" step) wraps around
    node.addEventListener(STEP_EVENT, (e) => {
      const { by, wrap } = (e as CustomEvent<StepDetail>).detail;
      const at = values.indexOf(settings()[key]) + by;
      pick(values[wrap ? (at + values.length) % values.length : Math.min(values.length - 1, Math.max(0, at))]!);
    });
  });

  const set = (open: boolean) => {
    if (modal.classList.contains('on') === open) return;
    modal.classList.toggle('on', open);
    for (const l of listeners) l(open);
  };
  modal.querySelector('[data-close]')!.addEventListener('click', () => set(false));
  // a click on the veil closes; a click in the panel does not
  modal.addEventListener('pointerdown', (e) => {
    if (e.target === modal) set(false);
  });

  const off = onSettings(render);
  render(settings());

  return {
    toggle: (open) => set(open ?? !modal.classList.contains('on')),
    isOpen: () => modal.classList.contains('on'),
    onToggle(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      off();
      modal.remove();
    },
  };
}
