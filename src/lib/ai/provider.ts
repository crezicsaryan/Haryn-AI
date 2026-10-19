/**
 * LLM + embedding provider.
 *
 * Chat goes through the **multi-provider failover chain** (see
 * `multiprovider.ts`): up to six providers are configured at once and the first
 * one that answers wins, so a single exhausted free tier or a rate-limited key
 * degrades gracefully instead of taking the assistant offline.
 *
 * Embeddings stay on the OpenAI-compatible wire format, since that is the only
 * widely-supported embeddings API.
 *
 * Design rule, preserved: **every function here returns null instead of
 * throwing.** The AI layer is an enhancement; the deterministic analysis is the
 * product. A missing key, a timeout or a 429 must never break a report — the
 * caller falls back to the offline retrieval path (TRD §40).
 */

import {
  chatWithFailover,
  configuredProviders,
  isAnyProviderConfigured,
  providerSummary,
  type MultiChatOptions,
} from "./multiprovider";

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

/**
 * Whether an embedding provider is available.
 *
 * Embeddings are a separate capability from chat: they need a key that supports
 * the embeddings endpoint, and they are optional. `AI_EMBEDDINGS=off` disables
 * them outright, which is the escape hatch for a provider that has chat but no
 * embeddings (Anthropic, most free tiers).
 */
export function embeddingsStatus(): {
  enabled: boolean;
  model: string;
  baseUrl: string;
} {
  const explicitOff = env("AI_EMBEDDINGS").toLowerCase() === "off";
  // Embeddings speak the OpenAI wire format, so they take the OpenAI-compatible
  // key. An Anthropic-only or Gemini-only setup simply has no embedding layer.
  const key = env("OPENAI_API_KEY") || env("AI_API_KEY") || env("CUSTOM_API_KEY");
  const base =
    env("OPENAI_BASE_URL") || env("CUSTOM_BASE_URL") || "https://api.openai.com/v1";
  return {
    enabled: !explicitOff && Boolean(key),
    model: env("AI_EMBEDDING_MODEL") || "text-embedding-3-small",
    baseUrl: base.replace(/\/$/, ""),
  };
}

export function aiStatus(): AiStatus {
  const chat = configuredProviders()[0];
  const emb = embeddingsStatus();
  return {
    // "Configured" means *any* provider in the failover chain has a key.
    configured: isAnyProviderConfigured(),
    chatModel: chat ? `${chat.def.label} · ${chat.model}` : "offline (no provider configured)",
    embeddingModel: emb.model,
    embeddingsEnabled: emb.enabled,
    baseUrl: chat?.baseUrl ?? "https://api.openai.com/v1",
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

/**
 * Chat options. An alias for the multi-provider options so callers do not need
 * to know which layer handles failover.
 */
export type ChatOptions = MultiChatOptions;
/** The provider that produced the last answer, for the UI badge. */
export interface ChatMeta {
  provider: string;
  model: string;
  /** Providers that were skipped because they were cooling off. */
  skipped: { provider: string; reason: string }[];
}

/**
 * Ask the failover chain. Returns the assistant text, or null when no provider
 * could answer — in which case the caller uses the offline path.
 *
 * Never throws. Use `chatCompletionMeta` when the answering provider needs to be
 * surfaced to the reader.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string | null> {
  const out = await chatWithFailover(messages, opts);
  return out ? out.text : null;
}

/** As `chatCompletion`, but also reports which provider answered. */
export async function chatCompletionMeta(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<{ text: string; meta: ChatMeta } | null> {
  const out = await chatWithFailover(messages, opts);
  if (!out) return null;
  return {
    text: out.text,
    meta: {
      provider: out.providerLabel,
      model: out.model,
      skipped: out.skipped.map((s) => ({ provider: s.provider, reason: s.reason })),
    },
  };
}

/** Embed a batch of texts. Returns null when embeddings are unavailable. */
export async function embedTexts(
  texts: string[],
  opts: { timeoutMs?: number } = {}
): Promise<number[][] | null> {
  const { enabled, model, baseUrl } = embeddingsStatus();
  const apiKey = env("OPENAI_API_KEY") || env("AI_API_KEY") || env("CUSTOM_API_KEY");
  if (!enabled || !apiKey || !texts.length) return null;

  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, input: texts }),
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
  return engine === "llm" ? providerSummary() : "Offline retrieval (BM25 + structure)";
}

export { providerSummary };
