// The voices the AI partner can speak with: the one list the settings panel offers, the
// server validates against and the bank script builds. The client only ever sends a `key`;
// the server looks the ElevenLabs voice id up here, so an id never comes from a client.
// (Voice ids are not secrets.)

export const AI_VOICES = [
  { key: 'jessica', label: 'Jessica', id: 'r1KmysJdVYZjJCm4mL3b' },
  { key: 'wizard', label: 'Wizard', id: 'JoYo65swyP8hH6fVMeTO' },
] as const;

export type AiVoice = (typeof AI_VOICES)[number]['key'];
export const AI_VOICE_KEYS: readonly AiVoice[] = AI_VOICES.map((v) => v.key);
export const DEFAULT_AI_VOICE: AiVoice = 'jessica';

/** A voice key as sent by a client or typed on a command line, or null: only a key of AI_VOICES is one. */
export const parseAiVoice = (value: unknown): AiVoice | null => (typeof value === 'string' && (AI_VOICE_KEYS as readonly string[]).includes(value) ? (value as AiVoice) : null);

/** The entry of a voice (its label and ElevenLabs id). */
export const aiVoice = (key: AiVoice): (typeof AI_VOICES)[number] => AI_VOICES.find((v) => v.key === key)!;
