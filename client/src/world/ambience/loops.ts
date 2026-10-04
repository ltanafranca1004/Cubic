import { audio } from '../../audio/AudioManager';
import { audioContext } from '../../game/sfx';
import type { LoopId, Surface } from './plan';

// The sound of the face you are on: one quiet loop at a time, on the SFX bus, crossfaded
// when you cross an edge. The files are synthesized by tools/ambience/make_audio.py
// (credited in /CREDITS.md). Each holds one 8 s period plus a little of the next on both
// ends; we loop the middle, so mp3 padding cannot click.

const DIR = 'ambience/';
/** Must match LOOP_S and PAD_S in tools/ambience/make_audio.py. */
export const LOOP_S = 8;
export const LOOP_PAD_S = 0.25;
/** The loops are levelled to about -31 LUFS; this keeps them under the music. */
export const LOOP_GAIN = 0.7;
export const LOOP_FADE_S = 0.6;

interface Playing {
  id: LoopId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Ogg Opus where the browser decodes it, mp3 otherwise (older Safari). */
function extensions(): string[] {
  try {
    return new Audio().canPlayType('audio/ogg; codecs="opus"') ? ['ogg', 'mp3'] : ['mp3', 'ogg'];
  } catch {
    return ['mp3', 'ogg'];
  }
}

export class AmbienceLoops {
  private buffers = new Map<LoopId, Promise<AudioBuffer | null>>();
  private wanted: { id: LoopId; rate: number } | null = null;
  private playing: Playing | null = null;
  /** Bumped on every change, so a slow decode cannot start a loop nobody wants any more. */
  private request = 0;
  /** The request whose file is being decoded. */
  private pending = -1;

  /** The loop for the face being shown, or null for silence. Safe to call every frame. */
  set(id: LoopId | null, rate = 1): void {
    if ((this.wanted?.id ?? null) === id && (id === null || this.wanted?.rate === rate)) return;
    this.wanted = id ? { id, rate } : null;
    this.request++;
    this.sync();
  }

  /** Call every frame: starts the wanted loop once the first click has unlocked audio. */
  sync(): void {
    if (!audio.unlocked) return;
    const want = this.wanted;
    if ((this.playing?.id ?? null) === (want?.id ?? null)) {
      if (want && this.playing) this.playing.source.playbackRate.value = want.rate;
      return;
    }
    this.stop();
    if (!want || this.pending === this.request) return; // nothing wanted, or already decoding it
    this.pending = this.request;
    void this.start(want.id, want.rate, this.request);
  }

  private load(id: LoopId): Promise<AudioBuffer | null> {
    let job = this.buffers.get(id);
    if (!job) {
      job = (async () => {
        for (const ext of extensions()) {
          const buffer = await audio.loadBuffer(`${DIR}${id}.${ext}`);
          if (buffer) return buffer;
        }
        return null;
      })();
      this.buffers.set(id, job);
    }
    return job;
  }

  private async start(id: LoopId, rate: number, request: number): Promise<void> {
    const buffer = await this.load(id);
    if (!buffer || request !== this.request || this.playing) return;
    try {
      const ac = audioContext();
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = LOOP_PAD_S;
      source.loopEnd = Math.min(buffer.duration, LOOP_PAD_S + LOOP_S);
      source.playbackRate.value = rate;
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(LOOP_GAIN, ac.currentTime + LOOP_FADE_S);
      source.connect(gain).connect(audio.sfxBus());
      source.start(0, LOOP_PAD_S);
      this.playing = { id, source, gain };
    } catch {
      // audio not available: stay silent
    }
  }

  private stop(): void {
    const old = this.playing;
    this.playing = null;
    if (!old) return;
    try {
      const now = audioContext().currentTime;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + LOOP_FADE_S);
      old.source.stop(now + LOOP_FADE_S + 0.05);
    } catch {
      // already stopped
    }
  }

  /** The loop that is audible now (for the dev hook and the checks). */
  get current(): LoopId | null {
    return this.playing?.id ?? null;
  }
}

// ----- footsteps: a tiny noise burst, coloured by the ground -----

/** Band centre (Hz), length (s) and level per surface: a soft swish, a crunch, a tap. */
export const STEP_SOUND: Record<Surface, { freq: number; q: number; dur: number; gain: number; double?: boolean }> = {
  grass: { freq: 1100, q: 0.8, dur: 0.07, gain: 0.03 },
  sand: { freq: 2600, q: 0.6, dur: 0.09, gain: 0.025 },
  snow: { freq: 1500, q: 2.5, dur: 0.05, gain: 0.04, double: true },
  leaves: { freq: 3400, q: 1.2, dur: 0.06, gain: 0.03, double: true },
  roof: { freq: 420, q: 1.5, dur: 0.05, gain: 0.05 },
  stone: { freq: 700, q: 2, dur: 0.05, gain: 0.04 },
  room: { freq: 380, q: 1.2, dur: 0.06, gain: 0.04 },
};

let noiseBuffer: AudioBuffer | null = null;

export function stepSound(surface: Surface): void {
  if (!audio.unlocked) return;
  try {
    const ac = audioContext();
    if (!noiseBuffer) {
      noiseBuffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.2), ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const s = STEP_SOUND[surface];
    for (const delay of s.double ? [0, 0.045] : [0]) {
      const source = ac.createBufferSource();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();
      const t = ac.currentTime + delay;
      source.buffer = noiseBuffer;
      filter.type = 'bandpass';
      filter.frequency.value = s.freq;
      filter.Q.value = s.q;
      gain.gain.setValueAtTime(s.gain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
      source.connect(filter).connect(gain).connect(audio.sfxBus());
      source.start(t, Math.random() * 0.1, s.dur + 0.02);
    }
  } catch {
    // audio not available: stay silent
  }
}
