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

/**
 * The rule that produced a finding.
 *
 * Analyzers record it as a trailing `_Rule: id_` marker inside the description.
 * Parsing it back out is how systemic patterns are found — twelve instances of
 * one rule is one bug to fix, not twelve — and it works for reports that were
 * stored before any rule-id field existed.
 */
export function ruleIdOf(f: Finding): string | null {
  const m = /_Rule:\s*([a-z0-9-]+)_/i.exec(f.description);
  return m ? m[1] : null;
}

/** The description without the internal rule marker, for display. */
function proseOf(f: Finding): string {
  return f.description.replace(/\n*_Rule:[^_]*_\s*$/i, "").trim();
}

/* ------------------------------------------------------------------ */
/* Repair guidance                                                     */
/* ------------------------------------------------------------------ */

/**
 * Concrete repair steps per rule.
 *
 * The analyzers already carry a `recommendation`, but it is written for a
 * summary card — short and generic. A diagnosis has to be actionable, so the
 * common rules get a specific instruction and a way to prove the fix worked.
 * Anything not listed here falls back to the analyzer's own recommendation,
 * which is still correct, just less pointed.
 */
const RULE_GUIDE: Record<string, { fix: string; verify: string }> = {
  "off-by-one-loop-bound": {
    fix: "Change `<=` to `<`. If you only need the values, drop the index entirely: `for (const item of items)`.",
    verify: "Add a test that passes an empty collection and one with a single element — both catch this immediately.",
  },
  "assignment-in-condition": {
    fix: "Use `===` for the comparison. If the assignment really was intended, move it to its own line and test the variable.",
    verify: "Write a case where the assigned value is falsy — a plain assignment makes that branch unreachable.",
  },
  "empty-catch": {
    fix: "Log or rethrow: `catch (err) { logger.error(err); throw err; }`. Only swallow it if the failure is genuinely irrelevant, and say why in a comment.",
    verify: "Force the throw (mock the failing call) and assert that the error is reported rather than silently dropped.",
  },
  "swallowed-exception": {
    fix: "Handle the exception: log it with context, or rethrow. A bare `pass` / empty block hides the failure.",
    verify: "Trigger the exception in a test and assert that it surfaces.",
  },
  "bare-except": {
    fix: "Catch the specific exception type instead of everything, and handle it.",
    verify: "Raise the unexpected exception and confirm it propagates.",
  },
  "unreachable-code": {
    fix: "Delete the dead statement, or move the early `return`/`throw` below the work it is skipping.",
    verify: "Cover the branch in a test — dead code is usually a return placed too high.",
  },
  "self-assignment": {
    fix: "Correct the right-hand side to the value that was meant, or delete the statement.",
    verify: "Assert the variable changes after the assignment.",
  },
  "async-in-map": {
    fix: "Await the batch: `await Promise.all(items.map(async (x) => ...))`. Or use `for (const x of items) { await fn(x); }` when the order matters.",
    verify: "Assert the resolved values, not the Promises — `expect(result[0]).toEqual(value)`, not `toBeInstanceOf(Promise)`.",
  },
  "async-in-foreach": {
    fix: "`forEach` ignores the returned Promise. Use `for (const x of items) { await fn(x); }` or `await Promise.all(items.map(...))`.",
    verify: "Assert that the work completed after the call resolves.",
  },
  "indexof-unchecked": {
    fix: "Compare against -1 before using the result, e.g. `if (i !== -1)`. Or use `includes()` when the index is not needed.",
    verify: "Pass a value that is absent and assert the code takes the not-found path.",
  },
  "unguarded-json-parse": {
    fix: "Wrap it: `try { return JSON.parse(raw); } catch { return fallback; }`.",
    verify: "Feed it malformed input and assert it degrades instead of throwing.",
  },
  "mutate-while-iterating": {
    fix: "Iterate a copy (`[...items]`), or collect the removals and apply them after the loop.",
    verify: "Remove the first and last element in a test — a shifting index skips one of them.",
  },
  "duplicate-branch-condition": {
    fix: "Two branches test the same condition, so the second can never run. Merge them, or fix the second condition.",
    verify: "Cover both branches; one of them is currently dead.",
  },
  "mutable-default-argument": {
    fix: "Default to `None` and create the value inside the function: `def f(x=None): x = x if x is not None else []`.",
    verify: "Call the function twice without the argument and assert the first call's result was not mutated.",
  },
  "none-equality": {
    fix: "Use `is None` / `is not None` for the comparison.",
    verify: "Cover the None path explicitly.",
  },
  "return-in-finally": {
    fix: "A `return` inside `finally` discards the try's return value and any exception. Move it out of the block.",
    verify: "Make the try block throw and assert the exception is not swallowed.",
  },
  "string-reference-equality": {
    fix: "Use `===` (or `.equals()` in Java) for value comparison; `==` on objects compares identity.",
    verify: "Compare two equal strings built separately and assert they match.",
  },
  "unbounded-loop": {
    fix: "Add a bound or a break condition that is guaranteed to be reached.",
    verify: "Run it with input that would otherwise never terminate.",
  },

  /* Security */
  "sql-concat": {
    fix: "Use a parameterised query: `db.query('... WHERE id = $1', [id])`. Never interpolate values into SQL text.",
    verify: "Send a value containing a quote (`O'Brien`) and assert it is stored literally.",
  },
  "dangerous-html": {
    fix: "Render text instead of raw HTML, or sanitise with DOMPurify before assigning.",
    verify: "Submit `<img src=x onerror=alert(1)>` and assert it is escaped.",
  },
  eval: {
    fix: "Replace `eval` with an explicit parser or a dispatch table keyed by allowed names.",
    verify: "Pass input that is not a permitted expression and assert it is rejected.",
  },
  "new-function": {
    fix: "Use a static implementation, or an allow-list of operations, instead of compiling a string.",
    verify: "Pass unexpected input and assert no code runs.",
  },
  "child-process": {
    fix: "Use `execFile`/`spawn` with an argument array instead of a shell string, so values cannot be reinterpreted as commands.",
    verify: "Pass a value containing `;` or `&&` and assert it is treated as data.",
  },
  "tls-verify-off": {
    fix: "Remove the `rejectUnauthorized: false` / `verify=False` option. If a private CA is needed, trust that CA explicitly.",
    verify: "Connect to a host with an invalid certificate and assert the connection is refused.",
  },
  "insecure-random": {
    fix: "Use a cryptographic source for anything security-relevant: `crypto.randomUUID()` / `secrets.token_hex()`.",
    verify: "Assert the value is not predictable across runs.",
  },
  "weak-hash": {
    fix: "Use bcrypt/scrypt/argon2 for passwords, and SHA-256 or better for integrity.",
    verify: "Assert a stored password hash is salted and slow to compute.",
  },
  "cors-wildcard": {
    fix: "List the allowed origins explicitly instead of `*`, especially on authenticated endpoints.",
    verify: "Send a request from an unlisted origin and assert it is refused.",
  },
};

