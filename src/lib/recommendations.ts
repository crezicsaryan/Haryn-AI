import type { Finding, Recommendation } from "./types";
import { SEVERITIES, SEVERITY_ORDER } from "./constants";

/**
 * Turn a flat finding list into a short, ordered action plan (PRD §25).
 * One recommendation per distinct issue title, most severe first.
 */
export function buildRecommendations(findings: Finding[]): Recommendation[] {
  const sorted = [...findings].sort((a, b) => {
    const s = SEVERITIES[a.severity].order - SEVERITIES[b.severity].order;
    if (s !== 0) return s;
    return b.confidence - a.confidence;
  });

  const seen = new Set<string>();
  const out: Recommendation[] = [];

  for (const f of sorted) {
    if (f.severity === "info") continue;
    const key = f.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: out.length + 1,
      severity: f.severity,
      title: f.title,
      category: f.category,
      findingId: f.id,
      filePath: f.filePath,
    });
    if (out.length >= 6) break;
  }

  return out;
}

/** Findings grouped by severity, already ordered. */
export function groupBySeverity(findings: Finding[]): Record<string, Finding[]> {
  const groups: Record<string, Finding[]> = {};
  for (const s of SEVERITY_ORDER) groups[s] = [];
  for (const f of findings) groups[f.severity].push(f);
  return groups;
}
