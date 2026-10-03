import { FACE_NAMES, compassDrift, neighbours, objectiveFor, portalOpen, signalBars, voiceMix, type GameEvent, type GameState, type Side } from '@cubic/shared';
import { createGameView, type GameHandle } from './game';
import { playEvent } from './game/sfx';
import { Net } from './net/client';
import type { HudState, UIActions, UIHandle, UIHost, UIState } from './ui/hooks';
import { Voice } from './voice/voice';

// Glue: Net (server + prediction) -> UIState for the UI and GameState for the Phaser view;
// UIActions and game input -> Net. No game rules here.

export function hudOf(state: GameState, me: Side, now: number): HudState {
  const pose = state.players[me].pose;
  const n = neighbours(pose);
  const label = (face: (typeof n)['up']) => ({ face, name: FACE_NAMES[me][face], solved: state.solved.includes(face) });
  const carried = state.players[me].carrying ? state.items[state.players[me].carrying!] : null;
  return {
    face: pose.face,
    faceName: FACE_NAMES[me][pose.face],
    drift: compassDrift(pose),
    edges: { up: label(n.up), down: label(n.down), left: label(n.left), right: label(n.right) },
    objective: objectiveFor(state, me),
    solved: [...state.solved],
    portalOpen: portalOpen(state),
    strikes: state.strikes,
    elapsedMs: Math.max(0, (state.wonAt ?? now) - state.startedAt),
    won: state.wonAt !== null,
    carrying: carried ? { id: carried.id, kind: carried.kind } : null,
  };
}

export function startApp(root: HTMLElement, ui: UIHost, offlineSide: Side | null = null): void {
  const gameEl = document.createElement('div');
  gameEl.id = 'game';
  root.appendChild(gameEl);

  let partnerTyping = false;
  /** Both seats have been taken at some point: we are past the lobby. */
  let started = false;
  let handle: UIHandle | null = null;
  let game: GameHandle | null = null;

  const net = new Net(
    {
      onChange: () => render(),
      onEvents: (events: GameEvent[]) => {
        events.forEach(playEvent);
        game?.handle(events);
      },
      onChat: () => {},
      onTyping: (on) => {
        partnerTyping = on;
        render();
      },
      onVoiceReady: () => voice.onReady(),
      onVoiceSignal: (data) => void voice.onSignal(data),
      onVoiceChunk: (chunk) => voice.onChunk(chunk),
      onTts: (clip) => void voice.playClip(clip),
      onSpeak: (text) => voice.speakText(text),
    },
    offlineSide,
  );

  /** How well the players hear each other right now (0 when there is no partner). */
  const proximity = () => {
    if (!net.state || !net.side || !started) return 0;
    const partner = net.room?.seats[net.side === 'out' ? 'in' : 'out'];
    return partner?.connected ? voiceMix(net.state).gain : 0;
  };
  const voice = new Voice(
    {
      signal: (data) => net.voiceSignal(data),
      sendChunk: (chunk) => net.voiceChunk(chunk),
      proximity,
      isCaller: () => (net.side ? net.side === 'out' : null),
      onChange: () => render(),
    },
    new URLSearchParams(location.search).has('relay'),
  );

  const actions: UIActions = {
    onCreateRoom: () => net.createRoom(),
    onJoinRoom: (code) => net.joinRoom(code),
    onPlayWithAI: (side) => net.playWithAI(side),
    onLeaveRoom: () => {
      started = false;
      net.leave();
    },
    onSendChat: (text) => net.sendChat(text),
    onEnableMic: () => void voice.enableMic(),
    onSetMuted: (muted) => voice.setMuted(muted),
    onSetMicMode: (mode) => voice.setMode(mode),
    onSetPartnerVolume: (v) => voice.setVolume(v),
    onPlayAgain: () => net.restart(),
  };

  function uiState(): UIState {
    const seats = net.room?.seats;
    const full = !!seats && seats.out.taken && seats.in.taken;
    if (full) started = true;
    if (!net.side) started = false;
    const partner = net.side ? seats?.[net.side === 'out' ? 'in' : 'out'] : undefined;
    const status: UIState['status'] = net.busy
      ? 'connecting'
      : !net.side
        ? 'idle'
        : partner?.connected
          ? 'partner-joined'
          : started
            ? 'partner-left'
            : 'waiting';
    const inGame = !!net.side && !!net.state && started;
    return {
      screen: inGame ? 'game' : 'lobby',
      online: net.online,
      status,
      error: net.error,
      roomCode: net.code,
      mode: net.room?.mode ?? null,
      side: net.side,
      aiAvailable: net.info.aiAvailable,
      chat: net.chat,
      partnerTyping,
      hud: inGame ? hudOf(net.state!, net.side!, Date.now()) : null,
      voice: voice.snapshot(signalBars(proximity())),
    };
  }

  function render(): void {
    const state = uiState();
    const playing = state.screen === 'game';
    gameEl.style.visibility = playing ? 'visible' : 'hidden';
    game?.setState(playing ? net.state : null, net.side ?? 'out');
    handle?.update(state);
  }

  game = createGameView(gameEl, {
    onMove: (dx, dy) => started && net.move(dx, dy),
    onInteract: () => started && net.interact(),
    onTalk: (down) => voice.setTalkKey(down),
  });
  handle = ui.mount(root, actions);
  // Dev only: lets tests and the console inspect the client state.
  if (import.meta.env.DEV) Object.assign(window, { __cubic: net, __cubicVoice: voice });
  net.start();
  if (!offlineSide) void voice.resumeMic();
  render();
  setInterval(render, 500); // keeps the clock ticking
}
