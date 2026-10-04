import { audio } from './audioApi';

// Player settings. They apply the moment they change and live in memory for the session
// (a refresh starts from the defaults).

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
}

/** The volumes match the AudioManager's own defaults, so nothing jumps when the UI mounts. */
export const DEFAULT_SETTINGS: Settings = { master: 1, music: 0.6, sfx: 1, voiceOn: true, voiceVolume: 1, micMuted: false };

/** Where the voice settings go: the existing Voice class, through the UI actions. */
export interface VoiceSink {
  setVolume(v: number): void;
  setMuted(muted: boolean): void;
}

const current: Settings = { ...DEFAULT_SETTINGS };
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
  for (const l of listeners) l(current);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
