import type { Finding } from "../types";

/**
 * Repair and verification guidance.
 *
 * Kept apart from the composer in `diagnose.ts` because this is reference data,
 * not logic: the analyzers say what is wrong, and this says what to do about it
 * and how to prove the fix worked. Growing this table is how the assistant gets
 * better at explaining a fix — it is the one place a domain answer can be added
 * without touching the analysis.
 *
 * Every entry has a `fix` and a `verify`. A fix you cannot demonstrate is a
 * guess, so a rule without a way to check it does not belong here.
 */

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

export function fixFor(f: Finding): string | null {
  const guide = guideFor(f);
  if (guide) return guide.fix;
  // `?? null` is not enough here: an empty string is not nullish, so a blank
  // recommendation would print an empty "Fix:" line that reads like advice.
  const recommendation = f.recommendation?.trim();
  return recommendation ? recommendation : null;
}

export function verifyFor(f: Finding): string {
  return (
    guideFor(f)?.verify ??
    VERIFY_BY_CATEGORY[f.category] ??
    "Add a test that exercises the failing path."
  );
}
