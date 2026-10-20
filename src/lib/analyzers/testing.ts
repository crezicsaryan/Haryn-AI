import type { RawFinding, SourceFile } from "./types";
import type { TestingAnalysis } from "../types";

const TEST_PATH_RE =
  /(^|\/)(__tests__|tests?|spec|e2e|integration|cypress|playwright)\/|\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)$|^test_.*\.py$|Test\.java$|\.Tests\.cs$/i;

const FRAMEWORK_SIGNATURES: { name: string; re: RegExp }[] = [
  { name: "Jest", re: /\bjest\b/ },
  { name: "Vitest", re: /\bvitest\b/ },
  { name: "Mocha", re: /\bmocha\b/ },
  { name: "Jasmine", re: /\bjasmine\b/ },
  { name: "AVA", re: /\bava\b/ },
  { name: "Playwright", re: /@playwright\/test/ },
  { name: "Cypress", re: /\bcypress\b/ },
  { name: "Testing Library", re: /@testing-library/ },
  { name: "pytest", re: /\bpytest\b/ },
  { name: "unittest", re: /\bunittest\b/ },
  { name: "RSpec", re: /\brspec\b/ },
  { name: "JUnit", re: /\bjunit\b/ },
  { name: "Go testing", re: /\bgo test\b/ },
  // Node's built-in runner: no dependency to detect, so the import is the only
  // signal. Without it a repository with a full node:test suite reported
  // "frameworks: none" next to its own test count.
  { name: "node:test", re: /["']node:test["']|\bnode\s+--test\b/ },
];

/** Domains we treat as business-critical when judging test coverage. */
const CRITICAL_DOMAINS = [
  "auth", "authentication", "login", "session", "payment", "billing",
  "checkout", "order", "user", "account", "invoice", "transaction",
  "permission", "role", "security", "admin",
];

export function isTestPath(path: string): boolean {
  return TEST_PATH_RE.test(path);
}

export interface TestingResult {
  analysis: TestingAnalysis;
  findings: RawFinding[];
}

export function analyzeTesting(args: {
  allPaths: string[];
  sourceFiles: SourceFile[];
  manifestText: Record<string, string>;
}): TestingResult {
  const { allPaths, sourceFiles, manifestText } = args;

  const testPaths = allPaths.filter(isTestPath);
  const sourcePaths = allPaths.filter(
    (p) => !isTestPath(p) && /\.(js|jsx|ts|tsx|mjs|cjs|py|java|go|rb|php|cs|kt|swift|rs|vue|svelte)$/i.test(p)
  );

  const testFiles = testPaths.length;
  const sourceFilesCount = sourcePaths.length;
  const ratio = sourceFilesCount ? testFiles / sourceFilesCount : 0;

  const hasTestDir = allPaths.some((p) =>
    /(^|\/)(__tests__|tests?|spec)\//i.test(p)
  );

  // Framework detection from manifests and test file contents.
  const corpus = [
    ...Object.values(manifestText),
    ...sourceFiles.filter((f) => isTestPath(f.path)).map((f) => f.content.slice(0, 4000)),
  ].join("\n");
  const frameworks = FRAMEWORK_SIGNATURES.filter((s) => s.re.test(corpus)).map((s) => s.name);

  // Which critical domains exist, and are they covered by any test path?
  const domains = new Set<string>();
  for (const p of sourcePaths) {
    const lower = p.toLowerCase();
    for (const d of CRITICAL_DOMAINS) {
      if (lower.includes(d)) domains.add(d);
    }
  }

  const areas: TestingAnalysis["areas"] = [];
  const criticalUncovered: string[] = [];
  for (const d of [...domains].sort()) {
    const covered = testPaths.some((p) => p.toLowerCase().includes(d));
    if (covered) {
      areas.push({ name: d, status: "ok", note: "Tests detected alongside this module" });
    } else {
      criticalUncovered.push(d);
      areas.push({
        name: d,
        status: "risk",
        note: "Business-critical module with no matching test file",
      });
    }
  }

  const findings: RawFinding[] = [];

  if (sourceFilesCount > 0 && testFiles === 0) {
    findings.push({
      category: "testing",
      severity: "high",
      title: "No tests detected",
      description:
        "No test files were found anywhere in the repository. Every change is currently unverified, so regressions can only be caught in production.",
      recommendation:
        "Introduce a test runner and start with the highest-risk modules — authentication, payments and data access.",
      impact: "Regressions reach users directly; refactoring becomes unsafe.",
      confidence: 0.9,
      source: "static-analysis",
    });
  } else if (ratio < 0.1 && sourceFilesCount > 8) {
    findings.push({
      category: "testing",
      severity: "medium",
      title: "Low test-to-source ratio",
      description: `Only ${testFiles} test file(s) for ${sourceFilesCount} source files (≈${(ratio * 100).toFixed(1)}%). Large parts of the codebase appear untested.`,
      recommendation:
        "Raise coverage incrementally, prioritising critical paths, and add a coverage gate to CI.",
      impact: "Defects are more likely to slip through review.",
      evidence: `${testFiles} test files / ${sourceFilesCount} source files`,
      confidence: 0.7,
      source: "static-analysis",
      isPotential: true,
    });
  }

  if (criticalUncovered.length) {
    findings.push({
      category: "testing",
      severity: criticalUncovered.length >= 3 ? "high" : "medium",
      title: "Critical modules without tests",
      description: `Business-critical areas have no matching test files: ${criticalUncovered
        .slice(0, 6)
        .join(", ")}.`,
      recommendation:
        "Add focused unit and integration tests for these modules before making further changes.",
      impact: "High-blast-radius code paths are unverified.",
      evidence: criticalUncovered.join(", "),
      confidence: 0.6,
      source: "static-analysis",
      isPotential: true,
    });
  }

  if (!hasTestDir && testFiles > 0) {
    findings.push({
      category: "testing",
      severity: "low",
      title: "No dedicated test directory",
      description:
        "Tests exist but are scattered rather than organised in a conventional tests/ directory.",
      recommendation: "Adopt a consistent test layout so suites are easy to find and run.",
      impact: "Discoverability of tests suffers.",
      confidence: 0.6,
      source: "static-analysis",
      isPotential: true,
    });
  }

  return {
    analysis: {
      testFiles,
      sourceFiles: sourceFilesCount,
      ratio,
      frameworks,
      hasTestDir,
      criticalUncovered,
      areas,
    },
    findings,
  };
}
