import type { Category, Report } from "../types";
import { CATEGORIES, SEVERITIES } from "../constants";

/**
 * Intent routing.
 *
 * Not every question about a repository is a code-search question. "Which files
 * should I improve first?" has an authoritative answer already sitting in the
 * report — routing it through code retrieval produces noise, because words like
 * "files" and "first" match unrelated source.
 *
 * So questions are classified first:
 *   • **facts** intents (findings, testing, stack, …) are answered from the
 *     analysis output, which is exact.
 *   • **code** intent falls through to retrieval over the source.
 *
 * Both paths then share the same generation step, so an LLM still writes prose
 * for either.
 */

export type Intent =
  | "findings"
  | "bugs"
  | "security"
  | "testing"
  | "dependencies"
  | "stack"
  | "structure"
  | "documentation"
  | "activity"
  | "database"
  | "code";

/**
 * Intent patterns, in priority order.
 *
 * Two things matter here and both were wrong before:
 *
 *  1. **Order is priority.** `structure` is checked before `stack` because
 *     "how is the project organised" contains no stack words, while "what does
 *     this project use" is a stack question — but "how big is the project" is
 *     structural. A single word must not steal a question from a stronger intent.
 *  2. **Facts intents must claim their questions.** "What database do they use?"
 *     used to fall through to `code`, retrieve noise like an `index.css`
 *     comment, and never consult the dependency manifest that actually holds the
 *     answer. Data-layer questions now have their own intent.
 */
const PATTERNS: { intent: Intent; re: RegExp }[] = [
  {
    intent: "findings",
    re: /\b(improve|fix|fixes|first|priorit(?:y|ies|ise|ize)|worst|biggest|most important|should i|action|start with|tech(?:nical)? debt|refactor|clean ?up)\b/i,
  },
  {
    intent: "bugs",
    re: /\b(bugs?|buggy|broken|incorrect|wrong|crash(?:es|ing)?|off[- ]by[- ]one|null pointer|runtime error|logical error|behaves?)\b/i,
  },
  {
    intent: "security",
    re: /\b(security|secure|risk|risks|vulnerab\w*|secret|credential|exposed|injection|xss|csrf|safe|hacked|exploit)\b/i,
  },
  {
    intent: "testing",
    re: /\b(tests?|testing|coverage|spec|jest|vitest|pytest|unit tests?)\b/i,
  },
  {
    // Data layer, before generic stack/structure, because "what database" is
    // answerable exactly from manifests and the architecture pass.
    intent: "database",
    re: /\b(databases?|db|orm|schema|migrations?|persistence|persist|postgres(?:ql)?|mysql|mongo(?:db)?|sqlite|redis|dynamodb|firestore|supabase|prisma|sequelize|mongoose|typeorm|knex|models?)\b/i,
  },
  {
    intent: "dependencies",
    re: /\b(dependenc\w*|packages?|npm|yarn|pnpm|outdated|upgrade|library|libraries|node_modules|third[- ]party)\b/i,
  },
  {
    intent: "activity",
    re: /\b(commits?|contributors?|authors?|activity|active|maintain\w*|history|timeline|frequenc\w*|how (?:many|often) times?|how old|last (?:commit|updated|change)|momentum|bus factor|churn)\b/i,
  },
  {
    intent: "documentation",
    re: /\b(documentation|docs?|readme|comments?|licen[cs]e)\b/i,
  },
  {
    // Structure before stack: "how is it organised / how big" is structural even
    // when the sentence also contains "project".
    intent: "structure",
    re: /\b(architect\w*|structure|structured|layers?|organi[sz]ed|organi[sz]ation|folder|directories|directory|how big|how many files|size|layout|monorepo|packages?\s+layout)\b/i,
  },
  {
    intent: "stack",
    re: /\b(technolog\w*|stack|frameworks?|languages?|built with|tech|what does .* use|what (?:is|are) .* (?:using|written in))\b/i,
  },
];

export function classifyIntent(question: string): Intent {
  for (const p of PATTERNS) {
    if (p.re.test(question)) return p.intent;
  }
  return "code";
}

export function isFactsIntent(intent: Intent): boolean {
  return intent !== "code";
}

/* ------------------------------------------------------------------ */
/* Facts context (for the LLM)                                         */
/* ------------------------------------------------------------------ */

