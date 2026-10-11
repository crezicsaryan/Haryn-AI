"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  Clock,
  FileText,
  GitCommitHorizontal,
  Info,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardHeader, Stat } from "@/components/ui/primitives";
import { cn, formatCount, relativeTime } from "@/lib/utils";
import type { RecentCommit, RepoActivity } from "@/lib/types";

/**
 * Commit activity, history and message analysis.
 *
 * Everything here comes from the GitHub activity API and is optional: when
 * GitHub cannot supply history (rate limit, or stats still being computed) the
 * panel says so rather than showing zeros that would read as "this project is
 * dead".
 */

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/** Colour per commit-message bucket — deliberately distinct in the light theme. */
const TYPE_META: Record<string, { label: string; hex: string }> = {
  feat: { label: "Features", hex: "#14b8a6" },
  fix: { label: "Fixes", hex: "#e5484d" },
  docs: { label: "Docs", hex: "#64748b" },
  refactor: { label: "Refactors", hex: "#8b5cf6" },
  perf: { label: "Performance", hex: "#06b6d4" },
  test: { label: "Tests", hex: "#f5a524" },
  chore: { label: "Chores", hex: "#7e868c" },
  build: { label: "Build", hex: "#0ea5e9" },
  ci: { label: "CI", hex: "#59616f" },
  style: { label: "Style", hex: "#c026d3" },
  revert: { label: "Reverts", hex: "#f76808" },
  merge: { label: "Merges", hex: "#a3a3a3" },
  deps: { label: "Dependency bumps", hex: "#22c55e" },
  other: { label: "Other", hex: "#cbd5e1" },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.other;
}

/**
 * Reports are immutable snapshots, so a report stored before these derived
 * fields existed will not have them. Normalise rather than crash — an old
 * report must keep rendering.
 */
function normalise(activity: RepoActivity): RepoActivity {
  return {
    ...activity,
    recentCommits: activity.recentCommits ?? [],
    months: activity.months ?? [],
    authorStats: activity.authorStats ?? [],
    messageTypes: activity.messageTypes ?? [],
    messageStats: activity.messageStats ?? {
      scanned: activity.recentCommits?.length ?? 0,
      withBody: 0,
      avgSubjectLength: 0,
      longestSubject: "",
    },
  };
}

/** Intensity buckets for the contribution grid. */
function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio > 0.66) return 4;
  if (ratio > 0.4) return 3;
  if (ratio > 0.18) return 2;
  return 1;
}

const LEVEL_CLASS = [
  "bg-surface-2",
  "bg-brand-500/20",
  "bg-brand-500/40",
  "bg-brand-500/65",
  "bg-brand-600",
];

/* ------------------------------------------------------------------ */
/* 1 — Commit frequency (per month)                                    */
/* ------------------------------------------------------------------ */

