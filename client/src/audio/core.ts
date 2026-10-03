// The audio logic, with no browser in it: volume math, crossfades, ducking and the
// first-gesture queue. It talks to an AudioContext-like interface so it runs under
// node:test with a fake (see client/test/audio.test.ts). AudioManager.ts binds it to the
// real AudioContext, the files and the window.
//
//   sfx (synth tones, samples)  ->  sfxBus   (master x sfx)    ->  speakers
//   music track (fade gain)     ->  duck  ->  musicBus (master x music)  ->  speakers

export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface NodeLike {
  // The real connect() is overloaded (AudioNode | AudioParam), so the fake stays loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(destination: any): unknown;
  disconnect(): void;
}

export interface GainLike extends NodeLike {
  gain: ParamLike;
}

export interface SourceLike<B> extends NodeLike {
  buffer: B | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}

/** The part of AudioContext the mixer uses. B is the decoded buffer type (AudioBuffer). */
export interface AudioContextLike<B> {
  readonly currentTime: number;
  readonly destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike<B>;
}

// ---------- volume math ----------

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Gain of a bus: master x bus, both clamped to 0..1. */
export const busGain = (master: number, bus: number) => clamp01(master) * clamp01(bus);

export const dbToGain = (db: number) => 10 ** (db / 20);

// ---------- fades ----------

/** Default crossfade between two tracks. */
export const CROSSFADE_MS = 800;

export interface FadeOptions {
  /** Fade time in ms. true or omitted = CROSSFADE_MS, false or 0 = cut. */
  fade?: number | boolean;
}

export function fadeSeconds(opts: FadeOptions | undefined): number {
  const fade = opts?.fade;
  if (fade === false) return 0;
  if (typeof fade !== 'number') return CROSSFADE_MS / 1000;
  return Number.isFinite(fade) ? Math.max(0, fade) / 1000 : CROSSFADE_MS / 1000;
}

/** A linear ramp between two gains, on the AudioContext clock (seconds). */
export interface Ramp {
  from: number;
  to: number;
  start: number;
  end: number;
}

/**
 * Where a ramp is at time t. Tracked here instead of reading AudioParam.value, which not
 * every browser updates while an automation is running.
 */
export function rampValueAt(ramp: Ramp, t: number): number {
  if (t >= ramp.end || ramp.end <= ramp.start) return ramp.to;
  if (t <= ramp.start) return ramp.from;
  return ramp.from + ((ramp.to - ramp.from) * (t - ramp.start)) / (ramp.end - ramp.start);
}

// ---------- ducking ----------

/** How far the music drops while the partner talks. */
export const DUCK_DB = -6;
export const DUCK_GAIN = dbToGain(DUCK_DB);
/** Partner level (Voice's 0..1 meter) that counts as talking, and the level it must drop under to stop. */
export const DUCK_ON_LEVEL = 0.1;
export const DUCK_OFF_LEVEL = 0.05;
/** Stay ducked this long after the last loud moment, so gaps between words do not pump. */
export const DUCK_HOLD_MS = 600;
/** setTargetAtTime time constants (the gain covers about 95% of the way in three of them). */
export const DUCK_ATTACK_S = 0.05;
export const DUCK_RELEASE_S = 0.3;

/** Decides when the music is ducked: on/off thresholds (hysteresis) plus a hold time. */
export class Ducker {
  private ducked = false;
  private lastLoud = -Infinity;

  /** Feed the partner's level; returns whether the music should be ducked now. */
  update(level: number, nowMs: number): boolean {
    if (level >= (this.ducked ? DUCK_OFF_LEVEL : DUCK_ON_LEVEL)) {
      this.ducked = true;
      this.lastLoud = nowMs;
    } else if (this.ducked && nowMs - this.lastLoud >= DUCK_HOLD_MS) {
      this.ducked = false;
    }
    return this.ducked;
  }
}

// ---------- first user gesture ----------

interface GestureTarget {
  addEventListener(type: string, fn: () => void, opts?: { capture?: boolean }): void;
  removeEventListener(type: string, fn: () => void, opts?: { capture?: boolean }): void;
}

export const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'];

/** Calls `fn` once, on the first click, tap or key press (browsers block audio before it). */
export function onFirstGesture(target: GestureTarget, fn: () => void): () => void {
  const off = () => GESTURE_EVENTS.forEach((type) => target.removeEventListener(type, handler, { capture: true }));
  const handler = () => {
    off();
    fn();
  };
  GESTURE_EVENTS.forEach((type) => target.addEventListener(type, handler, { capture: true }));
  return off;
}

// ---------- the mixer ----------

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 1, music: 0.6, sfx: 1 };

export interface MixerDeps<Id extends string, B> {
  /** Only called after the first user gesture. */
  context(): AudioContextLike<B>;
  /** Decoded loop for a track, or null if it cannot be played. */
  load(id: Id): Promise<B | null>;
  /** Level trim per track (files are not equally loud). Default 1. */
  trackGain?(id: Id): number;
  /** Wall clock in ms, for the ducking hold. */
  now?(): number;
}

interface Voice<Id, B> {
  id: Id;
  source: SourceLike<B>;
  gain: GainLike;
  ramp: Ramp;
}

export class Mixer<Id extends string, B> {
  private vol: Volumes = { ...DEFAULT_VOLUMES };
  private unlocked = false;
  private nodes: { ctx: AudioContextLike<B>; sfxBus: GainLike; musicBus: GainLike; duck: GainLike } | null = null;