/**
 * Repair guidance for findings that carry no rule id.
 *
 * The quality analyzer reports by measurement ("this function is 120 lines")
 * rather than by rule, so its findings have no `_Rule:` marker to key on. The
 * title is stable and specific enough to map, and these four account for most
 * of the volume in a typical repository — which makes them the highest-value
 * fixes to explain well.
 */
const TITLE_GUIDE: Record<string, { fix: string; verify: string }> = {
  "Complex function": {
    fix: "Extract each branch into a named function so the caller reads as a list of steps. Target under 10 decision points; the worst offenders here are usually a long `if/else` chain that is really a lookup table.",
    verify: "Cover each extracted function on its own — the branch that is hardest to reach is the one most likely to be wrong.",
  },
  "Long function": {
    fix: "Split at the seams: every block with its own inputs and output becomes a function. Keep the original as a short orchestrator.",
    verify: "The behaviour must not change — run the existing tests before and after the split.",
  },
  "Very large file": {
    fix: "Split by responsibility, not by line count: one exported concept per file, with its helpers beside it.",
    verify: "Confirm the build and tests still pass, then check that imports did not become circular.",
  },
  "Large file": {
    fix: "Look for two responsibilities sharing a file and separate them. If it is one cohesive module, this is informational rather than a defect.",
    verify: "No behavioural test needed if nothing moved; re-run the suite after any split.",
  },
  "Duplicated code blocks": {
    fix: "Extract the repeated block into one function and call it from both sites. Parameterise the part that differs.",
    verify: "Both call sites must keep their current behaviour — test each one.",
  },
  "Debug statements left in source": {
    fix: "Remove `console.log` / `debugger`, or route them through a logger that is disabled in production.",
    verify: "Grep for the removed calls and confirm none remain in shipped paths.",
  },
  "Swallowed exception": {
    fix: "Log or rethrow instead of ignoring. If the failure is genuinely irrelevant, say so in a comment.",
    verify: "Force the exception and assert it surfaces.",
  },
};

