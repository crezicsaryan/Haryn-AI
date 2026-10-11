"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  TestTube2,
  CircleAlert,
} from "lucide-react";
import type { Report } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardHeader, SeverityBadge } from "@/components/ui/primitives";
import { SUGGESTED_QUESTIONS } from "@/lib/chat";

/* ------------------------------------------------------------------ */
/* Testing detail                                                      */
/* ------------------------------------------------------------------ */

export function TestingDetail({ report }: { report: Report }) {
  const t = report.testing;
  const pct = Math.min(100, t.ratio * 100);

  return (
    <Card>
      <CardHeader
        title="Testing"
        subtitle="Estimated from test-file presence, not a coverage report"
        icon={<TestTube2 className="h-4 w-4" />}
      />
      <div className="p-5 sm:p-6">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="font-display text-2xl font-extrabold text-ink">
              {t.testFiles}
            </div>
            <div className="text-[11.5px] text-ink-3">test files</div>
          </div>
          <div>
            <div className="font-display text-2xl font-extrabold text-ink">
              {t.sourceFiles}
            </div>
            <div className="text-[11.5px] text-ink-3">source files</div>
          </div>
          <div>
            <div className="font-display text-2xl font-extrabold text-ink">
              {pct.toFixed(1)}%
            </div>
            <div className="text-[11.5px] text-ink-3">ratio</div>
          </div>
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-pill bg-hair">
          <div
            className="h-full rounded-pill bg-med"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>

        {t.frameworks.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Frameworks
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.frameworks.map((f) => (
                <span
                  key={f}
                  className="rounded-md border border-hair bg-surface-2 px-2 py-1 text-[12px] text-ink-2"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {t.areas.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Business-critical areas
            </div>
            <ul className="mt-2 space-y-1.5">
              {t.areas.slice(0, 8).map((a) => (
                <li
                  key={a.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {a.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good" />
                    ) : a.status === "risk" ? (
                      <CircleAlert className="h-3.5 w-3.5 shrink-0 text-crit" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-med" />
                    )}
                    <span className="truncate text-[13px] capitalize text-ink-2">
                      {a.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">
                    {a.status === "ok" ? "covered" : "no tests"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dependencies detail                                                 */
/* ------------------------------------------------------------------ */

export function DependencyDetail({ report }: { report: Report }) {
  const d = report.dependencies;
  const rows = [
    { label: "Healthy", value: d.stat.healthy, hex: "#12a594" },
    { label: "Outdated", value: d.stat.outdated, hex: "#f5a524" },
    { label: "Vulnerable", value: d.stat.vulnerable, hex: "#e5484d" },
    { label: "Unused", value: d.stat.unused, hex: "#0ea5e9" },
  ];
  const flagged = d.items.filter(
    (i) => i.status === "vulnerable" || i.status === "outdated"
  );

  return (
    <Card>
      <CardHeader
        title="Dependencies"
        subtitle={`${d.stat.total} declared · checked against the OSV advisory database`}
        icon={<Boxes className="h-4 w-4" />}
      />
      <div className="p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: r.hex }}
                />
                <span className="text-[11.5px] text-ink-3">{r.label}</span>
              </div>
              <div
                className="mt-1 font-display text-2xl font-extrabold tabular-nums"
                style={{ color: r.value > 0 ? r.hex : "var(--color-ink-4)" }}
              >
                {r.value}
              </div>
            </div>
          ))}
        </div>

        {d.manifests.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {d.manifests.map((m) => (
              <span
                key={m}
                className="rounded-md border border-hair bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink-2"
              >
                {m}
              </span>
            ))}
          </div>
        )}

        {flagged.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Flagged packages
            </div>
            <ul className="mt-2 space-y-1.5">
              {flagged.slice(0, 8).map((i) => (
                <li
                  key={`${i.ecosystem}:${i.name}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-surface px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SeverityBadge
                      severity={i.status === "vulnerable" ? "high" : "low"}
                      size="sm"
                      showIcon={false}
                    />
                    <span className="truncate font-mono text-[12.5px] text-ink-2">
                      {i.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-3">
                    {i.vulns?.length
                      ? i.vulns.map((v) => v.id).join(", ")
                      : i.version}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {d.stat.total === 0 && (
          <p className="mt-5 text-[13px] text-ink-2">
            No recognised package manifest was found, so dependency analysis was skipped.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

interface ChatMatch {
  path: string;
  line: number;
  endLine: number;
  symbol: string | null;
  kind: string;
  score: number;
  reasons: string[];
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  matches?: ChatMatch[];
  engine?: "llm" | "retrieval";
  intent?: string;
  groundedIn?: number;
}

const INTENT_LABEL: Record<string, string> = {
  findings: "from findings",
  security: "from security analysis",
  testing: "from testing analysis",
  dependencies: "from dependencies",
  stack: "from stack detection",
  structure: "from architecture",
  documentation: "from docs analysis",
  code: "code search",
};

function EngineBadge({ engine }: { engine?: "llm" | "retrieval" }) {
  if (!engine) return null;
  const llm = engine === "llm";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-1.5 py-[1px] text-[10px] font-medium",
        llm
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-hair bg-surface-2 text-ink-3"
      )}
      title={
        llm
          ? "Answer written by a language model, grounded in the retrieved excerpts"
          : "Answer composed offline from retrieved code excerpts (no API key configured)"
      }
    >
      <Sparkles className="h-2.5 w-2.5" />
      {llm ? "LLM" : "offline retrieval"}
    </span>
  );
}

/**
 * The AI agent — the right-hand pane of the report.
 *
 * Extracted from the old composite panel so it can sit persistently beside the
 * content instead of being one more section in a long scroll.
 */
export function ChatAgent({ report }: { report: Report }) {
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: "assistant",
      content: `I've analysed ${report.repo.fullName}. Ask me anything about it — authentication, the database layer, security risks, or where to start improving. Answers are retrieved from the actual source files and cite them.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [openDetail, setOpenDetail] = useState<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setTurns((m) => [...m, { role: "user", content: q }]);
    setBusy(true);

    try {
      const res = await fetch(`/api/chat/${report.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = (await res.json()) as {
        answer?: string;
        sources?: string[];
        matches?: ChatMatch[];
        engine?: "llm" | "retrieval";
        intent?: string;
        groundedIn?: number;
        error?: { message: string };
      };
      setTurns((m) => [
        ...m,
        {
          role: "assistant",
          content:
            data.answer ??
            data.error?.message ??
            "I couldn't answer that from the analysis data.",
          sources: data.sources,
          matches: data.matches,
          engine: data.engine,
          intent: data.intent,
          groundedIn: data.groundedIn,
        },
      ]);
    } catch {
      setTurns((m) => [
        ...m,
        {
          role: "assistant",
          content: "Something went wrong reaching the analysis service. Please try again.",
        },
      ]);
    } finally {
      setBusy(false);
      window.setTimeout(
        () => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
        60
      );
    }
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader
        title="Ask about this repository"
        subtitle="Answers are retrieved from the actual source files and cite them"
        icon={<MessageSquare className="h-4 w-4" />}
      />

      <div className="max-h-[480px] min-h-[280px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
        {turns.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-3",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {m.role === "assistant" && (
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,var(--color-brand-400),var(--color-brand-600))] text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            )}
            <div
              className={cn(
                "min-w-0 max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                m.role === "user"
                  ? "bg-ink text-white"
                  : "border border-hair bg-surface-2/70 text-ink-2"
              )}
            >
              {m.role === "assistant" && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <EngineBadge engine={m.engine} />
                  {m.intent && INTENT_LABEL[m.intent] && (
                    <span className="rounded-pill border border-hair bg-surface px-1.5 py-[1px] text-[10px] font-medium text-ink-3">
                      {INTENT_LABEL[m.intent]}
                    </span>
                  )}
                  {typeof m.groundedIn === "number" && m.groundedIn > 0 && (
                    <span className="text-[10.5px] text-ink-4">
                      grounded in {m.groundedIn} excerpt{m.groundedIn === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}

              <p className="whitespace-pre-wrap">{m.content}</p>

              {m.matches && m.matches.length > 0 && (
                <div className="mt-2.5 border-t border-hair pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenDetail((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    aria-expanded={openDetail.has(i)}
                    className="inline-flex cursor-pointer items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-4 transition-colors hover:text-ink-2"
                  >
                    {openDetail.has(i) ? "Hide" : "Show"} {m.matches.length} retrieved
                    source{m.matches.length === 1 ? "" : "s"}
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        openDetail.has(i) && "rotate-180"
                      )}
                    />
                  </button>

                  {openDetail.has(i) && (
                    <ul className="mt-2 space-y-1">
                      {m.matches.map((mt, j) => (
                        <li
                          key={`${mt.path}:${mt.line}:${j}`}
                          className="rounded-md border border-hair bg-surface px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[10.5px] text-ink-2">
                              {mt.path}:{mt.line}
                            </span>
                            <span
                              className="shrink-0 font-mono text-[10px] text-ink-4"
                              title="retrieval score"
                            >
                              {mt.score.toFixed(2)}
                            </span>
                          </div>
                          {(mt.symbol || mt.reasons.length > 0) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {mt.symbol && (
                                <span className="rounded border border-brand-100 bg-brand-50 px-1.5 py-[1px] font-mono text-[9.5px] text-brand-700">
                                  {mt.symbol}
                                </span>
                              )}
                              {mt.reasons
                                .filter((r) => !r.startsWith("symbol:"))
                                .map((r) => (
                                  <span
                                    key={r}
                                    className="rounded border border-hair bg-surface-2 px-1.5 py-[1px] text-[9.5px] text-ink-3"
                                  >
                                    {r}
                                  </span>
                                ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin-slow" />
            Retrieving relevant code…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-hair p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.slice(0, 4).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              disabled={busy}
              className="cursor-pointer rounded-pill border border-hair-strong bg-surface px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about this repository…"
            aria-label="Ask a question about this repository"
            className="h-11 min-w-0 flex-1 rounded-pill border border-hair-strong bg-surface px-4 text-[13.5px] text-ink outline-none placeholder:text-ink-4 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.12)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send question"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-white transition-colors hover:bg-[#161d2e] disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** The narrative summary card. */
export function AiSummaryCard({ report }: { report: Report }) {
  return (
    <Card>
      <CardHeader
        title="AI repository summary"
        subtitle="A narrative built only from the measured findings"
        icon={<Sparkles className="h-4 w-4" />}
        action={
          <span
            className={cn(
              "hidden rounded-pill border px-2.5 py-1 text-[11px] font-medium sm:inline-flex",
              report.summaryEngine === "llm"
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-hair bg-surface-2 text-ink-3"
            )}
            title={
              report.summaryEngine === "llm"
                ? "Written by a language model from the measured findings"
                : "Synthesised deterministically — configure AI_API_KEY for a written narrative"
            }
          >
            {report.summaryEngine === "llm" ? "LLM summary" : "Deterministic summary"}
          </span>
        }
      />
      <div className="p-5 sm:p-6">
        <p className="text-[14.5px] leading-relaxed text-ink-2">{report.summary}</p>
        {report.aiNotice && (
          <p className="mt-4 rounded-lg border border-hair bg-surface-2/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-3">
            {report.aiNotice}
          </p>
        )}
      </div>
    </Card>
  );
}
