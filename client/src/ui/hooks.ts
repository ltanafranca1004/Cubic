import type { ChatMessage, FaceId, RoomMode, Side } from '@cubic/shared';

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
}

export type LobbyStatus =
  | 'idle'
  | 'connecting'
  /** Room created, nobody else here yet. Show the code. */
  | 'waiting'
  | 'partner-joined'
  | 'partner-left';

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
  /** Every puzzle is solved: the portal on face 6 is awake. */
  portalOpen: boolean;
  strikes: number;
  elapsedMs: number;
  won: boolean;
  /** Item in hand, if any. */
  carrying: { id: string; kind: string } | null;
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
  status: LobbyStatus;
  error: string | null;
  roomCode: string | null;
  mode: RoomMode | null;
  side: Side | null;
  aiAvailable: boolean;
  chat: ChatMessage[];
  /** The AI partner is thinking. */
  partnerTyping: boolean;
  /** null until the game starts. */
  hud: HudState | null;
  voice: VoiceState;
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
