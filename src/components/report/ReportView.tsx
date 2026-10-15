"use client";

import { useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  ArrowLeft,
  Bug,
  Boxes,
  Clock,
  FileCode2,
  FolderTree,
  Gauge,
  GitCommitHorizontal,
  GitFork,
  Info,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Network,
  Package,
  Scale,
  ShieldAlert,
  Sparkles,
  Star,
  TestTube2,
  Waypoints,
  CircleDot,
} from "lucide-react";
import type { Report } from "@/lib/types";
import { CATEGORIES, SEVERITIES, SEVERITY_ORDER } from "@/lib/constants";
import { cn, formatBytes, formatCount, formatDuration, relativeTime } from "@/lib/utils";
import { gradeFor, severityCounts } from "@/lib/scoring";
import { Card, CardHeader, SeverityBadge, Stat } from "@/components/ui/primitives";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { FindingsList } from "./FindingsList";
import { ArchitectureGraph } from "./ArchitectureGraph";
import { ActivityPanel } from "./ActivityPanel";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import {
  AiSummaryCard,
  ChatAgent,
  DependencyDetail,
  TestingDetail,
} from "./ChatPanel";
import { ReportToolbar } from "./ReportToolbar";

/* ------------------------------------------------------------------ */
/* Language donut                                                      */
/* ------------------------------------------------------------------ */

