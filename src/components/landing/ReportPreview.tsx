import { Lock, Gauge, Network, TestTube2, Boxes, FileText, Zap } from "lucide-react";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { SeverityBadge } from "@/components/ui/primitives";

/**
 * A static preview of the report dashboard, shown beneath the hero — the
 * equivalent of the reference screen's product mock-up. Values are illustrative.
 */
const BARS = [
  { label: "Security", score: 71, icon: Lock, hex: "#e5484d" },
  { label: "Code Quality", score: 82, icon: Gauge, hex: "#14b8a6" },
  { label: "Performance", score: 76, icon: Zap, hex: "#06b6d4" },
  { label: "Architecture", score: 84, icon: Network, hex: "#0ea5e9" },
  { label: "Testing", score: 58, icon: TestTube2, hex: "#f5a524" },
  { label: "Dependencies", score: 91, icon: Boxes, hex: "#8b5cf6" },
];

const ISSUES = [
  {
    severity: "high" as const,
    title: "Potential secret exposure",
    file: "config/database.js",
    line: 24,
  },
  {
    severity: "medium" as const,
    title: "Potential N+1 query",
    file: "src/services/orderService.js",
    line: 88,
  },
  {
    severity: "low" as const,
    title: "Duplicated validation logic",
    file: "src/utils/validate.ts",
    line: 12,
  },
];

export function ReportPreview() {
  return (
    <div className="relative mx-auto w-full max-w-4xl">
      {/* glow */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 -top-6 bottom-0 rounded-[36px] opacity-60 blur-3xl"
        style={{
          background:
            "linear-gradient(120deg, rgba(45,212,191,0.28), rgba(6,182,212,0.16), rgba(222,216,248,0.28))",
        }}
      />

      <div className="relative overflow-hidden rounded-[22px] border border-hair-strong bg-surface shadow-lg">
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-hair bg-surface-2/70 px-4 py-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex max-w-xs flex-1 items-center gap-2 rounded-pill border border-hair bg-surface px-3 py-1">
            <Lock className="h-3 w-3 text-brand-500" />
            <span className="truncate font-mono text-[11.5px] text-ink-3">
              haryn.ai/report/an_8f3a2c
            </span>
          </div>
          <div className="hidden w-10 sm:block" />
        </div>

        {/* Body */}
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,236px)_1fr]">
          {/* Score */}
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-hair bg-surface-2/50 p-5">
            <ScoreRing score={78} size={168} stroke={12} label="Health" />
            <div className="w-full space-y-1.5 text-center">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
                acme/ecommerce
              </div>
              <div className="text-[12px] text-ink-2">
                247 files · JavaScript
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
                Category scores
              </h3>
              <span className="rounded-pill border border-hair bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-3">
                6 dimensions
              </span>
            </div>

            <div className="grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
              {BARS.map((b) => (
                <div key={b.label}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                      <b.icon className="h-3.5 w-3.5" style={{ color: b.hex }} />
                      {b.label}
                    </span>
                    <span className="font-display text-[13px] font-bold tabular-nums text-ink">
                      {b.score}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-pill bg-hair">
                    <div
                      className="h-full rounded-pill"
                      style={{ width: `${b.score}%`, background: b.hex }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Issues */}
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
                  Top findings
                </h3>
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                  <FileText className="h-3.5 w-3.5" />
                  file &amp; line references
                </span>
              </div>
              {ISSUES.map((i) => (
                <div
                  key={i.title}
                  className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-surface px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <SeverityBadge severity={i.severity} size="sm" showIcon={false} />
                    <span className="truncate text-[13px] font-medium text-ink">
                      {i.title}
                    </span>
                  </div>
                  <span className="hidden shrink-0 font-mono text-[11.5px] text-ink-3 sm:block">
                    {i.file}:{i.line}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
