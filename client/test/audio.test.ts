import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CROSSFADE_MS,
  DEFAULT_VOLUMES,
  DUCK_ATTACK_S,
  DUCK_GAIN,
  DUCK_HOLD_MS,
  DUCK_OFF_LEVEL,
  DUCK_ON_LEVEL,
  DUCK_RELEASE_S,
  Ducker,
  GESTURE_EVENTS,
  Mixer,
  busGain,
  clamp01,
  dbToGain,
  fadeSeconds,
  onFirstGesture,
  rampValueAt,
  type AudioContextLike,
  type GainLike,
  type ParamLike,
  type SourceLike,
} from '../src/audio/core';
import { TRACKS, TRACK_IDS, musicForScreen } from '../src/audio/tracks';

// ---------- a fake AudioContext that records what was scheduled ----------

type Call = [name: string, ...args: number[]];

class FakeParam implements ParamLike {
  value = 1;
  calls: Call[] = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push(['set', value, time]);
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push(['ramp', value, time]);
  }
  setTargetAtTime(target: number, time: number, timeConstant: number) {
    this.calls.push(['target', target, time, timeConstant]);
  }
  cancelScheduledValues(time: number) {
    this.calls.push(['cancel', time]);
  }
  last(name: string): Call | undefined {
    return this.calls.findLast((c) => c[0] === name);
  }
}

class FakeNode {
  to: unknown[] = [];
  connect(destination: unknown) {
    this.to.push(destination);
    return destination;
  }
  disconnect() {
    this.to = [];
  }
}

class FakeGain extends FakeNode implements GainLike {
  gain = new FakeParam();
}

class FakeSource extends FakeNode implements SourceLike<string> {
  buffer: string | null = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0) {
    this.startedAt = when;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}

class FakeContext implements AudioContextLike<string> {
  currentTime = 0;
  destination = 'speakers';
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

type Id = 'a' | 'b' | 'missing';

function setup(opts: { trackGain?: (id: Id) => number } = {}) {
  const ctx = new FakeContext();
  const clock = { ms: 0 };
  const loads: Id[] = [];
  let contexts = 0;
  const mixer = new Mixer<Id, string>({
    context: () => {
      contexts++;
      return ctx;
    },
    load: async (id) => {
      loads.push(id);
      return id === 'missing' ? null : `buffer-${id}`;
    },
    trackGain: opts.trackGain,
    now: () => clock.ms,
  });
  /** Graph nodes in creation order: sfxBus, musicBus, duck. */
  const nodes = () => ({ sfxBus: ctx.gains[0]!, musicBus: ctx.gains[1]!, duck: ctx.gains[2]! });
  /** The fade gain a source plays through. */
  const fadeOf = (source: FakeSource) => source.to[0] as FakeGain;
  return { ctx, clock, loads, mixer, nodes, fadeOf, contexts: () => contexts };
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

// ---------- volume math ----------

test('clamp01 keeps volumes in 0..1 and treats junk as silence', () => {
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(7), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(Infinity), 0);
});

test('a bus plays at master x bus, clamped', () => {
  close(busGain(0.5, 0.5), 0.25);
  assert.equal(busGain(1, 1), 1);
  assert.equal(busGain(0, 1), 0);
  assert.equal(busGain(1, 0), 0);
  assert.equal(busGain(2, 0.5), 0.5);
  assert.equal(busGain(0.5, -3), 0);
});

test('dbToGain: -6 dB is about half', () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001);
  assert.ok(Math.abs(DUCK_GAIN - 0.501) < 0.001);
});

test('volumes apply to the bus gains at once, with no ramp', () => {
  const { ctx, mixer, nodes } = setup();
  mixer.unlock();
  const { sfxBus, musicBus } = nodes();
  close(sfxBus.gain.value, busGain(DEFAULT_VOLUMES.master, DEFAULT_VOLUMES.sfx));
  close(musicBus.gain.value, busGain(DEFAULT_VOLUMES.master, DEFAULT_VOLUMES.music));

  ctx.currentTime = 3;
  mixer.setMusic(0.5);
  close(musicBus.gain.value, 0.5);
  assert.deepEqual(musicBus.gain.last('set'), ['set', 0.5, 3]);
  mixer.setMaster(0.5);
  close(musicBus.gain.value, 0.25);
  close(sfxBus.gain.value, 0.5);
  mixer.setSfx(0.2);
  close(sfxBus.gain.value, 0.1);
  close(musicBus.gain.value, 0.25);
  for (const bus of [sfxBus, musicBus]) assert.equal(bus.gain.calls.some((c) => c[0] === 'ramp' || c[0] === 'target'), false);

  mixer.setMaster(9);
  mixer.setSfx(-1);
  assert.deepEqual(mixer.volumes, { master: 1, music: 0.5, sfx: 0 });
  assert.equal(sfxBus.gain.value, 0);
});

