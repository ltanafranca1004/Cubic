// The AI partner's voice: ElevenLabs text-to-speech, server-side, cached per line.

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const MODEL_ID = 'eleven_flash_v2_5';
const CACHE_MAX = 300;
const TIMEOUT_MS = 10_000;

export interface Tts {
  /** MP3 bytes for a line, or null if speech failed (the chat line still shows). */
  speak(text: string): Promise<Buffer | null>;
}

export function elevenLabsTts(apiKey: string, voiceId: string = DEFAULT_VOICE_ID, fetchFn: typeof fetch = fetch): Tts {
  const cache = new Map<string, Promise<Buffer | null>>();
  return {
    speak(text) {
      const hit = cache.get(text);
      if (hit) return hit;
      const job = (async () => {
        try {
          const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
            body: JSON.stringify({ text, model_id: MODEL_ID }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) {
            console.warn(`[tts] ElevenLabs answered ${res.status}`);
            cache.delete(text);
            return null;
          }
          return Buffer.from(await res.arrayBuffer());
        } catch (e) {
          console.warn(`[tts] failed: ${e instanceof Error ? e.message : String(e)}`);
          cache.delete(text);
          return null;
        }
      })();
      cache.set(text, job);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      return job;
    },
  };
}
