import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../ai/chunk";
import type { Report } from "../types";
import type { Retriever, Retrieved } from "../ai/retrieve";
import {
  diagnose,
  diagnoseCategory,
  diagnoseRepo,
  ruleIdOf,
} from "../ai/diagnose";

/**
 * The diagnosis engine is the product's answer surface, so the tests pin the
 * *behaviour that makes an answer trustworthy*: it surfaces the finding that
 * exists, it does not claim relevance it lacks, it does not report a clean bill
 * of health, and it groups repeated defects into one root cause.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function chunk(over: Partial<Chunk> & { text: string; path: string }): Chunk {
  return {
    id: `${over.path}:1`,
    language: "TypeScript",
    symbol: null,
    kind: "function",
    startLine: 1,
    endLine: 20,
    imports: [],
    bytes: over.text.length,
    ...over,
  };
}

function retrieved(c: Chunk): Retrieved {
  return { chunk: c, score: 1, reasons: [] };
}

interface FindingOverrides {
  title: string;
  severity?: Report["findings"][number]["severity"];
  category?: Report["findings"][number]["category"];
  filePath?: string;
  lineStart?: number;
  rule?: string;
  description?: string;
  evidence?: string;
  impact?: string;
  recommendation?: string;
}

let findingSeq = 0;
function finding(o: FindingOverrides): Report["findings"][number] {
  findingSeq += 1;
  return {
    id: `f${findingSeq}`,
    category: o.category ?? "bugs",
    severity: o.severity ?? "high",
    title: o.title,
    description:
      (o.description ?? "Something is wrong here.") +
      (o.rule ? `\n\n_Rule: ${o.rule}_` : ""),
    filePath: o.filePath,
    lineStart: o.lineStart,
    evidence: o.evidence,
    impact: o.impact,
    recommendation: o.recommendation ?? "Fix it.",
    confidence: 0.85,
    source: "static-analysis",
    isPotential: true,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    id: "an_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    repo: {
      owner: "acme",
      name: "app",
      fullName: "acme/app",
      url: "https://github.com/acme/app",
      description: null,
      defaultBranch: "main",
      stars: 0,
      forks: 0,
      watchers: 0,
      openIssues: 0,
      license: null,
    },
    languages: [{ name: "TypeScript", percent: 100, bytes: 1000 }],
    structure: {
      fileCount: 12,
      dirCount: 4,
      totalBytes: 10_000,
      sizeClass: "Small",
      topLevelDirs: ["src"],
      extensionCounts: { ".ts": 12 },
      truncated: false,
    },
    healthScore: 72,
    scores: [
      { category: "security", label: "Security", score: 60, weight: 0.18, issueCount: 3 },
      { category: "bugs", label: "Bugs", score: 70, weight: 0.15, issueCount: 4 },
    ],
    findings: [],
    dependencies: {
      manifests: ["package.json"],
      items: [],
      stat: { total: 0, vulnerable: 0, outdated: 0, direct: 0, dev: 0 },
    } as unknown as Report["dependencies"],
    testing: {
      testFiles: 1,
      sourceFiles: 12,
      ratio: 0.08,
      frameworks: [],
      hasTestDir: true,
      criticalUncovered: [],
      areas: [],
    },
    architecture: { summary: "Layered.", nodes: [], edges: [] } as unknown as Report["architecture"],
    recommendations: [],
    summary: "A summary.",
    aiAvailable: true,
    stats: { filesAnalyzed: 12, bytesAnalyzed: 10_000, apiCalls: 0, sourceFilesSampled: 12, indexedChunks: 20 },
    ...over,
  } as Report;
}

function retriever(chunks: Chunk[], related: Record<string, string[]> = {}): Retriever {
  return {
    size: chunks.length,
    chunks,
    search: () => [],
    byPath: (p) => chunks.filter((c) => c.path === p),
    neighbours: () => [],
    relatedFiles: (p) => related[p] ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Rule ids                                                            */
/* ------------------------------------------------------------------ */

test("the rule id is recovered from the description marker", () => {
  const f = finding({ title: "Empty catch", rule: "empty-catch" });
  assert.equal(ruleIdOf(f), "empty-catch");
  assert.equal(ruleIdOf(finding({ title: "No rule" })), null);
});

/* ------------------------------------------------------------------ */
/* Targeted diagnosis                                                  */
/* ------------------------------------------------------------------ */

const AUTH = chunk({
  path: "src/lib/auth.ts",
  symbol: "requireAuth",
  text: [
    "import jwt from 'jsonwebtoken';",
    "export function requireAuth(req, res, next) {",
    "  const token = req.headers.authorization;",
    "  try { jwt.verify(token, process.env.JWT_SECRET); return next(); }",
    "  catch { return res.status(401).json({ error: 'unauthorized' }); }",
    "}",
  ].join("\n"),
});

