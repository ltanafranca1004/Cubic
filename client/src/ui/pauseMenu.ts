import { CONTROLS } from '../input/keymap';

// The pause menu (Esc in game, Start on a pad): Resume, Settings, Leave, and the controls
// reference. The game on the server keeps running; pausing only stops this player's keys
// from reaching it (input/gate.ts), so the partner is never frozen.

const HTML = `
<div class="cu-panel cu-pause" role="dialog" aria-label="Paused">
  <div class="cu-title">Paused</div>
  <div class="cu-pausegrid">
    <div class="cu-pausebtns">
      <button class="cu-btn in" data-act="resume" data-first><span>Resume</span></button>
      <button class="cu-btn light" data-act="settings"><span>Settings</span></button>
      <button class="cu-btn danger" data-act="leave"><span>Leave</span></button>
      <p class="cu-note">Your partner keeps playing while you are here.</p>
    </div>
    <div class="cu-help">
      <div class="cu-sub">Controls</div>
      <div class="cu-helprow head"><span>Key</span><span>Pad</span><span></span></div>
      ${CONTROLS.map((c) => `<div class="cu-helprow"><kbd>${c.keys}</kbd><kbd>${c.pad ?? ''}</kbd><span>${c.does}</span></div>`).join('')}
    </div>
  </div>
</div>`;

export interface PauseMenu {
  el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createPauseMenu(parent: HTMLElement, on: { settings(): void; leave(): void }): PauseMenu {
  const modal = document.createElement('div');
  modal.className = 'cu-modal';
  modal.id = 'cu-pause';
  modal.innerHTML = HTML;
  parent.appendChild(modal);
  const set = (open: boolean) => modal.classList.toggle('on', open);
  modal.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'resume') set(false);
    if (act === 'settings') on.settings();
    if (act === 'leave') {
      set(false);
      on.leave();
    }
  });
  return {
    el: modal,
    open: () => set(true),
    close: () => set(false),
    isOpen: () => modal.classList.contains('on'),
    destroy: () => modal.remove(),
  };
}
