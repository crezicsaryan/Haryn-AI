"use client";

import { GitHubMark } from "@/components/ui/GitHubMark";
import { Logo } from "@/components/ui/Logo";
import { formatElapsed, shortenRepoUrl } from "@/lib/analyze-progress";

/** Title block for the running analysis: wordmark, repo identity, elapsed time. */
export function AnalysisHeader({
  url,
  elapsed,
  failed,
}: {
  url: string;
  elapsed: number;
  failed: boolean;
}) {
  return (
    <header className="mb-8 text-center">
      <div className="mb-4 flex justify-center">
        <Logo href={null} />
      </div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-[30px]">
        {failed ? "Analysis stopped" : "Analyzing repository"}
      </h1>
      <p className="mt-2 inline-flex max-w-full items-center gap-2 text-[13.5px] text-ink-2">
        <GitHubMark className="h-3.5 w-3.5 shrink-0 text-ink-3" />
        <span className="truncate font-mono">{shortenRepoUrl(url)}</span>
      </p>
      {!failed && (
        <p className="mt-1 font-mono text-[12px] text-ink-3">
          {formatElapsed(elapsed)} elapsed
        </p>
      )}
    </header>
  );
}
