"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Cpu,
  ExternalLink,
  KeyRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Provider status and failover chain.
 *
 * Two things a reader needs and could not previously see:
 *
 *   1. **Which AI is answering.** A badge that says "LLM" without naming the
 *      provider is not verifiable. This names it and the model.
 *   2. **What happens when one runs out.** The whole point of the chain is that
 *      a reader can configure six providers and stop worrying about a free tier
 *      running dry. If a provider has been parked (rate limit, bad key), that is
 *      shown rather than silently skipped.
 */

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  model: string;
  baseUrl: string;
  freeTier: boolean;
  consoleUrl: string;
  cooling: string | null;
  order: number | null;
  primary: boolean;
  selfHosted: boolean;
  /** A key is present but is still the `.env.example` placeholder. */
  placeholderKey?: boolean;
}

interface StatusPayload {
  summary: string;
  anyConfigured: boolean;
  anyReady: boolean;
  providers: ProviderInfo[];
  embeddings: { enabled: boolean; model: string };
}

export function ProviderPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);

  // Fetched once when opened rather than on mount: the chat panel renders on
  // every report view and this is not worth a request on page load.
  useEffect(() => {
    if (!open || status) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/status", { cache: "no-store" });
        const data = (await res.json()) as StatusPayload;
        if (!cancelled) setStatus(data);
      } catch {
        /* the summary line simply stays unknown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status]);

  const configured = status?.providers.filter((p) => p.configured) ?? [];
  const ready = configured.filter((p) => !p.cooling);
  const primary = ready.find((p) => p.primary) ?? ready[0] ?? null;

  const headline = status
    ? status.anyReady && primary
      ? primary.label
      : status.anyConfigured
        ? "All providers cooling off"
        : "Offline analysis"
    : null;

  return (
    <div className="border-b border-hair">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-5 py-2.5 text-left transition-colors hover:bg-surface-2/50 sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <span className="truncate text-[12px] text-ink-2">
            {headline ? (
              <>
                <span className="font-medium text-ink">{headline}</span>
                {status && configured.length > 1 && (
                  <span className="text-ink-3">
                    {" "}
                    · {configured.length} providers
                  </span>
                )}
              </>
            ) : (
              "AI provider"
            )}
          </span>
          {status?.anyReady && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-good"
              title="A provider is available"
            />
          )}
          {status && !status.anyReady && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-med"
              title="No provider available — answers use offline analysis"
            />
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="px-5 pb-4 sm:px-6">
          {!status && (
            <p className="text-[12px] text-ink-3">Checking providers…</p>
          )}

          {status && (
            <>
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {status.anyReady
                  ? "Answers are tried against these in order. A provider that hits its limit is skipped automatically and retried later."
                  : status.anyConfigured
                    ? "Every configured provider is temporarily unavailable, so answers fall back to deterministic analysis of the source."
                    : "No AI provider is configured, so answers are produced by analysing the source directly — accurate and cited, but less fluent than a written explanation."}
              </p>

              <ul className="mt-3 space-y-1.5">
                {status.providers
                  .filter((p) => p.configured || p.freeTier)
                  .map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5",
                        p.primary
                          ? "border-brand-200 bg-brand-50/60"
                          : "border-hair bg-surface"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {p.cooling ? (
                          <CircleSlash className="h-3.5 w-3.5 shrink-0 text-med" />
                        ) : p.configured ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good" />
                        ) : (
                          <KeyRound
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              p.placeholderKey ? "text-med" : "text-ink-4"
                            )}
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] text-ink-2">
                            {p.label}
                            {p.primary && (
                              <span className="ml-1.5 rounded-pill border border-brand-200 bg-brand-50 px-1.5 text-[9.5px] font-medium text-brand-700">
                                active
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "block truncate font-mono text-[10.5px]",
                              p.placeholderKey ? "text-med" : "text-ink-4"
                            )}
                          >
                            {p.configured
                              ? p.model
                              : p.placeholderKey
                                ? "placeholder key — replace it"
                                : "no key set"}
                          </span>
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        {p.cooling ? (
                          <span className="text-[10.5px] text-med">{p.cooling}</span>
                        ) : p.configured ? (
                          <span className="text-[10.5px] text-ink-4">
                            #{p.order}
                          </span>
                        ) : (
                          <a
                            href={p.consoleUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-[10.5px] text-brand-700 hover:underline"
                          >
                            get key
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-4">
                <span>
                  Embeddings:{" "}
                  {status.embeddings.enabled
                    ? `on (${status.embeddings.model})`
                    : "off — lexical search only"}
                </span>
                {status.anyConfigured && (
                  <span className="inline-flex items-center gap-1">
                    <Zap className="h-2.5 w-2.5" />
                    failover enabled
                  </span>
                )}
              </div>

              <p className="mt-3 rounded-lg border border-hair bg-surface-2/50 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-3">
                .env — set any of OPENAI_API_KEY, ANTHROPIC_API_KEY,
                GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
                CUSTOM_API_KEY. Optional: AI_PROVIDER_ORDER=groq,gemini,openai
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
