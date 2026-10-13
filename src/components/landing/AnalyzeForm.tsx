"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { GitHubMark } from "@/components/ui/GitHubMark";
import { buttonClasses } from "@/components/ui/Button";
import { EXAMPLE_REPOS } from "@/lib/constants";
import { looksLikeGitHubUrl, parseGitHubUrl } from "@/lib/validation";
import { cn, formatCount, relativeTime } from "@/lib/utils";
import { gradeFor } from "@/lib/scoring";

/** A repository the user has analysed before, as `/api/history` returns it. */
interface HistoryItem {
  id: string;
  repoFullName: string;
  repoUrl: string;
  healthScore: number | null;
  findingCount: number;
  criticalCount: number;
  fileCount: number;
  lastAnalyzedAt: string;
  runCount: number;
}

function ScoreChip({ score }: { score: number }) {
  const grade = gradeFor(score);
  return (
    <span
      className="hidden shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 font-display text-[12px] font-bold tabular-nums sm:inline-flex"
      style={{
        borderColor: `${grade.hex}33`,
        background: `${grade.hex}12`,
        color: grade.hex,
      }}
      title={`Grade ${grade.letter} · ${grade.label}`}
    >
      {score}
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
        {grade.letter}
      </span>
    </span>
  );
}

export function AnalyzeForm() {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const valid = looksLikeGitHubUrl(url);
  const showError = touched && url.length > 0 && !valid;

  /**
   * What to search the history for.
   *
   * A pasted URL has to be reduced to `owner/name` before it can match a stored
   * repository name — searching for the whole URL would match nothing. Partial
   * input is searched as typed, so the list narrows while the URL is still being
   * typed.
   */
  const historyQuery = useMemo(() => {
    const raw = url.trim();
    if (!raw) return "";
    const parsed = parseGitHubUrl(raw);
    if (parsed.ok) return `${parsed.repo.owner}/${parsed.repo.name}`;
    return raw.length >= 2 ? raw : "";
  }, [url]);

  /** Load history whenever the picker is open and the search term changes. */
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    // A short debounce while typing; immediate on open.
    const timer = setTimeout(
      () => {
        void (async () => {
          setLoading(true);
          try {
            const res = await fetch(
              `/api/history?limit=20&q=${encodeURIComponent(historyQuery)}`,
              { signal: controller.signal, cache: "no-store" }
            );
            const data = (await res.json()) as { items?: HistoryItem[] };
            setItems(data.items ?? []);
            setFailed(false);
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            // History is a convenience — never block the form on it.
            setItems([]);
            setFailed(true);
          } finally {
            setLoading(false);
            // The old highlight would point at a row that no longer exists.
            setActiveIndex(-1);
          }
        })();
      },
      historyQuery ? 180 : 0
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, historyQuery]);

  /** Dismiss on an outside click. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const list = items ?? [];
  const active = open && activeIndex >= 0 && activeIndex < list.length ? activeIndex : -1;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (!valid || submitting) return;
    setSubmitting(true);
    setOpen(false);
    router.push(`/analyze?url=${encodeURIComponent(url.trim())}`);
  }

  /** Open the stored report — no re-scan, no waiting. */
  function openReport(item: HistoryItem) {
    setOpen(false);
    setActiveIndex(-1);
    router.push(`/report/${item.id}`);
  }

  /** Re-run the analysis for a repository already in the history. */
  function reanalyze(item: HistoryItem, e: React.MouseEvent) {
    e.stopPropagation();
    setUrl(item.repoUrl);
    setTouched(true);
    setSubmitting(true);
    setOpen(false);
    router.push(`/analyze?url=${encodeURIComponent(item.repoUrl)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        e.preventDefault();
        return;
      }
      if (!list.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return list.length - 1;
        if (next >= list.length) return 0;
        return next;
      });
      return;
    }

    if (e.key === "Enter" && active >= 0) {
      // Enter opens the highlighted repository; with nothing highlighted it
      // falls through to the form and starts a new analysis.
      e.preventDefault();
      openReport(list[active]);
      return;
    }

    if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={wrapRef} className="w-full max-w-2xl">
      <form onSubmit={submit} className="group relative">
        <div
          className={cn(
            "flex flex-col gap-2 rounded-[22px] border bg-surface/90 p-2 shadow-md backdrop-blur-md transition-shadow sm:flex-row sm:items-center sm:rounded-pill sm:pl-5",
            showError
              ? "border-crit/40 shadow-[0_0_0_4px_rgba(229,72,77,0.08)]"
              : "border-hair-strong focus-within:border-brand-400 focus-within:shadow-[0_0_0_4px_rgba(20,184,166,0.12)]"
          )}
        >
          <label htmlFor="repo-url" className="sr-only">
            Public GitHub repository URL
          </label>
          <GitHubMark className="ml-3 hidden h-[18px] w-[18px] shrink-0 text-ink-3 sm:block" />
          <input
            id="repo-url"
            name="repositoryUrl"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            role="combobox"
            aria-expanded={open}
            aria-controls="repo-history-list"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `repo-history-${active}` : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTouched(true)}
            onKeyDown={onKeyDown}
            placeholder="Paste a public GitHub repository URL"
            aria-invalid={showError}
            aria-describedby={showError ? "repo-url-error" : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink-4 sm:h-12 sm:px-3"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="repo-history-list"
            title="Previously analysed repositories"
            className={cn(
              "hidden h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium transition-colors sm:inline-flex",
              open
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-hair-strong bg-surface text-ink-2 hover:text-ink"
            )}
          >
            <History className="h-3.5 w-3.5" />
            History
            {items && items.length > 0 && (
              <span className="rounded-pill bg-ink/8 px-1.5 text-[10.5px] tabular-nums">
                {items.length}
              </span>
            )}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses(
              "primary",
              "md",
              "h-11 w-full shrink-0 sm:h-12 sm:w-auto sm:px-6"
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin-slow" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {submitting ? "Starting…" : "Analyze Repository"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>

        {/* ---------------- history picker ---------------- */}
        {open && (
          <div className="absolute inset-x-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl border border-hair-strong bg-surface text-left shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-hair px-3.5 py-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                <History className="h-3.5 w-3.5" />
                {historyQuery ? "Matching your history" : "Previously analysed"}
              </span>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
              ) : (
                <span className="text-[11px] text-ink-4">
                  {list.length} {list.length === 1 ? "repository" : "repositories"}
                </span>
              )}
            </div>

            {list.length > 0 ? (
              <ul
                role="listbox"
                id="repo-history-list"
                aria-label="Previously analysed repositories"
                className="max-h-[320px] overflow-y-auto p-1.5"
              >
                {list.map((item, i) => (
                  <li key={item.id}>
                    <div
                      role="option"
                      id={`repo-history-${i}`}
                      aria-selected={i === active}
                      onClick={() => openReport(item)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                        i === active ? "bg-brand-50" : "hover:bg-surface-2"
                      )}
                    >
                      <GitHubMark className="h-4 w-4 shrink-0 text-ink-3" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">
                          {item.repoFullName}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-3">
                          <span>{relativeTime(item.lastAnalyzedAt)}</span>
                          {item.runCount > 1 && (
                            <>
                              <span className="h-1 w-1 rounded-full bg-ink-4" />
                              <span>{item.runCount} runs</span>
                            </>
                          )}
                          <span className="h-1 w-1 rounded-full bg-ink-4" />
                          <span>{formatCount(item.fileCount)} files</span>
                          {item.criticalCount > 0 && (
                            <>
                              <span className="h-1 w-1 rounded-full bg-ink-4" />
                              <span className="font-medium text-crit">
                                {item.criticalCount} critical
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {item.healthScore !== null && <ScoreChip score={item.healthScore} />}

                      <button
                        type="button"
                        onClick={(e) => reanalyze(item, e)}
                        title={`Run a fresh analysis of ${item.repoFullName}`}
                        className={cn(
                          "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-hair-strong bg-surface px-2 text-[11px] font-medium",
                          "text-ink-4 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700",
                          "focus-visible:border-brand-300 focus-visible:text-brand-700"
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Re-run
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3.5 py-6 text-center">
                {loading ? (
                  <span className="text-[13px] text-ink-3">Searching your history…</span>
                ) : failed ? (
                  <span className="text-[13px] text-ink-3">
                    Your history could not be loaded. You can still paste a URL.
                  </span>
                ) : historyQuery ? (
                  <span className="text-[13px] text-ink-3">
                    No repository in your history matches “{historyQuery}”.
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-3">
                    Nothing here yet. The first repository you analyse will be saved
                    and appear here next time.
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-hair px-3.5 py-2 text-[10.5px] text-ink-4">
              <span>↑↓ to move · Enter to open · Esc to dismiss</span>
              <span className="hidden sm:inline">opens the saved report instantly</span>
            </div>
          </div>
        )}
      </form>

      <div className="mt-3 min-h-[22px] px-1">
        {showError ? (
          <p id="repo-url-error" className="text-[13px] font-medium text-crit">
            Please enter a valid public GitHub repository URL, e.g.
            https://github.com/owner/repo
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
              No signup required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-ink-4" />
              Public repositories only
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-ink-4" />
              Source is never stored
            </span>
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-ink-3">Try:</span>
        {EXAMPLE_REPOS.map((r) => (
          <button
            key={r.url}
            type="button"
            onClick={() => {
              setUrl(r.url);
              setTouched(true);
              // Choosing an example means "run this", not "browse my history" —
              // so the picker closes rather than popping open over the chips.
              setOpen(false);
            }}
            className="cursor-pointer rounded-pill border border-hair-strong bg-surface px-3 py-1.5 font-mono text-[12px] text-ink-2 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
