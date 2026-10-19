import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS,
  chatWithFailover,
  configuredProviders,
  coolingReason,
  isAnyProviderConfigured,
  markCooling,
  providerConfig,
  providerStatuses,
  providerSummary,
  resetCooling,
  resolveProviderId,
  isPlaceholderKey,
  retryHintMs,
} from "../ai/multiprovider";

/* ------------------------------------------------------------------ */
/* Env harness                                                         */
/* ------------------------------------------------------------------ */

const ALL_KEY_VARS = [
  "AI_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_MODEL",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL",
  "GROQ_API_KEY", "GROQ_MODEL",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
  "CUSTOM_API_KEY", "CUSTOM_BASE_URL", "CUSTOM_MODEL", "AI_MODEL",
  "AI_PROVIDER_ORDER",
  "POLLINATIONS_API_KEY", "POLLINATIONS_MODEL", "POLLINATIONS_BASE_URL",
  "AI_ALLOW_KEYLESS",
];

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ALL_KEY_VARS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  /*
   * Keyless is on by default, which would make "no keys configured" untrue in
   * every test below. These tests are about the *keyed* path, so they switch it
   * off explicitly; the keyless tests turn it back on themselves.
   */
  process.env.AI_ALLOW_KEYLESS = "off";
  resetCooling();
});

afterEach(() => {
  for (const k of ALL_KEY_VARS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetCooling();
});

function setKeys(keys: Record<string, string>) {
  for (const [k, v] of Object.entries(keys)) process.env[k] = v;
}

/** A fetch stub that answers per-hostname from a scripted map. */
function stubFetch(
  script: Record<
    string,
    { status: number; body?: unknown; throw?: boolean; error?: string }
  >
) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const host = new URL(url).hostname;
    const entry = script[host];
    if (!entry) throw new Error(`no stub for ${host}`);
    // `error` lets a test simulate an abort/timeout, which the caller classifies
    // differently from a plain network failure.
    if (entry.throw) throw new Error(entry.error ?? "network down");
    return new Response(JSON.stringify(entry.body ?? {}), {
      status: entry.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const pong = (text: string) => ({ choices: [{ message: { content: text } }] });

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

test("no keys means no providers, and no LLM", () => {
  assert.equal(isAnyProviderConfigured(), false);
  assert.equal(configuredProviders().length, 0);
  assert.equal(providerConfig("openai"), null);
});

test("one key configures exactly one provider", () => {
  setKeys({ GROQ_API_KEY: "gsk_test" });
  const configured = configuredProviders();
  assert.equal(configured.length, 1);
  assert.equal(configured[0].def.id, "groq");
});

test("AI_API_KEY alone still configures a usable provider", () => {
  setKeys({ AI_API_KEY: "sk-legacy" });
  const ids = configuredProviders().map((c) => c.def.id);
  // It is the documented OpenAI-compatible fallback.
  assert.ok(ids.includes("openai"), `expected openai, got ${ids.join(",")}`);
});

test("six providers can be configured at once", () => {
  setKeys({
    OPENAI_API_KEY: "a",
    ANTHROPIC_API_KEY: "b",
    GEMINI_API_KEY: "c",
    GROQ_API_KEY: "d",
    OPENROUTER_API_KEY: "e",
    CUSTOM_API_KEY: "f",
  });
  assert.equal(configuredProviders().length, 6);
});

test("provider order is respected from AI_PROVIDER_ORDER", () => {
  setKeys({
    OPENAI_API_KEY: "a",
    GROQ_API_KEY: "b",
    GEMINI_API_KEY: "c",
    AI_PROVIDER_ORDER: "groq,gemini,openai",
  });
  // "gemini" resolves to the canonical `google` id.
  assert.deepEqual(configuredProviders().map((c) => c.def.id), ["groq", "google", "openai"]);
});

test("unlisted providers are appended so a new key works without config", () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "groq" });
  assert.deepEqual(configuredProviders().map((c) => c.def.id), ["groq", "openai"]);
});

