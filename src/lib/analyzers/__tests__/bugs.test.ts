import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeBugs } from "../bugs";
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

const titles = (code: string) => analyzeBugs([src("src/a.ts", code)]).map((f) => f.title);

const has = (code: string, title: string) => titles(code).includes(title);

/* ------------------------------------------------------------------ */
/* Off-by-one loop bound                                               */
/* ------------------------------------------------------------------ */

test("flags `i <= arr.length`", () => {
  assert.ok(has("for (let i = 0; i <= arr.length; i++) { use(arr[i]); }", "Loop bound runs one past the end"));
});

test("flags `i <= items.size`", () => {
  assert.ok(has("for (let i = 0; i <= items.size; i++) { }", "Loop bound runs one past the end"));
});

test("does not flag a compound bound that guarantees the window fits", () => {
  // The exact shape of quality.ts, which this rule used to report against
  // itself: `i + 6 <= lines.length` never reaches `length`.
  assert.ok(
    !has(
      "for (let i = 0; i + 6 <= file.lines.length; i++) { const w = file.lines.slice(i, i + 6); }",
      "Loop bound runs one past the end"
    )
  );
});

test("does not flag the inclusive-but-correct `<= length - 1`", () => {
  assert.ok(!has("for (let i = 0; i <= arr.length - 1; i++) { }", "Loop bound runs one past the end"));
});

test("does not flag a plain `<` bound", () => {
  assert.ok(!has("for (let i = 0; i < arr.length; i++) { }", "Loop bound runs one past the end"));
});

test("does not flag a bound on a different collection", () => {
  assert.ok(!has("for (let i = 0; i <= limit; i++) { }", "Loop bound runs one past the end"));
});

/* ------------------------------------------------------------------ */
/* Async callback in map / forEach                                     */
/* ------------------------------------------------------------------ */

test("flags a bare async map callback", () => {
  assert.ok(has("const out = rows.map(async (r) => enrich(r));", "Async callback passed to map()"));
});

test("flags a bare async forEach callback", () => {
  assert.ok(has("rows.forEach(async (r) => { await enrich(r); });", "Async callback passed to forEach()"));
});

test("does not flag map(async) handed to Promise.all on the same line", () => {
  assert.ok(
    !has("const out = await Promise.all(items.map(async (i) => fetch(i)));", "Async callback passed to map()")
  );
});

test("does not flag map(async) when Promise.all wraps it from the line above", () => {
  // The exact shape of dependencies.ts, which this rule used to report.
  const code = [
    "async function go(names) {",
    "  await Promise.all(",
    "    names.map(async (name) => {",
    "      return fetch(name);",
    "    })",
    "  );",
    "}",
  ].join("\n");
  assert.ok(!has(code, "Async callback passed to map()"));
});

test("does not flag Promise.allSettled either", () => {
  assert.ok(!has("await Promise.allSettled(items.map(async (i) => i));", "Async callback passed to map()"));
});

test("does not flag the pattern quoted inside a string literal", () => {
  // The exact shape of bugs.ts's own recommendation string, and of the sample
  // report fixture, both of which this rule used to report.
  const code = 'const tip = "Use `await Promise.all(items.map(async (x) => x))` instead.";';
  assert.ok(!has(code, "Async callback passed to map()"));

  const fixture = 'evidence: "await rows.forEach(async (row) => { await enrich(row); });",';
  assert.ok(!has(fixture, "Async callback passed to forEach()"));
});

/* ------------------------------------------------------------------ */
/* A pattern quoted inside a string is not the pattern                 */
/* ------------------------------------------------------------------ */

test("does not report bug patterns quoted inside string literals", () => {
  // A test fixture, a doc string or a rule's own description can legitimately
  // contain the text of a bug. None of these lines contains the construct.
  const cases: [string, string][] = [
    ['const t = "for (let i = 0; i <= arr.length; i++) {}";', "Loop bound runs one past the end"],
    ['const t = "try { go(); } catch (e) { }";', "Empty catch block swallows the error"],
    ['const t = "try { go(); } finally { return 1; }";', "return inside a finally block"],
    ['const t = "if (x = 1) { }";', "Assignment used as a condition"],
    ['const t = "const parsed = JSON.parse(raw);";', "JSON.parse outside a try block"],
    ['const t = "while (true) { }";', "while(true) loop with no exit condition"],
  ];
  for (const [code, title] of cases) {
    assert.ok(!has(code, title), `should not report "${title}" for: ${code}`);
  }
});

test("still reports those patterns when they are real code", () => {
  assert.ok(has("for (let i = 0; i <= arr.length; i++) {}", "Loop bound runs one past the end"));
  assert.ok(has("try { go(); } catch (e) { }", "Empty catch block swallows the error"));
  assert.ok(has("if (x = 1) { }", "Assignment used as a condition"));
});

test("still compares Java-style strings with == on the raw line", () => {
  // This rule depends on the quote characters, so it deliberately reads the
  // unmasked line — masking would remove the very token it looks for. It is also
  // Java/C#-only, hence the .java path.
  const fixture = ["if (name ", "==", ' "admin") { }'].join("");
  const found = analyzeBugs([src("src/A.java", fixture)]).map((f) => f.title);
  assert.ok(found.includes("Strings compared with == instead of .equals()"));
});

/* ------------------------------------------------------------------ */
/* Neighbouring rules must be unaffected                               */
/* ------------------------------------------------------------------ */

test("still flags an empty catch block", () => {
  assert.ok(has("try { go(); } catch (e) { }", "Empty catch block swallows the error"));
});

test("still flags a return inside finally", () => {
  assert.ok(has("try { go(); } finally {\n  return 1;\n}", "return inside a finally block"));
});

test("does not flag a caught error that is handled", () => {
  assert.ok(!has("try { go(); } catch (e) { log(e); }", "Empty catch block swallows the error"));
});
