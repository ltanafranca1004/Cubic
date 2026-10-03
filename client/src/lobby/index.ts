import type { UIHandle, UIHost, UIState } from '../ui/hooks';

// Placeholder lobby (core team). Deliberately plain: the real UI lives in /client/src/ui.

const STATUS_TEXT: Record<UIState['status'], string> = {
  idle: '',
  connecting: 'Connecting...',
  waiting: 'Waiting for your partner. Share the code.',
  'partner-joined': 'Partner joined.',
  'partner-left': 'Partner left. Waiting for them to come back...',
};

export const placeholderUI: UIHost = {
  mount(root, actions): UIHandle {
    const el = document.createElement('div');
    el.id = 'lobby';
    el.innerHTML = `
      <h1>CUBIC</h1>
      <p>Two players, one cube. One outside, one trapped inside.</p>
      <button id="lb-create">Create room</button>
      <form id="lb-join"><input id="lb-code" maxlength="4" placeholder="CODE" autocomplete="off" /><button>Join room</button></form>
      <button id="lb-ai" disabled>Play with AI (soon)</button>
      <p id="lb-code-out"></p>
      <p id="lb-status"></p>
      <p id="lb-error"></p>`;
    root.appendChild(el);

    const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
    $('lb-create').addEventListener('click', () => actions.onCreateRoom());
    $('lb-join').addEventListener('submit', (e) => {
      e.preventDefault();
      actions.onJoinRoom($<HTMLInputElement>('lb-code').value.trim().toUpperCase());
    });

    return {
      update(state) {
        el.style.display = state.screen === 'lobby' ? '' : 'none';
        $('lb-code-out').textContent = state.roomCode ? `Room code: ${state.roomCode}` : '';
        $('lb-status').textContent = state.online ? STATUS_TEXT[state.status] : 'Server offline.';
        $('lb-error').textContent = state.error ?? '';
      },
      destroy: () => el.remove(),
    };
  },
};