test("common provider aliases are accepted in the order string", () => {
  setKeys({ GEMINI_API_KEY: "c", ANTHROPIC_API_KEY: "d" });
  // "gemini" and "claude" are what a reader would naturally type.
  process.env.AI_PROVIDER_ORDER = "gemini,claude";
  assert.deepEqual(configuredProviders().map((c) => c.def.id), ["google", "anthropic"]);
});

test("an unknown order entry is skipped, not treated as a provider", () => {
  setKeys({ GROQ_API_KEY: "b" });
  process.env.AI_PROVIDER_ORDER = "nonsense,groq";
  assert.deepEqual(configuredProviders().map((c) => c.def.id), ["groq"]);
});

test("resolveProviderId maps aliases and rejects junk", () => {
  assert.equal(resolveProviderId("gemini"), "google");
  assert.equal(resolveProviderId("claude"), "anthropic");
  assert.equal(resolveProviderId("ollama"), "custom");
  assert.equal(resolveProviderId("GOOGLE"), "google");
  assert.equal(resolveProviderId("  groq  "), "groq");
  assert.equal(resolveProviderId("not-a-provider"), null);
  assert.equal(resolveProviderId(""), null);
});

test("a custom base URL makes the self-hosted slot usable with no key", () => {
  setKeys({ CUSTOM_BASE_URL: "http://localhost:11434/v1" });
  const cfg = providerConfig("custom");
  assert.ok(cfg);
  assert.equal(cfg!.baseUrl, "http://localhost:11434/v1");
});

test("every provider in the catalogue has a distinct id and a default model", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PROVIDERS) {
    assert.ok(p.defaultModel.length > 0, `${p.id} needs a default model`);
    assert.ok(p.primaryKeyVar.length > 0, `${p.id} needs a primary key var`);
  }
});

/* ------------------------------------------------------------------ */
/* Failover                                                            */
/* ------------------------------------------------------------------ */

test("the first provider answers when healthy", async () => {
  setKeys({ OPENAI_API_KEY: "a", AI_PROVIDER_ORDER: "openai" });
  const s = stubFetch({ "api.openai.com": { status: 200, body: pong("hello") } });
  try {
    const out = await chatWithFailover([{ role: "user", content: "hi" }]);
    assert.ok(out);
    assert.equal(out!.text, "hello");
    assert.equal(out!.provider, "openai");
  } finally {
    s.restore();
  }
});

test("a 429 on the first provider falls through to the second", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 429, body: { error: { message: "rate limit exceeded" } } },
    "api.groq.com": { status: 200, body: pong("from groq") },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "hi" }]);
    assert.ok(out);
    assert.equal(out!.text, "from groq");
    assert.equal(out!.provider, "groq");
    assert.equal(out!.failures.length, 1);
    assert.equal(out!.failures[0].provider, "openai");
  } finally {
    s.restore();
  }
});

test("an exhausted first provider is skipped on the NEXT call (cooling off)", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 429, body: {} },
    "api.groq.com": { status: 200, body: pong("groq") },
  });
  try {
    await chatWithFailover([{ role: "user", content: "1" }]);
    assert.ok(coolingReason("openai"), "openai should be cooling off");

    const before = s.calls.length;
    const out = await chatWithFailover([{ role: "user", content: "2" }]);
    assert.ok(out);
    assert.equal(out!.provider, "groq");
    // Only the Groq call is made — the dead provider costs nothing this time.
    const newCalls = s.calls.slice(before);
    assert.equal(newCalls.length, 1, `expected 1 call, got ${newCalls.join(",")}`);
    assert.match(newCalls[0], /groq/);
  } finally {
    s.restore();
  }
});

test("an invalid key (401) parks the provider", async () => {
  setKeys({ OPENAI_API_KEY: "bad", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 401, body: { error: { message: "invalid api key" } } },
    "api.groq.com": { status: 200, body: pong("ok") },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(out!.provider, "groq");
    assert.ok(coolingReason("openai")?.includes("401"));
  } finally {
    s.restore();
  }
});

test("a network failure falls through rather than throwing", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 0, throw: true },
    "api.groq.com": { status: 200, body: pong("survived") },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(out!.text, "survived");
  } finally {
    s.restore();
  }
});

