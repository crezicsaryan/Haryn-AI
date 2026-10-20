import type {
  Architecture,
  CategoryScore,
  DependencyAnalysis,
  Finding,
  LanguageStat,
  RepoMeta,
  RepoStructure,
  TestingAnalysis,
} from "./types";
import { gradeFor } from "./scoring";

export interface SummaryInput {
  repo: RepoMeta;
  languages: LanguageStat[];
  structure: RepoStructure;
  scores: CategoryScore[];
  healthScore: number;
  findings: Finding[];
  dependencies: DependencyAnalysis;
  testing: TestingAnalysis;
  architecture: Architecture;
}

/**
 * Deterministic natural-language synthesis.
 *
 * This is the only thing that writes the narrative: it restates numbers and
 * findings produced by the static analyzers, so it cannot invent issues. There
 * is no model in this path — the same facts are what the report shows.
 */
export function generateSummary(input: SummaryInput): string {
  const { repo, languages, structure, scores, healthScore, findings, dependencies, testing, architecture } = input;

  const grade = gradeFor(healthScore);
  const primary = languages[0]?.name ?? "an unknown language";
  const topLangs = languages.slice(0, 3).map((l) => l.name);

  const langPart =
    topLangs.length > 1
      ? `primarily ${primary} (${topLangs.slice(1).join(", ")})`
      : `written in ${primary}`;

  const sizePart =
    structure.sizeClass === "Small"
      ? "a compact codebase"
      : structure.sizeClass === "Medium"
        ? "a medium-sized codebase"
        : `a large codebase (${structure.fileCount.toLocaleString()} files)`;

  const kind = repo.description
    ? `${repo.fullName} — ${repo.description.replace(/\.$/, "")}`
    : repo.fullName;

  // Strongest and weakest categories.
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];

  const lines: string[] = [];

  lines.push(
    `${kind} is ${sizePart} ${langPart}, with ${structure.fileCount.toLocaleString()} files across ${structure.dirCount.toLocaleString()} directories.`
  );

  lines.push(
    `The overall Codebase Health Score is ${healthScore}/100 (${grade.label}). ${strongest.label} is the strongest area at ${strongest.score}, while ${weakest.label} is the weakest at ${weakest.score}.`
  );

  if (architecture.summary) {
    lines.push(`Architecturally, the codebase resolves to: ${architecture.summary}`);
  }

  const crit = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const vuln = dependencies.stat.vulnerable;

  const riskBits: string[] = [];
  if (crit) riskBits.push(`${crit} critical issue${crit === 1 ? "" : "s"}`);
  if (vuln) riskBits.push(`${vuln} vulnerable dependenc${vuln === 1 ? "y" : "ies"}`);
  if (high) riskBits.push(`${high} high-severity finding${high === 1 ? "" : "s"}`);

  if (riskBits.length) {
    lines.push(
      `Before this reaches production, address ${riskBits.join(", ")}.`
    );
  } else {
    lines.push(
      "No critical or high-severity issues were detected by the static analyzers."
    );
  }

  if (testing.sourceFiles > 0) {
    const pct = (testing.ratio * 100).toFixed(1);
    if (testing.testFiles === 0) {
      lines.push(
        "No tests were found, so changes to this codebase are currently unverified."
      );
    } else if (testing.criticalUncovered.length) {
      lines.push(
        `Testing covers roughly ${pct}% of source files, but these business-critical areas have no matching tests: ${testing.criticalUncovered
          .slice(0, 4)
          .join(", ")}.`
      );
    } else {
      lines.push(`Tests cover roughly ${pct}% of source files.`);
    }
  }

  lines.push(
    "Every figure above is produced by deterministic static analysis; the narrative only restates those measurements."
  );

  return lines.join(" ");
}
