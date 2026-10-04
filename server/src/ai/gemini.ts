import { GoogleGenAI, ThinkingLevel, type GenerateContentParameters, type ThinkingConfig } from '@google/genai';
import { REPLY_SCHEMA, systemPrompt, type Persona } from './prompt';

// The only place that talks to Gemini. Key and model come from the environment and stay
// on the server. ONE model: whatever goes wrong, no other model is tried and nothing is
// retried here (the caller says the scripted line and the budget decides about next time).

export interface BrainReply {
  /** Raw model text (expected to be JSON). */
  text: string;
  tokens?: { input: number; output: number };
  /** Why the model stopped (STOP, MAX_TOKENS, ...). */
  finish?: string;
}

/** Anything that can answer a turn. Tests use a fake. */
export interface Brain {
  think(turn: string, signal: AbortSignal): Promise<BrainReply>;
}

/** Flash model with a free tier (https://ai.google.dev/gemini-api/docs/models). Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Room for the reply. It is a thinking model: thought tokens are taken out of this, so a
 * small number comes back as MAX_TOKENS with no text at all (seen live with 16). The reply
 * itself is about 40 tokens; the rest is headroom for whatever thinking cannot be turned off.
 */
export const MAX_OUTPUT_TOKENS = 512;

/**
 * As little thinking as the model allows: a walking partner must answer fast, and thought
 * tokens are paid for. Gemini 2.x takes a token budget (0 = off); Gemini 3 and later take a
 * level, and "minimal" is the lowest.
 */
export const thinkingConfig = (model: string): ThinkingConfig => (/^gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.MINIMAL });

/** The request of one turn. One place, so a test can read exactly what is sent. */
export function geminiRequest(model: string, system: string, turn: string, signal: AbortSignal): GenerateContentParameters {
  return {
    model,
    contents: turn,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: REPLY_SCHEMA,
      temperature: 0.8,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: thinkingConfig(model),
      abortSignal: signal,
    },
  };
}

/** The part of the SDK that is used (tests pass a fake: no network). */
export interface GeminiClient {
  models: {
    generateContent(params: GenerateContentParameters): Promise<{
      text?: string;
      candidates?: { finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; totalTokenCount?: number };
    }>;
  };
}

export interface GeminiOptions {
  client?: GeminiClient;
  warn?: (line: string) => void;
}

export function geminiBrain(apiKey: string, model: string = DEFAULT_GEMINI_MODEL, persona: Persona = 'default', opts: GeminiOptions = {}): Brain {
  const system = systemPrompt(persona);
  const ai: GeminiClient = opts.client ?? new GoogleGenAI({ apiKey });
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  return {
    async think(turn, signal) {
      const res = await ai.models.generateContent(geminiRequest(model, system, turn, signal));
      const u = res.usageMetadata;
      // Everything that is not the prompt is billed as output: the reply and the thoughts.
      const tokens = { input: u?.promptTokenCount ?? 0, output: Math.max(0, (u?.totalTokenCount ?? 0) - (u?.promptTokenCount ?? 0)) };
      const text = res.text ?? '';
      const finish = res.candidates?.[0]?.finishReason;
      if (!text.trim() || finish === 'MAX_TOKENS') warn(`[gemini] warning model=${model} ${text.trim() ? 'reply cut off' : 'empty reply'} finish=${finish ?? 'none'} in=${tokens.input} out=${tokens.output} max_out=${MAX_OUTPUT_TOKENS}`);
      return { text, tokens, ...(finish ? { finish } : {}) };
    },
  };
}

/** Is this error Gemini's "too many requests" (HTTP 429 / RESOURCE_EXHAUSTED)? */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { status, code, message } = e as { status?: unknown; code?: unknown; message?: unknown };
  return status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || (typeof message === 'string' && /\b429\b|RESOURCE_EXHAUSTED/.test(message));
}
