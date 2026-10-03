// The audio the UI talks to. The real one is client/src/audio/AudioManager.ts, built in
// another branch with exactly this API. Until it is wired in, every call lands in a silent
// stand-in, so the menus and the settings panel work either way.
//
// To wire it (one line, e.g. in main.ts):  setAudioApi(audioManager)

export type MusicTrack = 'menu' | 'lobby' | 'outside' | 'inside';

export interface AudioApi {
  /** Volumes are 0 to 1 and apply at once. */
  setMaster(v: number): void;
  setMusic(v: number): void;
  setSfx(v: number): void;
  playMusic(trackId: string, opts?: { fade?: number }): void;
  stopMusic(opts?: { fade?: number }): void;
  playSfx(id: string): void;
}

const silent: AudioApi = {
  setMaster() {},
  setMusic() {},
  setSfx() {},
  playMusic() {},
  stopMusic() {},
  playSfx() {},
};

let impl: AudioApi = silent;
/** What the UI last asked for, replayed into the real manager when it arrives. */
const wanted = { master: null as number | null, music: null as number | null, sfx: null as number | null, track: null as string | null };

/** Plug in the real AudioManager. Volumes and the current track carry over. */
export function setAudioApi(api: AudioApi): void {
  impl = api;
  if (wanted.master !== null) api.setMaster(wanted.master);
  if (wanted.music !== null) api.setMusic(wanted.music);
  if (wanted.sfx !== null) api.setSfx(wanted.sfx);
  if (wanted.track !== null) api.playMusic(wanted.track, { fade: 0.6 });
}

/** The audio API the UI uses. Never throws: a broken sound must not break a menu. */
export const audio: AudioApi = {
  setMaster(v) {
    wanted.master = v;
    safely(() => impl.setMaster(v));
  },
  setMusic(v) {
    wanted.music = v;
    safely(() => impl.setMusic(v));
  },
  setSfx(v) {
    wanted.sfx = v;
    safely(() => impl.setSfx(v));
  },
  playMusic(trackId, opts) {
    if (wanted.track === trackId) return; // already the track: do not restart it
    wanted.track = trackId;
    safely(() => impl.playMusic(trackId, opts));
  },
  stopMusic(opts) {
    wanted.track = null;
    safely(() => impl.stopMusic(opts));
  },
  playSfx(id) {
    safely(() => impl.playSfx(id));
  },
};

function safely(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.warn('[audio]', e);
  }
}
