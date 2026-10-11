import type { Report } from "../types";
import { CATEGORIES } from "../constants";
import { chatCompletion, type ChatMessage, type Engine } from "./provider";

/**
 * The written repository summary.
 *
 * With an LLM configured this is a genuinely reasoned narrative; without one it
 * falls back to the deterministic synthesiser already stored on the report, so
 * a summary is always present (TRD §40).
 */

export interface SummaryResult {
  text: string;
  engine: Engine;
}

/** A compact, factual digest — never the raw report. */
function buildDigest(report: Report): string {
  const scores = report.scores
    .map((s) => `${s.label}: ${s.score}/100`)
    .join(", ");

  const counts = report.findings.reduce<Record<string, number>>((a, f) => {
    a[f.severity] = (a[f.severity] ?? 0) + 1;
    return a;
  }, {});

  const top = report.findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 8)
    .map(
      (f) =>
        `- [${f.severity.toUpperCase()}] ${CATEGORIES[f.category].label}: ${f.title}${
          f.filePath ? ` (${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""})` : ""
        }`
    )
    .join("\n");

  const langs = report.languages
    .slice(0, 4)
    .map((l) => `${l.name} ${l.percent.toFixed(0)}%`)
    .join(", ");

  return [
    `Repository: ${report.repo.fullName}`,
    report.repo.description ? `Description: ${report.repo.description}` : "",
    `Languages: ${langs || "unknown"}`,
    `Size: ${report.structure.fileCount} files, ${report.structure.dirCount} directories (${report.structure.sizeClass})`,
    `Overall health: ${report.healthScore}/100`,
    `Category scores: ${scores}`,
    `Findings: ${JSON.stringify(counts)}`,
    `Architecture: ${report.architecture.summary}`,
    `Testing: ${report.testing.testFiles} test files / ${report.testing.sourceFiles} source files${
      report.testing.criticalUncovered.length
        ? `; untested critical areas: ${report.testing.criticalUncovered.join(", ")}`
        : ""
    }`,
    `Dependencies: ${report.dependencies.stat.total} total, ${report.dependencies.stat.vulnerable} vulnerable, ${report.dependencies.stat.outdated} outdated`,
    "",
    "Highest-severity findings:",
    top || "- none",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateAiSummary(report: Report): Promise<SummaryResult> {
  const fallback = report.summary;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Haryn AI, writing the executive summary of an engineering health report.",
        "",
        "RULES:",
        "1. Use ONLY the facts supplied. Do not invent files, issues or measurements.",
        "2. Write 3–5 sentences of plain, technical prose. No bullet points, no headings.",
        "3. Say what the codebase is, how healthy it is, where the risk concentrates,",
        "   and what should be fixed before production.",
        "4. Name the specific files behind the most serious issues.",
        "5. Do not use marketing language or praise the tool itself.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Facts:\n${buildDigest(report)}`,
    },
  ];

  const text = await chatCompletion(messages, { temperature: 0.2, maxTokens: 420 });

  if (text) return { text, engine: "llm" };
  return { text: fallback, engine: "retrieval" };
}
