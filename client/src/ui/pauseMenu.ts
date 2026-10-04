import { controls } from '../input/keymap';

// The pause menu (Esc in game, Start on a pad): Resume, Settings, Leave on the left, and
// the controls as a table on the right: what, and its key (the live binding). The few
// gamepad buttons are one line under it, not a half-empty column.
// The game on the server keeps running; pausing only stops this player's keys from
// reaching it (input/gate.ts), so the partner is never frozen.

const HTML = `
<div class="cu-panel cu-pause" role="dialog" aria-label="Paused">
  <div class="cu-title">Paused</div>
  <p class="cu-lead">Your partner keeps playing.</p>
  <div class="cu-pausegrid">
    <div class="cu-pausebtns">
      <button class="cu-btn in" data-act="resume" data-first><span>Resume</span></button>
      <button class="cu-btn light" data-act="settings"><span>Settings</span></button>
      <button class="cu-btn danger" data-act="leave"><span>Leave</span></button>
    </div>
    <div class="cu-help" role="table" aria-label="Controls"></div>
  </div>
</div>`;

/** The table's cells, from the bindings as they are right now. */
function helpHtml(): string {
  const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'); // a key can be bound to "<"
  const cell = (cls: string, text: string) => `<span class="${cls}" role="cell">${esc(text)}</span>`;
  const list = controls();
  const pad = list.filter((c) => c.pad).map((c) => `${c.pad} ${c.does.toLowerCase()}`);
  return `${cell('h', 'Controls')}${cell('h', 'Key')}<i class="rule"></i>${list.map((c) => `${cell('a', c.does)}${cell('k', c.keys)}`).join('')}<i class="rule"></i><span class="pad">Gamepad: ${pad.join(', ')}</span>`;
}

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
  const help = modal.querySelector<HTMLElement>('.cu-help')!;
  help.innerHTML = helpHtml();
  const set = (open: boolean) => {
    if (open) help.innerHTML = helpHtml(); // the keys may have been rebound since it was last open
    modal.classList.toggle('on', open);
  };
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
