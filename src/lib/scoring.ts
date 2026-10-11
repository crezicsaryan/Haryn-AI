import type { Category, CategoryScore, Finding, Severity } from "./types";
import { CATEGORIES, SCORE_WEIGHTS, SEVERITY_PENALTY, SEVERITY_ORDER } from "./constants";
import { clamp } from "./utils";

/**
 * Deterministic category score.
 *
 * Starts at 100 and subtracts a penalty per finding, where:
 *  - the penalty is scaled by the finding's confidence (so speculative
 *    heuristics move the score less than proven issues),
 *  - repeated findings of the same severity have diminishing impact, so a
 *    hundred trivial nits cannot outrank one critical vulnerability, and
 *  - the total is normalised by codebase size (see `densityDivisor`).
 */
export function penaltyScore(findings: Finding[], divisor = 1): number {
  if (!findings.length) return 100;

  const bySeverity = new Map<Severity, number[]>();
  for (const f of findings) {
    const list = bySeverity.get(f.severity) ?? [];
    list.push(f.confidence);
    bySeverity.set(f.severity, list);
  }

  let penalty = 0;
  for (const sev of SEVERITY_ORDER) {
    const confidences = bySeverity.get(sev);
    if (!confidences) continue;
    confidences.sort((a, b) => b - a);

    // Severity reflects intrinsic impact; volume reflects codebase size. A
    // critical vulnerability is critical whether the repo has 50 files or
    // 5,000, so it is never normalised. `high` is normalised at half strength,
    // and the volume-driven severities fully.
    const sevDivisor =
      sev === "critical" ? 1 : sev === "high" ? 1 + (divisor - 1) * 0.5 : divisor;

    confidences.forEach((confidence, index) => {
      const diminishing = Math.pow(0.72, index);
      const confidenceFactor = 0.6 + 0.4 * clamp(confidence, 0, 1);
      penalty +=
        (SEVERITY_PENALTY[sev] * diminishing * confidenceFactor) / sevDivisor;
    });
  }

  return Math.round(clamp(100 - penalty, 0, 100));
}

/**
 * How much to divide the raw penalty by, given how much code was scanned.
 *
 * A 3,500-file codebase naturally yields far more findings than a 50-file one.
 * Without normalisation every large repository scores near zero purely for
 * being large — the same analysis would rate a big healthy project below a
 * small broken one.
 *
 * A square root is a deliberate middle ground: twice the code does not mean
 * twice as healthy (findings genuinely cluster in problem areas), but it does
 * mean proportionally more headroom. Capped at 5× so a very large repository
 * cannot wash out a genuine problem.
 */
export function densityDivisor(filesAnalyzed: number): number {
  return clamp(Math.sqrt(Math.max(filesAnalyzed, 60) / 60), 1, 5);
}

export interface ScoreBundle {
  scores: CategoryScore[];
  healthScore: number;
}

/**
 * Combine per-category scores into the overall health score (TRD §26).
 * `documentationScore` is supplied by the documentation analyzer because it is
 * derived from structural signals rather than a findings penalty.
 */
export function computeScores(
  findings: Finding[],
  documentationScore: number,
  filesAnalyzed = 60
): ScoreBundle {
  const categories: Category[] = [
    "security",
    "bugs",
    "quality",
    "architecture",
    "performance",
    "testing",
    "dependency",
    "documentation",
  ];

  const divisor = densityDivisor(filesAnalyzed);

  const scores: CategoryScore[] = categories.map((category) => {
    const own = findings.filter((f) => f.category === category);
    const score =
      category === "documentation"
        ? documentationScore
        : penaltyScore(own, divisor);
    return {
      category,
      label: CATEGORIES[category].label,
      score,
      weight: SCORE_WEIGHTS[category],
      issueCount: own.length,
    };
  });

  const totalWeight = scores.reduce((a, s) => a + s.weight, 0) || 1;
  const healthScore = Math.round(
    scores.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight
  );

  return { scores, healthScore: clamp(healthScore, 0, 100) };
}

export function gradeFor(score: number): {
  letter: "A" | "B" | "C" | "D" | "F";
  label: string;
  hex: string;
} {
  if (score >= 90) return { letter: "A", label: "Excellent", hex: "#12a594" };
  if (score >= 80) return { letter: "B", label: "Good", hex: "#14b8a6" };
  if (score >= 70) return { letter: "C", label: "Fair", hex: "#f5a524" };
  if (score >= 55) return { letter: "D", label: "Needs work", hex: "#f76808" };
  return { letter: "F", label: "Critical", hex: "#e5484d" };
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) out[f.severity]++;
  return out;
}
