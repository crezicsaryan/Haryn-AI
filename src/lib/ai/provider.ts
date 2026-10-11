/**
 * LLM + embedding provider.
 *
 * Speaks the OpenAI-compatible chat/embeddings API, so it works with OpenAI,
 * Azure OpenAI, OpenRouter, Groq, Together, Ollama, vLLM or LM Studio by
 * changing `AI_BASE_URL`.
 *
 * Design rule: **every function here returns null instead of throwing.** The AI
 * layer is an enhancement; the deterministic analysis is the product. A missing
 * key, a timeout or a 429 must never break a report — the caller falls back to
 * the offline retrieval path (TRD §40).
 */

export interface AiStatus {
  configured: boolean;
  chatModel: string;
  embeddingModel: string;
  embeddingsEnabled: boolean;
  baseUrl: string;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function aiStatus(): AiStatus {
  const apiKey = env("AI_API_KEY") || env("OPENAI_API_KEY");
  const embeddingsEnabled =
    env("AI_EMBEDDINGS").toLowerCase() !== "off" && Boolean(apiKey);
  return {
    configured: Boolean(apiKey),
    chatModel: env("AI_MODEL") || "gpt-4o-mini",
    embeddingModel: env("AI_EMBEDDING_MODEL") || "text-embedding-3-small",
    embeddingsEnabled,
    baseUrl: (env("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export function isAiConfigured(): boolean {
  return aiStatus().configured;
}

function authHeaders(key: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Returns the assistant text, or null if the provider is unavailable. */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string | null> {
  const { configured, chatModel, baseUrl } = aiStatus();
  const apiKey = env("AI_API_KEY") || env("OPENAI_API_KEY");
  if (!configured || !apiKey) return null;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: chatModel,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 900,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/** Embed a batch of texts. Returns null when embeddings are unavailable. */
export async function embedTexts(
  texts: string[],
  opts: { timeoutMs?: number } = {}
): Promise<number[][] | null> {
  const { embeddingsEnabled, embeddingModel, baseUrl } = aiStatus();
  const apiKey = env("AI_API_KEY") || env("OPENAI_API_KEY");
  if (!embeddingsEnabled || !apiKey || !texts.length) return null;

  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: embeddingModel,
        input: texts,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { index: number; embedding: number[] }[];
    };
    if (!json.data?.length) return null;

    // The API may return items out of order; sort by index to be safe.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  } catch {
    return null;
  }
}

/** A human-readable label for the engine that produced an answer. */
export type Engine = "llm" | "retrieval";

export function engineLabel(engine: Engine): string {
  return engine === "llm"
    ? `LLM · ${aiStatus().chatModel}`
    : "Offline retrieval (BM25 + structure)";
}
