"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageRow } from "@/lib/analyze-progress";

/** Overall progress bar plus one row per pipeline stage. */
export function StageList({ rows, pct }: { rows: StageRow[]; pct: number }) {
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
          <StageItem key={r.stage} row={r} />
        ))}
      </ul>
    </div>
  );
}

function StageItem({ row }: { row: StageRow }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
        row.status === "active" && "bg-brand-50/70",
        row.status === "done" && "opacity-100",
        row.status === "pending" && "opacity-55"
      )}
    >
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors",
          row.status === "done" && "border-brand-500 bg-brand-500 text-white",
          row.status === "active" &&
            "border-brand-400 bg-surface text-brand-600",
          row.status === "pending" &&
            "border-hair-strong bg-surface text-ink-4"
        )}
      >
        {row.status === "done" && <Check className="h-3.5 w-3.5" />}
        {row.status === "active" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin-slow" />
        )}
        {row.status === "pending" && (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <span
        className={cn(
          "text-[13.5px]",
          row.status === "active"
            ? "font-semibold text-ink"
            : row.status === "done"
              ? "text-ink-2"
              : "text-ink-3"
        )}
      >
        {row.label}
      </span>
    </li>
  );
}
