import { onSettings, setSetting, settings, type Settings } from '../style/settings';

// The settings panel behind the gear. The same panel on every screen, menus and game.
// Every control writes straight to the settings store, which applies it at once:
// volumes to the AudioManager (style/audioApi), voice to the Voice class.

type NumberKey = 'master' | 'music' | 'sfx' | 'voiceVolume';
type ToggleKey = 'voiceOn' | 'micMuted' | 'reduceMotion';

const SLIDERS: { key: NumberKey; label: string; icon: string }[] = [
  { key: 'master', label: 'Master volume', icon: 'speaker' },
  { key: 'music', label: 'Music', icon: 'music' },
  { key: 'sfx', label: 'Sound effects', icon: 'sfx' },
];

const slider = (key: NumberKey, label: string) =>
  `<div class="cu-slider" data-key="${key}" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="0" aria-valuemax="100"><div class="track"></div><div class="fill"></div><div class="knob"></div></div><span class="val" data-val="${key}"></span>`;
const toggle = (key: ToggleKey, label: string) => `<button class="cu-toggle" data-key="${key}" role="switch" aria-label="${label}"></button>`;

const HTML = `
<div class="cu-panel cu-settings" role="dialog" aria-label="Settings">
  <div class="cu-title">Settings</div>
  ${SLIDERS.map((s) => `<div class="cu-set"><i class="cu-ico ${s.icon}"></i><label>${s.label}</label>${slider(s.key, s.label)}</div>`).join('')}
  <div class="cu-rule"></div>
  <div class="cu-set"><i class="cu-ico chat"></i><label>Proximity chat</label>${toggle('voiceOn', 'Proximity chat')}</div>
  <div class="cu-set" data-needs-voice><i class="cu-ico speaker"></i><label>Chat volume</label>${slider('voiceVolume', 'Proximity chat volume')}</div>
  <div class="cu-set" data-needs-voice><i class="cu-ico micOff"></i><label>Mute my mic</label>${toggle('micMuted', 'Mute my microphone')}</div>
  <div class="cu-rule"></div>
  <div class="cu-set"><i class="cu-ico hand"></i><label>Reduce motion</label>${toggle('reduceMotion', 'Reduce motion')}</div>
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
    node.addEventListener('keydown', (e) => {
      const key = node.dataset.key as NumberKey;
      const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopPropagation(); // the arrows are also the game's movement keys
      setSetting(key, Math.round((settings()[key] + step) * 20) / 20);
    });
  });
  modal.querySelectorAll<HTMLElement>('.cu-toggle').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.dataset.key as ToggleKey;
      setSetting(key, !settings()[key]);
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
