// Synthesized placeholder sound effects (Web Audio oscillators). Real audio listed in
// assets/manifest.json can replace these per key later. Which game event plays which key,
// and who hears it, is decided in audio/hearing.ts; everything plays through audio.playSfx.

let ctx: AudioContext | null = null;
/** Where the effects play. The AudioManager points this at its SFX bus (volume sliders). */
let output: (() => AudioNode) | null = null;

export function routeSfx(to: () => AudioNode): void {
  output = to;
}

/** Shared AudioContext (also used by voice chat). Created on first use after a gesture. */
export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.03, delay = 0): void {
  try {
    const ac = audioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime + delay;
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(output?.() ?? ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // audio not available: stay silent
  }
}

const chime = (notes: number[], step = 0.1) => notes.forEach((n, i) => tone(n, i === notes.length - 1 ? 0.25 : 0.12, 'square', 0.03, i * step));

export const sfx: Record<string, () => void> = {
  step: () => tone(180, 0.03, 'square', 0.012),
  bump: () => tone(90, 0.06, 'square', 0.03),
  flip: () => chime([300, 450], 0.06),
  push: () => tone(140, 0.06, 'triangle', 0.05),
  solve: () => chime([523, 659, 784]),
  strike: () => tone(110, 0.35, 'sawtooth', 0.05),
  win: () => chime([523, 659, 784, 1047], 0.12),
  pickup: () => chime([440, 660], 0.05),
  drop: () => chime([330, 220], 0.05),
  place: () => chime([392, 523, 659], 0.07),
  /** A partner's ping: soft, two sine notes. */
  ping: () => [880, 1320].forEach((f, i) => tone(f, 0.22, 'sine', 0.035, i * 0.09)),
  /** A quick-chat bubble popping up. */
  quick: () => tone(660, 0.08, 'sine', 0.025),
  'door-open': () => tone(400, 0.1),
  'door-close': () => tone(200, 0.1),
  /** A puzzle event with no sound of its own. */
  puzzle: () => tone(350, 0.08),
};
