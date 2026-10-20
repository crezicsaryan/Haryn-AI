import type { Category, Finding, Report, Severity } from "../types";
import { CATEGORIES } from "../constants";
import type { Retriever, Retrieved } from "./retrieve";
import {
  RESPONSE_MEANING,
  ROLE_META,
  explainChunk,
  stemsOverlap,
  type ExplainedSite,
} from "./comprehend";
import { fixFor, ruleIdOf, verifyFor } from "./repair";

// Re-exported: callers (and tests) treat finding metadata as part of the engine.
export { ruleIdOf };

/**
 * Deep, deterministic diagnosis of a repository.
 *
 * The assistant used to describe code: "this is a guard, it calls these
 * functions". That answers *what*, not *what is wrong* — and "what is wrong and
 * how do I fix it" is the question people actually ask. This module answers it
 * from evidence only:
 *
 *   • the static findings already computed for the exact files in scope,
 *   • the rule metadata behind each finding (what breaks, how to repair it),
 *   • the call/import neighbourhood from the retrieval index,
 *   • the report's own measurements (coverage, dependencies, scores).
 *
 * There is no model in this path. Every sentence either restates a measurement
 * or names a finding, so the answer cannot invent a problem that the analyzers
 * did not detect. Where the evidence runs out, the answer says so.
 */

/* ------------------------------------------------------------------ */
/* Ordering and labels                                                 */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_TAG: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

/**
 * Is this a test file?
 *
 * Test fixtures deliberately contain the bad pattern — a fake key, a missing
 * `await`, an off-by-one — because that is what they are testing. Reporting
 * them at the same rank as production code buried the real defects: a 55%
 * "potential hardcoded credential" in a test outranked genuine bugs. They are
 * still listed (a real key in a test *is* a leak) but after the code that ships.
 */
function isTestPath(path: string | undefined): boolean {
  if (!path) return false;
  return (
    /(^|\/)(__tests__|tests?|specs?)\//i.test(path) ||
    /\.(test|spec)\.[a-z]+$/i.test(path) ||
    /(^|\/)(test_|_test\.)/i.test(path)
  );
}

function bySeverity(a: Finding, b: Finding): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  // Same severity: production code before test fixtures.
  return Number(isTestPath(a.filePath)) - Number(isTestPath(b.filePath));
}

/** The description without the internal rule marker, for display. */
function proseOf(f: Finding): string {
  return f.description.replace(/\n*_Rule:[^_]*_\s*$/i, "").trim();
}

/* ------------------------------------------------------------------ */
/* Repair guidance                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared formatting                                                   */
/* ------------------------------------------------------------------ */

const MAX_EVIDENCE = 120;

function clip(s: string, n = MAX_EVIDENCE): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function location(f: Finding): string {
  if (!f.filePath) return "(repository-wide)";
  return f.lineStart ? `${f.filePath}:${f.lineStart}` : f.filePath;
}

/**
 * One finding, expanded into everything a reader needs to act on it.
 *
 * `heading` is numbered by the caller so the numbering stays stable across the
 * sections that share this block.
 */
function renderFinding(f: Finding, heading: number, showFix = true): string[] {
  const out: string[] = [];
  const confidence = Math.round(f.confidence * 100);
  const potential = f.isPotential ? " · heuristic" : "";
  out.push(
    `${heading}. [${SEVERITY_TAG[f.severity]} · ${confidence}% sure${potential}] ${f.title} — ${location(f)}`
  );

  const body = proseOf(f);
  if (body) out.push(`   ${clip(body, 320)}`);

  if (f.evidence) out.push(`   Code: ${clip(f.evidence)}`);
  if (f.impact) out.push(`   What breaks: ${clip(f.impact, 220)}`);

  if (showFix) {
    const fix = fixFor(f);
    if (fix) out.push(`   Fix: ${clip(fix, 300)}`);
  }
  return out;
}

/** Group findings by the rule that produced them. */
function byRule(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = ruleIdOf(f) ?? f.title;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  return groups;
}

