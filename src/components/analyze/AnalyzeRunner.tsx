"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitHubMark } from "@/components/ui/GitHubMark";
import { Logo } from "@/components/ui/Logo";
import {
  applyProgress,
  errorFromUnknown,
  formatElapsed,
  initialStageRows,
  markAllDone,
  nextPercent,
  readAnalysisStream,
  shortenRepoUrl,
  streamError,
  type StageRow,
} from "@/lib/analyze-progress";
import type { ErrorCode, StreamEvent } from "@/lib/types";
import { StageList } from "./StageList";
import { AnalysisError } from "./AnalysisError";
import { NoRepository } from "./NoRepository";

/** Pause before routing, so the completed stage list is readable. */
const RESULT_PAUSE_MS = 550;

/**
 * Runs one analysis and streams its progress.
 *
 * The state transitions and the stream protocol live in `lib/analyze-progress`;
 * this component only owns React state, the fetch and the layout.
 */
export function AnalyzeRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get("url") ?? "";

  const [rows, setRows] = useState<StageRow[]>(initialStageRows);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<{ code: ErrorCode; message: string } | null>(
    null
  );
  const [elapsed, setElapsed] = useState(0);
  // Seeded with 0 rather than `Date.now()`: reading the clock during render is
  // impure (react-hooks/purity). The timer effect below stamps the real start.
  const startedRef = useRef<number>(0);
  const ranRef = useRef(false);

  useEffect(() => {
    startedRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const applyEvent = useCallback(
    (evt: StreamEvent) => {
      const failure = streamError(evt);
      if (failure) {
        setError(failure);
        return;
      }

      setPct((current) => nextPercent(current, evt));
      setRows((prev) =>
        evt.type === "result" ? markAllDone(prev) : applyProgress(prev, evt)
      );

      if (evt.type === "result") {
        window.setTimeout(
          () => router.replace(`/report/${evt.report.id}`),
          RESULT_PAUSE_MS
        );
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

        await readAnalysisStream(res.body, applyEvent, () => alive);
      } catch (e) {
        if (!alive) return;
        setError(errorFromUnknown(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, [url, applyEvent]);

  const retry = useCallback(() => {
    setError(null);
    setRows(initialStageRows());
    setPct(0);
    ranRef.current = false;
    startedRef.current = Date.now();
    router.refresh();
    window.location.reload();
  }, [router]);

  if (!url) return <NoRepository />;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-14 sm:py-20">
      <header className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <Logo href={null} />
        </div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-[30px]">
          {error ? "Analysis stopped" : "Analyzing repository"}
        </h1>
        <p className="mt-2 inline-flex max-w-full items-center gap-2 text-[13.5px] text-ink-2">
          <GitHubMark className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <span className="truncate font-mono">{shortenRepoUrl(url)}</span>
        </p>
        {!error && (
          <p className="mt-1 font-mono text-[12px] text-ink-3">
            {formatElapsed(elapsed)} elapsed
          </p>
        )}
      </header>

      <div className="rounded-xl border border-hair bg-surface p-5 shadow-md sm:p-7">
        {error ? (
          <AnalysisError code={error.code} message={error.message} onRetry={retry} />
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
