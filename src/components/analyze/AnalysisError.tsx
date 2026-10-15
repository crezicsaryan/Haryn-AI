"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import type { ErrorCode } from "@/lib/types";

/** Failure state for a run that could not complete, with recovery routes. */
export function AnalysisError({
  code,
  message,
  onRetry,
}: {
  code: ErrorCode;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-crit-soft text-crit">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h2 className="mt-4 font-display text-[17px] font-bold text-ink">
        We couldn&rsquo;t finish the analysis
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-2">
        {message}
      </p>
      <p className="mt-1 font-mono text-[11.5px] text-ink-3">code: {code}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onRetry} className={buttonClasses("primary", "md")}>
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
  );
}
