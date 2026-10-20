import { test } from "node:test";
import assert from "node:assert/strict";
import type { Finding, Report } from "../types";
import {
  gradeOf,
  rankedFindings,
  severityCounts,
  summaryExcerpt,
  systemicFixes,
  topFindings,
  verificationOf,
  verdictOf,
} from "../pdf";

/**
 * The printed report makes claims, so the shaping has to be tested as carefully
 * as the analysis: which findings are shown, in what order, and — most
 * importantly — what the document is allowed to say was verified.
 */

let seq = 0;
function finding(over: Partial<Finding> & { title: string }): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    category: "bugs",
    severity: "high",
    description: "Something is wrong.",
    recommendation: "Fix it.",
    confidence: 0.8,
    source: "static-analysis",
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    id: "an_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1200,
    repo: { fullName: "acme/app", name: "app", defaultBranch: "main" },
    languages: [],
    structure: { fileCount: 10, dirCount: 3, totalBytes: 4096 },
    healthScore: 78,
    scores: [],
    findings: [],
    dependencies: { stat: { total: 4, healthy: 3, outdated: 1, vulnerable: 0, unused: 0, unknown: 0 } },
    testing: { testFiles: 1, sourceFiles: 10, ratio: 0.1, frameworks: [], hasTestDir: true, criticalUncovered: [], areas: [] },
    architecture: { summary: "Layered." },
    recommendations: [],
    summary: "First sentence. Second sentence. Third sentence.",
    stats: { filesAnalyzed: 10, bytesAnalyzed: 4096, apiCalls: 0, sourceFilesSampled: 10, indexedChunks: 20 },
    ...over,
  } as unknown as Report;
}

test("severity counts ignore informational findings", () => {
  const counts = severityCounts([
    finding({ title: "a", severity: "critical" }),
    finding({ title: "b", severity: "high" }),
    finding({ title: "c", severity: "medium" }),
    finding({ title: "d", severity: "low" }),
    finding({ title: "e", severity: "info" }),
  ]);
  assert.deepEqual(counts, { critical: 1, high: 1, medium: 1, low: 1, total: 4 });
});

test("shipping code outranks a test fixture at the same severity", () => {
  const ranked = rankedFindings([
    finding({ title: "in test", filePath: "src/lib/__tests__/x.test.ts" }),
    finding({ title: "in src", filePath: "src/lib/x.ts" }),
  ]);
  assert.equal(ranked[0].title, "in src");
});

test("severity wins before file location", () => {
  const ranked = rankedFindings([
    finding({ title: "medium src", severity: "medium", filePath: "src/a.ts" }),
    finding({ title: "critical test", severity: "critical", filePath: "src/__tests__/b.test.ts" }),
  ]);
  assert.equal(ranked[0].title, "critical test", "a critical test fixture still outranks a medium bug");
});

test("the printed findings carry the fields the page needs", () => {
  const [f] = topFindings(
    report({
      findings: [
        finding({
          title: "Empty catch",
          filePath: "src/a.ts",
          lineStart: 12,
          description: "Swallows the error.\n\n_Rule: empty-catch_",
          impact: "Failures vanish.",
          evidence: "} catch {",
        }),
      ],
    }),
    5
  );
  assert.equal(f.rank, 1);
  assert.equal(f.filePath, "src/a.ts");
  assert.equal(f.lineStart, 12);
  assert.ok(!f.what.includes("_Rule:"), "the internal rule marker must not print");
  assert.equal(f.why, "Failures vanish.");
  assert.equal(f.rule, "empty-catch");
  assert.ok(f.fix && f.fix.length > 10, "a repair must be present");
});

test("repeated rules collapse into one systemic fix", () => {
  const r = report({
    findings: [
      finding({ title: "Empty catch", filePath: "src/a.ts", description: "_Rule: empty-catch_" }),
      finding({ title: "Empty catch", filePath: "src/b.ts", description: "_Rule: empty-catch_" }),
      finding({ title: "Empty catch", filePath: "src/c.ts", description: "_Rule: empty-catch_" }),
      finding({ title: "Lonely", filePath: "src/d.ts", description: "_Rule: lonely_" }),
    ],
  });
  const fixes = systemicFixes(r, 3);
  assert.equal(fixes.length, 1, "a rule that fires once is not systemic");
  assert.equal(fixes[0].count, 3);
  assert.equal(fixes[0].files, 3);
});

test("the report never claims a fix was applied or verified", () => {
  // The analysis reads code; it cannot change or re-test it.
  const v = verificationOf(
    report({
      findings: [
        finding({ title: "a", isPotential: true }),
        finding({ title: "b", isPotential: false }),
      ],
    })
  );
  assert.equal(v.detected, 2);
  assert.equal(v.heuristic, 1);
  assert.equal(v.confirmed, 1);
  assert.equal(v.fixesApplied, 0);
  assert.equal(v.fixesVerified, 0);
});

test("the verdict names the most severe problem that exists", () => {
  const critical = severityCounts([finding({ title: "a", severity: "critical" })]);
  assert.match(verdictOf(report(), critical), /critical finding must be resolved/);

  const high = severityCounts([finding({ title: "a", severity: "high" })]);
  assert.match(verdictOf(report(), high), /No critical issues/);

  const none = severityCounts([]);
  assert.match(verdictOf(report(), none), /not a proof of correctness/);
});

test("the summary excerpt stops after the requested sentences", () => {
  assert.equal(summaryExcerpt(report(), 2), "First sentence. Second sentence.");
});

test("grades map to the score bands", () => {
  assert.equal(gradeOf(95), "A");
  assert.equal(gradeOf(84), "B");
  assert.equal(gradeOf(71), "C");
  assert.equal(gradeOf(60), "D");
  assert.equal(gradeOf(41), "E");
});

test("the printed list shows distinct problems, not the same one repeatedly", () => {
  // A raw severity sort printed "complex function" three times and pushed
  // everything else off the page.
  const r = report({
    findings: [
      finding({ title: "Complex function", filePath: "src/a.ts", description: "_Rule: complex_" }),
      finding({ title: "Complex function", filePath: "src/b.ts", description: "_Rule: complex_" }),
      finding({ title: "Complex function", filePath: "src/c.ts", description: "_Rule: complex_" }),
      finding({ title: "Empty catch", filePath: "src/d.ts", description: "_Rule: empty-catch_" }),
    ],
  });
  const top = topFindings(r, 5);
  assert.equal(top.length, 2, "three instances of one rule is one entry");
  assert.equal(top[0].title, "Complex function");
  assert.equal(top[0].occurrences, 3);
  assert.equal(top[0].files, 3);
  assert.equal(top[1].occurrences, 1);
});

test("a one-off finding still reports a prevalence of one", () => {
  const [f] = topFindings(
    report({ findings: [finding({ title: "Only once", filePath: "src/a.ts" })] }),
    5
  );
  assert.equal(f.occurrences, 1);
  assert.equal(f.files, 1);
});