function LanguageDonut({ report }: { report: Report }) {
  const data = report.languages.slice(0, 7).map((l) => ({
    name: l.name,
    value: Number(l.percent.toFixed(2)),
    color: l.color,
  }));

  if (!data.length) {
    return (
      <p className="py-8 text-center text-[13px] text-ink-3">
        Language data unavailable.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--color-hair)",
                fontSize: 12,
                boxShadow: "var(--shadow-md)",
              }}
              formatter={((v: unknown, n: unknown) => [
                `${v}%`,
                String(n),
              ]) as never}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-display text-lg font-extrabold text-ink">
              {data[0]?.value.toFixed(0)}%
            </div>
            <div className="text-[10.5px] text-ink-3">{data[0]?.name}</div>
          </div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {report.languages.slice(0, 7).map((l) => (
          <li key={l.name} className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: l.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {l.name}
            </span>
            <span className="font-mono text-[12px] tabular-nums text-ink-3">
              {l.percent.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category scores                                                     */
/* ------------------------------------------------------------------ */

function CategoryCards({ report }: { report: Report }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {report.scores.map((s) => {
        const meta = CATEGORIES[s.category];
        return (
          <div
            key={s.category}
            className="rounded-xl border border-hair bg-surface p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">
                  {s.label}
                </div>
                <div className="mt-0.5 text-[11.5px] text-ink-3">
                  {s.issueCount} finding{s.issueCount === 1 ? "" : "s"}
                </div>
              </div>
              <div
                className="font-display text-2xl font-extrabold tabular-nums leading-none"
                style={{ color: meta.hex }}
              >
                {s.score}
              </div>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-hair">
              <div
                className="h-full rounded-pill transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ width: `${s.score}%`, background: meta.hex }}
              />
            </div>
            <div className="mt-2 text-[11px] text-ink-4">
              weight {Math.round(s.weight * 100)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Severity strip                                                      */
/* ------------------------------------------------------------------ */

function SeverityStrip({ report }: { report: Report }) {
  const counts = severityCounts(report.findings);
  const total = report.findings.length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {SEVERITY_ORDER.map((sev) => {
        const meta = SEVERITIES[sev];
        const n = counts[sev];
        return (
          <div
            key={sev}
            className={cn(
              "rounded-lg border border-hair p-3.5",
              n > 0 ? meta.soft : "bg-surface-2/60"
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: n > 0 ? meta.hex : "var(--color-ink-4)" }}
              />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                {meta.label}
              </span>
            </div>
            <div
              className="mt-1.5 font-display text-2xl font-extrabold tabular-nums"
              style={{ color: n > 0 ? meta.hex : "var(--color-ink-4)" }}
            >
              {n}
            </div>
          </div>
        );
      })}
      <div className="rounded-lg border border-dashed border-hair-strong bg-surface-2/40 p-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Total
        </div>
        <div className="mt-1.5 font-display text-2xl font-extrabold tabular-nums text-ink">
          {total}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

function Recommendations({ report }: { report: Report }) {
  if (!report.recommendations.length) {
    return (
      <Card>
        <CardHeader title="Recommended actions" />
        <div className="px-5 py-8 text-center sm:px-6">
          <p className="text-[13.5px] text-ink-2">
            No high or critical issues were detected. Keep test coverage rising and
            dependencies current.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Recommended actions"
        subtitle="An ordered plan instead of a wall of findings — fix top-down."
      />
      <ol className="divide-y divide-hair">
        {report.recommendations.map((r) => (
          <li key={r.rank} className="flex items-start gap-4 px-5 py-4 sm:px-6">
            <span
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-[13px] font-bold text-white"
              style={{ background: SEVERITIES[r.severity].hex }}
            >
              {r.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-ink">{r.title}</span>
                <SeverityBadge severity={r.severity} size="sm" showIcon={false} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                <span>{CATEGORIES[r.category].label}</span>
                {r.filePath && (
                  <span className="font-mono truncate">{r.filePath}</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export function ReportView({ report }: { report: Report }) {
  const grade = useMemo(() => gradeFor(report.healthScore), [report.healthScore]);
  const repo = report.repo;

  const bugs = useMemo(
    () => report.findings.filter((f) => f.category === "bugs"),
    [report.findings]
  );

  const [view, setView] = useState<string>("overview");
  const [mobilePane, setMobilePane] = useState<"views" | "agent">("views");

  /** The views ("slides") available in the left rail. */
  const sections: {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "scores", label: "Scores", icon: Gauge },
    { id: "bugs", label: "Bugs", icon: Bug, badge: bugs.length },
    {
      id: "findings",
      label: "Findings",
      icon: ShieldAlert,
      badge: report.findings.length,
    },
    { id: "activity", label: "Activity", icon: GitCommitHorizontal },
    { id: "architecture", label: "Architecture", icon: Network },
    {
      id: "graph",
      label: "Knowledge graph",
      icon: Waypoints,
      badge: report.graph?.nodeCount,
    },
    { id: "dependencies", label: "Dependencies", icon: Package },
    { id: "testing", label: "Testing", icon: TestTube2 },
    { id: "summary", label: "AI summary", icon: Sparkles },
    {
      id: "actions",
      label: "Actions",
      icon: ListChecks,
      badge: report.recommendations.length,
    },
  ];

  const shown = (id: string) => (view === id ? "" : "hidden");

  return (
    <div className="min-h-screen">
      {/* The view rail below is the only navigation surface — the toolbar no
          longer repeats the section list. */}
      <ReportToolbar report={report} />

      <main className="mx-auto max-w-[1560px] px-4 pb-20 pt-6 sm:px-6">
        {/* Mobile: pick the report or the agent (the agent pane is xl+ only). */}
        <div className="mb-4 flex gap-1.5 rounded-pill border border-hair bg-surface-2 p-1 xl:hidden">
          {(
            [
              { id: "views" as const, label: "Report", icon: LayoutDashboard },
              { id: "agent" as const, label: "AI agent", icon: MessageSquare },
            ]
          ).map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setMobilePane(p.id)}
                aria-pressed={mobilePane === p.id}
                className={cn(
                  "inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-pill px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  mobilePane === p.id
                    ? "bg-ink text-white"
                    : "text-ink-2 hover:text-ink"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-[196px_minmax(0,1fr)] xl:grid-cols-[196px_minmax(0,1fr)_400px]">
          {/* ===================== VIEW RAIL ===================== */}
          <nav
            aria-label="Report views"
            className={cn(
              "lg:sticky lg:top-24 lg:self-start",
              mobilePane === "agent" && "hidden lg:block"
            )}
          >
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {sections.map((s) => {
                const Icon = s.icon;
                const on = view === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setView(s.id)}
                    aria-current={on}
                    className={cn(
                      "group flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[12.5px] font-medium transition-all",
                      on
                        ? "border-brand-200 bg-brand-50 text-brand-700"
                        : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        on ? "text-brand-600" : "text-ink-3"
                      )}
                    />
                    <span className="whitespace-nowrap lg:whitespace-normal">
                      {s.label}
                    </span>
                    {typeof s.badge === "number" && s.badge > 0 && (
                      <span
                        className={cn(
                          "ml-auto hidden rounded-pill px-1.5 py-[1px] text-[10px] font-semibold tabular-nums lg:inline-block",
                          on ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-ink-3"
                        )}
                      >
                        {s.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-4 hidden text-[11.5px] leading-relaxed text-ink-4 lg:block">
              Pick a view. The AI agent stays open beside it — ask about whatever
              you are looking at.
            </p>
          </nav>

          {/* ===================== CONTENT ===================== */}
          <div className={cn("min-w-0", mobilePane === "agent" && "hidden lg:block")}>
            {/* Persistent context strip — the score is never more than a glance away. */}
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-hair bg-surface px-4 py-3">
              <span className="truncate font-display text-[15px] font-bold tracking-tight text-ink">
                {repo.fullName}
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-display text-[12.5px] font-bold tabular-nums"
                style={{
                  borderColor: `${grade.hex}33`,
                  background: `${grade.hex}12`,
                  color: grade.hex,
                }}
              >
                {report.healthScore}
                <span className="text-[10px] uppercase opacity-70">{grade.letter}</span>
              </span>
              <span className="text-[12px] text-ink-3">
                {formatCount(report.structure.fileCount)} files ·{" "}
                {formatCount(report.structure.dirCount)} dirs
              </span>
              <span className="ml-auto hidden text-[11.5px] text-ink-4 sm:inline">
                {report.findings.length} findings
              </span>
            </div>

        {/* ======================= HEADER ======================= */}
        <section id="overview" className={cn("scroll-mt-24", shown("overview"))}>
          <div className="mb-4 flex items-center gap-2 text-[13px] text-ink-3">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Report</span>
            <span className="text-ink-4">/</span>
            <span className="font-mono text-ink-2">{report.id}</span>
          </div>

          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[1fr_auto]">
              {/* Repo identity */}
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2">
                    <CircleDot className="h-3 w-3 text-brand-500" />
                    {report.structure.sizeClass} codebase
                  </span>
                  {repo.license && (
                    <span className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2">
                      <Scale className="h-3 w-3" />
                      {repo.license}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2">
                    <Clock className="h-3 w-3" />
                    {repo.pushedAt ? `pushed ${relativeTime(repo.pushedAt)}` : "last push unknown"}
                  </span>
                  {repo.metaPartial && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-3"
                      title="The GitHub REST API was unavailable (rate limit), so the repository was analysed directly from its archive. Star counts and dates could not be read."
                    >
                      <Info className="h-3 w-3" />
                      metadata limited
                    </span>
                  )}
                </div>

                <h1 className="mt-4 font-display text-[26px] font-extrabold tracking-tight text-ink sm:text-[32px]">
                  {repo.owner}
                  <span className="text-ink-3">/</span>
                  {repo.name}
                </h1>

                {repo.description && (
                  <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-2">
                    {repo.description}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
                  {!repo.metaPartial && (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <Star className="h-3.5 w-3.5 text-ink-3" />
                        {formatCount(repo.stars)} stars
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <GitFork className="h-3.5 w-3.5 text-ink-3" />
                        {formatCount(repo.forks)} forks
                      </span>
                    </>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <FileCode2 className="h-3.5 w-3.5 text-ink-3" />
                    {report.structure.fileCount.toLocaleString()} files
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <FolderTree className="h-3.5 w-3.5 text-ink-3" />
                    {report.structure.dirCount.toLocaleString()} directories
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5 text-ink-3" />
                    {report.dependencies.stat.total} dependencies
                  </span>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Analysis time"
                    value={formatDuration(report.durationMs)}
                    hint={`${report.stats.sourceFilesSampled} files scanned`}
                  />
                  <Stat
                    label="Scanned size"
                    value={formatBytes(report.stats.bytesAnalyzed)}
                    hint={
                      report.stats.indexedChunks
                        ? `${report.stats.indexedChunks.toLocaleString()} chunks indexed`
                        : `${report.stats.apiCalls} API calls`
                    }
                  />
                  <Stat
                    label="Findings"
                    value={report.findings.length}
                    hint={`${report.recommendations.length} recommended actions`}
                  />
                </div>
              </div>

              {/* Score */}
              <div className="flex flex-col items-center justify-center gap-4 border-t border-hair bg-surface-2/50 p-6 sm:p-8 lg:border-l lg:border-t-0">
                <ScoreRing score={report.healthScore} size={200} stroke={14} />
                <div
                  className="rounded-pill border px-3 py-1.5 text-[12px] font-semibold"
                  style={{
                    borderColor: `${grade.hex}33`,
                    background: `${grade.hex}12`,
                    color: grade.hex,
                  }}
                >
                  Grade {grade.letter} · {grade.label}
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* ======================= SEVERITY ======================= */}
        <section className="mt-6">
          <SeverityStrip report={report} />
        </section>

        {/* ======================= SCORES ======================= */}
        <section id="scores" className={cn("mt-10 scroll-mt-24", shown("scores"))}>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">
                Category scores
              </h2>
              <p className="mt-1 text-[13.5px] text-ink-2">
                Weighted to produce the overall health score — deterministic, not
                AI-decided.
              </p>
            </div>
          </div>
          <CategoryCards report={report} />

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Languages"
                subtitle="Share of the codebase by language"
                icon={<FileCode2 className="h-4 w-4" />}
              />
              <div className="p-5 sm:p-6">
                <LanguageDonut report={report} />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Structure"
                subtitle="Top-level layout detected in the repository"
                icon={<FolderTree className="h-4 w-4" />}
              />
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap gap-2">
                  {report.structure.topLevelDirs.slice(0, 16).map((d) => (
                    <span
                      key={d}
                      className="rounded-md border border-hair bg-surface-2 px-2.5 py-1 font-mono text-[12px] text-ink-2"
                    >
                      {d}/
                    </span>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Files" value={report.structure.fileCount.toLocaleString()} />
                  <Stat label="Dirs" value={report.structure.dirCount.toLocaleString()} />
                  <Stat
                    label="Size"
                    value={formatBytes(report.structure.totalBytes)}
                  />
                  <Stat label="Class" value={report.structure.sizeClass} />
                </div>
                {report.structure.truncated && (
                  <p className="mt-3 text-[12px] text-med">
                    GitHub truncated the file listing for this repository — counts are a
                    lower bound.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </section>

        {/* ======================= FINDINGS ======================= */}
        <section id="findings" className={cn("mt-10 scroll-mt-24", shown("findings"))}>
          <FindingsList findings={report.findings} />
        </section>

        {/* ======================= BUGS ======================= */}
        <section id="bugs" className={cn("mt-10 scroll-mt-24", shown("bugs"))}>
          {bugs.length ? (
            <FindingsList findings={bugs} hideCategoryFilter />
          ) : (
            <Card>
              <CardHeader
                title="Bugs"
                subtitle="Constructs that behave incorrectly at runtime"
                icon={<Bug className="h-4 w-4" />}
              />
              <div className="px-5 py-10 text-center text-[13.5px] text-ink-2 sm:px-6">
                <p>
                  The bug scan found nothing in the files that were analysed.
                </p>
                <p className="mx-auto mt-2 max-w-md text-[12.5px] text-ink-3">
                  That is not proof of correctness — it means none of the known
                  wrong patterns (missing <code className="font-mono">await</code>,
                  off-by-one bounds, empty catches, mutation during iteration,
                  mutable defaults) appeared.
                </p>
              </div>
            </Card>
          )}
        </section>

        {/* ======================= ACTIVITY ======================= */}
        <section id="activity" className={cn("mt-10 scroll-mt-24", shown("activity"))}>
          <ActivityPanel activity={report.activity} />
        </section>

        {/* ======================= ARCHITECTURE ======================= */}
        <section id="architecture" className={cn("mt-10 scroll-mt-24", shown("architecture"))}>
          <ArchitectureGraph architecture={report.architecture} />
        </section>

        {/* ======================= KNOWLEDGE GRAPH ======================= */}
        <section id="graph" className={cn("mt-10 scroll-mt-24", shown("graph"))}>
          <Card className="overflow-hidden">
            <CardHeader
              title="Codebase knowledge graph"
              subtitle="Files, functions, classes, routes, models and packages, and how they connect — parsed from the source, not generated"
              icon={<Waypoints className="h-4 w-4" />}
              action={
                report.graph ? (
                  <span className="hidden items-center gap-1.5 text-[11.5px] text-ink-3 sm:inline-flex">
                    {formatCount(report.graph.nodeCount)} nodes ·{" "}
                    {formatCount(report.graph.edgeCount)} relationships
                  </span>
                ) : null
              }
            />
            <div className="p-4 sm:p-5">
              {report.graph && report.graph.nodeCount > 0 ? (
                <KnowledgeGraphView analysisId={report.id} repoUrl={report.repo.url} />
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Waypoints className="h-6 w-6 text-ink-4" />
                  <p className="font-display text-[15px] font-bold text-ink">
                    No knowledge graph for this repository
                  </p>
                  <p className="max-w-lg text-[13px] leading-relaxed text-ink-2">
                    {report.graph?.error
                      ? `Graph generation failed: ${report.graph.error}`
                      : "The graph is built from JavaScript and TypeScript. This repository had no files the parser could read."}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* ======================= DEPENDENCIES ======================= */}
        <section id="dependencies" className={cn("mt-10 scroll-mt-24", shown("dependencies"))}>
          <DependencyDetail report={report} />
        </section>

        {/* ======================= TESTING ======================= */}
        <section id="testing" className={cn("mt-10 scroll-mt-24", shown("testing"))}>
          <TestingDetail report={report} />
        </section>

        {/* ======================= AI SUMMARY ======================= */}
        <section id="summary" className={cn("mt-10 scroll-mt-24", shown("summary"))}>
          <AiSummaryCard report={report} />
        </section>

        {/* ======================= ACTIONS ======================= */}
        <section id="actions" className={cn("mt-10 scroll-mt-24", shown("actions"))}>
          <Recommendations report={report} />
        </section>

        <div className="mt-12 rounded-xl border border-hair bg-surface-2/60 p-6 text-center">
          <p className="mx-auto max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
            Haryn AI combines deterministic static analysis with a narrative layer that
            only restates measured facts. Findings are advisory and heuristic signals are
            labelled “potential” — treat this report as a starting point, not a security
            audit.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-ink-4">
            <span>generated {relativeTime(report.completedAt)}</span>
            <span>·</span>
            <span>{formatDuration(report.durationMs)}</span>
            <span>·</span>
            <span>
              <AnimatedNumber value={report.findings.length} /> findings
            </span>
          </div>
        </div>
          </div>

          {/* ===================== AI AGENT ===================== */}
          <aside
            className={cn(
              "lg:col-span-2 xl:col-span-1 xl:sticky xl:top-24 xl:self-start",
              mobilePane === "views" && "hidden xl:block"
            )}
          >
            <ChatAgent report={report} />
          </aside>
        </div>
      </main>
    </div>
  );
}