test('volumes set before the first gesture are used when the graph is built', () => {
  const { mixer, nodes, contexts } = setup();
  mixer.setMaster(0.5);
  mixer.setMusic(0.4);
  mixer.setSfx(0.8);
  assert.equal(contexts(), 0, 'no AudioContext before a gesture');
  mixer.unlock();
  close(nodes().musicBus.gain.value, 0.2);
  close(nodes().sfxBus.gain.value, 0.4);
});

test('graph: sfx bus and music bus go to the speakers, music through the duck gain', () => {
  const { mixer, nodes } = setup();
  const input = mixer.sfxInput();
  const { sfxBus, musicBus, duck } = nodes();
  assert.equal(input, sfxBus);
  assert.deepEqual(sfxBus.to, ['speakers']);
  assert.deepEqual(musicBus.to, ['speakers']);
  assert.deepEqual(duck.to, [musicBus]);
});

// ---------- crossfades ----------

test('fadeSeconds: default, explicit ms, cut', () => {
  assert.equal(CROSSFADE_MS, 800);
  assert.equal(fadeSeconds(undefined), 0.8);
  assert.equal(fadeSeconds({}), 0.8);
  assert.equal(fadeSeconds({ fade: true }), 0.8);
  assert.equal(fadeSeconds({ fade: 250 }), 0.25);
  assert.equal(fadeSeconds({ fade: 0 }), 0);
  assert.equal(fadeSeconds({ fade: false }), 0);
  assert.equal(fadeSeconds({ fade: -5 }), 0);
  assert.equal(fadeSeconds({ fade: NaN }), 0.8);
});

test('rampValueAt follows a linear ramp and holds at both ends', () => {
  const ramp = { from: 0, to: 1, start: 10, end: 12 };
  assert.equal(rampValueAt(ramp, 9), 0);
  assert.equal(rampValueAt(ramp, 10.5), 0.25);
  assert.equal(rampValueAt(ramp, 11), 0.5);
  assert.equal(rampValueAt(ramp, 12), 1);
  assert.equal(rampValueAt(ramp, 99), 1);
  assert.equal(rampValueAt({ from: 0.3, to: 1, start: 5, end: 5 }, 5), 1);
});

test('the first track loops and fades in from silence', async () => {
  const { ctx, mixer, nodes, fadeOf } = setup();
  mixer.unlock();
  ctx.currentTime = 2;
  await mixer.playMusic('a');
  const [src] = ctx.sources;
  assert.equal(src!.buffer, 'buffer-a');
  assert.equal(src!.loop, true);
  assert.equal(src!.startedAt, 2);
  assert.equal(src!.stoppedAt, null);
  const fade = fadeOf(src!);
  assert.deepEqual(fade.to, [nodes().duck]);
  assert.deepEqual(fade.gain.calls, [
    ['set', 0, 2],
    ['ramp', 1, 2.8],
  ]);
  assert.equal(mixer.track, 'a');
});

test('crossfade: the old track ramps to 0 and stops while the new one ramps up over the same window', async () => {
  const { ctx, mixer, fadeOf } = setup();
  mixer.unlock();
  await mixer.playMusic('a');
  ctx.currentTime = 10;
  await mixer.playMusic('b');
  const [a, b] = ctx.sources;
  assert.deepEqual(fadeOf(a!).gain.calls.slice(-3), [
    ['cancel', 10],
    ['set', 1, 10],
    ['ramp', 0, 10.8],
  ]);
  close(a!.stoppedAt!, 10.85);
  assert.equal(b!.startedAt, 10);
  assert.deepEqual(fadeOf(b!).gain.calls, [
    ['set', 0, 10],
    ['ramp', 1, 10.8],
  ]);
  assert.equal(b!.stoppedAt, null);
});

test('a crossfade that interrupts a fade-in starts from where that fade was', async () => {
  const { ctx, mixer, fadeOf } = setup();
  mixer.unlock();
  await mixer.playMusic('a'); // fades in over 0..0.8
  ctx.currentTime = 0.2;
  await mixer.playMusic('b', { fade: 400 });
  const a = fadeOf(ctx.sources[0]!).gain;
  const set = a.last('set')!;
  close(set[1]!, 0.25);
  assert.equal(set[2], 0.2);
  const ramp = a.last('ramp')!;
  assert.equal(ramp[1], 0);
  close(ramp[2]!, 0.6);
});

