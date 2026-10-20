import type { Finding, Report, Severity } from "./types";
import { CATEGORIES } from "./constants";
import { fixFor, ruleIdOf, verifyFor } from "./ai/repair";

/**
 * Shaping for the printed report.
 *
 * The PDF is three pages, so the content has to be *chosen*, not dumped. This
 * module makes those choices in one place — which findings earn a page-2 entry,
 * what counts as a systemic fix, what can honestly be called verified — so the
 * document component stays presentational and the rules can be tested.
 *
 * The guiding constraint is honesty about provenance: a finding was *detected*
 * by a static rule, a fix is *suggested*, and nothing here was *applied*. Those
 * three words are not interchangeable, and the PDF says which is which.
 */

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export function severityCounts(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const f of findings) {
    if (f.severity === "critical") counts.critical += 1;
    else if (f.severity === "high") counts.high += 1;
    else if (f.severity === "medium") counts.medium += 1;
    else if (f.severity === "low") counts.low += 1;
    else continue; // `info` is not an actionable severity
    counts.total += 1;
  }
  return counts;
}

/** Production code before test fixtures, at equal severity. */
export function isTestPath(path: string | undefined): boolean {
  if (!path) return false;
  return (
    /(^|\/)(__tests__|tests?|specs?)\//i.test(path) ||
    /\.(test|spec)\.[a-z]+$/i.test(path) ||
    /(^|\/)(test_|_test\.)/i.test(path)
  );
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** The description without the analyzer's internal rule marker. */
export function proseOf(f: Finding): string {
  return f.description.replace(/\n*_Rule:[^_]*_\s*$/i, "").trim();
}

export interface PdfFinding {
  rank: number;
  title: string;
  severity: Severity;
  categoryLabel: string;
  filePath: string | null;
  lineStart: number | null;
  what: string;
  why: string | null;
  evidence: string | null;
  fix: string | null;
  confidence: number;
  /** True when the rule reports a pattern rather than a proven defect. */
  heuristic: boolean;
  rule: string | null;
  inTest: boolean;
  /** How many findings share this rule — 1 means it is a one-off. */
  occurrences: number;
  /** Distinct files those occurrences sit in. */
  files: number;
}

function toPdfFinding(f: Finding, rank: number, occurrences = 1, files = 1): PdfFinding {
  return {
    rank,
    title: f.title,
    severity: f.severity,
    categoryLabel: CATEGORIES[f.category]?.label ?? f.category,
    filePath: f.filePath ?? null,
    lineStart: f.lineStart ?? null,
    what: proseOf(f),
    why: f.impact?.trim() || null,
    evidence: f.evidence?.trim() || null,
    fix: fixFor(f),
    confidence: f.confidence,
    heuristic: Boolean(f.isPotential),
    rule: ruleIdOf(f),
    inTest: isTestPath(f.filePath),
    occurrences,
    files,
  };
}

/**
 * The findings that earn a place in the printed report.
 *
 * Ordered by severity, then by whether the code ships. A test fixture that
 * deliberately contains a bad pattern is the last thing a reader needs at the
 * top of a security report.
 */
export function rankedFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return Number(isTestPath(a.filePath)) - Number(isTestPath(b.filePath));
  });
}

/**
 * The findings to print, one entry per *kind* of problem.
 *
 * A raw severity sort put the same rule on the page three times ("complex
 * function" three times over) and pushed everything else out. Grouping by rule
 * keeps the page about distinct problems, and carries the prevalence — "×36
 * across 24 files" — which is the part a reader actually acts on.
 */
export function topFindings(report: Report, limit: number): PdfFinding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of rankedFindings(report.findings)) {
    if (f.severity === "info") continue;
    const key = ruleIdOf(f) ?? f.title;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  return [...groups.values()]
    .map((list) => ({
      list,
      files: new Set(list.map((f) => f.filePath).filter(Boolean)).size,
    }))
    // The representative is the highest-ranked member of the group.
    .sort((a, b) => {
      const sev =
        SEVERITY_RANK[a.list[0].severity] - SEVERITY_RANK[b.list[0].severity];
      if (sev !== 0) return sev;
      if (a.list.length !== b.list.length) return b.list.length - a.list.length;
      return Number(isTestPath(a.list[0].filePath)) - Number(isTestPath(b.list[0].filePath));
    })
    .slice(0, limit)
    .map(({ list, files }, i) => toPdfFinding(list[0], i + 1, list.length, files));
}

