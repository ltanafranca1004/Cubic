import { audioContext, routeSfx, sfx } from '../game/sfx';
import { Mixer, onFirstGesture, type FadeOptions, type Volumes } from './core';
import { SAMPLES, TRACKS, type AudioFile, type SampleId, type SfxId, type TrackId } from './tracks';

// All game sound except voice chat: music per screen (crossfaded, ducked under the
// partner's voice) and sound effects, behind three volumes. The logic is in ./core; this
// file binds it to the shared AudioContext, the files in public/assets/audio and the
// first click.
//
//   import { audio, musicForScreen } from '../audio/AudioManager';
//   audio.setMusic(0.5);                       // 0..1, heard at once
//   audio.playMusic(musicForScreen('start'));  // waits for the first click or key
//   audio.playSfx('solved');

export { CROSSFADE_MS, DEFAULT_VOLUMES, type FadeOptions, type Volumes } from './core';
export { TRACK_IDS, musicForScreen, type MusicScreen, type SampleId, type SfxId, type TrackId } from './tracks';

const AUDIO_DIR = `${import.meta.env.BASE_URL}assets/audio/`;
/** Decoded loops kept in memory (about 30 MB each): the playing one and the one before. */
const KEEP_DECODED = 2;

export class AudioManager {
  private mixer: Mixer<TrackId, AudioBuffer>;
  private decoded = new Map<TrackId, Promise<AudioBuffer | null>>();
  private samples = new Map<SampleId, AudioBuffer>();

  constructor() {
    this.mixer = new Mixer<TrackId, AudioBuffer>({
      context: () => audioContext(),
      load: (id) => this.loadTrack(id),
      trackGain: (id) => TRACKS[id].gain,
    });
    // The synthesized effects in game/sfx.ts play into the SFX bus.
    routeSfx(() => this.mixer.sfxInput() as GainNode);
    if (typeof window !== 'undefined') this.arm();
  }

  // ----- volumes (0..1, applied instantly) -----

  setMaster(v: number): void {
    this.mixer.setMaster(v);
  }

  setMusic(v: number): void {
    this.mixer.setMusic(v);
  }

  setSfx(v: number): void {
    this.mixer.setSfx(v);
  }

  /** The current volumes, e.g. to initialise sliders. */
  get volumes(): Volumes {
    return this.mixer.volumes;
  }

  // ----- music -----

  /**
   * Loop a track, crossfading from the current one (`fade` in ms, default 800). Before
   * the first click or key press the track is remembered and starts with that gesture.
   * Asking for the track that already plays does nothing.
   */
  playMusic(trackId: TrackId, opts?: FadeOptions): void {
    void this.mixer.playMusic(trackId, opts);
  }

  stopMusic(opts?: FadeOptions): void {
    this.mixer.stopMusic(opts);
  }

  /** The track that is playing or queued. */
  get track(): TrackId | null {
    return this.mixer.track;
  }

  // ----- sound effects -----

  /** 'solved' (the puzzle-solved sting) or any key of the synthesized table, e.g. 'step'. */
  playSfx(id: SfxId): void {
    const sample = id in SAMPLES ? SAMPLES[id as SampleId] : null;
    const buffer = this.samples.get(id as SampleId);
    if (!sample || !buffer) {
      sfx[sample?.fallback ?? id]?.();
      return;
    }
    try {
      const ac = audioContext();
      const src = ac.createBufferSource();
      const gain = ac.createGain();
      src.buffer = buffer;
      gain.gain.value = sample.gain;
      src.connect(gain).connect(this.mixer.sfxInput() as GainNode);
      src.start();
    } catch {
      // audio not available: stay silent
    }
  }

  // ----- ambience (the looping face sounds in client/src/world/ambience/loops.ts) -----

  /** True once the first click or key press has let the AudioContext run. */
  get unlocked(): boolean {
    return this.mixer.isUnlocked;
  }

  /** The SFX bus (master x sfx), for a source that starts and stops itself, e.g. a loop. */
  sfxBus(): GainNode {
    return this.mixer.sfxInput() as GainNode;
  }

  /** Fetch and decode a file in assets/audio. Null when it cannot be loaded. */
  loadBuffer(file: string): Promise<AudioBuffer | null> {
    return this.decode(file);
  }

  // ----- ducking -----

  /** Feed the partner's voice level (Voice's 0..1 meter) every tick: the music dips about 6 dB while they talk. */
  setVoiceLevel(level: number): void {
    this.mixer.setVoiceLevel(level);
  }

  // ----- internals -----

  private arm(): void {
    onFirstGesture(window, () => this.unlock());
  }

  /** First user gesture: the AudioContext may run now. Starts the queued track. */
  private unlock(): void {
    try {
      const first = !this.mixer.isUnlocked;
      this.mixer.unlock();
      if (first) for (const id of Object.keys(SAMPLES) as SampleId[]) void this.loadSample(id);
      // Some keys (Tab, Escape) do not count as a gesture: try again on the next one.
      if (audioContext().state !== 'running') this.arm();
    } catch {
      // no Web Audio: the game stays silent
    }
  }

  /** The Ogg Opus file, or the mp3 where that cannot be played or decoded (older Safari). */
  private async decode({ file, alt }: AudioFile): Promise<AudioBuffer | null> {
    const ogg = new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
    for (const name of ogg ? [file, alt] : [alt, file]) {
      try {
        const res = await fetch(AUDIO_DIR + name);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await audioContext().decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn(`[audio] could not load ${name}`, e);
      }
    }
    return null;
  }

  private loadTrack(id: TrackId): Promise<AudioBuffer | null> {
    let job = this.decoded.get(id);
    this.decoded.delete(id);
    job ??= this.decode(TRACKS[id]);
    this.decoded.set(id, job); // most recently used last
    for (const old of this.decoded.keys()) {
      if (this.decoded.size <= KEEP_DECODED) break;
      this.decoded.delete(old);
    }
    return job;
  }

  private async loadSample(id: SampleId): Promise<void> {
    const buffer = await this.decode(SAMPLES[id]);
    if (buffer) this.samples.set(id, buffer);
  }
}

export const audio = new AudioManager();
