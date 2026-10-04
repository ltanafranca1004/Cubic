import type { ChatMessage, FaceId, Role, RoomMode, Side, SignalView } from '@cubic/shared';

// THE UI HOOK INTERFACE.
// Everything outside the Phaser canvas (lobby, HUD, chat, voice controls, win screen) is a
// UIHost. The app calls `mount` once, then `update(state)` every time something changes.
// The UI calls `actions` when the player does something. A UI never talks to the socket,
// the game engine or Phaser directly.
//
// To replace the placeholder UI: implement UIHost in this folder and export it from
// ./index.ts. Build it against ./mock.ts (?mock=lobby, ?mock=hud, ?mock=game).

export interface UIActions {
  onCreateRoom(): void;
  onJoinRoom(code: string): void;
  /** Phase 2. `side` is the side the human wants to play. */
  onPlayWithAI(side: Side): void;
  /** Lobby: take a side, or null to step back to the middle. Refused if the partner has it. */
  onPickSide(side: Side | null): void;
  /** Lobby, guest only: ready up (needs a side) or take it back. */
  onSetReady(ready: boolean): void;
  /** Lobby, host only: start the game. Refused until `lobby.startBlocker` is null. */
  onStartGame(): void;
  onLeaveRoom(): void;
  onSendChat(text: string): void;
  /** Ask for the microphone (must be called from a click). */
  onEnableMic(): void;
  onSetMuted(muted: boolean): void;
  /** 'push' = hold V to talk (default), 'open' = always on. */
  onSetMicMode(mode: 'push' | 'open'): void;
  /** Partner volume, 0..1. */
  onSetPartnerVolume(volume: number): void;
  onPlayAgain(): void;
  /**
   * Put down the carried item (never picks one up), at once. The keyboard's drop key does
   * not come through here: the game scene buffers it with the moves (game/keys.ts).
   */
  onDrop(): void;
  /** 1 to 4: say a fixed line. `index` is 0..3 into QUICK_CHATS. */
  onQuickChat(index: number): void;
}

export type LobbyStatus =
  | 'idle'
  | 'connecting'
  /** Room created, nobody else here yet. Show the code. */
  | 'waiting'
  | 'partner-joined'
  /** In a game, the partner dropped or pressed Leave: the server holds their seat (see `partnerAway`). */
  | 'partner-away'
  /** The partner is gone for good (the held seat ran out): the seat is free. */
  | 'partner-left';

/** One player in the lobby. */
export interface LobbyPlayer {
  connected: boolean;
  isAI: boolean;
  /** The side they picked, or null while they stand in the middle. */
  side: Side | null;
  /** Only the guest readies up. */
  ready: boolean;
}

/** The side select screen. It is the server's view: both players always see the same. */
export interface LobbyState {
  /** You. The host is P1 and starts the game; the guest is P2 and readies up. */
  role: Role;
  host: LobbyPlayer;
  /** Null until someone joins with the code. */
  guest: LobbyPlayer | null;
  /** Why the host cannot start yet, or null when Start is live. */
  startBlocker: string | null;
}

export interface EdgeLabel {
  face: FaceId;
  name: string;
  solved: boolean;
}

export interface HudState {
  face: FaceId;
  faceName: string;
  /** 0 | 90 | 180 | 270: how far the player's "up" has turned from the face's own up. */
  drift: number;
  /** The face you reach by walking off each screen edge. */
  edges: Record<'up' | 'down' | 'left' | 'right', EdgeLabel>;
  objective: string;
  solved: FaceId[];
  /** How many puzzles there are (the registered ones). `solved.length` of them are done. */
  puzzleTotal: number;
  /** The face of each puzzle, in face order: one progress pip per entry. */
  puzzleFaces: FaceId[];
  /** Every puzzle is solved: the portal on face 6 is awake. */
  portalOpen: boolean;
  strikes: number;
  elapsedMs: number;
  won: boolean;
  /** Item in hand, if any. */
  carrying: { id: string; kind: string } | null;
  /** The face your partner is on (the HUD cube marks it, or points the way). */
  partnerFace?: FaceId | null;
}

export interface VoiceState {
  /** off: not asked yet. denied: show a clear "allow the mic in your browser" message. */
  mic: 'off' | 'asking' | 'denied' | 'on';
  mode: 'push' | 'open';
  muted: boolean;
  /** How the audio travels. relay = fallback through the server. */
  link: 'none' | 'connecting' | 'direct' | 'relay';
  /** You are transmitting right now. */
  talking: boolean;
  /** Partner speaking level 0..1 (for a speaking indicator). */
  partnerLevel: number;
  /** How well you hear your partner, in bars: 0 (silent) to 3 (same face). */
  signal: 0 | 1 | 2 | 3;
  partnerVolume: number;
}

export interface UIState {
  screen: 'lobby' | 'game';
  /** Socket connection to the server. */
  online: boolean;
  /** Not online because the server refuses this site (its CLIENT_ORIGIN): not a cold start. */
  blocked?: boolean;
  status: LobbyStatus;
  error: string | null;
  roomCode: string | null;
  mode: RoomMode | null;
  side: Side | null;
  aiAvailable: boolean;
  /** Set while you are in a room whose game has not started (pick sides, ready, start). */
  lobby: LobbyState | null;
  chat: ChatMessage[];
  /** The AI partner is thinking. */
  partnerTyping: boolean;
  /**
   * In a game, the partner's seat is held: their connection dropped (`reconnecting`) or
   * they pressed Leave (`left`). `until` is when the server gives the seat up, in epoch ms
   * on THIS clock: show `until - Date.now()` as m:ss.
   */
  partnerAway?: { kind: 'reconnecting' | 'left'; until: number } | null;
  /** null until the game starts. */
  hud: HudState | null;
  voice: VoiceState;
  /** Quick-chat bubbles to draw over the game view, in screen tiles. */
  signals?: SignalView;
}

export interface UIHandle {
  /** Called with a fresh state object on every change (several times a second in game). */
  update(state: UIState): void;
  destroy(): void;
}

export interface UIHost {
  /**
   * Build your DOM inside `root`. The Phaser canvas lives in `root.querySelector('#game')`,
   * which already exists: position your UI around or over it, do not remove it.
   */
  mount(root: HTMLElement, actions: UIActions): UIHandle;
}
