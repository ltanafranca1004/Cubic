import { GoogleGenAI } from '@google/genai';
import { REPLY_SCHEMA, systemPrompt, type Persona } from './prompt';

// The only place that talks to Gemini. Key and model come from the environment and stay
// on the server.

export interface BrainReply {
  /** Raw model text (expected to be JSON). */
  text: string;
  tokens?: { input: number; output: number };
}

/** Anything that can answer a turn. Tests use a fake. */
export interface Brain {
  think(turn: string, signal: AbortSignal): Promise<BrainReply>;
}

/**
 * Stable Flash model with a free tier (https://ai.google.dev/gemini-api/docs/models,
 * https://ai.google.dev/gemini-api/docs/pricing). Newer Flash models work too but answer
 * several seconds slower; override with GEMINI_MODEL.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

export function geminiBrain(apiKey: string, model: string = DEFAULT_GEMINI_MODEL, persona: Persona = 'default'): Brain {
  const system = systemPrompt(persona);
  const ai = new GoogleGenAI({ apiKey });
  return {
    async think(turn, signal) {
      const res = await ai.models.generateContent({
        model,
        contents: turn,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: REPLY_SCHEMA,
          temperature: 0.8,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 }, // a walking partner must answer fast
          abortSignal: signal,
        },
      });
      const u = res.usageMetadata;
      return { text: res.text ?? '', tokens: { input: u?.promptTokenCount ?? 0, output: (u?.totalTokenCount ?? 0) - (u?.promptTokenCount ?? 0) } };
    },
  };
}