function FrequencyChart({ activity }: { activity: RepoActivity }) {
  const months = activity.months;
  if (!months.length) return null;

  const peak = Math.max(...months.map((m) => m.total));
  const busiest = months.find((m) => m.total === peak);
  const total = months.reduce((a, m) => a + m.total, 0);

  return (
    <section>
      <div className="mb-3">
        <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
          Commit frequency
        </h4>
        <p className="mt-1 text-[12.5px] text-ink-2">
          Based on the {formatCount(total)} most recent commits
          {busiest && peak > 0 ? ` · busiest was ${busiest.label} with ${peak}` : ""}
        </p>
      </div>

      <div className="rounded-lg border border-hair bg-surface-2/40 p-3">
        <div style={{ width: "100%", height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-hair)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-ink-3)" }}
                interval={0}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--color-ink-3)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--color-surface-2)" }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid var(--color-hair)",
                  fontSize: 12,
                  boxShadow: "0 6px 20px rgba(15,23,42,0.08)",
                }}
                formatter={(value) => {
                  const n = Number(value ?? 0);
                  return [`${n} commit${n === 1 ? "" : "s"}`, "Committed"];
                }}
              />
              <Bar dataKey="total" radius={[5, 5, 0, 0]} maxBarSize={38}>
                {months.map((m) => (
                  <Cell
                    key={m.month}
                    fill={m.total === peak && peak > 0 ? "#0d9488" : "#5eead4"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Contribution calendar                                           */
/* ------------------------------------------------------------------ */

function CommitGrid({ activity }: { activity: RepoActivity }) {
  const weeks = activity.weeklyCommits;
  if (!weeks.length) return null;

  const max = Math.max(1, ...weeks.map((w) => w.total));
  const total = weeks.reduce((a, w) => a + w.total, 0);

  const months: { index: number; label: string }[] = [];
  weeks.forEach((w, i) => {
    const m = new Date(w.week).getMonth();
    const prev = i > 0 ? new Date(weeks[i - 1].week).getMonth() : -1;
    if (m !== prev && i - (months.at(-1)?.index ?? -99) >= 3) {
      months.push({
        index: i,
        label: new Date(w.week).toLocaleString("en", { month: "short" }),
      });
    }
  });

  return (
    <section>
      <h4 className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
        Contribution calendar
      </h4>
      <div className="overflow-x-auto rounded-lg border border-hair bg-surface-2/40 p-4">
        <div className="inline-block min-w-full">
          <div className="relative mb-1.5 h-4">
            {months.map((m) => (
              <span
                key={`${m.label}-${m.index}`}
                className="absolute text-[10.5px] font-medium text-ink-3"
                style={{ left: `${(m.index / weeks.length) * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            <div className="mr-1 flex flex-col gap-[3px]">
              {DAY_LABELS.map((d, i) => (
                <span key={i} className="h-[11px] w-6 text-[9.5px] leading-[11px] text-ink-4">
                  {d}
                </span>
              ))}
            </div>

            {weeks.map((w) => (
              <div key={w.week} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }).map((_, d) => {
                  const count = w.days[d] ?? 0;
                  const when = new Date(new Date(w.week).getTime() + d * 86_400_000);
                  return (
                    <span
                      key={d}
                      title={`${count} commit${count === 1 ? "" : "s"} on ${when.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}`}
                      className={cn(
                        "h-[11px] w-[11px] rounded-[2.5px] transition-colors",
                        LEVEL_CLASS[level(count, max)]
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-3">
            <span>{formatCount(total)} commits in the last 52 weeks</span>
            <span className="inline-flex items-center gap-1.5">
              Less
              {LEVEL_CLASS.map((c, i) => (
                <span key={i} className={cn("h-[10px] w-[10px] rounded-[2px]", c)} />
              ))}
              More
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — Who committed                                                   */
/* ------------------------------------------------------------------ */

function AuthorBreakdown({ activity }: { activity: RepoActivity }) {
  const authors = activity.authorStats;
  if (!authors.length) return null;

  const max = Math.max(1, ...authors.map((a) => a.commits));
  const top = authors.slice(0, 10);
  const rest = authors.length - top.length;

  return (
    <section>
      <h4 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
        Who committed
      </h4>
      <p className="mb-3 text-[12.5px] text-ink-2">
        {authors.length} author{authors.length === 1 ? "" : "s"} across the last{" "}
        {formatCount(activity.messageStats.scanned)} commits
        {rest > 0 ? ` · showing the top ${top.length}` : ""}
      </p>

      <ul className="space-y-2.5">
        {top.map((a) => (
          <li key={a.login} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate font-mono text-[12px] text-ink-2 lg:w-32"
              title={a.login}
            >
              {a.login}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-brand-400),var(--color-brand-600))]"
                style={{ width: `${Math.max(3, (a.commits / max) * 100)}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-[11.5px] tabular-nums text-ink-3">
              {formatCount(a.commits)}
              <span className="ml-1 text-ink-4">({(a.share * 100).toFixed(0)}%)</span>
            </span>
            <span className="hidden w-28 shrink-0 text-right text-[11px] text-ink-4 xl:block">
              {a.lastCommitAt ? `last ${relativeTime(a.lastCommitAt)}` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — What the messages say                                           */
/* ------------------------------------------------------------------ */

function MessageOverview({ activity }: { activity: RepoActivity }) {
  const types = activity.messageTypes;
  const stats = activity.messageStats;
  if (!types.length) return null;

  const conventional = types.filter((t) => t.type !== "other" && t.type !== "merge");
  const conventionalShare = conventional.reduce((a, t) => a + t.share, 0);

  return (
    <section>
      <h4 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
        Commit message overview
      </h4>
      <p className="mb-3 text-[12.5px] text-ink-2">
        {conventionalShare >= 0.5
          ? `${(conventionalShare * 100).toFixed(0)}% of messages follow a recognised convention.`
          : "Messages are mostly free-form — no dominant convention."}
      </p>

      <div className="space-y-3">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          {types.map((t) => (
            <span
              key={t.type}
              title={`${typeMeta(t.type).label}: ${t.count} (${(t.share * 100).toFixed(0)}%)`}
              style={{ width: `${t.share * 100}%`, background: typeMeta(t.type).hex }}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {types.map((t) => (
            <span key={t.type} className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: typeMeta(t.type).hex }} />
              {typeMeta(t.type).label}
              <span className="tabular-nums text-ink-3">{t.count}</span>
              <span className="text-ink-4">({(t.share * 100).toFixed(0)}%)</span>
            </span>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Messages inspected"
            value={formatCount(stats.scanned)}
            hint={stats.withBody > 0 ? `${stats.withBody} with a body` : "subjects only"}
          />
          <Stat label="Avg subject length" value={`${stats.avgSubjectLength}`} hint="characters" />
          <Stat
            label="Distinct types"
            value={`${types.length}`}
            hint={types[0] ? `most common: ${typeMeta(types[0].type).label.toLowerCase()}` : undefined}
          />
        </div>

        {stats.longestSubject && (
          <p className="rounded-lg border border-hair bg-surface-2/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Longest subject: </span>
            <span className="italic">“{stats.longestSubject}”</span>
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Commit history                                                  */
/* ------------------------------------------------------------------ */

const PAGE = 15;

function CommitHistory({ activity }: { activity: RepoActivity }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [visible, setVisible] = useState(PAGE);

  const all = activity.recentCommits;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (type !== "all" && c.type !== type) return false;
      if (!q) return true;
      return (
        c.message.toLowerCase().includes(q) ||
        (c.body ?? "").toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.shortSha.includes(q)
      );
    });
  }, [all, query, type]);

  if (!all.length) return null;

  const shown = filtered.slice(0, visible);
  const types = activity.messageTypes;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
            Commit history
          </h4>
          <p className="mt-1 text-[12.5px] text-ink-2">
            {formatCount(all.length)} most recent commits
            {filtered.length !== all.length ? ` · ${filtered.length} matching` : ""}
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE);
            }}
            placeholder="Search messages, authors or SHA…"
            className="h-9 w-full rounded-lg border border-hair-strong bg-surface pl-9 pr-3 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.12)]"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            setType("all");
            setVisible(PAGE);
          }}
          aria-pressed={type === "all"}
          className={cn(
            "cursor-pointer rounded-pill border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            type === "all"
              ? "border-ink bg-ink text-white"
              : "border-hair-strong bg-surface text-ink-2 hover:text-ink"
          )}
        >
          All <span className="opacity-70">{all.length}</span>
        </button>
        {types.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => {
              setType(type === t.type ? "all" : t.type);
              setVisible(PAGE);
            }}
            aria-pressed={type === t.type}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              type === t.type
                ? "border-ink bg-ink text-white"
                : "border-hair-strong bg-surface text-ink-2 hover:text-ink"
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: typeMeta(t.type).hex }} />
            {typeMeta(t.type).label}
            <span className="opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-hair bg-surface-2/50 px-4 py-6 text-center text-[13px] text-ink-3">
          No commits match that filter.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-hair)] rounded-lg border border-hair bg-surface">
          {shown.map((c) => (
            <CommitRow key={c.sha} commit={c} />
          ))}
        </ul>
      )}

      {filtered.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE)}
          className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-hair bg-surface-2/60 py-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Show {Math.min(PAGE, filtered.length - visible)} more
        </button>
      )}
    </section>
  );
}

function CommitRow({ commit }: { commit: RecentCommit }) {
  const [open, setOpen] = useState(false);
  const meta = typeMeta(commit.type);
  const hasBody = Boolean(commit.body);

  return (
    <li>
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        aria-expanded={hasBody ? open : undefined}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
          hasBody ? "cursor-pointer hover:bg-surface-2/50" : "cursor-default"
        )}
      >
        <span
          className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: meta.hex }}
          title={meta.label}
        />

        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug text-ink">{commit.message}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
            <span className="font-mono text-ink-4">{commit.shortSha}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {commit.author}
            </span>
            {commit.date && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {relativeTime(commit.date)}
              </span>
            )}
            <span
              className="rounded-pill px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: `${meta.hex}1a`, color: meta.hex }}
            >
              {meta.label}
            </span>
            {hasBody && (
              <span className="inline-flex items-center gap-1 text-ink-4">
                <FileText className="h-3 w-3" />
                has description
              </span>
            )}
          </span>

          {open && commit.body && (
            <span className="mt-2 block whitespace-pre-line rounded-lg border border-hair bg-surface-2/60 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
              {commit.body}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function ActivityPanel({ activity: raw }: { activity?: RepoActivity }) {
  if (!raw) {
    return (
      <Card>
        <CardHeader
          title="Repository activity"
          subtitle="Commit history and contributors"
          icon={<GitCommitHorizontal className="h-4 w-4" />}
        />
        <div className="flex items-start gap-2.5 px-5 py-6 text-[13.5px] text-ink-2 sm:px-6">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <p>
            Commit history was not available for this repository. GitHub did not
            return it — most likely the REST API was rate-limited. The rest of the
            report is unaffected.
          </p>
        </div>
      </Card>
    );
  }

  const activity = normalise(raw);

  const momentumUp = activity.recentMonthly >= activity.priorMonthly;
  const hasMomentum = activity.priorMonthly > 0 || activity.recentMonthly > 0;
  const hasHistory = activity.weeklyCommits.length > 0;

  return (
    <Card>
      <CardHeader
        title="Repository activity"
        subtitle="Commit timeline, frequency, authors and messages"
        icon={<GitCommitHorizontal className="h-4 w-4" />}
        action={
          activity.partial ? (
            <span className="hidden rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-3 sm:inline-flex">
              history limited
            </span>
          ) : null
        }
      />

      <div className="space-y-7 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total commits"
            value={formatCount(activity.totalCommits)}
            hint={activity.lastCommitAt ? `last ${relativeTime(activity.lastCommitAt)}` : undefined}
          />
          <Stat
            label="Contributors"
            value={formatCount(activity.contributors.length)}
            hint={activity.contributors[0] ? `top: ${activity.contributors[0].login}` : undefined}
          />
          <Stat
            label="Last 4 weeks"
            value={formatCount(activity.recentMonthly)}
            hint={`previous 4 weeks: ${activity.priorMonthly}`}
          />
          <Stat
            label="Momentum"
            value={
              hasMomentum ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    momentumUp ? "text-good" : "text-high"
                  )}
                >
                  {momentumUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {momentumUp ? "Steady" : "Slowing"}
                </span>
              ) : (
                "—"
              )
            }
            hint={hasMomentum ? "commits vs prior 4 weeks" : "not enough history"}
          />
        </div>

        {activity.notice && (
          <p className="flex items-start gap-2 rounded-lg border border-hair bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
            {activity.notice}
          </p>
        )}

        <FrequencyChart activity={activity} />
        {hasHistory && <CommitGrid activity={activity} />}

        <div className="grid gap-7 lg:grid-cols-2">
          <AuthorBreakdown activity={activity} />
          <MessageOverview activity={activity} />
        </div>

        <CommitHistory activity={activity} />

        <p className="flex items-center gap-2 border-t border-hair pt-4 text-[11.5px] text-ink-4">
          <Clock className="h-3.5 w-3.5" />
          Commit data from the GitHub API — the 100 most recent commits, plus a
          total count from the pagination header. Unauthenticated requests are
          limited to 60/hour, so history may occasionally be unavailable.
        </p>
      </div>
    </Card>
  );
}
