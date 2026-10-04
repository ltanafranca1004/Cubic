import { SPAWN, type GameState } from '@cubic/shared';
import type { UIActions, UIState } from './hooks';

// Mock data so the UI can be built with no server running: open the client with ?mock
// (http://localhost:5173/?mock) or ?mock=lobby. Edit freely while designing.

export const mockGameState: GameState = {
  players: {
    out: { side: 'out', pose: { side: 'out', face: 1, up: [0, 1, 0], ...SPAWN.out, dir: 1 }, connected: true, isAI: false, steps: 0, carrying: null },
    in: { side: 'in', pose: { side: 'in', face: 1, up: [0, 1, 0], ...SPAWN.in, dir: 1 }, connected: true, isAI: false, steps: 0, carrying: null },
  },
  puzzles: { 'plate-door': { pressed: false, taken: false } },
  items: {},
  solved: [],
  strikes: 0,
  startedAt: Date.now(),
  wonAt: null,
};

export const mockLobbyState: UIState = {
  screen: 'lobby',
  online: true,
  status: 'waiting',
  error: null,
  roomCode: 'QZKP',
  mode: 'friend',
  side: 'out',
  aiAvailable: true,
  lobby: {
    role: 'host',
    host: { connected: true, isAI: false, side: 'out', ready: false },
    guest: { connected: true, isAI: false, side: 'in', ready: true },
    startBlocker: null,
  },
  chat: [],
  partnerTyping: false,
  hud: null,
  voice: { mic: 'off', mode: 'push', muted: false, link: 'none', talking: false, partnerLevel: 0, signal: 0, partnerVolume: 1 },
};

/** The menus before any room: title, then the mode screen (?mock=menu). */
export const mockMenuState: UIState = { ...mockLobbyState, status: 'idle', roomCode: null, mode: null, side: null, lobby: null };

export const mockGameUIState: UIState = {
  ...mockLobbyState,
  screen: 'game',
  status: 'partner-joined',
  lobby: null,
  chat: [
    { id: 1, from: 'out', isAI: false, text: 'I see a door with a crystal behind it.', at: Date.now() - 9000 },
    { id: 2, from: 'in', isAI: false, text: 'There is a plate on my floor, top right for me.', at: Date.now() - 4000 },
  ],
  hud: {
    face: 1,
    faceName: 'Grass',
    drift: 90,
    edges: {
      up: { face: 5, name: 'Rooftop', solved: false },
      down: { face: 6, name: 'Cave', solved: false },
      left: { face: 4, name: 'Forest', solved: false },
      right: { face: 2, name: 'Desert', solved: true },
    },
    objective: 'A crystal sits behind a sealed door. Its mechanism is somewhere inside.',
    solved: [2],
    portalOpen: false,
    strikes: 1,
    elapsedMs: 83_000,
    won: false,
    carrying: { id: 'rose', kind: 'rose' },
    partnerFace: 4,
  },
  signals: {
    pings: [
      { id: 1, sx: 6, sy: 3, mine: false, alpha: 1 },
      { id: 2, sx: 2, sy: 6, mine: true, alpha: 1 },
    ],
    bubbles: [{ id: 3, sx: 6, sy: 5, mine: false, text: 'Here!' }],
  },
  voice: { mic: 'on', mode: 'push', muted: false, link: 'direct', talking: false, partnerLevel: 0.4, signal: 2, partnerVolume: 1 },
};

/** Actions that only log, for use with the mock states. */
export const mockActions: UIActions = {
  onCreateRoom: () => console.log('[ui] onCreateRoom'),
  onJoinRoom: (code) => console.log('[ui] onJoinRoom', code),
  onPlayWithAI: (side) => console.log('[ui] onPlayWithAI', side),
  onPickSide: (side) => console.log('[ui] onPickSide', side),
  onSetReady: (ready) => console.log('[ui] onSetReady', ready),
  onStartGame: () => console.log('[ui] onStartGame'),
  onLeaveRoom: () => console.log('[ui] onLeaveRoom'),
  onSendChat: (text) => console.log('[ui] onSendChat', text),
  onEnableMic: () => console.log('[ui] onEnableMic'),
  onSetMuted: (muted) => console.log('[ui] onSetMuted', muted),
  onSetMicMode: (mode) => console.log('[ui] onSetMicMode', mode),
  onSetPartnerVolume: (v) => console.log('[ui] onSetPartnerVolume', v),
  onPlayAgain: () => console.log('[ui] onPlayAgain'),
  onDrop: () => console.log('[ui] onDrop'),
  onPing: () => console.log('[ui] onPing'),
  onQuickChat: (index) => console.log('[ui] onQuickChat', index),
};