test('asking for the track that already plays does nothing', async () => {
  const { ctx, mixer, loads } = setup();
  mixer.unlock();
  await mixer.playMusic('a');
  await mixer.playMusic('a');
  await mixer.playMusic('a', { fade: 0 });
  assert.equal(ctx.sources.length, 1);
  assert.deepEqual(loads, ['a']);
});

test('fade 0 cuts', async () => {
  const { ctx, mixer, fadeOf } = setup();
  mixer.unlock();
  await mixer.playMusic('a', { fade: 0 });
  ctx.currentTime = 5;
  await mixer.playMusic('b', { fade: false });
  const [a, b] = ctx.sources;
  assert.deepEqual(fadeOf(a!).gain.last('set'), ['set', 0, 5]);
  assert.equal(fadeOf(a!).gain.last('ramp'), undefined);
  assert.deepEqual(fadeOf(b!).gain.calls, [['set', 1, 5]]);
});

test('stopMusic fades the track out, and the same track can be started again', async () => {
  const { ctx, mixer, fadeOf } = setup();
  mixer.unlock();
  await mixer.playMusic('a');
  ctx.currentTime = 4;
  mixer.stopMusic({ fade: 500 });
  assert.equal(mixer.track, null);
  assert.deepEqual(fadeOf(ctx.sources[0]!).gain.last('ramp'), ['ramp', 0, 4.5]);
  close(ctx.sources[0]!.stoppedAt!, 4.55);
  await mixer.playMusic('a');
  assert.equal(ctx.sources.length, 2);
});

test('a slow load never starts a track that is no longer wanted', async () => {
  const { ctx, mixer } = setup();
  mixer.unlock();
  const first = mixer.playMusic('a');
  const second = mixer.playMusic('b');
  await Promise.all([first, second]);
  assert.deepEqual(ctx.sources.map((s) => s.buffer), ['buffer-b']);

  const third = mixer.playMusic('a');
  mixer.stopMusic();
  await third;
  assert.equal(ctx.sources.length, 1);
  close(ctx.sources[0]!.stoppedAt!, 0.85);
});

test('a track that cannot be loaded leaves silence, not the old music', async () => {
  const { ctx, mixer } = setup();
  mixer.unlock();
  await mixer.playMusic('a');
  await mixer.playMusic('missing');
  assert.equal(ctx.sources.length, 1);
  assert.notEqual(ctx.sources[0]!.stoppedAt, null);
});

test('the per-track trim is the level a track fades to', async () => {
  const { ctx, mixer, fadeOf } = setup({ trackGain: (id) => (id === 'a' ? 0.25 : 0.5) });
  mixer.unlock();
  await mixer.playMusic('a');
  assert.deepEqual(fadeOf(ctx.sources[0]!).gain.last('ramp'), ['ramp', 0.25, 0.8]);
  ctx.currentTime = 5;
  await mixer.playMusic('b');
  assert.deepEqual(fadeOf(ctx.sources[0]!).gain.last('set'), ['set', 0.25, 5]);
  assert.deepEqual(fadeOf(ctx.sources[1]!).gain.last('ramp'), ['ramp', 0.5, 5.8]);
});

// ---------- first user gesture ----------

test('music asked for before the first gesture is queued and starts on unlock', async () => {
  const { ctx, mixer, loads, contexts } = setup();
  await mixer.playMusic('a');
  await mixer.playMusic('b', { fade: 300 });
  assert.equal(mixer.track, 'b');
  assert.equal(mixer.isUnlocked, false);
  assert.equal(contexts(), 0, 'no AudioContext before a gesture');
  assert.deepEqual(loads, [], 'nothing is fetched before a gesture');

  ctx.currentTime = 1;
  mixer.unlock();
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(loads, ['b'], 'only the last request starts');
  assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.sources[0]!.buffer, 'buffer-b');
  assert.deepEqual((ctx.sources[0]!.to[0] as FakeGain).gain.last('ramp'), ['ramp', 1, 1.3]);

  mixer.unlock(); // a second gesture changes nothing
  await new Promise((r) => setTimeout(r));
  assert.equal(ctx.sources.length, 1);
});

test('music stopped before the first gesture does not start on unlock', async () => {
  const { ctx, mixer, loads } = setup();
  await mixer.playMusic('a');
  mixer.stopMusic();
  mixer.unlock();
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(loads, []);
  assert.equal(ctx.sources.length, 0);
});

test('onFirstGesture fires once, on whichever gesture comes first', () => {
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  };
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());
  let count = 0;
  onFirstGesture(target, () => count++);
  assert.deepEqual([...listeners.keys()], GESTURE_EVENTS);
  fire('keydown');
  fire('keydown');
  fire('pointerdown');
  assert.equal(count, 1);
  assert.ok([...listeners.values()].every((set) => set.size === 0), 'listeners are removed');

  const off = onFirstGesture(target, () => count++);
  off();
  fire('pointerdown');
  assert.equal(count, 1, 'cancelled before any gesture');
});

