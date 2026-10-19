/**
 * Multi-provider LLM layer with automatic failover.
 *
 * The problem this solves: one API key is a single point of failure. A free tier
 * runs out at 40 requests, a key gets rate-limited, a provider has an outage —
 * and the assistant goes silent, or worse, silently degrades to the offline path
 * mid-conversation.
 *
 * So instead of one key, up to six providers are configured at once. A request
 * walks the chain in order; the first provider that answers wins. A provider that
 * returns 429 (rate limit), 402/403 (quota/billing), 401 (bad key), 5xx, or times
 * out is marked **cooling off** for a short window and skipped on subsequent
 * requests — so a dead provider costs one failed round-trip, not one per message.
 *
 * Provider order is user-controllable (`AI_PROVIDER_ORDER`). Anything speaking the
 * OpenAI chat-completions wire format works through the generic adapter, which
 * covers OpenAI, Groq, OpenRouter, Together, DeepSeek, xAI, Mistral, Ollama, vLLM
 * and LM Studio. Anthropic and Gemini need their own adapters because their
 * request and response shapes genuinely differ.
 *
 * Design rule, inherited from provider.ts: **nothing here throws.** A failure
 * degrades to the next provider, then to the offline path. The deterministic
 * analysis is the product; the model is an enhancement (TRD §40).
 */

import type { ChatMessage } from "./provider";

/* ------------------------------------------------------------------ */
/* Provider definitions                                                */
/* ------------------------------------------------------------------ */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "openrouter"
  | "custom";

export type WireFormat = "openai" | "anthropic" | "google";

export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** The wire protocol this provider speaks. */
  wire: WireFormat;
  /** Env vars that may hold the key, in priority order. */
  keyVars: string[];
  /** Env vars that may hold a model override. */
  modelVars: string[];
  /** Default model when none is configured. */
  defaultModel: string;
  /** Default endpoint when none is configured. */
  defaultBaseUrl: string;
  /** Env var that may override the endpoint (for self-hosted / proxies). */
  baseUrlVar: string;
  /** Env var that may override the key (the one written in .env.example). */
  primaryKeyVar: string;
  /** Where to get a key — surfaced in the UI. */
  consoleUrl: string;
  /** Free tier available, so the reader knows what can be tried at no cost. */
  freeTier: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    wire: "openai",
    keyVars: ["OPENAI_API_KEY", "AI_API_KEY"],
    modelVars: ["OPENAI_MODEL"],
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlVar: "OPENAI_BASE_URL",
    primaryKeyVar: "OPENAI_API_KEY",
    consoleUrl: "https://platform.openai.com/api-keys",
    freeTier: false,
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    wire: "anthropic",
    keyVars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    modelVars: ["ANTHROPIC_MODEL"],
    defaultModel: "claude-3-5-haiku-latest",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlVar: "ANTHROPIC_BASE_URL",
    primaryKeyVar: "ANTHROPIC_API_KEY",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    freeTier: false,
  },
  {
    id: "google",
    label: "Google Gemini",
    wire: "google",
    keyVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    modelVars: ["GEMINI_MODEL"],
    defaultModel: "gemini-2.0-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlVar: "GEMINI_BASE_URL",
    primaryKeyVar: "GEMINI_API_KEY",
    consoleUrl: "https://aistudio.google.com/app/apikey",
    freeTier: true,
  },
  {
    id: "groq",
    label: "Groq",
    wire: "openai",
    keyVars: ["GROQ_API_KEY"],
    modelVars: ["GROQ_MODEL"],
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    baseUrlVar: "GROQ_BASE_URL",
    primaryKeyVar: "GROQ_API_KEY",
    consoleUrl: "https://console.groq.com/keys",
    freeTier: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    wire: "openai",
    keyVars: ["OPENROUTER_API_KEY"],
    modelVars: ["OPENROUTER_MODEL"],
    defaultModel: "openai/gpt-4o-mini",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlVar: "OPENROUTER_BASE_URL",
    primaryKeyVar: "OPENROUTER_API_KEY",
    consoleUrl: "https://openrouter.ai/keys",
    freeTier: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    wire: "openai",
    keyVars: ["CUSTOM_API_KEY", "AI_API_KEY"],
    modelVars: ["CUSTOM_MODEL", "AI_MODEL"],
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlVar: "CUSTOM_BASE_URL",
    primaryKeyVar: "CUSTOM_API_KEY",
    consoleUrl: "",
    freeTier: true,
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/**
 * Aliases a reader might reasonably type in `AI_PROVIDER_ORDER`.
 *
 * The id is `google` but everyone calls it "gemini"; `claude` is the model name
 * for the `anthropic` id. Silently ignoring an unrecognised entry would put the
 * provider back in catalogue position and make the configured order look wrong
 * for no visible reason, so common names are mapped explicitly.
 */
const ALIASES: Record<string, ProviderId> = {
  gemini: "google",
  googleai: "google",
  "google-ai": "google",
  claude: "anthropic",
  anthropic: "anthropic",
  openai: "openai",
  gpt: "openai",
  groq: "groq",
  openrouter: "openrouter",
  or: "openrouter",
  custom: "custom",
  local: "custom",
  ollama: "custom",
  lmstudio: "custom",
  vllm: "custom",
};

export function resolveProviderId(raw: string): ProviderId | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (BY_ID.has(key as ProviderId)) return key as ProviderId;
  return ALIASES[key] ?? null;
}

