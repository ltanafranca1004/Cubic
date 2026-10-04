// Core types shared by client and server. Pure data, no DOM, no networking.

/** Integer 3D vector. Face normals and "up" vectors are always axis-aligned unit vectors. */
export type Vec = readonly [number, number, number];

/** Which surface of the cube a player walks on. */
export type Side = 'out' | 'in';
export const SIDES: readonly Side[] = ['out', 'in'];

/** Faces by normal: 1=+z 2=+x 3=-z 4=-x 5=+y 6=-y. */
export type FaceId = 1 | 2 | 3 | 4 | 5 | 6;
export const FACES: readonly FaceId[] = [1, 2, 3, 4, 5, 6];

/** Tiles per face edge and pixels per tile. Read FACE_SIZE; never hardcode the number. */
export const FACE_SIZE = 12;
export const TILE_PX = 16;

/** A tile on one face, in that face's canonical coords (x right, y down, 0..FACE_SIZE-1). */
export interface TileRef {
  face: FaceId;
  x: number;
  y: number;
}

/**
 * Where a player is and how they are turned.
 * `up` is the 3D direction that is screen-up for this player. It drifts away from the
 * face's canonical up as the player walks around cube corners.
 * `x`/`y` are canonical tile coords, the same for both sides: inside tile (x,y) is directly
 * behind outside tile (x,y).
 */
export interface Pose {
  side: Side;
  face: FaceId;
  up: Vec;
  x: number;
  y: number;
  /** Sprite facing on screen: 1 right, -1 left. */
  dir: 1 | -1;
}

export interface Player {
  side: Side;
  pose: Pose;
  connected: boolean;
  isAI: boolean;
  /** Total steps taken, used for the walk animation frame. */
  steps: number;
  /** Id of the item being carried, or null. One item at a time. */
  carrying: string | null;
}

/**
 * A carryable thing. Comes from a map object of type "item" (its name is the id).
 * While carried, side/face/x/y are stale: the item is wherever `carriedBy` is.
 */
export interface Item {
  id: string;
  /** What it is, e.g. "rose". Picks the art and what targets accept. Map prop "kind". */
  kind: string;
  side: Side;
  face: FaceId;
  x: number;
  y: number;
  carriedBy: Side | null;
  /** Name of the target it was placed on. Placed items stay put. */
  placedOn: string | null;
  props: Record<string, string | number | boolean>;
}

/** Whole game. JSON-serializable: the server broadcasts it as is. */
export interface GameState {
  players: Record<Side, Player>;
  /** Per-puzzle state keyed by PuzzleModule.id. Owned by that module. */
  puzzles: Record<string, unknown>;
  /** Carryable items by id. */
  items: Record<string, Item>;
  /** Faces whose puzzle is solved (latched). */
  solved: FaceId[];
  strikes: number;
  /** Epoch ms. */
  startedAt: number;
  wonAt: number | null;
}

export type GameEvent =
  | { type: 'step'; side: Side }
  | { type: 'bump'; side: Side }
  /** Walked over a cube edge onto another face. dx/dy is the screen direction walked. */
  | { type: 'flip'; side: Side; from: FaceId; to: FaceId; dx: number; dy: number }
  | { type: 'push'; side: Side }
  | { type: 'solve'; face: FaceId; puzzle: string }
  | { type: 'strike'; side: Side }
  | { type: 'win' }
  | { type: 'pickup'; side: Side; item: string }
  | { type: 'drop'; side: Side; item: string }
  /** Dropped on a target that accepts it. */
  | { type: 'place'; side: Side; item: string; target: string }
  /** Custom event from a puzzle module (ctx.emit), e.g. name "door-open". */
  | { type: 'puzzle'; puzzle: string; name: string; data?: Record<string, string | number | boolean> };

// ---------- rooms and chat ----------

export type RoomMode = 'friend' | 'ai';

/** Who made the room (host) and who joined it (guest). Only the host can start the game. */
export type Role = 'host' | 'guest';
export const ROLES: readonly Role[] = ['host', 'guest'];

/** lobby: picking sides and readying up. playing: the game runs and the sides are locked. */
export type RoomPhase = 'lobby' | 'playing';

/** One person (or the AI) in a room, as everyone in the room sees them. */
export interface MemberInfo {
  /** Stable within the room. Compare with `Seat.id` to find yourself. */
  id: number;
  connected: boolean;
  isAI: boolean;
  /** The side they picked, or null while they have not picked one. */
  side: Side | null;
  /** The guest pressed Ready. Always false for the host. */
  ready: boolean;
}

export interface RoomInfo {
  code: string;
  mode: RoomMode;
  phase: RoomPhase;
  /** Seat status per side: who holds (or, in the lobby, has picked) it. */
  seats: Record<Side, { taken: boolean; connected: boolean; isAI: boolean }>;
  members: Record<Role, MemberInfo | null>;
}

export interface ChatMessage {
  id: number;
  from: Side;
  isAI: boolean;
  text: string;
  /** Epoch ms. */
  at: number;
}

export const CHAT_MAX_LEN = 200;

/** A ping marker (F key): dropped on the sender's own tile. Rules in signals.ts. */
export interface Ping {
  id: number;
  from: Side;
  face: FaceId;
  x: number;
  y: number;
  /** Epoch ms (server clock). */
  at: number;
}

