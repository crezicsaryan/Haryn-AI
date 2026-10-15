import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeTesting, isTestPath } from "../testing";
import { languageForPath } from "../files";
import type { SourceFile } from "../types";

function src(path: string, content = ""): SourceFile {
  return {
    path,
    content,
    lines: content.split("\n"),
    language: languageForPath(path),
    bytes: content.length,
  };
}

const run = (allPaths: string[], manifestText: Record<string, string> = {}) =>
  analyzeTesting({ allPaths, sourceFiles: allPaths.map((p) => src(p)), manifestText });

const titles = (allPaths: string[], manifestText?: Record<string, string>) =>
  run(allPaths, manifestText).findings.map((f) => f.title);

/* ------------------------------------------------------------------ */
/* Test-file recognition — the paths a JavaScript/TypeScript project    */
/* actually uses                                                       */
/* ------------------------------------------------------------------ */

test("recognises the conventional test path shapes", () => {
  const recognised = [
    "src/lib/graph/__tests__/extract.test.ts",
    "src/lib/graph/__tests__/store.test.ts",
    "src/utils/parse.spec.ts",
    "tests/integration/login.ts",
    "test/unit/math.test.js",
    "e2e/checkout.spec.tsx",
    "pkg/service_test.go",
    "tests/test_models.py",
    "src/UserTest.java",
    "src/User.Tests.cs",
  ];
  for (const p of recognised) {
    assert.ok(isTestPath(p), `expected ${p} to be treated as a test path`);
  }
});

test("does not treat ordinary source files as tests", () => {
  for (const p of ["src/lib/store.ts", "src/components/Nav.tsx", "lib/contest.ts"]) {
    assert.ok(!isTestPath(p), `expected ${p} NOT to be treated as a test path`);
  }
});

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

test("reports no tests when none exist", () => {
  const found = titles(["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.ok(found.includes("No tests detected"));
});

test("counts a __tests__ directory as tests rather than reporting none", () => {
  const paths = [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/lib/graph/__tests__/extract.test.ts",
  ];
  const result = run(paths);
  assert.equal(result.analysis.testFiles, 1);
  assert.equal(result.analysis.hasTestDir, true);
  assert.ok(!result.findings.map((f) => f.title).includes("No tests detected"));
});

test("reports a low test-to-source ratio once tests exist but are thin", () => {
  const paths = Array.from({ length: 20 }, (_, i) => `src/mod${i}.ts`);
  paths.push("src/one.test.ts");
  const found = titles(paths);
  assert.ok(found.includes("Low test-to-source ratio"));
  assert.ok(!found.includes("No tests detected"));
});

test("reports critical domains with no matching test file", () => {
  const found = titles(["src/lib/analyzers/security.ts", "src/other.ts"]);
  assert.ok(found.includes("Critical modules without tests"));
});

test("clears the critical-domain finding when a matching test exists", () => {
  const paths = [
    "src/lib/analyzers/security.ts",
    "src/lib/analyzers/__tests__/security.test.ts",
  ];
  const result = run(paths);
  assert.deepEqual(result.analysis.criticalUncovered, []);
  assert.ok(!result.findings.map((f) => f.title).includes("Critical modules without tests"));
});

test("detects the test framework from the manifest", () => {
  // Assembled so this test file does not itself mention a framework name — the
  // detector reads the contents of test files, so a literal here would be
  // reported as the project's framework.
  const framework = ["vit", "est"].join("");
  const result = run(["src/a.ts", "src/a.test.ts"], {
    "package.json": `{"devDependencies":{"${framework}":"^2"}}`,
  });
  assert.ok(result.analysis.frameworks.includes("Vitest"));
});

test("flags tests that are not in a dedicated directory", () => {
  const found = titles(["src/a.ts", "src/thing.test.ts"]);
  assert.ok(found.includes("No dedicated test directory"));
});