test("the targeted answer surfaces the finding that exists in the file", () => {
  const r = report({
    findings: [
      finding({
        title: "Empty catch block swallows the error",
        filePath: "src/lib/auth.ts",
        lineStart: 5,
        rule: "empty-catch",
        evidence: "catch { return res.status(401) }",
        impact: "Failures become invisible.",
      }),
    ],
  });
  const d = diagnose({
    report: r,
    question: "How does authentication work?",
    retriever: retriever([AUTH]),
    results: [retrieved(AUTH)],
  });

  assert.match(d.answer, /This is `requireAuth`/, "must describe the matched code");
  assert.match(d.answer, /Empty catch block swallows the error/);
  assert.match(d.answer, /src\/lib\/auth\.ts:5/, "must cite the location");
  assert.match(d.answer, /Fix:/, "must tell the reader how to repair it");
  assert.match(d.answer, /What breaks:/, "must explain the failure");
});

test("a file with no findings is reported as clean for the rules, not as safe", () => {
  const d = diagnose({
    report: report(),
    question: "How does authentication work?",
    retriever: retriever([AUTH]),
    results: [retrieved(AUTH)],
  });
  assert.match(d.answer, /No static finding touches these files/);
  assert.match(d.answer, /not a guarantee/i, "must not claim the code is correct");
});

test("implementation leads even when a test scores higher", () => {
  const testFile = chunk({
    path: "src/lib/__tests__/auth.test.ts",
    symbol: "authentication work",
    text: "test('authentication work', () => { expect(requireAuth).toThrow(); });",
  });
  const d = diagnose({
    report: report(),
    question: "how does authentication work",
    retriever: retriever([testFile, AUTH]),
    results: [retrieved(testFile), retrieved(AUTH)],
  });
  const first = d.answer.split("\n")[0];
  assert.match(first, /requireAuth/, "must open on the implementation");
  assert.ok(!/__tests__/.test(first), `must not open on a test: ${first}`);
});

test("an unrelated match is called the closest code, not the answer", () => {
  const unrelated = chunk({
    path: "src/app/api/status/route.ts",
    symbol: "GET",
    text: "export async function GET() { return Response.json({ ok: true }); }",
  });
  const d = diagnose({
    report: report(),
    question: "Where is the Kubernetes deployment configured?",
    retriever: retriever([unrelated]),
    results: [retrieved(unrelated)],
  });
  assert.match(d.answer, /closest code I could find/i);
  assert.match(d.answer, /probably not what you asked about/i);
  assert.ok(!/^This is /m.test(d.answer), "must not assert relevance it lacks");
});

test("repeated defects in scope are named as one root cause", () => {
  const r = report({
    findings: [
      finding({ title: "Empty catch block swallows the error", filePath: "src/lib/auth.ts", lineStart: 5, rule: "empty-catch" }),
      finding({ title: "Empty catch block swallows the error", filePath: "src/lib/auth.ts", lineStart: 9, rule: "empty-catch" }),
      finding({ title: "Empty catch block swallows the error", filePath: "src/lib/auth.ts", lineStart: 14, rule: "empty-catch" }),
    ],
  });
  const d = diagnose({
    report: r,
    question: "How does authentication work?",
    retriever: retriever([AUTH]),
    results: [retrieved(AUTH)],
  });
  assert.match(d.answer, /Root cause: 3 of these are the same defect/);
  assert.match(d.answer, /one fix, not 3/);
});

test("the blast radius names the files that import the match", () => {
  const d = diagnose({
    report: report(),
    question: "How does authentication work?",
    retriever: retriever([AUTH], {
      "src/lib/auth.ts": ["src/routes/orders.ts", "src/routes/users.ts"],
    }),
    results: [retrieved(AUTH)],
  });
  assert.match(d.answer, /2 files import it or are imported by it/);
  assert.match(d.answer, /src\/routes\/orders\.ts/);
});

test("the answer states what it was based on", () => {
  const d = diagnose({
    report: report(),
    question: "How does authentication work?",
    retriever: retriever([AUTH]),
    results: [retrieved(AUTH)],
  });
  assert.match(d.answer, /Evidence: 1 match/);
  assert.match(d.answer, /cites a file and line/);
});

/* ------------------------------------------------------------------ */
/* Repository diagnosis                                                */
/* ------------------------------------------------------------------ */

function repoWith(findings: Report["findings"]): Report {
  return report({ findings });
}

test("the repository view orders findings by severity", () => {
  const r = repoWith([
    finding({ title: "Medium thing", severity: "medium", filePath: "src/a.ts", lineStart: 1 }),
    finding({ title: "Critical thing", severity: "critical", filePath: "src/b.ts", lineStart: 2 }),
    finding({ title: "High thing", severity: "high", filePath: "src/c.ts", lineStart: 3 }),
  ]);
  const d = diagnoseRepo(r, "what should I fix?");
  const criticalAt = d.answer.indexOf("Critical thing");
  const highAt = d.answer.indexOf("High thing");
  const mediumAt = d.answer.indexOf("Medium thing");
  assert.ok(criticalAt < highAt && highAt < mediumAt, "must lead with the worst");
});