test("all providers failing returns null (caller uses offline path)", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 500, body: {} },
    "api.groq.com": { status: 500, body: {} },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.equal(out, null);
  } finally {
    s.restore();
  }
});

test("all providers cooling off returns null without any network call", async () => {
  setKeys({ OPENAI_API_KEY: "a" });
  markCooling("openai", "rate limit (429)");
  const s = stubFetch({});
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.equal(out, null);
    assert.equal(s.calls.length, 0, "no request should be attempted");
  } finally {
    s.restore();
  }
});

test("no configured provider returns null immediately", async () => {
  const s = stubFetch({});
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.equal(out, null);
    assert.equal(s.calls.length, 0);
  } finally {
    s.restore();
  }
});

test("a success clears a stale cooldown", async () => {
  setKeys({ OPENAI_API_KEY: "a", AI_PROVIDER_ORDER: "openai" });
  markCooling("openai", "temporary", -1); // already expired
  const s = stubFetch({ "api.openai.com": { status: 200, body: pong("back") } });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(coolingReason("openai"), null);
  } finally {
    s.restore();
  }
});

test("`only` restricts the attempt to one provider", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({ "api.groq.com": { status: 200, body: pong("groq only") } });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }], { only: "groq" });
    assert.ok(out);
    assert.equal(out!.provider, "groq");
    assert.ok(s.calls.every((c) => c.includes("groq")));
  } finally {
    s.restore();
  }
});

/* ------------------------------------------------------------------ */
/* Wire formats                                                        */
/* ------------------------------------------------------------------ */

test("Gemini's response shape is parsed", async () => {
  setKeys({ GEMINI_API_KEY: "g", AI_PROVIDER_ORDER: "google" });
  const s = stubFetch({
    "generativelanguage.googleapis.com": {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: "gemini says hi" }] } }] },
    },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(out!.text, "gemini says hi");
  } finally {
    s.restore();
  }
});

test("Gemini's key travels as a query parameter, not a header", async () => {
  setKeys({ GEMINI_API_KEY: "secret-key", AI_PROVIDER_ORDER: "google" });
  const s = stubFetch({
    "generativelanguage.googleapis.com": {
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
    },
  });
  try {
    await chatWithFailover([{ role: "user", content: "x" }]);
    assert.match(s.calls[0], /key=secret-key/);
  } finally {
    s.restore();
  }
});

test("Anthropic's content-block response is parsed", async () => {
  setKeys({ ANTHROPIC_API_KEY: "sk-ant", AI_PROVIDER_ORDER: "anthropic" });
  const s = stubFetch({
    "api.anthropic.com": {
      status: 200,
      body: { content: [{ type: "text", text: "claude here" }] },
    },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(out!.text, "claude here");
    assert.equal(out!.provider, "anthropic");
  } finally {
    s.restore();
  }
});

test("Anthropic receives the system prompt as a top-level field", async () => {
  setKeys({ ANTHROPIC_API_KEY: "sk-ant", AI_PROVIDER_ORDER: "anthropic" });
  let sent: Record<string, unknown> = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    await chatWithFailover([
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
    ]);
    assert.equal(sent.system, "be terse");
    const msgs = sent.messages as { role: string }[];
    assert.ok(msgs.every((m) => m.role !== "system"), "system must not be in messages");
  } finally {
    globalThis.fetch = original;
  }
});

test("an empty response body is treated as a failure and falls through", async () => {
  setKeys({ OPENAI_API_KEY: "a", GROQ_API_KEY: "b", AI_PROVIDER_ORDER: "openai,groq" });
  const s = stubFetch({
    "api.openai.com": { status: 200, body: { choices: [{ message: { content: "   " } }] } },
    "api.groq.com": { status: 200, body: pong("real answer") },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "x" }]);
    assert.ok(out);
    assert.equal(out!.text, "real answer");
  } finally {
    s.restore();
  }
});

/* ------------------------------------------------------------------ */
/* Status surface                                                      */
/* ------------------------------------------------------------------ */

test("status marks the provider that would answer next", () => {
  setKeys({ GROQ_API_KEY: "b", OPENAI_API_KEY: "a", AI_PROVIDER_ORDER: "groq,openai" });
  const statuses = providerStatuses();
  const primary = statuses.find((s) => s.primary);
  assert.ok(primary);
  assert.equal(primary!.id, "groq");
});

