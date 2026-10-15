import { test } from "node:test";
import assert from "node:assert/strict";

import { maskNonCode } from "../code-mask";

/**
 * Masking tests.
 *
 * The invariant that matters: the result must be the same length as the input,
 * so callers can keep reporting offsets against the original line.
 */

test("maskNonCode blanks a double-quoted string", () => {
  const line = 'const a = "eval(x)"; const b = 1;';
  const masked = maskNonCode(line);
  assert.equal(masked.length, line.length);
  assert.ok(!masked.includes("eval(x)"), "string body should be masked");
  assert.ok(masked.includes("const a ="), "code before the string survives");
  assert.ok(masked.includes("const b = 1;"), "code after the string survives");
});

test("maskNonCode blanks a single-quoted string", () => {
  const masked = maskNonCode("run('.map(async (x) => x)'); done();");
  assert.ok(!masked.includes(".map(async"));
  assert.ok(masked.includes("done();"));
});

test("maskNonCode blanks a template literal", () => {
  const masked = maskNonCode("const s = `hello ${name} world`;");
  assert.ok(!masked.includes("hello"));
  assert.ok(masked.includes("const s ="));
});

test("maskNonCode keeps template interpolations as code", () => {
  // `${ eval(x) }` is evaluated, so a code rule must still see it.
  const masked = maskNonCode("const s = `a${ eval(x) }b`;");
  assert.ok(masked.includes("eval(x)"), "interpolation is code");
  assert.ok(!masked.includes("`a"), "literal text is masked");
});

test("maskNonCode blanks line and block comments", () => {
  assert.ok(!maskNonCode("const a = 1; // eval(x)").includes("eval(x)"));
  assert.ok(!maskNonCode("const a = 1; /* eval(x) */ const b = 2;").includes("eval(x)"));
  assert.ok(maskNonCode("const a = 1; /* c */ const b = 2;").includes("const b = 2;"));
});

test("maskNonCode honours escaped quotes", () => {
  const line = 'const s = "a \\" eval(x) b"; tail();';
  const masked = maskNonCode(line);
  assert.ok(!masked.includes("eval(x)"), "the escaped quote must not end the string");
  assert.ok(masked.includes("tail();"));
});

test("maskNonCode leaves code-only lines untouched", () => {
  const line = "for (let i = 0; i <= arr.length; i++) {";
  assert.equal(maskNonCode(line), line);
});

test("maskNonCode does not treat an apostrophe in a comment as a string", () => {
  const line = "// don't run eval(x) here";
  const masked = maskNonCode(line);
  assert.equal(masked.trim(), "", "the whole comment is masked");
});

/* ------------------------------------------------------------------ */
/* Regex literals                                                      */
/* ------------------------------------------------------------------ */

test("maskNonCode blanks a regex literal", () => {
  const line = "const re = /\\b(if|else|for)\\b|&&|\\|\\|/g;";
  const masked = maskNonCode(line);
  assert.equal(masked.length, line.length);
  assert.ok(!masked.includes("if|else"), "the pattern body is masked");
  assert.ok(masked.includes("const re ="), "the declaration survives");
});

test("maskNonCode keeps the slashes of a division as code", () => {
  // `a / b` is division: treating it as a regex would mask the rest of the line
  // and silently stop checking real code.
  const line = "const ratio = total / count; if (a && b) go();";
  const masked = maskNonCode(line);
  assert.ok(masked.includes("total / count"), "division is left alone");
  assert.ok(masked.includes("if (a && b)"), "code after the division survives");
});

test("maskNonCode handles an escaped slash inside a regex", () => {
  const line = "const re = /a\\/b|c/; tail();";
  const masked = maskNonCode(line);
  assert.ok(!masked.includes("|c"), "the escaped slash does not end the pattern");
  assert.ok(masked.includes("tail();"));
});

test("maskNonCode does not end a regex at a slash inside a character class", () => {
  const line = "const re = /[/|]+/; tail();";
  const masked = maskNonCode(line);
  assert.ok(masked.includes("tail();"), "the class keeps the pattern open");
});

test("maskNonCode leaves strings intact when asked to", () => {
  // For rules whose subject lives in a string (SQL, hashes, headers) but which
  // must still not fire on a regex listing the same keywords.
  const line = "const q = `hello ${name}`; const re = /a|b|c/;";
  const masked = maskNonCode(line, { strings: false });
  assert.ok(masked.includes("hello"), "the string is preserved");
  assert.ok(!masked.includes("a|b|c"), "the regex is masked");
});
