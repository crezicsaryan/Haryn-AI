import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeQuality } from "../quality";
import { languageForPath } from "../files";
import type { SourceFile } from "../types";

function src(path: string, content: string): SourceFile {
  return {
    path,
    content,
    lines: content.split("\n"),
    language: languageForPath(path),
    bytes: content.length,
  };
}

const titles = (files: SourceFile[]) => analyzeQuality(files).map((f) => f.title);

test("reports a file that is far longer than the guideline", () => {
  const body = Array.from({ length: 900 }, (_, i) => `const v${i} = ${i};`).join("\n");
  assert.ok(titles([src("src/big.ts", body)]).includes("Very large file"));
});

test("reports a function with high cyclomatic complexity", () => {
  const branches = Array.from(
    { length: 40 },
    (_, i) => `  if (x > ${i}) { y += ${i}; }`
  ).join("\n");
  const code = `function messy(x) {\n  let y = 0;\n${branches}\n  return y;\n}\n`;
  assert.ok(titles([src("src/messy.ts", code)]).includes("Complex function"));
});

test("reports repeated debug logging in a non-test file", () => {
  const code = "console.log(1);\nconsole.log(2);\nconsole.log(3);\n";
  assert.ok(titles([src("src/a.ts", code)]).includes("Debug statements left in source"));
});

test("does not report debug logging inside a test file", () => {
  const code = "console.log(1);\nconsole.log(2);\nconsole.log(3);\n";
  assert.ok(!titles([src("src/a.test.ts", code)]).includes("Debug statements left in source"));
});

test("reports a block duplicated across files", () => {
  // The detector records at most one duplicate hit per file and needs two, so a
  // block must appear in three files before it is reported.
  const block = [
    "function shared(a, b) {",
    "  const first = a.trim().toLowerCase();",
    "  const second = b.trim().toLowerCase();",
    "  if (first === second) return true;",
    "  const merged = first.concat(second);",
    "  return merged.length > 0;",
    "}",
  ].join("\n");
  const found = titles([
    src("src/one.ts", block),
    src("src/two.ts", block),
    src("src/three.ts", block),
  ]);
  assert.ok(found.includes("Duplicated code blocks"));
});

test("a block appearing in only two files is below the reporting threshold", () => {
  const block = [
    "function shared(a, b) {",
    "  const first = a.trim().toLowerCase();",
    "  const second = b.trim().toLowerCase();",
    "  if (first === second) return true;",
    "  const merged = first.concat(second);",
    "  return merged.length > 0;",
    "}",
  ].join("\n");
  const found = titles([src("src/one.ts", block), src("src/two.ts", block)]);
  assert.ok(!found.includes("Duplicated code blocks"));
});

test("a clean small file produces no quality findings", () => {
  const code = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
  assert.deepEqual(titles([src("src/math.ts", code)]), []);
});