/** A quick-chat bubble (keys 1 to 4). The line is also a normal chat message (`chatId`). */
export interface QuickChat {
  id: number;
  from: Side;
  /** Index into QUICK_CHATS. */
  index: number;
  chatId: number;
  /** Epoch ms (server clock). */
  at: number;
}

// ---------- socket messages ----------

export type Ack<T> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

/** Returned on create/join. Keep `token` (sessionStorage) to rejoin after a disconnect. */
export interface Seat {
  code: string;
  /** Your member id: find yourself in `room.members` with it (roles can change). */
  id: number;
  role: Role;
  /** Null in the lobby until you pick a side. */
  side: Side | null;
  token: string;
  room: RoomInfo;
  state: GameState;
  chat: ChatMessage[];
}

export interface ServerInfo {
  /** GEMINI_API_KEY is set: "Play with AI" works. */
  aiAvailable: boolean;
  /** The AI partner's lines are spoken (ElevenLabs clip or the browser's own voice). */
  ttsAvailable: boolean;
  /** How the server intends to voice the AI. `browser` = free speechSynthesis. */
  ttsMode: 'browser' | 'elevenlabs';
}

/** One relayed audio chunk (fallback when WebRTC cannot connect directly). */
export interface VoiceChunk {
  seq: number;
  mime: string;
  data: ArrayBuffer;
}

/** A spoken AI chat line (ElevenLabs). Play it through the voiceMix gain. */
export interface TtsClip {
  chatId: number;
  mime: string;
  data: ArrayBuffer;
}

/** Narrow what an interact does: only pick up, or only drop. Unset = whichever applies. */
export type InteractOnly = 'pick' | 'drop';

export interface StateUpdate {
  state: GameState;
  events: GameEvent[];
  /** Highest move seq the server has processed per side. Used to reconcile prediction. */
  acks: Record<Side, number>;
}

/**
 * Dev tools (client `?dev`). The server only obeys when it runs with DEV_COMMANDS=1, and
 * never when NODE_ENV=production; otherwise every command is answered with an error.
 */
export type DevCommand =
  /** Does nothing: the answer's round trip is the ping. */
  | { type: 'ping' }
  /** Put `side` (either player, whoever asks) on `face`. */
  | { type: 'teleport'; side: Side; face: FaceId }
  /** Force-latch the puzzle on `face` as solved. */
  | { type: 'solve'; face: FaceId };

export interface ClientToServer {
  'room:create': (ack: Ack<Seat>) => void;
  'room:join': (msg: { code: string }, ack: Ack<Seat>) => void;
  /** Phase 2: play alone as `side`; an AI takes the other one. */
  'room:createAI': (msg: { side: Side }, ack: Ack<Seat>) => void;
  'room:rejoin': (msg: { code: string; token: string }, ack: Ack<Seat>) => void;
  'room:leave': () => void;
  /** Lobby: take a side, or null to step back to the middle. Fails if the partner has it. */
  'lobby:pick': (msg: { side: Side | null }, ack?: Ack<object>) => void;
  /** Lobby, guest only: ready up (needs a side) or take it back. */
  'lobby:ready': (msg: { ready: boolean }, ack?: Ack<object>) => void;
  /** Lobby, host only: start once both sides are picked and the guest is ready. */
  'lobby:start': (ack?: Ack<object>) => void;
  /** After a win: start a fresh game in the same room. */
  'room:restart': () => void;
  /** dx,dy in SCREEN space of the sender: exactly one of them is -1 or 1. */
  move: (msg: { dx: number; dy: number; seq: number }) => void;
  /** Pick up / drop (E key). `only: 'drop'` (Q key) drops and never picks up. */
  interact: (msg: { seq: number; only?: InteractOnly }) => void;
  chat: (msg: { text: string }) => void;
  /** Drop a ping marker on your own tile (F key). Rate limited. */
  ping: () => void;
  /** Say one of the fixed QUICK_CHATS lines (keys 1 to 4). Rate limited like chat. */
  quick: (msg: { index: number }) => void;
  /** WebRTC signaling (offer/answer/ICE), relayed untouched to the partner. */
  'voice:signal': (msg: { data: unknown }) => void;
  /** Fallback audio relay when the direct connection fails. */
  'voice:chunk': (msg: VoiceChunk) => void;
  /** Dev tools only, see DevCommand. */
  dev: (cmd: DevCommand, ack: Ack<object>) => void;
}

export interface ServerToClient {
  info: (msg: ServerInfo) => void;
  state: (msg: StateUpdate) => void;
  room: (msg: RoomInfo) => void;
  chat: (msg: ChatMessage) => void;
  ping: (msg: Ping) => void;
  quick: (msg: QuickChat) => void;
  /** The AI partner is thinking. */
  typing: (msg: { from: Side; on: boolean }) => void;
  'voice:signal': (msg: { data: unknown }) => void;
  'voice:chunk': (msg: VoiceChunk) => void;
  /** The partner (re)connected and is ready for a voice call. The outside player calls. */
  'voice:ready': () => void;
  tts: (msg: TtsClip) => void;
  /** Say this AI line with the browser's own speechSynthesis (free, or ElevenLabs failed). */
  speak: (msg: { chatId: number; text: string }) => void;
}
