"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock, FileCode2, History, Loader2, RotateCw } from "lucide-react";
import { cn, formatCount, relativeTime } from "@/lib/utils";
import { gradeFor } from "@/lib/scoring";

/**
 * One repository, not one run.
 *
 * The endpoint groups by repository and returns the latest run for each. Listing
 * runs instead would show the same repository seven times over once it has been
 * re-analysed a few times, which is exactly what a history view must not do.
 */
interface HistoryEntry {
  id: string;
  repoFullName: string;
  repoUrl: string;
  healthScore: number | null;
  findingCount: number;
  criticalCount: number;
  highCount: number;
  fileCount: number;
  lastAnalyzedAt: string;
  runCount: number;
}

function ScorePill({ score }: { score: number }) {
  const grade = gradeFor(score);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-display text-[13px] font-bold tabular-nums"
      style={{
        borderColor: `${grade.hex}33`,
        background: `${grade.hex}12`,
        color: grade.hex,
      }}
      title={`Grade ${grade.letter} · ${grade.label}`}
    >
      {score}
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {grade.letter}
      </span>
    </span>
  );
}

export function RecentAnalyses() {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/history?limit=9", { cache: "no-store" });
        const data = (await res.json()) as { items?: HistoryEntry[] };
        if (alive) setItems(data.items ?? []);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Nothing stored yet — stay out of the way entirely.
  if (items !== null && items.length === 0) return null;

  return (
    <section id="history" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            History
          </div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">
            Repositories you&rsquo;ve analysed
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
            Every report is saved and shareable by link. Reopen one from here, or pick
            a repository straight from the search field above — no re-scan, no waiting.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-3">
          <History className="h-3.5 w-3.5" />
          saved automatically
        </span>
      </div>

      {items === null ? (
        <div className="grid place-items-center rounded-xl border border-hair bg-surface py-12">
          <Loader2 className="h-5 w-5 animate-spin-slow text-brand-500" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/report/${item.id}`}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-hair bg-surface p-4 shadow-xs",
                "transition-all duration-300 hover:-translate-y-0.5 hover:border-hair-strong hover:shadow-md"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-[14px] font-bold tracking-tight text-ink">
                    {item.repoFullName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                    <span className="inline-flex items-center gap-1">
                      <FileCode2 className="h-3 w-3" />
                      {formatCount(item.fileCount)} files
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {relativeTime(item.lastAnalyzedAt)}
                    </span>
                    {item.runCount > 1 && (
                      <span className="inline-flex items-center gap-1">
                        <RotateCw className="h-3 w-3" />
                        {item.runCount} runs
                      </span>
                    )}
                  </div>
                </div>
                {item.healthScore !== null && <ScorePill score={item.healthScore} />}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-hair pt-3">
                {item.criticalCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-crit-soft px-2 py-[3px] text-[10.5px] font-semibold text-crit">
                    {item.criticalCount} critical
                  </span>
                )}
                {item.highCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-high-soft px-2 py-[3px] text-[10.5px] font-semibold text-high">
                    {item.highCount} high
                  </span>
                )}
                <span className="text-[11.5px] text-ink-3">
                  {item.findingCount} finding{item.findingCount === 1 ? "" : "s"}
                </span>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-ink-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-500" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