function findingsFor(report: Report, categories: Category[], limit: number) {
  return report.findings
    .filter((f) => categories.includes(f.category))
    .sort(
      (a, b) =>
        SEVERITIES[a.severity].order - SEVERITIES[b.severity].order ||
        b.confidence - a.confidence
    )
    .slice(0, limit);
}

/** Compact relative time for prose ("3 weeks ago"). */
function relativeIso(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "at an unknown time";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatFindings(
  findings: Report["findings"],
  withFile = true
): string {
  if (!findings.length) return "- none detected";
  return findings
    .map(
      (f) =>
        `- [${f.severity.toUpperCase()}] ${CATEGORIES[f.category].label}: ${f.title}${
          withFile && f.filePath
            ? ` (${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""})`
            : ""
        }`
    )
    .join("\n");
}

/** The factual context handed to the model for a facts intent. */
export function buildFactsContext(report: Report, intent: Intent): string {
  const langs = report.languages
    .slice(0, 5)
    .map((l) => `${l.name} ${l.percent.toFixed(0)}%`)
    .join(", ");

  switch (intent) {
    case "findings":
      return [
        `Overall health: ${report.healthScore}/100`,
        `Category scores: ${report.scores.map((s) => `${s.label} ${s.score}`).join(", ")}`,
        "",
        "Prioritised recommended actions:",
        report.recommendations.length
          ? report.recommendations
              .map(
                (r) =>
                  `${r.rank}. [${r.severity.toUpperCase()}] ${r.title} (${CATEGORIES[r.category].label})${
                    r.filePath ? ` — ${r.filePath}` : ""
                  }`
              )
              .join("\n")
          : "- none; no high or critical issues were detected",
        "",
        "All high and critical findings:",
        formatFindings(
          report.findings
            .filter((f) => f.severity === "critical" || f.severity === "high")
            .slice(0, 12)
        ),
      ].join("\n");

    case "bugs":
      return [
        `Bug-scan findings: ${findingsFor(report, ["bugs"], 999).length}`,
        "",
        "Statically detected constructs that behave incorrectly at runtime",
        "(each is a heuristic — verify against the code before acting):",
        formatFindings(findingsFor(report, ["bugs"], 15)),
      ].join("\n");

    case "security":
      return [
        `Security score: ${report.scores.find((s) => s.category === "security")?.score ?? "n/a"}/100`,
        "",
        "Security findings:",
        formatFindings(findingsFor(report, ["security"], 12)),
        "",
        `Vulnerable dependencies: ${report.dependencies.stat.vulnerable}`,
        report.dependencies.items
          .filter((i) => i.status === "vulnerable")
          .slice(0, 8)
          .map(
            (i) =>
              `- ${i.name}@${i.version} → ${i.vulns?.map((v) => v.id).join(", ") || "advisory"}`
          )
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n");

    case "testing":
      return [
        `Testing score: ${report.scores.find((s) => s.category === "testing")?.score ?? "n/a"}/100`,
        `Test files: ${report.testing.testFiles}`,
        `Source files: ${report.testing.sourceFiles}`,
        `Ratio: ${(report.testing.ratio * 100).toFixed(1)}%`,
        `Frameworks: ${report.testing.frameworks.join(", ") || "none detected"}`,
        `Business-critical areas without tests: ${report.testing.criticalUncovered.join(", ") || "none"}`,
        "",
        "Testing findings:",
        formatFindings(findingsFor(report, ["testing"], 8)),
      ].join("\n");

    case "dependencies":
      return [
        `Total declared: ${report.dependencies.stat.total}`,
        `Healthy: ${report.dependencies.stat.healthy}`,
        `Outdated: ${report.dependencies.stat.outdated}`,
        `Vulnerable: ${report.dependencies.stat.vulnerable}`,
        `Potentially unused: ${report.dependencies.stat.unused}`,
        `Manifests: ${report.dependencies.manifests.join(", ") || "none found"}`,
        "",
        "Vulnerable packages:",
        report.dependencies.items
          .filter((i) => i.status === "vulnerable")
          .slice(0, 10)
          .map((i) => `- ${i.name}@${i.version} → ${i.vulns?.map((v) => v.id).join(", ")}`)
          .join("\n") || "- none",
        "",
        "Outdated packages:",
        report.dependencies.items
          .filter((i) => i.status === "outdated")
          .slice(0, 10)
          .map((i) => `- ${i.name}@${i.version}`)
          .join("\n") || "- none",
      ].join("\n");

    case "stack":
      return [
        `Languages: ${langs || "unknown"}`,
        `Files: ${report.structure.fileCount}, directories: ${report.structure.dirCount}`,
        `Architecture: ${report.architecture.summary}`,
        "",
        "Detected layers:",
        report.architecture.nodes.map((n) => `- ${n.label} (${n.files} files)`).join("\n"),
      ].join("\n");

    case "database": {
      const libs = report.dependencies.items.filter((d) =>
        /prisma|mongoose|sequelize|typeorm|knex|pg|postgres|mysql|sqlite|mongodb|firestore|redis|dynamodb|supabase|better-sqlite/i.test(
          d.name
        )
      );
      const dataNode = report.architecture.nodes.find((n) => n.id === "data");
      return [
        `Data-layer libraries declared: ${libs.length ? libs.map((l) => `${l.name}@${l.version}`).join(", ") : "none detected in the manifests"}`,
        `Manifests read: ${report.dependencies.manifests.join(", ") || "none found"}`,
        dataNode
          ? `The architecture pass classified ${dataNode.files} file(s) into the "${dataNode.label}" layer:`
          : "No dedicated data layer was classified from the file tree.",
        dataNode?.detail
          ? dataNode.detail
              .split("\n")
              .slice(0, 8)
              .map((d) => `- ${d}`)
              .join("\n")
          : "",
        "",
        "Files whose path suggests persistence:",
        report.findings
          .filter((f) => f.filePath && /model|schema|migrat|db|database|repository|dao|entity|store/i.test(f.filePath))
          .map((f) => f.filePath as string)
          .filter((p, i, a) => a.indexOf(p) === i)
          .slice(0, 8)
          .map((p) => `- ${p}`)
          .join("\n") || "- none identified",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "structure":
      return [
        `Files: ${report.structure.fileCount}, directories: ${report.structure.dirCount}`,
        `Estimated size: ${report.structure.sizeClass}`,
        `Top-level entries: ${report.structure.topLevelDirs.join(", ")}`,
        `Architecture: ${report.architecture.summary}`,
        "",
        "Detected layers:",
        report.architecture.nodes
          .map((n) => `- ${n.label} — ${n.files} files${n.detail ? ` (e.g. ${n.detail.split("\n")[0]})` : ""}`)
          .join("\n"),
      ].join("\n");

    case "documentation":
      return [
        `Documentation score: ${report.scores.find((s) => s.category === "documentation")?.score ?? "n/a"}/100`,
        "",
        "Documentation findings:",
        formatFindings(findingsFor(report, ["documentation"], 8)),
      ].join("\n");

    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic facts answer (offline path)                           */
/* ------------------------------------------------------------------ */

export function factsAnswer(report: Report, intent: Intent): string {
  const r = report;
  const lines: string[] = [];

  switch (intent) {
    case "findings": {
      lines.push(`Health ${r.healthScore}/100 — fix these in order, highest impact first:`);
      lines.push("");
      if (!r.recommendations.length) {
        lines.push(
          "No high or critical issues were detected. The next best moves are raising test coverage and keeping dependencies current."
        );
      } else {
        r.recommendations.forEach((rec) =>
          lines.push(
            `${rec.rank}. [${rec.severity.toUpperCase()}] ${rec.title}${
              rec.filePath ? ` — ${rec.filePath}` : ""
            } (${CATEGORIES[rec.category].label})`
          )
        );
      }
      break;
    }

    case "bugs": {
      const bugs = findingsFor(r, ["bugs"], 12);
      if (!bugs.length) {
        lines.push(
          "The bug scan found nothing. That is not proof of correctness — it means none of the known-wrong patterns appeared in the scanned files."
        );
      } else {
        lines.push(
          `${bugs.length} construct${bugs.length === 1 ? "" : "s"} that look like bugs — verify each against the code:`
        );
        lines.push("");
        bugs.forEach((f) =>
          lines.push(
            `• [${f.severity.toUpperCase()}] ${f.title}${
              f.filePath ? ` — ${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}` : ""
            }`
          )
        );
      }
      break;
    }

    case "activity": {
      const a = r.activity;
      if (!a || (!a.totalCommits && !a.contributors.length)) {
        lines.push(
          "Commit history was not available — GitHub did not return it (likely the REST API was rate-limited, or the stats are still being computed)."
        );
        break;
      }
      lines.push(`${a.totalCommits.toLocaleString()} commits from ${a.contributors.length} contributor${a.contributors.length === 1 ? "" : "s"}.`);
      if (a.lastCommitAt) lines.push(`Last commit ${relativeIso(a.lastCommitAt)}.`);
      if (a.priorMonthly > 0 || a.recentMonthly > 0) {
        const dir = a.recentMonthly >= a.priorMonthly ? "steady or rising" : "slowing";
        lines.push(
          `Momentum: ${a.recentMonthly} commits in the last 4 weeks vs ${a.priorMonthly} in the previous 4 — ${dir}.`
        );
      }
      if (a.months?.length) {
        const active = a.months.filter((m) => m.total > 0);
        const busiest = [...a.months].sort((x, y) => y.total - x.total)[0];
        lines.push(
          `Commits were recorded in ${active.length} of the last ${a.months.length} months; the busiest was ${busiest.label} with ${busiest.total}.`
        );
      }
      if (a.messageTypes?.length) {
        lines.push("");
        lines.push("Message types:");
        a.messageTypes
          .slice(0, 6)
          .forEach((t) => lines.push(`• ${t.type} — ${t.count} (${(t.share * 100).toFixed(0)}%)`));
      }
      if (a.authorStats?.length) {
        lines.push("");
        lines.push(
          `Authors (from the last ${a.messageStats?.scanned ?? a.recentCommits.length} commits):`
        );
        a.authorStats
          .slice(0, 8)
          .forEach((x) =>
            lines.push(`• ${x.login} — ${x.commits} commits (${(x.share * 100).toFixed(0)}%)`)
          );
      }
      if (a.recentCommits.length) {
        lines.push("");
        lines.push("Most recent commits:");
        a.recentCommits
          .slice(0, 8)
          .forEach((c) => lines.push(`• ${c.shortSha} ${c.message} — ${c.author}`));
      }
      break;
    }

    case "security": {
      const sec = findingsFor(r, ["security"], 10);
      const vuln = r.dependencies.items.filter((i) => i.status === "vulnerable");
      if (!sec.length && !vuln.length) {
        lines.push(
          "No security findings were produced by the static analyzers. That is not proof of absence — it means no known pattern matched."
        );
      } else {
        lines.push(`Security score ${r.scores.find((s) => s.category === "security")?.score}/100.`);
        lines.push("");
        if (sec.length) {
          lines.push("Findings:");
          sec.forEach((f) =>
            lines.push(
              `• [${f.severity.toUpperCase()}] ${f.title}${
                f.filePath ? ` — ${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}` : ""
              }`
            )
          );
        }
        if (vuln.length) {
          lines.push("");
          lines.push("Vulnerable dependencies:");
          vuln.slice(0, 8).forEach((i) =>
            lines.push(`• ${i.name}@${i.version} → ${i.vulns?.map((v) => v.id).join(", ")}`)
          );
        }
      }
      break;
    }

    case "testing": {
      const t = r.testing;
      lines.push(`Testing score ${r.scores.find((s) => s.category === "testing")?.score}/100.`);
      lines.push(
        `${t.testFiles} test file${t.testFiles === 1 ? "" : "s"} for ${t.sourceFiles} source files (${(t.ratio * 100).toFixed(1)}%).`
      );
      lines.push(
        t.frameworks.length
          ? `Frameworks: ${t.frameworks.join(", ")}.`
          : "No test framework detected."
      );
      if (t.criticalUncovered.length) {
        lines.push("");
        lines.push(`Business-critical modules with no matching tests: ${t.criticalUncovered.join(", ")}.`);
      }
      lines.push("");
      lines.push("This is estimated from test-file presence, not a measured coverage report.");
      break;
    }

    case "dependencies": {
      const d = r.dependencies.stat;
      lines.push(
        `${d.total} dependencies declared — ${d.healthy} healthy, ${d.outdated} outdated, ${d.vulnerable} vulnerable, ${d.unused} potentially unused.`
      );
      const vuln = r.dependencies.items.filter((i) => i.status === "vulnerable");
      if (vuln.length) {
        lines.push("");
        lines.push("Vulnerable packages:");
        vuln.slice(0, 8).forEach((i) =>
          lines.push(`• ${i.name}@${i.version} → ${i.vulns?.map((v) => v.id).join(", ")}`)
        );
      }
      const out = r.dependencies.items.filter((i) => i.status === "outdated");
      if (out.length) {
        lines.push("");
        lines.push(`Outdated: ${out.slice(0, 8).map((i) => `${i.name}@${i.version}`).join(", ")}.`);
      }
      break;
    }

    case "stack": {
      lines.push(
        `Languages: ${r.languages.slice(0, 5).map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(", ") || "unknown"}.`
      );
      lines.push(`Structure: ${r.architecture.summary}`);
      lines.push("");
      lines.push("Detected layers:");
      r.architecture.nodes.forEach((n) => lines.push(`• ${n.label} — ${n.files} files`));
      break;
    }

    case "database": {
      const libs = r.dependencies.items.filter((d) =>
        /prisma|mongoose|sequelize|typeorm|knex|pg|postgres|mysql|sqlite|mongodb|firestore|redis|dynamodb|supabase|better-sqlite/i.test(
          d.name
        )
      );
      if (libs.length) {
        lines.push(
          `Data-layer libraries declared in the manifests: ${libs.map((l) => `${l.name}@${l.version}`).join(", ")}.`
        );
      } else {
        lines.push(
          "No recognisable database or ORM library was found in the package manifests."
        );
      }
      const dataNode = r.architecture.nodes.find((n) => n.id === "data");
      if (dataNode) {
        lines.push(
          `The architecture pass classified ${dataNode.files} file(s) into the "${dataNode.label}" layer.`
        );
      } else {
        lines.push(
          "No dedicated data/ persistence layer was classified from the file tree."
        );
      }
      lines.push("");
      lines.push(
        "This is read from the declared dependencies and the file tree — it is not a live connection check."
      );
      break;
    }

    case "structure": {
      lines.push(
        `${r.structure.fileCount} files across ${r.structure.dirCount} directories (${r.structure.sizeClass}).`
      );
      lines.push("");
      lines.push(r.architecture.summary);
      lines.push("");
      r.architecture.nodes.forEach((n) =>
        lines.push(`• ${n.label} — ${n.files} file${n.files === 1 ? "" : "s"}`)
      );
      break;
    }

    case "activity": {
      const a = report.activity;
      if (!a || (!a.totalCommits && !a.contributors.length)) {
        return [
          "Commit history was not available for this repository.",
          "",
          "GitHub did not return it — most likely the REST API was rate-limited, or the statistics are still being computed for a newly pushed repository.",
        ].join("\n");
      }
      const trend =
        a.priorMonthly === 0
          ? "no prior baseline"
          : a.recentMonthly >= a.priorMonthly
            ? `up (${a.recentMonthly} vs ${a.priorMonthly})`
            : `down (${a.recentMonthly} vs ${a.priorMonthly})`;
      return [
        `Total commits: ${a.totalCommits}`,
        `Contributors: ${a.contributors.length}`,
        `Last commit: ${a.lastCommitAt ?? "unknown"}`,
        `Commit momentum over 4 weeks: ${trend}`,
        "",
        "Commits per month:",
        (a.months ?? [])
          .map((m) => `- ${m.month}: ${m.total}`)
          .join("\n") || "- none available",
        "",
        "Commit message types:",
        (a.messageTypes ?? [])
          .map((t) => `- ${t.type}: ${t.count} (${(t.share * 100).toFixed(0)}%)`)
          .join("\n") || "- none available",
        "",
        "Authors (from the commits inspected):",
        (a.authorStats ?? [])
          .slice(0, 10)
          .map(
            (x) =>
              `- ${x.login}: ${x.commits} commits (${(x.share * 100).toFixed(0)}%)`
          )
          .join("\n") || "- none available",
        "",
        "Most recent commits:",
        a.recentCommits
          .slice(0, 20)
          .map((c) => `- ${c.shortSha} [${c.type}] ${c.message} (${c.author})`)
          .join("\n") || "- none available",
      ].join("\n");
    }

    case "documentation": {
      const doc = findingsFor(r, ["documentation"], 8);
      lines.push(
        `Documentation score ${r.scores.find((s) => s.category === "documentation")?.score}/100.`
      );
      lines.push("");
      if (!doc.length) lines.push("No documentation issues were detected.");
      else doc.forEach((f) => lines.push(`• [${f.severity.toUpperCase()}] ${f.title}`));
      break;
    }

    default:
      return "";
  }

  return lines.join("\n").trim();
}