test("a cooling provider loses primary status to the next one", () => {
  setKeys({ GROQ_API_KEY: "b", OPENAI_API_KEY: "a", AI_PROVIDER_ORDER: "groq,openai" });
  markCooling("groq", "rate limit (429)");
  const primary = providerStatuses().find((s) => s.primary);
  assert.ok(primary);
  assert.equal(primary!.id, "openai");

  const groq = providerStatuses().find((s) => s.id === "groq");
  assert.ok(groq!.cooling);
});

test("unconfigured providers are listed but not ordered", () => {
  setKeys({ GROQ_API_KEY: "b" });
  const statuses = providerStatuses();
  const openai = statuses.find((s) => s.id === "openai");
  assert.equal(openai!.configured, false);
  assert.equal(openai!.order, null);
});

test("providerSummary names the active provider and its fallback count", () => {
  setKeys({ GROQ_API_KEY: "b", OPENAI_API_KEY: "a", AI_PROVIDER_ORDER: "groq,openai" });
  const summary = providerSummary();
  assert.match(summary, /Groq/);
  assert.match(summary, /1 fallback/);
});

test("providerSummary says offline when nothing is configured", () => {
  assert.match(providerSummary(), /Offline retrieval/);
});

test("providerSummary warns when every provider is cooling off", () => {
  setKeys({ GROQ_API_KEY: "b" });
  markCooling("groq", "rate limit (429)");
  const summary = providerSummary();
  assert.match(summary, /cooling off/i);
  assert.match(summary, /offline/i);
});

/* ------------------------------------------------------------------ */
/* Placeholder keys                                                    */
/* ------------------------------------------------------------------ */

test("a placeholder key does not count as a configured provider", () => {
  // This is what `.env.example` ships, and what a reader gets by copying it.
  setKeys({ GEMINI_API_KEY: "YOUR_API_KEY" });
  assert.equal(isAnyProviderConfigured(), false);
});

test("a placeholder key is reported so the UI can explain it", () => {
  setKeys({ GEMINI_API_KEY: "YOUR_API_KEY" });
  const google = providerStatuses().find((s) => s.id === "google");
  assert.equal(google!.configured, false);
  assert.equal(google!.placeholderKey, true);
});

test("an unset provider is not flagged as a placeholder", () => {
  const google = providerStatuses().find((s) => s.id === "google");
  assert.equal(google!.configured, false);
  assert.equal(google!.placeholderKey, false);
});

test("every placeholder form is rejected", () => {
  for (const v of [
    "", "YOUR_API_KEY", "your-api-key", "changeme", "replace_me", "TODO",
    "xxxxxxxx", "sk-xxx", "<your key>", "${GEMINI_API_KEY}", "paste_your_key_here",
  ]) {
    assert.equal(isPlaceholderKey(v), true, `should reject placeholder: "${v}"`);
  }
});

test("a realistic key is accepted", () => {
  for (const v of [
    "sk-proj-abc123DEF456ghi789jkl012",
    "AIzaSyC4N8f2kL9mQ3rT7vW1xY5zA6bC8dE0fG",
    "gsk_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p",
    // A short token is still a token — self-hosted gateways use them, and a
    // wrongly-rejected real key is worse than an accepted placeholder.
    "localkey",
  ]) {
    assert.equal(isPlaceholderKey(v), false, `should accept key: "${v}"`);
  }
});

test("a placeholder does not block a real key on the same provider", () => {
  // GOOGLE_API_KEY is the second var; a real one there must still work.
  setKeys({ GEMINI_API_KEY: "YOUR_API_KEY", GOOGLE_API_KEY: "AIzaSyC4N8f2kL9mQ3rT7vW1" });
  assert.equal(providerConfig("google") !== null, true);
});

/* ------------------------------------------------------------------ */
/* Keyless public provider                                             */
/* ------------------------------------------------------------------ */