/* ------------------------------------------------------------------ */
/* Systemic fixes                                                      */
/* ------------------------------------------------------------------ */

export interface SystemicFix {
  rule: string;
  title: string;
  count: number;
  files: number;
  fix: string | null;
}

/**
 * Repeated defects, grouped.
 *
 * One rule firing across many files is one decision, not many tickets — that is
 * the single most useful thing a three-page report can tell a reader about what
 * to do next.
 */
export function systemicFixes(report: Report, limit: number): SystemicFix[] {
  const groups = new Map<string, Finding[]>();
  for (const f of report.findings) {
    if (f.severity === "info" || isTestPath(f.filePath)) continue;
    const key = ruleIdOf(f) ?? f.title;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([rule, list]) => ({
      rule,
      title: list[0].title,
      count: list.length,
      files: new Set(list.map((f) => f.filePath).filter(Boolean)).size,
      fix: fixFor(list[0]),
    }));
}

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export interface Verification {
  detected: number;
  /** Findings the rule labels as a pattern to check, not a proven defect. */
  heuristic: number;
  /** Confirmed against the source text rather than inferred. */
  confirmed: number;
  fixesApplied: number;
  fixesVerified: number;
}

/**
 * What this report can actually claim.
 *
 * `fixesApplied` and `fixesVerified` are zero by construction: the analysis
 * reads code, it does not change it. They are in the model so the document can
 * print them explicitly rather than implying verification it never performed.
 */
export function verificationOf(report: Report): Verification {
  const actionable = report.findings.filter((f) => f.severity !== "info");
  const heuristic = actionable.filter((f) => f.isPotential).length;
  return {
    detected: actionable.length,
    heuristic,
    confirmed: actionable.length - heuristic,
    fixesApplied: 0,
    fixesVerified: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Test evidence                                                       */
/* ------------------------------------------------------------------ */

export interface TestEvidence {
  testFiles: number;
  sourceFiles: number;
  ratio: number;
  frameworks: string[];
  hasTestDir: boolean;
  uncovered: string[];
}

/**
 * Test *evidence*, not test *results*.
 *
 * The analysis does not execute the repository's suite — it has no runtime and
 * would not trust one — so this reports what the file tree shows: how many test
 * files exist, which frameworks they use, and which critical areas have none.
 */
export function testEvidenceOf(report: Report): TestEvidence {
  return {
    testFiles: report.testing.testFiles,
    sourceFiles: report.testing.sourceFiles,
    ratio: report.testing.ratio,
    frameworks: report.testing.frameworks.slice(0, 4),
    hasTestDir: report.testing.hasTestDir,
    uncovered: report.testing.criticalUncovered.slice(0, 4),
  };
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function gradeOf(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

/** The one-line verdict, derived from the counts rather than written by hand. */
export function verdictOf(report: Report, counts: SeverityCounts): string {
  if (counts.critical > 0) {
    return `${counts.critical} critical finding${counts.critical === 1 ? "" : "s"} must be resolved before this code is exposed to untrusted input.`;
  }
  if (counts.high > 0) {
    return `No critical issues, but ${counts.high} high-severity finding${counts.high === 1 ? "" : "s"} should be fixed before the next release.`;
  }
  if (counts.medium > 0) {
    return `No critical or high findings. The ${counts.medium} medium findings are worth scheduling, not blocking on.`;
  }
  return "No actionable findings were detected by the rules that ran. That is a clean result, not a proof of correctness.";
}

/** The first sentences of the report narrative, for the page-1 summary. */
export function summaryExcerpt(report: Report, sentences = 2): string {
  const text = report.summary.replace(/\s+/g, " ").trim();
  // Each match keeps the leading space it was split on, so trim before joining
  // or the printed paragraph ends up with doubled spaces.
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.slice(0, 320);
  return parts
    .slice(0, sentences)
    .map((p) => p.trim())
    .join(" ")
    .trim();
}