  /** The track that should be playing (kept while locked or loading). */
  private wanted: Id | null = null;
  private wantedFade = CROSSFADE_MS / 1000;
  private current: Voice<Id, B> | null = null;
  /** Bumped on every request, so a slow load cannot start a track nobody wants any more. */
  private request = 0;

  private ducker = new Ducker();
  private ducked = false;

  constructor(private deps: MixerDeps<Id, B>) {}

  // ----- volumes -----

  get volumes(): Volumes {
    return { ...this.vol };
  }

  setMaster(v: number): void {
    this.vol.master = clamp01(v);
    this.applyVolumes();
  }

  setMusic(v: number): void {
    this.vol.music = clamp01(v);
    this.applyVolumes();
  }

  setSfx(v: number): void {
    this.vol.sfx = clamp01(v);
    this.applyVolumes();
  }

  /** Volumes are set straight on the bus gains: no ramp, the slider is heard at once. */
  private applyVolumes(): void {
    if (!this.nodes) return;
    const now = this.nodes.ctx.currentTime;
    const set = (param: ParamLike, value: number) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
      param.value = value;
    };
    set(this.nodes.sfxBus.gain, busGain(this.vol.master, this.vol.sfx));
    set(this.nodes.musicBus.gain, busGain(this.vol.master, this.vol.music));
  }

  // ----- graph -----

  private graph() {
    if (!this.nodes) {
      const ctx = this.deps.context();
      const sfxBus = ctx.createGain();
      const musicBus = ctx.createGain();
      const duck = ctx.createGain();
      duck.gain.value = this.ducked ? DUCK_GAIN : 1;
      duck.connect(musicBus);
      musicBus.connect(ctx.destination);
      sfxBus.connect(ctx.destination);
      this.nodes = { ctx, sfxBus, musicBus, duck };
      this.applyVolumes();
    }
    return this.nodes;
  }

  /** Where every sound effect connects (instead of the speakers). */
  sfxInput(): GainLike {
    return this.graph().sfxBus;
  }

  // ----- first gesture -----

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Call on the first user gesture: starts the track that was asked for meanwhile. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.graph();
    if (this.wanted) void this.begin(this.wanted, this.wantedFade);
  }

  // ----- music -----

  /** The track that is playing, or will be once it has loaded / the player has clicked. */
  get track(): Id | null {
    return this.wanted;
  }

  /**
   * Loop `id`, crossfading from whatever plays now. Asking for the track that is already
   * wanted does nothing, so it is safe to call on every render.
   */
  playMusic(id: Id, opts?: FadeOptions): Promise<void> {
    if (id === this.wanted) return Promise.resolve();
    this.wanted = id;
    this.wantedFade = fadeSeconds(opts);
    this.request++;
    if (!this.unlocked) return Promise.resolve(); // queued for unlock()
    return this.begin(id, this.wantedFade);
  }

  stopMusic(opts?: FadeOptions): void {
    this.wanted = null;
    this.request++;
    if (this.nodes) this.fadeOut(fadeSeconds(opts));
  }

  private async begin(id: Id, fade: number): Promise<void> {
    const request = this.request;
    let buffer: B | null;
    try {
      buffer = await this.deps.load(id);
    } catch {
      buffer = null;
    }
    if (request !== this.request) return; // something else was asked for meanwhile
    if (!buffer) {
      // No such file or it cannot be decoded: silence rather than the wrong music.
      this.fadeOut(fade);
      return;
    }
    const { ctx, duck } = this.graph();
    const now = ctx.currentTime;
    this.fadeOut(fade);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const level = this.deps.trackGain?.(id) ?? 1;
    const ramp: Ramp = { from: fade > 0 ? 0 : level, to: level, start: now, end: now + fade };
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = ramp.from;
    gain.gain.setValueAtTime(ramp.from, now);
    if (fade > 0) gain.gain.linearRampToValueAtTime(ramp.to, ramp.end);
    source.connect(gain);
    gain.connect(duck);
    source.start(now);
    this.current = { id, source, gain, ramp };
  }

  /** Fade the playing track to silence from wherever its own fade is, then stop it. */
  private fadeOut(fade: number): void {
    const voice = this.current;
    if (!voice || !this.nodes) return;
    this.current = null;
    const now = this.nodes.ctx.currentTime;
    const from = rampValueAt(voice.ramp, now);
    const param = voice.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(fade > 0 ? from : 0, now);
    if (fade > 0) param.linearRampToValueAtTime(0, now + fade);
    voice.ramp = { from, to: 0, start: now, end: now + fade };
    voice.source.stop(now + fade + 0.05);
  }

  // ----- ducking -----

  get isDucked(): boolean {
    return this.ducked;
  }

  /** Feed the partner's voice level (0..1) regularly; the music dips while they talk. */
  setVoiceLevel(level: number): void {
    const ducked = this.ducker.update(level, (this.deps.now ?? Date.now)());
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    if (!this.nodes) return;
    const now = this.nodes.ctx.currentTime;
    const param = this.nodes.duck.gain;
    // setTargetAtTime starts from the value the gain has right now, so a release that is
    // interrupted by a new word turns around smoothly.
    param.cancelScheduledValues(now);
    param.setTargetAtTime(ducked ? DUCK_GAIN : 1, now, ducked ? DUCK_ATTACK_S : DUCK_RELEASE_S);
  }
}