// ---------- ducking ----------

test('Ducker: on above the threshold, off only after the hold, with hysteresis', () => {
  const d = new Ducker();
  assert.equal(d.update(0, 0), false);
  assert.equal(d.update(DUCK_ON_LEVEL - 0.01, 50), false, 'quiet noise does not duck');
  assert.equal(d.update(DUCK_ON_LEVEL, 100), true);
  assert.equal(d.update(0, 150), true, 'a gap between words keeps it ducked');
  assert.equal(d.update(0, 100 + DUCK_HOLD_MS - 1), true);
  assert.equal(d.update(DUCK_OFF_LEVEL, 100 + DUCK_HOLD_MS - 1), true, 'a quieter level still holds it while ducked');
  assert.equal(d.update(0, 100 + 2 * DUCK_HOLD_MS - 2), true, 'the hold restarted');
  assert.equal(d.update(0, 100 + 2 * DUCK_HOLD_MS - 1), false);
  assert.equal(d.update(DUCK_OFF_LEVEL, 5000), false, 'the lower threshold only applies while ducked');
});

test('ducking drops the music about 6 dB with a fast attack and a slow release, and does not pump', async () => {
  const { ctx, clock, mixer, nodes } = setup();
  mixer.unlock();
  await mixer.playMusic('a');
  const { duck, musicBus, sfxBus } = nodes();
  assert.equal(duck.gain.value, 1);

  ctx.currentTime = 1;
  mixer.setVoiceLevel(0.5);
  assert.equal(mixer.isDucked, true);
  assert.deepEqual(duck.gain.last('target'), ['target', DUCK_GAIN, 1, DUCK_ATTACK_S]);
  assert.ok(Math.abs(20 * Math.log10(DUCK_GAIN) + 6) < 1e-9);

  // Speech: loud and quiet ticks every 50 ms. Nothing new may be scheduled.
  const scheduled = duck.gain.calls.length;
  for (let i = 1; i <= 40; i++) {
    clock.ms = i * 50;
    ctx.currentTime = 1 + i * 0.05;
    mixer.setVoiceLevel(i % 4 === 0 ? 0.4 : 0);
  }
  assert.equal(duck.gain.calls.length, scheduled, 'no pumping while they talk');

  // They stop: released once, after the hold.
  for (let i = 41; i <= 80; i++) {
    clock.ms = i * 50;
    ctx.currentTime = 1 + i * 0.05;
    mixer.setVoiceLevel(0);
  }
  assert.equal(mixer.isDucked, false);
  const release = duck.gain.last('target')!;
  assert.deepEqual([release[1], release[3]], [1, DUCK_RELEASE_S]);
  close(release[2]!, 1 + (2000 + DUCK_HOLD_MS) / 1000);
  assert.equal(duck.gain.calls.filter((c) => c[0] === 'target').length, 2);
  assert.ok(DUCK_RELEASE_S > DUCK_ATTACK_S);

  // The volume buses are not touched by ducking.
  assert.equal(musicBus.gain.calls.some((c) => c[0] === 'target'), false);
  assert.equal(sfxBus.gain.calls.some((c) => c[0] === 'target'), false);
});

test('a partner already talking before the first gesture starts the music ducked', () => {
  const { mixer, nodes } = setup();
  mixer.setVoiceLevel(0.6);
  mixer.unlock();
  assert.equal(nodes().duck.gain.value, DUCK_GAIN);
});

// ---------- tracks ----------

test('musicForScreen picks the track per screen and side', () => {
  assert.equal(musicForScreen('start'), 'menu');
  assert.equal(musicForScreen('mode'), 'menu');
  assert.equal(musicForScreen('menu'), 'menu');
  assert.equal(musicForScreen('lobby'), 'lobby');
  assert.equal(musicForScreen('lobby', 'in'), 'lobby');
  assert.equal(musicForScreen('game', 'out'), 'outside');
  assert.equal(musicForScreen('game', 'in'), 'inside');
  assert.equal(musicForScreen('game'), 'outside');
});

test('every track has a file and a sane trim', () => {
  assert.deepEqual(Object.keys(TRACKS).sort(), [...TRACK_IDS].sort());
  for (const id of TRACK_IDS) {
    assert.match(TRACKS[id].file, /^music-[a-z]+\.ogg$/);
    assert.ok(TRACKS[id].gain > 0 && TRACKS[id].gain <= 1, `${id} trim ${TRACKS[id].gain}`);
  }
});
