import type { Side } from '@cubic/shared';
import { dbToGain } from './core';

// Which file plays where. The files live in client/public/assets/audio and are credited
// in /CREDITS.md. No DOM in here, so the tests can import it.

export type TrackId = 'menu' | 'lobby' | 'outside' | 'inside';
export const TRACK_IDS: TrackId[] = ['menu', 'lobby', 'outside', 'inside'];

/** Sampled effects. Every key of the synthesized `sfx` table in game/sfx.ts also works. */
export type SampleId = 'solved';
export type SfxId = SampleId | (string & {});

/** Music sits at this loudness (LUFS) with the music slider at full. */
const MUSIC_LUFS = -24;

export interface AudioFile {
  /** Ogg Opus. */
  file: string;
  /** The same audio as mp3, for browsers that cannot decode Ogg Opus (older Safari). */
  alt: string;
  /** Linear trim so every file comes out equally loud. */
  gain: number;
}

/** `lufs` is the measured integrated loudness (ffmpeg ebur128) of `name`.ogg and `name`.mp3. */
const music = (name: string, lufs: number): AudioFile => ({
  file: `${name}.ogg`,
  alt: `${name}.mp3`,
  gain: dbToGain(MUSIC_LUFS - lufs),
});

// Gentle acoustic pieces by Kevin MacLeod (CC BY 4.0, see /CREDITS.md), each one whole,
// levelled to about -20 LUFS and looped at the end of its last note.
export const TRACKS: Record<TrackId, AudioFile> = {
  menu: music('music-menu', -20.0), // "Morning": classical guitar, harp, flutes
  lobby: music('music-lobby', -20.0), // "Clear Air": two guitars, soft piano
  outside: music('music-outside', -20.0), // "Windswept": guitar and strings
  inside: music('music-inside', -20.3), // "Immersed": sparse piano over string drones
};

export const SAMPLES: Record<SampleId, AudioFile & { fallback: string }> = {
  /**
   * Puzzle solved: one rolled harp chord. Falls back to the synthesized `solve` chime
   * until the file is decoded.
   */
  solved: { file: 'sting-solved.ogg', alt: 'sting-solved.mp3', gain: 0.2, fallback: 'solve' },
};

/**
 * Every screen that has music. 'start' and 'mode' are the menu scenes, 'lobby' is the
 * room / side select, 'game' needs the local player's side.
 */
export type MusicScreen = 'start' | 'mode' | 'menu' | 'lobby' | 'game';

/** The track for a screen: `audio.playMusic(musicForScreen('start'))`. */
export function musicForScreen(screen: MusicScreen, side?: Side | null): TrackId {
  if (screen === 'game') return side === 'in' ? 'inside' : 'outside';
  return screen === 'lobby' ? 'lobby' : 'menu';
}
