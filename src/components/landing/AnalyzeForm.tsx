"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { GitHubMark } from "@/components/ui/GitHubMark";
import { buttonClasses } from "@/components/ui/Button";
import { EXAMPLE_REPOS } from "@/lib/constants";
import { looksLikeGitHubUrl } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function AnalyzeForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const valid = looksLikeGitHubUrl(url);
  const showError = touched && url.length > 0 && !valid;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setTouched(true);
    if (!valid || submitting) return;
    setSubmitting(true);
    router.push(`/analyze?url=${encodeURIComponent(url.trim())}`);
  }

  return (
    <div className="w-full max-w-2xl">
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
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Paste a public GitHub repository URL"
            aria-invalid={showError}
            aria-describedby={showError ? "repo-url-error" : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none placeholder:text-ink-4 sm:h-12 sm:px-3"
          />
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
