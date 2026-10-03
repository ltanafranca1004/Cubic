import { ui } from './ui';
import { mockActions, mockGameUIState, mockLobbyState } from './ui/mock';

// Skeleton entry: mounts the UI against mock data. The networked game lands on branch
// "core"; `?mock` keeps working after that so the UI can be built without a server.

const root = document.querySelector<HTMLElement>('#app')!;
const game = document.createElement('div');
game.id = 'game';
root.appendChild(game);

const mock = new URLSearchParams(location.search).get('mock');
const handle = ui.mount(root, mockActions);
handle.update(mock === 'game' ? mockGameUIState : mockLobbyState);
