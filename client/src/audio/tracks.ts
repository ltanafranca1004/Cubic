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

interface AudioFile {
  file: string;
  /** Linear trim so every file comes out equally loud. */
  gain: number;
}

/** `lufs` is the file's measured integrated loudness (ffmpeg ebur128). */
const music = (file: string, lufs: number): AudioFile => ({ file, gain: dbToGain(MUSIC_LUFS - lufs) });

export const TRACKS: Record<TrackId, AudioFile> = {
  menu: music('music-menu.ogg', -13.2),
  lobby: music('music-lobby.ogg', -14.5),
  outside: music('music-outside.ogg', -12.4),
  inside: music('music-inside.ogg', -17.3),
};

export const SAMPLES: Record<SampleId, AudioFile & { fallback: string }> = {
  /** Puzzle solved. Falls back to the synthesized `solve` chime until the file is decoded. */
  solved: { file: 'sting-solved.mp3', gain: 0.35, fallback: 'solve' },
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
