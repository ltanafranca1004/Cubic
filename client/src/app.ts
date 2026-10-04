import {
  FACE_NAMES,
  NO_SIGNALS,
  BUBBLE_MS,
  bubbleAlive,
  compassDrift,
  defaultEnv,
  neighbours,
  objectiveFor,
  portalFace,
  portalOpen,
  relayText,
  sameWall,
  signalBars,
  signalsFor,
  voiceMix,
  type GameEvent,
  type GameState,
  type FaceId,
  type QuickChat,
  type Side,
} from '@cubic/shared';
import { audio, musicForScreen } from './audio/AudioManager';
import { heardSfx } from './audio/hearing';
import { createGameView, type GameHandle } from './game';
import { sfx } from './game/sfx';
import { Net } from './net/client';
import { setPartnerLevel, showCaption } from './ui/captions';
import { chatText, type HudState, type LobbyState, type UIActions, type UIHandle, type UIHost, type UIState } from './ui/hooks';
import { mountOnboarding } from './ui/onboarding';
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
    puzzleTotal: defaultEnv.puzzles.length,
    puzzleFaces: defaultEnv.puzzles.map((p) => p.face).sort((a, b) => a - b),
    // only a world that has a portal can have one open (the shipped maps have none)
    portalOpen: portalFace() !== null && portalOpen(state),
    strikes: state.strikes,
    elapsedMs: Math.max(0, (state.wonAt ?? now) - state.startedAt),
    won: state.wonAt !== null,
    carrying: carried ? { id: carried.id, kind: carried.kind } : null,
    partnerFace: state.players[me === 'out' ? 'in' : 'out'].pose.face,
  };
}

/**
 * Hook for the dev tools (client/src/dev, ?dev only): the running app's Net, a way to
 * redraw, and `viewSide` to draw the other player's side instead of our own (hot-seat).
 */
export const devHooks: { net: Net | null; viewSide: Side | null; render(): void } = { net: null, viewSide: null, render: () => {} };

/** How long the lobby shows "Your partner left due to inactivity". */
const NOTICE_MS = 10_000;

