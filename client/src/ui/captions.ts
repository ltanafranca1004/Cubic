// CAPTIONS. Everything that is spoken can also be read: the narrator's lines, the AI
// partner's voice, and a "Partner speaking" tag for the human partner's microphone.
//
// To show a line from anywhere (the narrator in content/narrator.ts, a scene, a puzzle
// cue), import this file and call:
//
//   showCaption('The wall hums.');                         // narrator, timed by length
//   showCaption('Step on the plate.', { speaker: 'AI' });  // with a speaker tag
//   showCaption('Hold on...', { ms: 6000 });               // your own duration
//   clearCaption();
//
// One caption shows at a time: a new line replaces the old one. The DOM is drawn by
// ui/cubicUI.ts, which listens with onCaption(). This file has no DOM and no Phaser.

export interface Caption {
  /** Goes up by one per line, so a repeated text still counts as new. */
  id: number;
  text: string;
  /** Who says it, shown as a tag before the line. Empty = the narrator. */
  speaker: string;
  /** How long it stays, in ms. */
  ms: number;
}

export interface CaptionOptions {
  speaker?: string;
  ms?: number;
}

export const CAPTION_MIN_MS = 2000;
export const CAPTION_MAX_MS = 9000;
/** Reading time: a base, plus this much per character. */
const CAPTION_BASE_MS = 1200;
const CAPTION_MS_PER_CHAR = 65;

/** How long a caption stays up when the caller does not say. Longer lines stay longer. */
export function captionMs(text: string): number {
  return Math.min(CAPTION_MAX_MS, Math.max(CAPTION_MIN_MS, CAPTION_BASE_MS + text.trim().length * CAPTION_MS_PER_CHAR));
}

let current: Caption | null = null;
let nextId = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(c: Caption | null) => void>();

const emit = () => {
  for (const l of listeners) l(current);
};

/** Show one line. Returns its id (pass it to clearCaption to clear only this line). */
export function showCaption(text: string, opts: CaptionOptions = {}): number {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (timer) clearTimeout(timer);
  timer = null;
  if (!clean) {
    current = null;
    emit();
    return nextId;
  }
  const caption: Caption = { id: ++nextId, text: clean, speaker: opts.speaker ?? '', ms: opts.ms ?? captionMs(clean) };
  current = caption;
  timer = setTimeout(() => clearCaption(caption.id), caption.ms);
  emit();
  return caption.id;
}

/** Take the caption down. With an id: only if that line is still the one showing. */
export function clearCaption(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

export const caption = (): Caption | null => current;

export function onCaption(fn: (c: Caption | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- "Partner speaking" ----------

/** The partner's voice level (0..1) above which they count as speaking. */
export const SPEAK_LEVEL = 0.08;
/** The tag stays this long after the last loud moment, so it does not flicker between words. */
export const SPEAK_HOLD_MS = 600;

export interface SpeakState {
  on: boolean;
  /** When the level was last above SPEAK_LEVEL. */
  lastLoudAt: number;
}

/** Feed it the level every poll; it says whether the tag should show. */
export function speakStep(prev: SpeakState, level: number, now: number): SpeakState {
  if (level > SPEAK_LEVEL) return { on: true, lastLoudAt: now };
  return { on: prev.on && now - prev.lastLoudAt < SPEAK_HOLD_MS, lastLoudAt: prev.lastLoudAt };
}

let speak: SpeakState = { on: false, lastLoudAt: -Infinity };
const speakListeners = new Set<(on: boolean) => void>();

/** Call often (the app polls the voice level every 50 ms). */
export function setPartnerLevel(level: number, now: number = Date.now()): void {
  const next = speakStep(speak, level, now);
  const changed = next.on !== speak.on;
  speak = next;
  if (changed) for (const l of speakListeners) l(next.on);
}

export const partnerSpeaking = (): boolean => speak.on;

export function onPartnerSpeaking(fn: (on: boolean) => void): () => void {
  speakListeners.add(fn);
  return () => speakListeners.delete(fn);
}
