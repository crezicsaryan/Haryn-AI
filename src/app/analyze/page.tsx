"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Aurora } from "@/components/ui/Aurora";
import { Logo } from "@/components/ui/Logo";
import { GitHubMark } from "@/components/ui/GitHubMark";
import { buttonClasses } from "@/components/ui/Button";
import { PIPELINE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { StreamEvent } from "@/lib/types";

interface StageRow {
  stage: string;
  label: string;
  status: "pending" | "active" | "done";
  pct: number;
}

const INITIAL: StageRow[] = PIPELINE.map((p) => ({
  ...p,
  status: "pending",
  pct: 0,
}));

function StageList({ rows, pct }: { rows: StageRow[]; pct: number }) {
  return (
    <div>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium">
          <span className="text-ink-2">Overall progress</span>
          <span className="font-mono text-ink-3">{Math.round(pct)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-pill bg-hair">
          <div
            className="h-full rounded-pill bg-[linear-gradient(90deg,var(--color-brand-500),var(--color-accent-500))] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${Math.max(3, pct)}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.stage}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
              r.status === "active" && "bg-brand-50/70",
              r.status === "done" && "opacity-100",
              r.status === "pending" && "opacity-55"
            )}
          >
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors",
                r.status === "done" &&
                  "border-brand-500 bg-brand-500 text-white",
                r.status === "active" &&
                  "border-brand-400 bg-surface text-brand-600",
                r.status === "pending" &&
                  "border-hair-strong bg-surface text-ink-4"
              )}
            >
              {r.status === "done" && <Check className="h-3.5 w-3.5" />}
              {r.status === "active" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin-slow" />
              )}
              {r.status === "pending" && (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                "text-[13.5px]",
                r.status === "active"
                  ? "font-semibold text-ink"
                  : r.status === "done"
                    ? "text-ink-2"
                    : "text-ink-3"
              )}
            >
              {r.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalyzeRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get("url") ?? "";

  const [rows, setRows] = useState<StageRow[]>(INITIAL);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef<number>(Date.now());
  const ranRef = useRef(false);

  /* Elapsed timer */
  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const applyEvent = useCallback(
    (evt: StreamEvent) => {
      if (evt.type === "progress") {
        setPct(evt.pct);
        setRows((prev) =>
          prev.map((r) => {
            if (r.stage === evt.stage) {
              return { ...r, status: evt.status, label: evt.label, pct: evt.pct };
            }
            // Anything before the current stage that is still pending → done.
            if (r.status === "active" && evt.status === "active") {
              return { ...r, status: "done" };
            }
            return r;
          })
        );
      } else if (evt.type === "result") {
        setPct(100);
        setRows((prev) => prev.map((r) => ({ ...r, status: "done" })));
        // Brief pause so the completed state is readable.
        window.setTimeout(() => {
          router.replace(`/report/${evt.report.id}`);
        }, 550);
      } else {
        setError({ code: evt.code, message: evt.message });
      }
    },
    [router]
  );

  useEffect(() => {
    if (!url || ranRef.current) return;
    ranRef.current = true;
    startedRef.current = Date.now();

    let alive = true;

    void (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryUrl: url }),
        });

        if (!res.body) throw new Error("The analysis stream could not be opened.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!alive) return;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              applyEvent(JSON.parse(trimmed) as StreamEvent);
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch (e) {
        if (!alive) return;
        setError({
          code: "ANALYSIS_FAILED",
          message:
            e instanceof Error
              ? e.message
              : "Analysis failed. Please try again.",
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [url, applyEvent]);

  /* No URL → bounce home. */
  if (!url) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-display text-xl font-bold text-ink">
          No repository specified
        </h1>
        <p className="mt-2 text-[14px] text-ink-2">
          Paste a public GitHub repository URL to start an analysis.
        </p>
        <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14 sm:py-20">
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <Logo href={null} />
        </div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-[30px]">
          {error ? "Analysis stopped" : "Analyzing repository"}
        </h1>
        <p className="mt-2 inline-flex max-w-full items-center gap-2 text-[13.5px] text-ink-2">
          <GitHubMark className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <span className="truncate font-mono">{url.replace(/^https?:\/\//, "")}</span>
        </p>
        {!error && (
          <p className="mt-1 font-mono text-[12px] text-ink-3">{elapsed}s elapsed</p>
        )}
      </div>

      <div className="rounded-xl border border-hair bg-surface p-5 shadow-md sm:p-7">
        {error ? (
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-crit-soft text-crit">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-[17px] font-bold text-ink">
              We couldn&rsquo;t finish the analysis
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-2">
              {error.message}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-ink-3">
              code: {error.code}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setRows(INITIAL);
                  setPct(0);
                  ranRef.current = false;
                  startedRef.current = Date.now();
                  // Force a re-run by toggling a no-op navigation.
                  router.refresh();
                  window.location.reload();
                }}
                className={buttonClasses("primary", "md")}
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
              <Link href="/" className={buttonClasses("secondary", "md")}>
                Back to home
              </Link>
              <Link href="/report/an_sample" className={buttonClasses("ghost", "md")}>
                View a sample report
              </Link>
            </div>
          </div>
        ) : (
          <StageList rows={rows} pct={pct} />
        )}
      </div>

      {!error && (
        <p className="mt-5 text-center text-[12.5px] text-ink-3">
          Files are fetched into memory for analysis only and are never stored.
        </p>
      )}
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <Aurora variant="subtle" />
      <div className="relative">
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center">
              <Loader2 className="h-6 w-6 animate-spin-slow text-brand-500" />
            </div>
          }
        >
          <AnalyzeRunner />
        </Suspense>
      </div>
    </main>
  );
}