export function providerDef(id: ProviderId): ProviderDef | undefined {
  return BY_ID.get(id);
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Values people put in `.env` while filling it in, which are not real keys.
 *
 * `.env.example` ships `GEMINI_API_KEY=YOUR_API_KEY`. If that line is copied
 * verbatim — which is the normal way to start — the provider looks configured,
 * gets tried on every request, fails, and only then falls through. The reader
 * sees "LLM configured" in the UI and cannot tell why answers stay offline.
 * Treating a placeholder as absent makes the failure visible and immediate
 * instead of costing a round-trip per message.
 */
const PLACEHOLDER_KEYS = new Set([
  "your_api_key", "your-api-key", "yourapikey", "your_api_key_here",
  "api_key", "apikey", "api-key", "replace_me", "changeme", "change_me",
  "xxx", "xxxx", "xxxxxxxx", "todo", "none", "null", "undefined", "test",
  "sk-xxx", "sk-your-key", "paste_your_key_here", "insert_key_here",
]);

export function isPlaceholderKey(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (PLACEHOLDER_KEYS.has(v)) return true;
  // Anything still containing an obvious placeholder marker.
  if (/(?:your|my|insert|paste|replace|put)[-_ ]?(?:api[-_ ]?)?key/i.test(v)) return true;
  if (/^<.*>$/.test(v) || /^\$\{.*\}$/.test(v)) return true;
  /*
   * Deliberately no length check.
   *
   * It is tempting to reject short values, but a key's length is not something
   * this code gets to decide — self-hosted gateways use short tokens, and a
   * wrongly-rejected real key is worse than a wrongly-accepted placeholder
   * (which costs one failed request and then cools off). Only *recognisable*
   * placeholder text is rejected.
   */
  return false;
}

function firstEnv(names: string[]): string {
  for (const n of names) {
    const v = env(n);
    if (v && !isPlaceholderKey(v)) return v;
  }
  return "";
}

export interface ProviderConfig {
  def: ProviderDef;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Configuration for one provider, or null when it has no usable key. */
export function providerConfig(id: ProviderId): ProviderConfig | null {
  const def = BY_ID.get(id);
  if (!def) return null;

  const apiKey = firstEnv(def.keyVars);
  // A local OpenAI-compatible server (Ollama, LM Studio, vLLM) needs no key, so
  // the custom slot is usable whenever a base URL is configured.
  const selfHosted = def.id === "custom" && Boolean(env(def.baseUrlVar));
  if (!apiKey && !selfHosted) return null;

  return {
    def,
    apiKey,
    model: firstEnv(def.modelVars) || def.defaultModel,
    baseUrl: (env(def.baseUrlVar) || def.defaultBaseUrl).replace(/\/$/, ""),
  };
}

/**
 * The ordered chain of usable providers.
 *
 * `AI_PROVIDER_ORDER` wins when set (comma-separated ids **or** aliases — both
 * `google` and `gemini` work), so a reader can put their strongest or cheapest
 * provider first. Anything not listed is appended in catalogue order, which means
 * adding one new key never requires editing the order string to make it work.
 */
export function providerChain(): ProviderId[] {
  const order = env("AI_PROVIDER_ORDER")
    .split(",")
    .map((s) => resolveProviderId(s))
    .filter((id): id is ProviderId => id !== null);

  const chain: ProviderId[] = [];
  for (const id of order) {
    if (!chain.includes(id)) chain.push(id);
  }
  for (const p of PROVIDERS) {
    if (!chain.includes(p.id)) chain.push(p.id);
  }
  return chain;
}

/** Every configured provider, in the order they would be tried. */
export function configuredProviders(): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  for (const id of providerChain()) {
    const cfg = providerConfig(id);
    if (cfg) out.push(cfg);
  }
  return out;
}

export function isAnyProviderConfigured(): boolean {
  return configuredProviders().length > 0;
}

/* ------------------------------------------------------------------ */
/* Cooling-off state                                                   */
/* ------------------------------------------------------------------ */

/**
 * A provider that failed for a *transient or quota* reason is parked for a while.
 *
 * Without this, a rate-limited provider is retried on every message, and each
 * message pays a full failed round-trip before falling through — turning a
 * degraded experience into a slow one.
 */
const COOLDOWN_MS = 5 * 60_000;

/** A quota/limit failure parks the provider far longer than a blip. */
const QUOTA_COOLDOWN_MS = 30 * 60_000;

interface Cooldown {
  until: number;
  reason: string;
}

const cooling = new Map<ProviderId, Cooldown>();

export function markCooling(id: ProviderId, reason: string, ms = COOLDOWN_MS): void {
  cooling.set(id, { until: Date.now() + ms, reason });
}

export function coolingReason(id: ProviderId): string | null {
  const c = cooling.get(id);
  if (!c) return null;
  if (c.until <= Date.now()) {
    cooling.delete(id);
    return null;
  }
  return c.reason;
}

export function isCooling(id: ProviderId): boolean {
  return coolingReason(id) !== null;
}

/** Test seam — clears all cooldown state. */
export function resetCooling(): void {
  cooling.clear();
}

/**
 * Classify an HTTP failure so the cooldown is proportionate.
 *
 * 429 and 402 are quota/billing — the provider will not recover in a minute, so
 * it is parked for the long window. 401/403 means the key is wrong, which will
 * not fix itself at all. 5xx and timeouts are transient.
 */
function classify(status: number): { reason: string; ms: number } {
  if (status === 429) return { reason: "rate limit (429)", ms: QUOTA_COOLDOWN_MS };
  if (status === 402) return { reason: "quota exhausted (402)", ms: QUOTA_COOLDOWN_MS };
  if (status === 401) return { reason: "invalid API key (401)", ms: QUOTA_COOLDOWN_MS };
  if (status === 403) return { reason: "key rejected (403)", ms: QUOTA_COOLDOWN_MS };
  if (status === 404) return { reason: "model not found (404)", ms: COOLDOWN_MS };
  if (status >= 500) return { reason: `provider error (${status})`, ms: COOLDOWN_MS };
  return { reason: `request failed (${status})`, ms: COOLDOWN_MS };
}

/** The provider's own error text, when it is helpful. */
function quotaHint(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | undefined;
  const msg =
    (err?.message as string | undefined) ??
    (b.message as string | undefined) ??
    (b.detail as string | undefined);
  if (typeof msg !== "string" || !msg.trim()) return null;
  if (/quota|rate|limit|credit|billing|exceed/i.test(msg)) return msg.trim().slice(0, 160);
  return null;
}

/* ------------------------------------------------------------------ */
/* Wire adapters                                                       */
/* ------------------------------------------------------------------ */

interface CallResult {
  text: string;
  status: number;
}

/**
 * Anthropic's Messages API differs from OpenAI's in three ways that matter:
 * the system prompt is a top-level field rather than a message, the max-token
 * field has a different name, and the response nests text blocks in an array.
 */
function anthropicBody(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  return {
    model: cfg.model,
    max_tokens: maxTokens,
    temperature,
    ...(system ? { system } : {}),
    messages: rest,
  };
}

/** Gemini folds the system prompt into the contents array as a `system` turn. */
function googleBody(
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
) {
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  return {
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
}

function openaiBody(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number
) {
  return {
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature,
    max_tokens: maxTokens,
  };
}

function extractText(wire: WireFormat, json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;

  if (wire === "anthropic") {
    const content = j.content as { type?: string; text?: string }[] | undefined;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();
    return text || null;
  }

  if (wire === "google") {
    const candidates = j.candidates as
      | { content?: { parts?: { text?: string }[] } }[]
      | undefined;
    const text = candidates?.[0]?.content?.parts
      ?.map((p) => p?.text ?? "")
      .join("")
      .trim();
    return text || null;
  }

  const choices = j.choices as { message?: { content?: string } }[] | undefined;
  const text = choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

function endpointAndHeaders(cfg: ProviderConfig): { url: string; headers: HeadersInit; wire: WireFormat } {
  const wire = cfg.def.wire;

  if (wire === "anthropic") {
    return {
      url: `${cfg.baseUrl}/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      wire,
    };
  }

  if (wire === "google") {
    // The key travels as a query parameter on the Gemini REST API.
    return {
      url: `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
      headers: { "Content-Type": "application/json" },
      wire,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  // OpenRouter attributes traffic; harmless elsewhere but only sent there.
  if (cfg.def.id === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/crezicsaryan/Haryn-AI";
    headers["X-Title"] = "Haryn AI";
  }

  return { url: `${cfg.baseUrl}/chat/completions`, headers, wire };
}

/** One attempt against one provider. Never throws. */
async function callProvider(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  opts: { temperature: number; maxTokens: number; timeoutMs: number }
): Promise<CallResult | { error: string; status: number }> {
  const { url, headers, wire } = endpointAndHeaders(cfg);

  const body =
    wire === "anthropic"
      ? anthropicBody(cfg, messages, opts.maxTokens, opts.temperature)
      : wire === "google"
        ? googleBody(messages, opts.maxTokens, opts.temperature)
        : openaiBody(cfg, messages, opts.maxTokens, opts.temperature);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* a non-JSON error body is fine — the status is what matters */
      }
      const hint = quotaHint(parsed);
      const cls = classify(res.status);
      return {
        error: hint ? `${cls.reason} — ${hint}` : cls.reason,
        status: res.status,
      };
    }

    const json = (await res.json()) as unknown;
    const text = extractText(wire, json);
    if (!text) return { error: "provider returned an empty response", status: 200 };
    return { text, status: 200 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timeout = /abort|timeout/i.test(msg);
    return {
      error: timeout ? `timed out after ${Math.round(opts.timeoutMs / 1000)}s` : msg.slice(0, 160),
      status: timeout ? 408 : 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface ChatOutcome {
  text: string;
  provider: ProviderId;
  providerLabel: string;
  model: string;
  /** Providers skipped because they were cooling off. */
  skipped: { provider: ProviderId; reason: string }[];
  /** Providers that were tried and failed during this call. */
  failures: { provider: ProviderId; error: string }[];
}

export interface MultiChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Restrict the attempt to one provider (used by the UI selector). */
  only?: ProviderId;
  /** Attempts per provider before moving on. Default 1. */
  retriesPerProvider?: number;
}

/**
 * Ask the provider chain. Returns the first usable answer, or null.
 *
 * Null means "no provider could answer" — the caller then uses the offline path.
 * This function never throws and never returns a partial answer.
 */
export async function chatWithFailover(
  messages: ChatMessage[],
  opts: MultiChatOptions = {}
): Promise<ChatOutcome | null> {
  const all = configuredProviders();
  const candidates = opts.only ? all.filter((c) => c.def.id === opts.only) : all;
  if (!candidates.length) return null;

  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 900;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const attempts = Math.max(1, opts.retriesPerProvider ?? 1);

  const skipped: ChatOutcome["skipped"] = [];
  const failures: ChatOutcome["failures"] = [];

  for (const cfg of candidates) {
    const parked = coolingReason(cfg.def.id);
    if (parked) {
      skipped.push({ provider: cfg.def.id, reason: parked });
      continue;
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = await callProvider(cfg, messages, { temperature, maxTokens, timeoutMs });

      if ("text" in result) {
        // A success clears any stale cooldown for this provider.
        cooling.delete(cfg.def.id);
        return {
          text: result.text,
          provider: cfg.def.id,
          providerLabel: cfg.def.label,
          model: cfg.model,
          skipped,
          failures,
        };
      }

      // The final attempt decides whether the provider is parked.
      const last = attempt === attempts - 1;
      if (last) {
        const ms = classify(result.status).ms;
        markCooling(cfg.def.id, result.error, ms);
      }
      failures.push({ provider: cfg.def.id, error: result.error });
      if (last) break;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Status (for the UI)                                                 */
/* ------------------------------------------------------------------ */

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  model: string;
  baseUrl: string;
  freeTier: boolean;
  consoleUrl: string;
  /** Non-null when the provider is parked after a failure. */
  cooling: string | null;
  /** Index in the failover order, or null when unconfigured. */
  order: number | null;
  /** True for the provider that would be tried first right now. */
  primary: boolean;
  /** True when this is a local server needing no key. */
  selfHosted: boolean;
  /**
   * A key is present but is a placeholder, so the provider is not usable.
   * Surfaced so the UI can say "replace the placeholder" rather than "no key".
   */
  placeholderKey: boolean;
}

/** Is a key set for this provider, ignoring placeholders? */
function hasPlaceholderKey(def: ProviderDef): boolean {
  return def.keyVars.some((v) => {
    const raw = env(v);
    return Boolean(raw) && isPlaceholderKey(raw);
  });
}

/**
 * The full provider picture for the settings surface.
 *
 * `primary` marks the provider that would answer the next request, which is what
 * the reader actually wants to know — not the nominal configuration order.
 */
export function providerStatuses(): ProviderStatus[] {
  const chain = providerChain();
  const configuredIds = new Set(configuredProviders().map((c) => c.def.id));

  let primaryId: ProviderId | null = null;
  for (const id of chain) {
    if (configuredIds.has(id) && !isCooling(id)) {
      primaryId = id;
      break;
    }
  }

  let order = 0;
  return PROVIDERS.map((def) => {
    const cfg = providerConfig(def.id);
    const isConfigured = cfg !== null;
    return {
      id: def.id,
      label: def.label,
      configured: isConfigured,
      model: cfg?.model ?? def.defaultModel,
      baseUrl: cfg?.baseUrl ?? def.defaultBaseUrl,
      freeTier: def.freeTier,
      consoleUrl: def.consoleUrl,
      cooling: coolingReason(def.id),
      order: isConfigured ? ++order : null,
      primary: isConfigured && def.id === primaryId,
      selfHosted: def.id === "custom" && isConfigured,
      // Only meaningful when the provider is not usable because of the value.
      placeholderKey: !isConfigured && hasPlaceholderKey(def),
    } satisfies ProviderStatus;
  }).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** A one-line summary of the active chain, for the engine badge. */
export function providerSummary(): string {
  const configured = configuredProviders();
  if (!configured.length) return "Offline retrieval (BM25 + structure)";

  const ready = configured.filter((c) => !isCooling(c.def.id));
  if (!ready.length) {
    const first = configured[0];
    const why = coolingReason(first.def.id);
    return `All providers cooling off${why ? ` (${why})` : ""} — using offline retrieval`;
  }

  const primary = ready[0];
  const others = ready.length - 1;
  return others > 0
    ? `${primary.def.label} · ${primary.model} (+${others} fallback${others === 1 ? "" : "s"})`
    : `${primary.def.label} · ${primary.model}`;
}
