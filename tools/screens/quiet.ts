// SILENT RUNS. A Playwright run must never make a sound on the machine it runs on.
//  - QUIET_ARGS: Chromium's own audio (Web Audio, <audio>, the AI's clips) is muted.
//  - SILENCE: with TTS_MODE=browser the page calls speechSynthesis.speak, which on macOS goes
//    through the OS speech synthesizer and is NOT silenced by --mute-audio. This init script
//    replaces speak() with a stub: nothing is spoken, the app's code path still runs (the
//    caption shows) and the utterance still gets its "start" and "end" events.
// Every script that opens a game page: launch with QUIET_ARGS (never headed) and call
// `await quiet(context)` before any navigation.
import type { BrowserContext } from 'playwright';

export const QUIET_ARGS = ['--mute-audio'];

export const SILENCE = `(() => {
  const s = window.speechSynthesis;
  if (!s) return;
  s.speak = (u) => {
    setTimeout(() => {
      try { u.dispatchEvent(new Event('start')); u.dispatchEvent(new Event('end')); } catch {}
    }, 0);
  };
  s.cancel = () => {};
})()`;

/** Stub the browser voice in every page of this context. Call it before any navigation. */
export const quiet = (context: BrowserContext): Promise<void> => context.addInitScript(SILENCE);