test("a keyless provider is usable with no key at all", () => {
  process.env.AI_ALLOW_KEYLESS = "on";
  const cfg = providerConfig("pollinations");
  assert.ok(cfg, "keyless provider must be configured without a key");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.def.keyless, true);
});

test("a keyless provider keeps the app working on an empty .env", () => {
  process.env.AI_ALLOW_KEYLESS = "on";
  assert.equal(configuredProviders().length, 1);
  assert.equal(isAnyProviderConfigured(), true);
  assert.match(providerSummary(), /Pollinations/);
});

test("AI_ALLOW_KEYLESS=off removes it, for private repositories", () => {
  for (const off of ["off", "0", "false", "no", "OFF"]) {
    process.env.AI_ALLOW_KEYLESS = off;
    assert.equal(providerConfig("pollinations"), null, `"${off}" must disable it`);
    assert.equal(isAnyProviderConfigured(), false);
  }
});

test("a real key always outranks the keyless provider", () => {
  process.env.AI_ALLOW_KEYLESS = "on";
  process.env.GROQ_API_KEY = "gsk_real";
  const chain = configuredProviders().map((c) => c.def.id);
  assert.equal(chain[0], "groq", "the keyed provider must be tried first");
  assert.ok(chain.includes("pollinations"), "keyless stays as the last resort");
  assert.equal(chain[chain.length - 1], "pollinations");
});

test("a keyless provider is never reported as a placeholder key", () => {
  process.env.AI_ALLOW_KEYLESS = "on";
  const status = providerStatuses().find((p) => p.id === "pollinations");
  assert.ok(status);
  assert.equal(status.configured, true);
  assert.equal(status.keyless, true);
  assert.equal(
    status.placeholderKey,
    false,
    "there is no key to be a placeholder, so warning about one would be noise"
  );
});

test("the keyless provider can be named in the order string", () => {
  process.env.AI_ALLOW_KEYLESS = "on";
  assert.equal(resolveProviderId("pollinations"), "pollinations");
  assert.equal(resolveProviderId("public"), "pollinations");
  assert.equal(resolveProviderId("polli"), "pollinations");
});

/* ------------------------------------------------------------------ */
/* Retry hints                                                         */
/* ------------------------------------------------------------------ */

test("a stated reset time wins over the generic 30-minute bucket", () => {
  // Pollinations' free tier: "1 reply every 30 seconds". Parking it for 30
  // minutes removes a working provider from the chain for no reason.
  assert.equal(
    retryHintMs(
      "Free limit reached: 1 reply every 30 seconds per IP. Retry after 5s, or get unlimited replies."
    ),
    30_000
  );
});

test("reads seconds, minutes and plain numbers with units", () => {
  assert.equal(retryHintMs("Retry after 5s"), 10_000, "clamped up to the floor");
  assert.equal(retryHintMs("try again in 45 seconds"), 45_000);
  assert.equal(retryHintMs("rate limited, retry in 2 minutes"), 120_000);
});

test("ignores text with no reset time", () => {
  assert.equal(retryHintMs("invalid api key"), null);
  assert.equal(retryHintMs("model gpt-4o-mini not found"), null);
  assert.equal(retryHintMs(""), null);
});

test("a long hint cannot park a provider indefinitely", () => {
  assert.equal(retryHintMs("retry after 999999 seconds"), 30 * 60_000);
});

test("a provider's own timeout cap is the one reported", async () => {
  // Pollinations throttles by queueing, so the global 45s wait is wasted; the
  // message must name the 20s cap that actually fired, not the global default.
  process.env.AI_ALLOW_KEYLESS = "on";
  const s = stubFetch({
    "text.pollinations.ai": {
      status: 0,
      throw: true,
      error: "The operation was aborted due to timeout",
    },
  });
  try {
    const out = await chatWithFailover([{ role: "user", content: "hi" }], {
      only: "pollinations",
      timeoutMs: 45_000,
    });
    assert.equal(out, null, "a failing provider yields the offline path");
    const parked = coolingReason("pollinations");
    assert.ok(parked);
    assert.match(parked!, /timed out after 20s/);
    assert.ok(!/45s/.test(parked!), "must not report a timeout that never happened");
  } finally {
    s.restore();
  }
});
