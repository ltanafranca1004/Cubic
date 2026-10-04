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
  // not only 'suspended': iOS puts it in 'interrupted' after a call or a trip to another app
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
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
  /** A quick-chat bubble popping up. */
  quick: () => tone(660, 0.08, 'sine', 0.025),
  /** E on a puzzle tile (a button, a keypad key that has no sound of its own). */
  use: () => tone(520, 0.05, 'square', 0.025),
  // Generic puzzle sounds: a puzzle plays one with ctx.emit('<key>').
  /** Something went right (a code accepted, a stage done). */
  chime: () => chime([659, 880, 1175], 0.08),
  /** A keypad key going down. */
  key: () => tone(740, 0.04, 'square', 0.02),
  /** A floor tile flipping over. */
  toggle: () => chime([260, 390], 0.04),
  burn: () => {
    tone(220, 0.3, 'sawtooth', 0.03);
    tone(330, 0.2, 'sawtooth', 0.02, 0.05);
  },
  laser: () => {
    tone(1320, 0.18, 'sawtooth', 0.02);
    tone(990, 0.25, 'sine', 0.025, 0.04);
  },
  /** Into the lava. */
  splash: () => {
    tone(160, 0.12, 'triangle', 0.05);
    tone(90, 0.3, 'sine', 0.05, 0.06);
  },
  /** A puzzle event with no sound of its own. */
  puzzle: () => tone(350, 0.08),
};
