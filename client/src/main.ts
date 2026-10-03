import { startApp } from './app';
import { ui } from './ui';
import { mockActions, mockGameUIState, mockLobbyState, mockMenuState } from './ui/mock';

const root = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const mock = params.get('mock');
if (params.has('dev')) void import('./dev').then((dev) => dev.mountDev()); // dev tools, see client/src/dev

if (mock === 'lobby' || mock === 'hud' || mock === 'menu') {
  // Static mock data for building UI without a server (see client/src/ui/README.md).
  const game = document.createElement('div');
  game.id = 'game';
  root.appendChild(game);
  ui.mount(root, mockActions).update(mock === 'hud' ? mockGameUIState : mock === 'menu' ? mockMenuState : mockLobbyState);
} else if (mock !== null) {
  // ?mock=game (or ?mock): a playable local game with no server. &side=in for the inside.
  startApp(root, ui, params.get('side') === 'in' ? 'in' : 'out');
} else {
  startApp(root, ui);
}
