import { AI_VOICE_KEYS, DEFAULT_AI_VOICE, type AiVoice } from '@cubic/shared';
import { DEFAULT_BINDINGS, cleanBindings, useBindings, type Bindings } from '../input/bindings';
import { audio } from './audioApi';

// Player settings. They apply the moment they change and are saved in the browser
// (localStorage), so they are still there after a reload. Where storage is not available
// (private mode, blocked cookies) they simply last for the session.

export interface Settings {
  /** 0 to 1. */
  master: number;
  music: number;
  sfx: number;
  /** Proximity voice chat as a whole: off = you neither hear nor send. */
  voiceOn: boolean;
  /** How loud your partner is, 0 to 1. */
  voiceVolume: number;
  micMuted: boolean;
  /** Swap animated transitions and turns for a quick fade or a snap; no UI animations. */
  reduceMotion: boolean;
  /** Open mic, or push to talk (hold the talk key). */
  micMode: 'open' | 'ptt';
  textSize: 's' | 'm' | 'l';
  highContrast: boolean;
  /** Off = the camera never shakes. */
  screenShake: boolean;
  /** Off = no onboarding or context hints. */
  hints: boolean;
  /** Which key does which game action (input/bindings.ts). */
  keys: Bindings;
  /** The voice the AI partner speaks with (solo games): a key of AI_VOICES. The server is told by app.ts. */
  aiVoice: AiVoice;
}

/** The volumes match the AudioManager's own defaults, so nothing jumps when the UI mounts. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  master: 0.8,
  music: 0.35,
  sfx: 0.7,
  voiceOn: true,
  voiceVolume: 1,
  micMuted: false,
  reduceMotion: false,
  micMode: 'ptt',
  textSize: 'm',
  highContrast: false,
  screenShake: true,
  hints: true,
  keys: { ...DEFAULT_BINDINGS },
  aiVoice: DEFAULT_AI_VOICE,
};

/** Where the voice settings go: the existing Voice class, through the UI actions. */
export interface VoiceSink {
  setVolume(v: number): void;
  setMuted(muted: boolean): void;
  /** Open mic, or push-to-talk. */
  setMode?(mode: Settings['micMode']): void;
}

// ---------- saving ----------

/** The version is part of the key: a change of shape starts from the defaults again. */
export const STORAGE_KEY = 'cubic.settings.v1';
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = { micMode: ['open', 'ptt'], textSize: ['s', 'm', 'l'], aiVoice: AI_VOICE_KEYS };

/** Saved settings, checked field by field: anything missing or of the wrong kind is the default. */
export function cleanSettings(raw: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_BINDINGS } };
  if (!raw || typeof raw !== 'object') return out as unknown as Settings;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = r[key];
    const choices = CHOICES[key];
    if (key === 'keys') out[key] = cleanBindings(v);
    else if (choices) {
      if (typeof v === 'string' && choices.includes(v)) out[key] = v;
    } else if (typeof DEFAULT_SETTINGS[key] === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(1, Math.max(0, v));
    } else if (typeof v === 'boolean') out[key] = v;
  }
  return out as unknown as Settings;
}

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** The browser's storage, or null where there is none (a test, a locked-down browser). */
function store(): Store | null {
  try {
    const s = (globalThis as { localStorage?: Store }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null; // reading the property itself can throw (blocked storage)
  }
}

function load(): Settings {
  try {
    const text = store()?.getItem(STORAGE_KEY);
    return cleanSettings(text ? JSON.parse(text) : null);
  } catch {
    return cleanSettings(null); // private mode, or what was saved is not JSON
  }
}

function save(): void {
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // no storage, or it is full: the settings still hold for this session
  }
}

const current: Settings = load();
useBindings(current.keys);
const listeners = new Set<(s: Settings) => void>();
let voice: VoiceSink | null = null;

export const settings = (): Readonly<Settings> => current;

function apply(keys: readonly (keyof Settings)[]): void {
  if (keys.includes('master')) audio.setMaster(current.master);
  if (keys.includes('music')) audio.setMusic(current.music);
  if (keys.includes('sfx')) audio.setSfx(current.sfx);
  if (voice && keys.some((k) => k === 'voiceOn' || k === 'voiceVolume' || k === 'micMuted')) {
    voice.setVolume(current.voiceOn ? current.voiceVolume : 0);
    voice.setMuted(!current.voiceOn || current.micMuted);
  }
  if (voice && keys.includes('micMode')) voice.setMode?.(current.micMode);
  if (keys.includes('keys')) useBindings(current.keys);
}

const ALL = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Connect the voice settings and push every setting out once. */
export function bindSettings(sink: VoiceSink): void {
  voice = sink;
  apply(ALL);
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (current[key] === value) return;
  current[key] = typeof value === 'number' ? (Math.min(1, Math.max(0, value)) as Settings[K]) : value;
  apply([key]);
  save();
  for (const l of listeners) l(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
