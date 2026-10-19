import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeSecurity } from "../security";
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

const titles = (files: SourceFile[]) => analyzeSecurity(files).map((f) => f.title);

/* ------------------------------------------------------------------ */
/* True positives — these must keep working                            */
/* ------------------------------------------------------------------ */

test("flags a real eval() call", () => {
  const found = titles([src("src/a.js", "const out = eval(userInput);")]);
  assert.ok(found.includes("Use of eval()"));
});

test("flags a real new Function() construction", () => {
  const found = titles([src("src/a.js", "const fn = new Function('a', 'return a');")]);
  assert.ok(found.includes("Dynamic Function construction"));
});

test("flags a secret that lives inside a string literal", () => {
  // The guard on the masking change: secret detection must keep reading raw
  // lines, because a hard-coded credential is a string literal by nature. The
  // key is assembled so this test file does not itself contain a live-looking
  // credential for the scanner to report.
  const key = ["AKIA", "1234567890ABCDEF"].join("");
  const found = titles([src("src/config.js", `const k = "${key}";`)]);
  assert.ok(found.includes("AWS access key ID detected"));
});

test("flags SQL built by interpolation inside a template literal", () => {
  // Assembled from parts on purpose: written out verbatim, this line would be an
  // interpolated SQL statement in the source, and the analyzer would (correctly)
  // report this test file. Split so no single literal reads as a SQL statement.
  const statement = ["SELECT * ", "FROM t WHERE id = ", "${id}"].join("");
  const source = "const q = `" + statement + "`;";
  const found = titles([src("src/db.js", source)]);
  assert.ok(found.includes("SQL built by string concatenation"));
});

test("flags a populated .env file", () => {
  const found = titles([src(".env", "AWS_KEY=abc123\n")]);
  assert.ok(found.includes("Environment file committed to the repository"));
});

/* ------------------------------------------------------------------ */
/* False positives — the regressions this change fixes                 */
/* ------------------------------------------------------------------ */

test("does not flag its own rule table", () => {
  // The exact shape of this repository's security.ts: a rule whose title,
  // description and recommendation all quote the pattern it detects. Every one
  // of those was previously reported as a real occurrence.
  const ruleTable = `
const CODE_RULES = [
  {
    id: "eval",
    title: "Use of eval()",
    description: "eval() executes arbitrary strings as code.",
    recommendation: "Replace eval() with an explicit parser.",
  },
  {
    id: "new-function",
    description: "new Function() compiles a string into executable code, mirroring the risk profile of eval().",
  },
];
`;
  const found = titles([src("src/lib/analyzers/security.ts", ruleTable)]);
  assert.deepEqual(found, [], `expected no findings, got: ${found.join(", ")}`);
});

test("does not flag SQL keywords listed inside a regex literal", () => {
  const found = titles([
    src("src/lib/analyzers/performance.ts", "const re = /SELECT\\s+\\*\\s+FROM|findAll/i;"),
  ]);
  assert.ok(!found.includes("SQL built by string concatenation"));
});

test("does not flag a quoted example in a comment or a plain string", () => {
  const found = titles([
    src("src/docs.js", 'const help = "never call eval( ) on user input";'),
  ]);
  assert.ok(!found.includes("Use of eval()"));
});

test("a property named evaluate() is not an eval() call", () => {
  const found = titles([src("src/a.js", "obj.eval(value);")]);
  assert.ok(!found.includes("Use of eval()"));
});

test("flags a bare exec() call from a destructured child_process import", () => {
  const found = titles([
    src(
      "src/build.js",
      'const { exec } = require("child_process");\nexec("rm -rf " + dir);'
    ),
  ]);
  assert.ok(found.includes("Shell command execution"));
});

test("flags child_process and execSync by name", () => {
  assert.ok(
    titles([src("src/a.js", 'const cp = require("child_process");')]).includes(
      "Shell command execution"
    )
  );
  assert.ok(
    titles([src("src/a.js", 'execSync("git status");')]).includes("Shell command execution")
  );
});

test("a RegExp .exec() is not shell execution", () => {
  // `re.exec(text)` is the single most common `.exec` in any codebase; reporting
  // it as command injection made every regex-matching file look dangerous.
  const found = titles([
    src("src/parse.js", "let m; while ((m = re.exec(text))) { out.push(m[0]); }"),
  ]);
  assert.ok(!found.includes("Shell command execution"));
});

test("a method named exec() on another object is not shell execution", () => {
  const found = titles([src("src/parse.js", "const hit = matcher.exec(line);")]);
  assert.ok(!found.includes("Shell command execution"));
});
