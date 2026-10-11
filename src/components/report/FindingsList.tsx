"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { Category, Finding, Severity } from "@/lib/types";
import { CATEGORIES, SEVERITIES, SEVERITY_ORDER } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Card, CardHeader, Chip, SeverityBadge } from "@/components/ui/primitives";

const CATEGORY_KEYS: Category[] = [
  "security",
  "quality",
  "performance",
  "testing",
  "dependency",
  "architecture",
  "documentation",
];

const SOURCE_LABEL: Record<Finding["source"], string> = {
  "static-analysis": "Static analysis",
  "dependency-scanner": "Dependency scanner",
  ai: "AI",
};

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-pill bg-hair">
        <div
          className="h-full rounded-pill bg-brand-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-ink-3">{pct}%</span>
    </div>
  );
}

function FindingRow({
  finding,
  index,
  open,
  onToggle,
}: {
  finding: Finding;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = SEVERITIES[finding.severity];
  return (
    <div
      className={cn(
        "group border-b border-hair last:border-b-0 transition-colors",
        open && "bg-surface-2/50"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left sm:px-6"
      >
        <span
          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: meta.hex }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-ink-4">
              #{String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-[14px] font-semibold text-ink">
              {finding.title}
            </span>
            <SeverityBadge severity={finding.severity} size="sm" showIcon={false} />
            {finding.isPotential && (
              <span className="rounded-pill border border-hair bg-surface px-2 py-[2px] text-[10.5px] font-medium text-ink-3">
                potential
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
            <span className="rounded-pill bg-surface-2 px-2 py-0.5 font-medium text-ink-2">
              {CATEGORIES[finding.category].label}
            </span>
            {finding.filePath && (
              <span className="truncate font-mono">
                {finding.filePath}
                {finding.lineStart ? `:${finding.lineStart}` : ""}
              </span>
            )}
            <span className="hidden sm:inline">· {SOURCE_LABEL[finding.source]}</span>
          </div>
        </div>

        <ChevronDown
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-ink-3 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 sm:px-6 sm:pl-[3.1rem]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Problem
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
                {finding.description}
              </p>
            </div>

            {finding.evidence && (
              <div className="sm:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Evidence
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hair bg-[#0a0f1c] px-3.5 py-3 font-mono text-[12px] leading-relaxed text-[#d7e0ea]">
                  {finding.evidence}
                </pre>
              </div>
            )}

            {finding.impact && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Impact
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  {finding.impact}
                </p>
              </div>
            )}

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Confidence
              </div>
              <div className="mt-1.5">
                <ConfidenceMeter value={finding.confidence} />
              </div>
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                <Wrench className="h-3 w-3" />
                Recommendation
              </div>
              <p className="mt-1 rounded-lg border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
                {finding.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FindingsList({
  findings,
  hideCategoryFilter = false,
}: {
  findings: Finding[];
  /** Set when the list is already scoped to one category (e.g. the Bugs view). */
  hideCategoryFilter?: boolean;
}) {
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [categories, setCategories] = useState<Set<Category>>(new Set());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const bySev: Record<string, number> = {};
    const byCat: Record<string, number> = {};
    for (const f of findings) {
      bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
      byCat[f.category] = (byCat[f.category] ?? 0) + 1;
    }
    return { bySev, byCat };
  }, [findings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings
      .filter((f) => (severities.size ? severities.has(f.severity) : true))
      .filter((f) => (categories.size ? categories.has(f.category) : true))
      .filter((f) => {
        if (!q) return true;
        return (
          f.title.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          (f.filePath ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const s = SEVERITIES[a.severity].order - SEVERITIES[b.severity].order;
        if (s !== 0) return s;
        return b.confidence - a.confidence;
      });
  }, [findings, severities, categories, query]);

  const hasFilters = severities.size > 0 || categories.size > 0 || query.length > 0;

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  function clearAll() {
    setSeverities(new Set());
    setCategories(new Set());
    setQuery("");
  }

  return (
    <Card>
      <CardHeader
        title="Findings"
        subtitle={`${findings.length} issue${findings.length === 1 ? "" : "s"} across ${
          new Set(findings.map((f) => f.category)).size
        } categories · filter by severity, category or file`}
        icon={<ShieldCheck className="h-4 w-4" />}
        action={
          hasFilters ? (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-hair bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          ) : null
        }
      />

      {/* Filters */}
      <div className="space-y-3 border-b border-hair px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
            Severity
          </span>
          {SEVERITY_ORDER.map((s) => (
            <Chip
              key={s}
              active={severities.has(s)}
              onClick={() => toggle(severities, s, setSeverities)}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: SEVERITIES[s].hex }}
              />
              {SEVERITIES[s].label}
              <span className="text-ink-3">{counts.bySev[s] ?? 0}</span>
            </Chip>
          ))}
        </div>

        {!hideCategoryFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
            Category
          </span>
          {CATEGORY_KEYS.map((c) => (
            <Chip
              key={c}
              active={categories.has(c)}
              onClick={() => toggle(categories, c, setCategories)}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CATEGORIES[c].hex }}
              />
              {CATEGORIES[c].short}
              <span className="text-ink-3">{counts.byCat[c] ?? 0}</span>
            </Chip>
          ))}
        </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search findings by title, description or file path…"
            className="h-10 w-full rounded-lg border border-hair-strong bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.12)]"
          />
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
            {findings.length === 0 ? (
              <ShieldCheck className="h-5 w-5 text-good" />
            ) : (
              <Search className="h-5 w-5" />
            )}
          </span>
          <p className="mt-3 text-[14px] font-semibold text-ink">
            {findings.length === 0
              ? "No issues detected"
              : "No findings match these filters"}
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            {findings.length === 0
              ? "The static analyzers did not flag anything in the analysed files."
              : "Try widening the filters or clearing the search."}
          </p>
        </div>
      ) : (
        <div>
          {filtered.map((f, i) => (
            <FindingRow
              key={f.id}
              finding={f}
              index={i}
              open={open.has(f.id)}
              onToggle={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.id)) next.delete(f.id);
                  else next.add(f.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex items-center justify-between border-t border-hair px-5 py-3 text-[12px] text-ink-3 sm:px-6">
          <span>
            Showing {filtered.length} of {findings.length}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            Heuristic findings are labelled “potential”
          </span>
        </div>
      )}
    </Card>
  );
}
