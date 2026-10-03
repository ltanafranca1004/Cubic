import { GoogleGenAI } from '@google/genai';
import { REPLY_SCHEMA, SYSTEM_PROMPT } from './prompt';

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

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function geminiBrain(apiKey: string, model: string = DEFAULT_GEMINI_MODEL): Brain {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async think(turn, signal) {
      const res = await ai.models.generateContent({
        model,
        contents: turn,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseJsonSchema: REPLY_SCHEMA,
          temperature: 0.8,
          maxOutputTokens: 1024,
          abortSignal: signal,
        },
      });
      const u = res.usageMetadata;
      return { text: res.text ?? '', tokens: { input: u?.promptTokenCount ?? 0, output: (u?.totalTokenCount ?? 0) - (u?.promptTokenCount ?? 0) } };
    },
  };
}