test("the repository view counts what needs attention", () => {
  const r = repoWith([
    finding({ title: "A", severity: "critical", filePath: "src/a.ts" }),
    finding({ title: "B", severity: "high", filePath: "src/b.ts" }),
    finding({ title: "C", severity: "high", filePath: "src/c.ts" }),
  ]);
  const d = diagnoseRepo(r, "what is wrong?");
  assert.match(d.answer, /3 findings need attention: 1 critical, 2 high/);
  assert.match(d.answer, /72\/100/);
});

test("repeated rules are reported as a systemic pattern with one fix", () => {
  const r = repoWith([
    finding({ title: "Empty catch block swallows the error", filePath: "src/a.ts", rule: "empty-catch" }),
    finding({ title: "Empty catch block swallows the error", filePath: "src/b.ts", rule: "empty-catch" }),
    finding({ title: "Empty catch block swallows the error", filePath: "src/c.ts", rule: "empty-catch" }),
  ]);
  const d = diagnoseRepo(r, "what should I fix?");
  assert.match(d.answer, /Systemic patterns/);
  assert.match(d.answer, /3× Empty catch block swallows the error \(empty-catch\) across 3 files/);
  assert.match(d.answer, /Fix once:/);
});

test("the repository view gives an order to work in", () => {
  const r = repoWith([
    finding({ title: "Critical thing", severity: "critical", filePath: "src/a.ts" }),
    finding({ title: "High thing", severity: "high", filePath: "src/b.ts" }),
  ]);
  const d = diagnoseRepo(r, "what first?");
  assert.match(d.answer, /Fix order:/);
  assert.match(d.answer, /1 critical finding first/);
});

test("a clean repository is not described as correct", () => {
  const d = diagnoseRepo(report({ findings: [] }), "what is wrong?");
  assert.match(d.answer, /No actionable findings were detected/);
  assert.match(d.answer, /not proof of correctness/i);
});

/* ------------------------------------------------------------------ */
/* Category-scoped diagnosis                                           */
/* ------------------------------------------------------------------ */

test("a security question leads with the security score, not the overall one", () => {
  const r = report({
    findings: [
      finding({ title: "Hardcoded credential", category: "security", severity: "high", filePath: "src/x.ts" }),
      finding({ title: "Complex function", category: "quality", severity: "high", filePath: "src/y.ts" }),
    ],
  });
  const d = diagnoseCategory(r, "security");
  assert.match(d.answer, /Security in acme\/app/);
  assert.match(d.answer, /scores 60\/100/, "must quote the category score");
  assert.match(d.answer, /Hardcoded credential/);
  assert.ok(!/Complex function/.test(d.answer), "must not leak other categories");
});

test("the fix order starts at 1 even with no critical or high findings", () => {
  // Deriving the number from how many sections *should* print produced a list
  // beginning at "2." for a repository whose worst finding was medium.
  const r = repoWith([
    finding({ title: "Medium thing", severity: "medium", filePath: "src/a.ts", rule: "empty-catch" }),
    finding({ title: "Medium thing", severity: "medium", filePath: "src/b.ts", rule: "empty-catch" }),
  ]);
  const d = diagnoseRepo(r, "what should I fix?");
  assert.match(d.answer, /\n1\. The repeated pattern/);
  assert.ok(!/\n2\. The repeated pattern/.test(d.answer), "must not skip to 2");
});

test("dependencies are not spelled 'dependencys'", () => {
  const r = report({
    findings: [finding({ title: "A", filePath: "src/a.ts" })],
    dependencies: {
      manifests: ["package.json"],
      items: [],
      stat: { total: 16, vulnerable: 0, outdated: 0, direct: 0, dev: 0 },
    } as unknown as Report["dependencies"],
  });
  const d = diagnoseRepo(r, "what is wrong?");
  assert.match(d.answer, /16 dependencies/);
  assert.ok(!/dependencys/.test(d.answer));
});

test("a test fixture does not outrank shipping code at the same severity", () => {
  // A fake key in a test scored the same as a real one, and "what should I fix"
  // opened on the fixture instead of the bug.
  const r = repoWith([
    finding({ title: "Potential hardcoded credential", severity: "high", category: "security", filePath: "src/lib/__tests__/auth.test.ts", lineStart: 9 }),
    finding({ title: "Loop bound runs one past the end", severity: "high", filePath: "src/lib/auth.ts", lineStart: 12 }),
  ]);
  const d = diagnoseRepo(r, "what should I fix?");
  const implAt = d.answer.indexOf("Loop bound runs one past the end");
  const testAt = d.answer.indexOf("Potential hardcoded credential");
  assert.ok(implAt < testAt, "shipping code must come first");
  assert.match(d.answer, /1 of these are in test files/);
});