/** How many findings sit in each top-level area. */
function concentration(findings: Finding[]): { area: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of findings) {
    if (!f.filePath) continue;
    const parts = f.filePath.split("/");
    // A monorepo's first segment is the package; a flat repo's is the folder.
    const area = parts.length > 1 ? `${parts[0]}/` : "(root)";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);
}

function severityCounts(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Repo-wide diagnosis                                                 */
/* ------------------------------------------------------------------ */

export interface DiagnosisInput {
  report: Report;
  question: string;
  retriever: Retriever;
  /** Chunks retrieved for the question. Empty means "the whole repository". */
  results: Retrieved[];
}

export interface Diagnosis {
  answer: string;
  sources: string[];
  intent: "code" | "findings";
  groundedIn: number;
}

/**
 * The whole-repository answer: what needs attention, in what order, and why.
 *
 * Ordered by severity rather than by category, because the reader is deciding
 * what to do next — not filing a report.
 */
export function diagnoseRepo(
  report: Report,
  question: string,
  opts: { findings?: Finding[]; subject?: string } = {}
): Diagnosis {
  const findings = [...(opts.findings ?? report.findings)].sort(bySeverity);
  const counts = severityCounts(findings);
  const actionable = findings.filter((f) => f.severity !== "info");

  const lines: string[] = [];

  /* --- Headline ----------------------------------------------------- */
  const worst = [...report.scores].sort((a, b) => a.score - b.score)[0];
  if (opts.subject) {
    // A category-scoped question ("biggest security risks") is not a request for
    // the overall grade, so lead with the category's own score and count.
    const own = report.scores.find((sc) => sc.label === opts.subject);
    lines.push(
      `${opts.subject} in ${report.repo.fullName}: ${plural(actionable.length, "finding")} need attention — ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low${own ? `, and the category scores ${own.score}/100` : ""}.`
    );
  } else {
    lines.push(
      `${report.repo.fullName} scores ${report.healthScore}/100 across ${plural(
        report.structure.fileCount,
        "file"
      )}. ${plural(actionable.length, "finding")} need attention: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`
    );
    if (worst) {
      lines.push(
        `${worst.label} is the weakest area at ${worst.score}/100 (${plural(worst.issueCount, "issue")}).`
      );
    }
  }

  /* --- Concentration ------------------------------------------------ */
  const areas = concentration(actionable);
  if (areas.length > 1) {
    const top = areas.slice(0, 3).map((a) => `${a.area} ${a.count}`);
    lines.push(`Most of the risk sits in: ${top.join(", ")}.`);
  }

  if (!actionable.length) {
    lines.push("");
    lines.push(
      "No actionable findings were detected. That is not proof of correctness — it means the rules that ran found nothing, and the rules only cover patterns they know."
    );
    return {
      answer: lines.join("\n"),
      sources: [],
      intent: "findings",
      groundedIn: 0,
    };
  }

  /* --- Top issues --------------------------------------------------- */
  const inTests = actionable.filter((f) => isTestPath(f.filePath)).length;
  if (inTests) {
    lines.push(
      `${inTests} of these are in test files. Test fixtures deliberately contain the bad pattern they exercise, so they are listed after the code that ships — unless the value is a real credential.`
    );
  }

  const top = actionable.slice(0, 8);
  lines.push("");
  lines.push("Top issues, in the order I would fix them:");
  lines.push("");
  top.forEach((f, i) => {
    lines.push(...renderFinding(f, i + 1, true));
    lines.push("");
  });

  /* --- Systemic patterns -------------------------------------------
   * The most useful thing a whole-repository view can say: when the same rule
   * fires many times, it is one design habit, and one decision fixes all of it.
   */
  const groups = [...byRule(actionable).entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);

  if (groups.length) {
    lines.push("Systemic patterns — one fix covers many files:");
    for (const [rule, list] of groups) {
      const files = new Set(list.map((f) => f.filePath).filter(Boolean));
      const sample = list[0];
      lines.push(
        `• ${list.length}× ${sample.title} (${rule}) across ${plural(files.size, "file")}.`
      );
      const fix = fixFor(sample);
      if (fix) lines.push(`  Fix once: ${clip(fix, 240)}`);
    }
    lines.push("");
  }

  /* --- Fix order ---------------------------------------------------- */
  const criticals = actionable.filter((f) => f.severity === "critical");
  const highs = actionable.filter((f) => f.severity === "high");
  const systemic = groups[0];
  lines.push("Fix order:");
  /*
   * Number the steps as they are emitted. Deriving the number from how many
   * earlier sections *should* have printed produced a list that started at "2."
   * whenever a repository had no critical or high findings.
   */
  let step = 0;
  if (criticals.length) {
    step += 1;
    lines.push(
      `${step}. ${plural(criticals.length, "critical finding")} first — these are exploitable or data-destroying: ${criticals
        .slice(0, 4)
        .map((f) => f.title.toLowerCase())
        .join("; ")}.`
    );
  }
  if (highs.length) {
    step += 1;
    // "Then" only reads correctly when something came before it.
    lines.push(
      `${step}. ${step === 1 ? "Start with" : "Then"} the ${plural(
        highs.length,
        "high finding"
      )}; start with ${highs[0].filePath ?? highs[0].title}.`
    );
  }
  if (systemic) {
    step += 1;
    lines.push(
      `${step}. The repeated pattern (${systemic[1].length}× ${systemic[1][0].title.toLowerCase()}) is the cheapest win per edit.`
    );
  }

  /* --- Evidence and limits ------------------------------------------ */
  lines.push("");
  lines.push(
    `What this is based on: ${plural(report.findings.length, "finding")} from eight static analyzers, ${plural(
      report.structure.fileCount,
      "file"
    )} parsed, ${plural(report.testing.testFiles, "test file")}, and ${plural(
      report.dependencies.stat.total,
      "dependency",
      "dependencies"
    )}. Every line above names a file and line or a measurement.`
  );
  lines.push(
    "Limits: static rules find patterns, not intent. A finding marked heuristic is a signal to check, not a proven defect — and code that no rule covers is not reported as clean."
  );

  return {
    answer: lines.join("\n").trim(),
    sources: actionable
      .filter((f) => f.filePath)
      .slice(0, 6)
      .map((f) => `${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}`),
    intent: "findings",
    groundedIn: actionable.length,
  };
}

/* ------------------------------------------------------------------ */
/* Targeted diagnosis                                                  */
/* ------------------------------------------------------------------ */

/** Findings that sit inside the files the question matched. */
function findingsFor(report: Report, paths: Set<string>): Finding[] {
  return report.findings
    .filter((f) => f.filePath && paths.has(f.filePath))
    .sort(bySeverity);
}

/**
 * The evidence a chunk carries beyond its code: data stores, auth primitives,
 * environment variables and the status codes it returns.
 *
 * Status codes are spelled out ("401 (unauthorised)") because the code alone
 * does not tell a reader what the function promises on failure.
 */
function describeSignals(site: ExplainedSite): string | null {
  const sig = site.signals;
  const notable: string[] = [];
  if (sig.dbHints.length) notable.push(`data stores: ${sig.dbHints.join(", ")}`);
  if (sig.authWords.length) notable.push(`auth: ${sig.authWords.join(", ")}`);
  if (sig.env.length) notable.push(`env: ${sig.env.join(", ")}`);
  if (sig.statusCodes.length) {
    notable.push(
      `HTTP: ${sig.statusCodes
        .map((code) => (RESPONSE_MEANING[code] ? `${code} (${RESPONSE_MEANING[code]})` : `${code}`))
        .join(", ")}`
    );
  }
  return notable.length ? `Signals: ${notable.join("; ")}.` : null;
}

/** How the call flow reads: what it delegates to, and what it depends on. */
function describeFlow(site: ExplainedSite): string[] {
  const flow = site.calls.filter((call) => call !== site.chunk.symbol);
  if (!flow.length) return [];
  return [
    flow.length === 1
      ? `It calls \`${flow[0]}\`.`
      : `Call order: ${flow.slice(0, 8).map((call) => `\`${call}\``).join(" → ")}.`,
  ];
}

/**
 * The opening: what the match is, and how much to trust the match at all.
 *
 * Retrieval always returns *something*, so the top chunk is not proof of
 * relevance. When none of the question's words occur in it, this says "closest"
 * rather than "this is the answer" — otherwise the reader is told that an
 * unrelated file explains a feature the repository may not even have.
 */
function describeSite(site: ExplainedSite, question: string): string[] {
  const { chunk, role } = site;
  const meta = ROLE_META[role];
  const where = chunk.symbol
    ? `\`${chunk.symbol}\` — ${meta.label} in ${chunk.path} (line ${chunk.startLine})`
    : `${chunk.path} (line ${chunk.startLine}) — ${meta.label}`;

  const out: string[] = [];
  if (stemsOverlap(question, chunk)) {
    out.push(`This is ${where}. ${capitalise(meta.describes)}.`);
  } else {
    out.push(`The closest code I could find is ${where}. ${capitalise(meta.describes)}.`);
    out.push(
      "None of the terms in your question appear in it, so this is probably not what you asked about — the repository may not contain that feature. What follows is still what the analysis found there."
    );
  }

  out.push(...describeFlow(site));
  if (site.externals.length) {
    out.push(`Depends on: ${site.externals.map((e) => `\`${e}\``).join(", ")}.`);
  }
  const signals = describeSignals(site);
  if (signals) out.push(signals);
  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Everything the targeted sections need, computed once. */
interface TargetContext {
  report: Report;
  question: string;
  retriever: Retriever;
  sites: ExplainedSite[];
  lead: ExplainedSite;
  paths: Set<string>;
  scoped: Finding[];
}

function buildTargetContext(
  report: Report,
  question: string,
  retriever: Retriever,
  results: Retrieved[]
): TargetContext {
  const sites = results.map((r) => explainChunk(r.chunk, question));
  sites.sort((a, b) => b.relevance - a.relevance);

  // Same rule as the descriptive path: implementation leads, tests do not.
  const lead = sites.find((s) => s.role !== "test") ?? sites[0];
  const paths = new Set(sites.map((s) => s.chunk.path));

  return { report, question, retriever, sites, lead, paths, scoped: findingsFor(report, paths) };
}

/**
 * The defects on the matched files, each expanded into evidence, impact and fix.
 *
 * A file with no findings is reported as clean *for the rules that ran* — not as
 * correct. The distinction matters: the second would be a claim the analysis
 * cannot support.
 */
function describeDefects(ctx: TargetContext): string[] {
  const { scoped, paths } = ctx;
  const lines: string[] = [""];

  if (!scoped.length) {
    lines.push(
      "No static finding touches these files. That is a clean result for the rules that ran — it is not a guarantee: rules only catch patterns they know, and a defect in business logic is invisible to them."
    );
    lines.push("");
    return lines;
  }

  const highOrCritical = scoped.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).length;

  lines.push(
    `Problems found in ${paths.size === 1 ? "this file" : `these ${paths.size} files`}: ${plural(
      scoped.length,
      "finding"
    )}${highOrCritical ? `, ${highOrCritical} of them high or critical` : ""}.`
  );
  lines.push("");
  scoped.slice(0, 8).forEach((f, i) => {
    lines.push(...renderFinding(f, i + 1, true));
    lines.push("");
  });
  if (scoped.length > 8) {
    lines.push(`(${scoped.length - 8} further findings in these files.)`);
    lines.push("");
  }
  return lines;
}

/**
 * One root cause, when several findings share a rule.
 *
 * "Three of these are the same defect" changes what the reader does: they fix
 * one thing once, instead of three things three times.
 */
function describeRootCause(ctx: TargetContext): string[] {
  const groups = [...byRule(ctx.scoped).entries()].filter(([, list]) => list.length > 1);
  if (!groups.length) return [];

  const [rule, list] = groups.sort((a, b) => b[1].length - a[1].length)[0];
  const files = new Set(list.map((f) => f.filePath).filter(Boolean));

  return [
    `Root cause: ${list.length} of these are the same defect (${rule}) across ${plural(
      files.size,
      "file"
    )} — one fix, not ${list.length}.`,
    "",
  ];
}

/** Who imports the matched files, from the retrieval index's import graph. */
function describeBlastRadius(ctx: TargetContext): string[] {
  const related = new Set<string>();
  for (const path of ctx.paths) {
    for (const other of ctx.retriever.relatedFiles(path)) related.add(other);
  }
  for (const path of ctx.paths) related.delete(path);
  if (!related.size) return [];

  const lines = [
    `If you change this, ${plural(related.size, "file")} import it or are imported by it:`,
  ];
  for (const file of [...related].slice(0, 6)) lines.push(`• ${file}`);
  if (related.size > 6) lines.push(`• …and ${related.size - 6} more`);
  lines.push("");
  return lines;
}

/** How to prove a fix worked — one hint per distinct rule, plus coverage gaps. */
function describeVerification(ctx: TargetContext): string[] {
  if (!ctx.scoped.length) return [];

  const lines = ["How to verify a fix:"];
  const seen = new Set<string>();
  for (const finding of ctx.scoped.slice(0, 4)) {
    const hint = verifyFor(finding);
    if (seen.has(hint)) continue;
    seen.add(hint);
    lines.push(`• ${hint}`);
  }

  const uncovered = ctx.report.testing.criticalUncovered.filter((area) =>
    [...ctx.paths].some((path) => path.includes(area))
  );
  if (uncovered.length) {
    lines.push(
      `• These areas have no test coverage at all: ${uncovered.join(", ")} — write the test before the fix, so you can see it fail.`
    );
  }
  lines.push("");
  return lines;
}

/** What the answer was built from, and where it stops. */
function describeEvidence(ctx: TargetContext): string[] {
  const lines = [
    `Evidence: ${plural(ctx.sites.length, "match", "matches")} across ${plural(
      ctx.paths.size,
      "file"
    )}, ${plural(ctx.scoped.length, "finding")} from the static analyzers. Every claim above cites a file and line.`,
  ];
  if (ctx.lead.role === "test") {
    lines.push(
      "Only tests matched this question, so the behaviour described is what the tests assert — the implementation may live elsewhere."
    );
  }
  return lines;
}

/**
 * The targeted answer: this code, its defects, the repair, and the blast radius.
 *
 * Split into one builder per section so each can be read and tested on its own —
 * this function previously carried all six inline at a cyclomatic complexity of
 * 19, which the quality analyzer (correctly) reported.
 */
export function diagnoseTarget(
  report: Report,
  question: string,
  retriever: Retriever,
  results: Retrieved[]
): Diagnosis {
  const ctx = buildTargetContext(report, question, retriever, results);

  const lines = [
    ...describeSite(ctx.lead, question),
    ...describeDefects(ctx),
    ...describeRootCause(ctx),
    ...describeBlastRadius(ctx),
    ...describeVerification(ctx),
    ...describeEvidence(ctx),
  ];

  return {
    answer: lines.join("\n").trim(),
    sources: [ctx.lead, ...ctx.sites.filter((s) => s !== ctx.lead)]
      .slice(0, 6)
      .map((s) => `${s.chunk.path}:${s.chunk.startLine}`),
    intent: "code",
    groundedIn: ctx.sites.length,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Answer a question about the repository.
 *
 * With retrieved chunks it diagnoses those files. Without — or when the caller
 * asks for a repository-wide view — it diagnoses the whole report. The choice is
 * made from evidence, not from the wording of the question: if nothing was
 * retrieved, there is nothing specific to diagnose.
 */
export function diagnose(input: DiagnosisInput): Diagnosis {
  const { report, question, retriever, results } = input;
  if (!results.length) return diagnoseRepo(report, question);
  return diagnoseTarget(report, question, retriever, results);
}

/**
 * A diagnosis scoped to one category — "what are the biggest security risks".
 *
 * Same evidence and same ordering as the repository view, but the headline is
 * the category's own score rather than the overall grade, and the systemic
 * patterns are drawn only from that category.
 */
export function diagnoseCategory(report: Report, category: Category): Diagnosis {
  const findings = report.findings.filter((f) => f.category === category);
  return diagnoseRepo(report, "", {
    findings,
    subject: CATEGORIES[category]?.label ?? category,
  });
}

/** Category label for a finding, used by the UI when grouping. */
export function categoryLabel(f: Finding): string {
  return CATEGORIES[f.category]?.label ?? f.category;
}