function guideFor(f: Finding): { fix: string; verify: string } | null {
  const id = ruleIdOf(f);
  if (id && RULE_GUIDE[id]) return RULE_GUIDE[id];
  return TITLE_GUIDE[f.title] ?? null;
}

/** Fallback verification advice by category, when the rule has no entry. */
const VERIFY_BY_CATEGORY: Record<string, string> = {
  bugs: "Reproduce the path in a test before changing it — a fix you cannot demonstrate is a guess.",
  security: "Exercise the entry point with hostile input and assert it is rejected or escaped.",
  quality: "Cover the function with a test first, then refactor under it.",
  performance: "Measure before and after — this finding is about cost, not correctness.",
  testing: "Add the missing test; that is the fix.",
  dependency: "Upgrade and re-run the suite.",
  architecture: "Move the code, then confirm the build and tests still pass.",
  documentation: "Write the missing doc at the point of use.",
};

function fixFor(f: Finding): string | null {
  return guideFor(f)?.fix ?? f.recommendation?.trim() ?? null;
}

function verifyFor(f: Finding): string {
  return (
    guideFor(f)?.verify ??
    VERIFY_BY_CATEGORY[f.category] ??
    "Add a test that exercises the failing path."
  );
}

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

function describeSite(site: ExplainedSite, question: string): string[] {
  const out: string[] = [];
  const { chunk, role } = site;
  const meta = ROLE_META[role];

  const where = chunk.symbol
    ? `\`${chunk.symbol}\` — ${meta.label} in ${chunk.path} (line ${chunk.startLine})`
    : `${chunk.path} (line ${chunk.startLine}) — ${meta.label}`;

  /*
   * Retrieval always returns *something*, so the top chunk is not proof of
   * relevance. When none of the question's words occur in it, say "closest"
   * rather than "this is the answer" — otherwise the reader is told that an
   * unrelated file explains a feature the repository may not even have.
   */
  if (stemsOverlap(question, chunk)) {
    out.push(`This is ${where}. ${capitalise(meta.describes)}.`);
  } else {
    out.push(
      `The closest code I could find is ${where}. ${capitalise(meta.describes)}.`
    );
    out.push(
      "None of the terms in your question appear in it, so this is probably not what you asked about — the repository may not contain that feature. What follows is still what the analysis found there."
    );
  }

  const flow = site.calls.filter((c) => c !== chunk.symbol);
  if (flow.length) {
    out.push(
      flow.length === 1
        ? `It calls \`${flow[0]}\`.`
        : `Call order: ${flow.slice(0, 8).map((c) => `\`${c}\``).join(" → ")}.`
    );
  }
  if (site.externals.length) {
    out.push(`Depends on: ${site.externals.map((e) => `\`${e}\``).join(", ")}.`);
  }

  const sig = site.signals;
  const notable: string[] = [];
  if (sig.dbHints.length) notable.push(`data stores: ${sig.dbHints.join(", ")}`);
  if (sig.authWords.length) notable.push(`auth: ${sig.authWords.join(", ")}`);
  if (sig.env.length) notable.push(`env: ${sig.env.join(", ")}`);
  if (sig.statusCodes.length) {
    notable.push(
      `HTTP: ${sig.statusCodes
        .map((c) => (RESPONSE_MEANING[c] ? `${c} (${RESPONSE_MEANING[c]})` : `${c}`))
        .join(", ")}`
    );
  }
  if (notable.length) out.push(`Signals: ${notable.join("; ")}.`);

  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The targeted answer: this code, its defects, the repair, and the blast radius.
 */
export function diagnoseTarget(
  report: Report,
  question: string,
  retriever: Retriever,
  results: Retrieved[]
): Diagnosis {
  const sites = results.map((r) => explainChunk(r.chunk, question));
  sites.sort((a, b) => b.relevance - a.relevance);

  // Same rule as the descriptive path: implementation leads, tests do not.
  const lead = sites.find((s) => s.role !== "test") ?? sites[0];
  const paths = new Set(sites.map((s) => s.chunk.path));
  const scoped = findingsFor(report, paths);

  const lines: string[] = [];

  /* --- 1. Direct answer --------------------------------------------- */
  lines.push(...describeSite(lead, question));

  /* --- 2. Defects --------------------------------------------------- */
  if (scoped.length) {
    const criticals = scoped.filter(
      (f) => f.severity === "critical" || f.severity === "high"
    ).length;
    lines.push("");
    lines.push(
      `Problems found in ${paths.size === 1 ? "this file" : `these ${paths.size} files`}: ${plural(
        scoped.length,
        "finding"
      )}${criticals ? `, ${criticals} of them high or critical` : ""}.`
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
  } else {
    lines.push("");
    lines.push(
      "No static finding touches these files. That is a clean result for the rules that ran — it is not a guarantee: rules only catch patterns they know, and a defect in business logic is invisible to them."
    );
    lines.push("");
  }

  /* --- 3. Root cause when one rule repeats -------------------------- */
  const groups = [...byRule(scoped).entries()].filter(([, l]) => l.length > 1);
  if (groups.length) {
    const [rule, list] = groups.sort((a, b) => b[1].length - a[1].length)[0];
    const files = new Set(list.map((f) => f.filePath).filter(Boolean));
    lines.push(
      `Root cause: ${list.length} of these are the same defect (${rule}) across ${plural(
        files.size,
        "file"
      )} — one fix, not ${list.length}.`
    );
    lines.push("");
  }

  /* --- 4. Blast radius ---------------------------------------------- */
  const related = new Set<string>();
  for (const p of paths) {
    for (const r of retriever.relatedFiles(p)) related.add(r);
  }
  for (const p of paths) related.delete(p);
  if (related.size) {
    lines.push(
      `If you change this, ${plural(related.size, "file")} import it or are imported by it:`
    );
    for (const r of [...related].slice(0, 6)) lines.push(`• ${r}`);
    if (related.size > 6) lines.push(`• …and ${related.size - 6} more`);
    lines.push("");
  }

  /* --- 5. How to verify --------------------------------------------- */
  if (scoped.length) {
    lines.push("How to verify a fix:");
    const seen = new Set<string>();
    for (const f of scoped.slice(0, 4)) {
      const v = verifyFor(f);
      if (seen.has(v)) continue;
      seen.add(v);
      lines.push(`• ${v}`);
    }
    const uncovered = report.testing.criticalUncovered.filter((a) =>
      [...paths].some((p) => p.includes(a))
    );
    if (uncovered.length) {
      lines.push(
        `• These areas have no test coverage at all: ${uncovered.join(", ")} — write the test before the fix, so you can see it fail.`
      );
    }
    lines.push("");
  }

  /* --- 6. Evidence and limits --------------------------------------- */
  lines.push(
    `Evidence: ${plural(sites.length, "match", "matches")} across ${plural(
      paths.size,
      "file"
    )}, ${plural(scoped.length, "finding")} from the static analyzers. Every claim above cites a file and line.`
  );
  if (lead.role === "test") {
    lines.push(
      "Only tests matched this question, so the behaviour described is what the tests assert — the implementation may live elsewhere."
    );
  }

  return {
    answer: lines.join("\n").trim(),
    sources: [lead, ...sites.filter((s) => s !== lead)]
      .slice(0, 6)
      .map((s) => `${s.chunk.path}:${s.chunk.startLine}`),
    intent: "code",
    groundedIn: sites.length,
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
