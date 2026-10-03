// Core types shared by client and server. Pure data, no DOM, no networking.

/** Integer 3D vector. Face normals and "up" vectors are always axis-aligned unit vectors. */
export type Vec = readonly [number, number, number];

/** Which surface of the cube a player walks on. */
export type Side = 'out' | 'in';
export const SIDES: readonly Side[] = ['out', 'in'];

/** Faces by normal: 1=+z 2=+x 3=-z 4=-x 5=+y 6=-y. */
export type FaceId = 1 | 2 | 3 | 4 | 5 | 6;
export const FACES: readonly FaceId[] = [1, 2, 3, 4, 5, 6];

/** Tiles per face edge and pixels per tile. */
export const GRID = 10;
export const TILE_PX = 16;

/** A tile on one face, in that face's canonical coords (x right, y down, 0..GRID-1). */
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

export interface RoomInfo {
  code: string;
  mode: RoomMode;
  /** Seat status per side. */
  seats: Record<Side, { taken: boolean; connected: boolean; isAI: boolean }>;
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

// ---------- socket messages ----------

export type Ack<T> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

/** Returned on create/join. Keep `token` (sessionStorage) to rejoin after a disconnect. */
export interface Seat {
  code: string;
  side: Side;
  token: string;
  room: RoomInfo;
  state: GameState;
  chat: ChatMessage[];
}

export interface ServerInfo {
  /** GEMINI_API_KEY is set: "Play with AI" works. */
  aiAvailable: boolean;
  /** ELEVENLABS_API_KEY is set: the AI partner speaks. */
  ttsAvailable: boolean;
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

export interface StateUpdate {
  state: GameState;
  events: GameEvent[];
  /** Highest move seq the server has processed per side. Used to reconcile prediction. */
  acks: Record<Side, number>;
}

export interface ClientToServer {
  'room:create': (ack: Ack<Seat>) => void;
  'room:join': (msg: { code: string }, ack: Ack<Seat>) => void;
  /** Phase 2: play alone as `side`; an AI takes the other one. */
  'room:createAI': (msg: { side: Side }, ack: Ack<Seat>) => void;
  'room:rejoin': (msg: { code: string; token: string }, ack: Ack<Seat>) => void;
  'room:leave': () => void;
  /** After a win: start a fresh game in the same room. */
  'room:restart': () => void;
  /** dx,dy in SCREEN space of the sender: exactly one of them is -1 or 1. */
  move: (msg: { dx: number; dy: number; seq: number }) => void;
  /** Pick up / drop (E key). */
  interact: (msg: { seq: number }) => void;
  chat: (msg: { text: string }) => void;
  /** WebRTC signaling (offer/answer/ICE), relayed untouched to the partner. */
  'voice:signal': (msg: { data: unknown }) => void;
  /** Fallback audio relay when the direct connection fails. */
  'voice:chunk': (msg: VoiceChunk) => void;
}

export interface ServerToClient {
  info: (msg: ServerInfo) => void;
  state: (msg: StateUpdate) => void;
  room: (msg: RoomInfo) => void;
  chat: (msg: ChatMessage) => void;
  /** The AI partner is thinking. */
  typing: (msg: { from: Side; on: boolean }) => void;
  'voice:signal': (msg: { data: unknown }) => void;
  'voice:chunk': (msg: VoiceChunk) => void;
  /** The partner (re)connected and is ready for a voice call. The outside player calls. */
  'voice:ready': () => void;
  tts: (msg: TtsClip) => void;
}
