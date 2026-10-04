import { startApp } from './app';
import { audio, type SfxId, type TrackId } from './audio/AudioManager';
import { setAudioApi } from './style/audioApi';
import { mountFitDebug } from './style/fitDebug';
import { ui } from './ui';
import { mockActions, mockGameUIState, mockLobbyState, mockMenuState } from './ui/mock';

// The settings panel's volume sliders drive the real AudioManager.
setAudioApi({
  setMaster: (v) => audio.setMaster(v),
  setMusic: (v) => audio.setMusic(v),
  setSfx: (v) => audio.setSfx(v),
  playMusic: (id, opts) => void audio.playMusic(id as TrackId, opts),
  stopMusic: (opts) => void audio.stopMusic(opts),
  playSfx: (id) => audio.playSfx(id as SfxId),
});

const root = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const mock = params.get('mock');
// Dev tools (client/src/dev). Dev server only: a production build drops the chunk, so
// ?dev does nothing there.
if (import.meta.env.DEV && params.has('dev')) void import('./dev').then((dev) => dev.mountDev());

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

if (params.get('debug') === 'fit') mountFitDebug();