export function startApp(root: HTMLElement, ui: UIHost, offlineSide: Side | null = null): void {
  const gameEl = document.createElement('div');
  gameEl.id = 'game';
  root.appendChild(gameEl);

  let partnerTyping = false;
  /** Live quick-chat bubbles, stamped with OUR clock when they arrived. */
  let quicks: QuickChat[] = [];
  /** Is something on that face on our wall (do we see and hear it)? */
  const onMyWall = (face: FaceId) => !!net.state && !!net.side && sameWall(face, net.state.players[net.side].pose.face);
  let handle: UIHandle | null = null;
  let game: GameHandle | null = null;

  const net = new Net(
    {
      onChange: () => render(),
      onEvents: (events: GameEvent[]) => {
        // Sound follows the cube: the partner's steps only through the shared wall, never their ding.
        if (net.side && net.state) for (const id of heardSfx(events, net.side, net.state, (key) => key in sfx)) audio.playSfx(id);
        if (events.some((e) => e.type === 'solve')) audio.playSfx('solved');
        game?.handle(events);
      },
      onChat: () => {},
      onQuick: (quick) => {
        const now = Date.now();
        quicks = [...quicks.filter((q) => bubbleAlive(q.at, now)), { ...quick, at: now }];
        if (net.state && quick.from !== net.side && onMyWall(net.state.players[quick.from].pose.face)) sfx.quick?.();
        render();
        setTimeout(render, BUBBLE_MS + 20);
      },
      onTyping: (on) => {
        partnerTyping = on;
        render();
      },
      onVoiceReady: () => voice.onReady(),
      onVoiceSignal: (data) => void voice.onSignal(data),
      onVoiceChunk: (chunk) => voice.onChunk(chunk),
      // whatever the AI partner says out loud is also captioned
      onTts: (clip) => {
        const line = net.chat.find((m) => m.id === clip.chatId);
        if (line) showCaption(line.text, { speaker: 'AI' });
        void voice.playClip(clip);
      },
      onTtsChain: (chain) => {
        // a relay line: the caption is its pieces, the sound is their clips in a row
        let text: string;
        try {
          text = relayText(chain.pieces);
        } catch {
          text = net.chat.find((m) => m.id === chain.chatId)?.text ?? chain.pieces.join(' ');
        }
        showCaption(text, { speaker: 'AI' });
        void voice.playChain(chain, () => voice.speakText(text));
      },
      onSpeak: (text) => {
        showCaption(text, { speaker: 'AI' });
        voice.speakText(text);
      },
    },
    offlineSide,
  );

  /** The host has started the game (or it is an AI game): we are past the lobby. */
  const playing = () => net.room?.phase === 'playing';
  /** How well the players hear each other right now (0 when there is no partner). */
  const proximity = () => {
    if (!net.state || !net.side || !playing()) return 0;
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
    onResumeSolo: () => net.resumeSolo(),
    onPickSide: (side) => net.pickSide(side),
    onSetReady: (ready) => net.setReady(ready),
    onStartGame: () => net.startGame(),
    onLeaveRoom: () => net.leave(),
    onSendChat: (text) => net.sendChat(text),
    onEnableMic: () => void voice.enableMic(),
    onSetMuted: (muted) => voice.setMuted(muted),
    onSetMicMode: (mode) => voice.setMode(mode),
    onSetPartnerVolume: (v) => voice.setVolume(v),
    onPlayAgain: () => net.restart(),
    onDrop: () => playing() && net.interact('drop'),
    onQuickChat: (index) => playing() && net.quick(index),
  };

  /** The side we draw: our own, unless the dev tools show the other one. */
  const viewSide = () => (net.side ? (devHooks.viewSide ?? net.side) : null);

  /** The lobby as the UI shows it. The server decides everything; this only reads it. */
  function lobbyOf(): LobbyState | null {
    const room = net.room;
    if (!room || !net.role || room.phase !== 'lobby' || !room.members.host) return null;
    const { host, guest } = room.members;
    const blocker = !guest?.connected ? 'Waiting for a second player.' : !host.side || !guest.side ? 'Both players need to pick a side.' : !guest.ready ? 'Waiting for P2 to ready up.' : null;
    return {
      role: net.role,
      host: { connected: host.connected, isAI: host.isAI, side: host.side, ready: host.ready },
      guest: guest ? { connected: guest.connected, isAI: guest.isAI, side: guest.side, ready: guest.ready } : null,
      startBlocker: blocker,
    };
  }

  /** The lobby's system line: a running inactivity countdown, or who was just removed. */
  function noticeOf(): string | null {
    const last = net.chat.filter((m) => m.system).at(-1);
    const now = Date.now();
    if (last?.system?.kind === 'idle') return chatText(last, now);
    return last?.system?.kind === 'removed' && now - last.at < NOTICE_MS ? last.text : null;
  }

  function uiState(): UIState {
    const room = net.room;
    const partner = net.role ? room?.members[net.role === 'host' ? 'guest' : 'host'] : undefined;
    // In a game a partner who is still a member but not connected dropped or pressed Leave:
    // the server holds the seat (partnerAway says which, and until when). Once the window
    // has passed they are no longer a member at all.
    const status: UIState['status'] = net.busy ? 'connecting' : !net.role ? 'idle' : partner?.connected ? 'partner-joined' : partner ? (playing() ? 'partner-away' : 'partner-left') : playing() ? 'partner-left' : 'waiting';
    const inGame = !!net.side && !!net.state && playing();
    return {
      screen: inGame ? 'game' : 'lobby',
      online: net.online,
      blocked: net.blocked,
      status,
      error: net.error,
      roomCode: net.code,
      mode: room?.mode ?? null,
      side: viewSide(),
      aiAvailable: net.info.aiAvailable,
      soloLeft: net.code ? null : net.leftSolo(),
      lobby: lobbyOf(),
      chat: net.chat,
      partnerTyping,
      partnerAway: inGame ? net.partnerAway() : null,
      notice: inGame ? null : noticeOf(),
      idleUntil: net.idleUntil(),
      hud: inGame ? hudOf(net.state!, viewSide()!, Date.now()) : null,
      voice: voice.snapshot(signalBars(proximity())),
      signals: inGame ? signalsFor(net.state!, viewSide()!, quicks, Date.now()) : NO_SIGNALS,
    };
  }

  /**
   * The voice call follows the room. It starts on the server's `voice:ready`; it ends here:
   * for good (the microphone is let go too) when we are in no room or the partner gave
   * their seat up, and for now when the partner lost their connection and the seat is held.
   */
  let callState: 'none' | 'gone' | 'held' | 'on' = 'none';
  function syncVoice(): void {
    const partner = net.role ? net.room?.members[net.role === 'host' ? 'guest' : 'host'] : undefined;
    const next = !net.code ? 'none' : partner?.connected ? 'on' : partner ? 'held' : 'gone';
    if (next === callState) return;
    callState = next;
    if (next !== 'on') voice.hangUp(next !== 'held');
    // The mic is never opened on the title screen or in an empty lobby. With a partner in
    // the room it comes back by itself if this browser already allowed it; otherwise the
    // player presses Enable mic (or TALK on a touch screen).
    else if (!offlineSide) void voice.resumeMic();
  }

  function render(): void {
    syncVoice();
    const state = uiState();
    const playing = state.screen === 'game';
    gameEl.style.visibility = playing ? 'visible' : 'hidden';
    game?.setState(playing ? net.state : null, viewSide() ?? 'out');
    // Music follows the screen: menu, then lobby once in a room, then the side being shown.
    audio.playMusic(musicForScreen(playing ? 'game' : net.code ? 'lobby' : 'menu', viewSide()));
    handle?.update(state);
  }

  game = createGameView(gameEl, {
    onMove: (dx, dy) => playing() && net.move(dx, dy),
    onInteract: (only) => playing() && net.interact(only),
    onTalk: (down) => voice.setTalkKey(down),
  });
  handle = ui.mount(root, actions);
  mountOnboarding(root, net); // hints, the side intro card and the narrator's captions (ui/onboarding)
  // Dev only: lets tests and the console inspect the client state.
  if (import.meta.env.DEV) Object.assign(window, { __cubic: net, __cubicVoice: voice, __cubicAudio: audio });
  Object.assign(devHooks, { net, render });
  // Inactivity: any key or tap says we are here (the server hears moves and chat by itself).
  for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, () => net.activity(), true);
  // iOS only lets sound start from a tap: every tap keeps the voice path allowed to play.
  window.addEventListener('touchend', () => voice.prime(), true);
  net.start();
  render();
  setInterval(render, 500); // keeps the clock ticking
  setInterval(() => {
    audio.setVoiceLevel(voice.partnerLevelNow); // music ducks under the partner's voice
    setPartnerLevel(voice.partnerLevelNow); // and the "Partner speaking" tag follows it
    if (voice.talkingNow) net.activity(); // talking is being here, also for a player who stands still
  }, 50);
}
