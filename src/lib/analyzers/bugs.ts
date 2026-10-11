import type { RawFinding, SourceFile } from "./types";
import { snippet } from "./types";

/**
 * Bug detection.
 *
 * Deliberately separate from the quality analyzer. Quality asks "is this hard to
 * maintain?"; this asks "will this behave incorrectly at runtime?" — a
 * different question with different evidence standards.
 *
 * Every rule here is written for **precision over recall**. A bug finder that
 * cries wolf gets ignored, so each pattern targets a construct that is almost
 * always wrong rather than merely suspicious, and carries an honest confidence
 * value. Findings are labelled `isPotential` because they are read statically.
 */

const BRACE_LANGS = new Set([
  "JavaScript",
  "TypeScript",
  "Java",
  "Kotlin",
  "C#",
  "C++",
  "C",
  "Go",
  "PHP",
  "Swift",
  "Dart",
  "Scala",
]);

/** Cap per rule per file — beyond this it is the same bug, not new ones. */
const MAX_PER_RULE_PER_FILE = 4;

interface Ctx {
  file: SourceFile;
  out: RawFinding[];
}

function push(
  ctx: Ctx,
  rule: string,
  finding: Omit<RawFinding, "category" | "source" | "isPotential"> & {
    title: string;
  }
): void {
  const already = ctx.out.filter(
    (f) => f.filePath === ctx.file.path && f.title === finding.title
  ).length;
  if (already >= MAX_PER_RULE_PER_FILE) return;

  ctx.out.push({
    category: "bugs",
    source: "static-analysis",
    isPotential: true,
    ...finding,
    description: `${finding.description}\n\n_Rule: ${rule}_`,
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return (
    !t ||
    t.startsWith("//") ||
    t.startsWith("#") ||
    t.startsWith("*") ||
    t.startsWith("/*")
  );
}

/** Index of the line that closes the block opened on `start`. */
function blockEnd(lines: string[], start: number, limit = 600): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length && i < start + limit; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") depth--;
    }
    if (opened && depth <= 0) return i;
  }
  return -1;
}

/** Line ranges that sit inside a `try` block (where throws are handled). */
function tryRanges(lines: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\}?\s*try\s*\{/.test(lines[i]) && !/\btry\s*\{\s*$/.test(lines[i])) {
      continue;
    }
    const end = blockEnd(lines, i);
    if (end > i) ranges.push([i, end]);
  }
  return ranges;
}

function inTry(ranges: [number, number][], line: number): boolean {
  return ranges.some(([a, b]) => line >= a && line <= b);
}

/* ------------------------------------------------------------------ */
/* Rules — brace languages                                             */
/* ------------------------------------------------------------------ */

function detectBraceLangs(ctx: Ctx): void {
  const { file } = ctx;
  const lines = file.lines;
  const tryBlocks = tryRanges(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    const ln = i + 1;

    /* --- Off-by-one loop bound ------------------------------------- */
    // `i <= arr.length` runs one past the end. `<= arr.length - 1` is correct
    // and is deliberately not matched.
    if (/<=\s*[\w.$[\]]*\.(?:length|size|count)\s*;/.test(line) && /\bfor\s*\(/.test(line)) {
      push(ctx, "off-by-one-loop-bound", {
        severity: "high",
        title: "Loop bound runs one past the end",
        description:
          "A `for` loop compares with `<=` against a collection's length or size. Because indices run `0..length-1`, the final iteration reads or writes one element past the end.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "Reads `undefined` (JavaScript) or throws an out-of-bounds error (Java, C#, C++).",
        recommendation:
          "Use `<` instead of `<=`, or `<= length - 1` if the inclusive form is intentional.",
        confidence: 0.75,
      });
    }

    /* --- Assignment inside a condition ----------------------------- */
    // `if (x = y)` — almost always a typo for `===`. Arrow functions (`=>`) and
    // all comparison operators are excluded by requiring a non-`=` after the `=`.
    if (/\b(if|while)\s*\(\s*[A-Za-z_$][\w$.\[\]]*\s*=\s*[^=]/.test(line)) {
      push(ctx, "assignment-in-condition", {
        severity: "high",
        title: "Assignment used as a condition",
        description:
          "A single `=` inside an `if`/`while` condition assigns rather than compares. The condition is then the assigned value's truthiness, which is usually not what was meant.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "The branch is taken based on the assigned value — often always true, or true when it should be false.",
        recommendation:
          "Use `===` (or `==` where coercion is intended). If assignment is deliberate, wrap it in extra parentheses to show intent.",
        confidence: 0.85,
      });
    }

    /* --- Empty catch ----------------------------------------------- */
    if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
      push(ctx, "empty-catch", {
        severity: "medium",
        title: "Empty catch block swallows the error",
        description:
          "An exception is caught and discarded with no handling, logging or rethrow. The failure disappears silently.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "Failures become invisible — the program continues in a broken state with no diagnostic trail.",
        recommendation:
          "Log the error with context, rethrow it, or convert it into a typed result the caller must handle.",
        confidence: 0.9,
      });
    } else if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/.test(line)) {
      // Multi-line: only whitespace or a comment before the closing brace.
      let j = i + 1;
      while (j < lines.length && isBlankOrComment(lines[j])) j++;
      if (lines[j]?.trim() === "}") {
        push(ctx, "empty-catch", {
          severity: "medium",
          title: "Empty catch block swallows the error",
          description:
            "An exception is caught and discarded with no handling, logging or rethrow.",
          filePath: file.path,
          lineStart: ln,
          lineEnd: j + 1,
          evidence: snippet(line),
          impact: "Failures become invisible with no diagnostic trail.",
          recommendation:
            "Log the error with context, rethrow it, or return a typed failure.",
          confidence: 0.85,
        });
      }
    }

    /* --- Unreachable code after return / throw --------------------- */
    if (/^\s*(return|throw)\b[^;]*;\s*$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && isBlankOrComment(lines[j])) j++;
      const next = lines[j]?.trim() ?? "";
      const isBoundary =
        !next ||
        next.startsWith("}") ||
        next.startsWith("case ") ||
        next.startsWith("default:") ||
        next.startsWith("catch") ||
        next.startsWith("finally") ||
        next.startsWith("else") ||
        next.startsWith(")") ||
        next.startsWith(".");
      if (!isBoundary && /^[A-Za-z_$[(]/.test(next)) {
        push(ctx, "unreachable-code", {
          severity: "medium",
          title: "Unreachable code after a return",
          description:
            "A statement follows an unconditional `return` or `throw` in the same block, so it can never execute.",
          filePath: file.path,
          lineStart: j + 1,
          evidence: snippet(lines[j]),
          impact:
            "Dead code — usually a sign the early return was placed too high, so intended work is skipped.",
          recommendation:
            "Move the early return below the statement, or delete the unreachable code.",
          confidence: 0.7,
        });
      }
    }

    /* --- Self-assignment ------------------------------------------- */
    const selfAssign = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*\1\s*;/.exec(line);
    if (selfAssign) {
      push(ctx, "self-assignment", {
        severity: "medium",
        title: "Value assigned to itself",
        description:
          "A statement assigns a variable to itself, which has no effect — the right-hand side was almost certainly meant to be something else.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact: "The intended assignment never happens.",
        recommendation: "Correct the right-hand side, or delete the statement.",
        confidence: 0.95,
      });
    }

    /* --- Async callback in map / forEach ---------------------------- */
    if (/\.map\(\s*async\b/.test(line)) {
      push(ctx, "async-in-map", {
        severity: "high",
        title: "Async callback passed to map()",
        description:
          "`map` with an `async` callback returns an array of pending Promises, not the resolved values. The array is almost always used as though it held data.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "Downstream code receives `Promise` objects — values are `undefined`, and rejections go unhandled.",
        recommendation:
          "Use `await Promise.all(items.map(async …))` when the results are needed, or `for…of` with `await` when they must run in order.",
        confidence: 0.8,
      });
    }

    if (/\.forEach\(\s*async\b/.test(line)) {
      push(ctx, "async-in-foreach", {
        severity: "high",
        title: "Async callback passed to forEach()",
        description:
          "`forEach` ignores the promise an `async` callback returns, so `await` inside it does not pause the outer function and rejections are never caught.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "The loop finishes before the work does; failures inside it are silently lost.",
        recommendation:
          "Use `for…of` with `await` for sequential work, or `await Promise.all(...)` for parallel work.",
        confidence: 0.85,
      });
    }

    /* --- return inside finally -------------------------------------- */
    if (/\bfinally\s*\{/.test(line)) {
      const end = blockEnd(lines, i);
      if (end > i) {
        for (let j = i + 1; j < end; j++) {
          if (/^\s*return\b/.test(lines[j])) {
            push(ctx, "return-in-finally", {
              severity: "high",
              title: "return inside a finally block",
              description:
                "A `return` in `finally` discards any exception or return value from the `try` block, silently swallowing errors.",
              filePath: file.path,
              lineStart: j + 1,
              evidence: snippet(lines[j]),
              impact:
                "Exceptions raised in `try` are replaced by this return value — real failures vanish.",
              recommendation:
                "Move the return out of `finally`; use it only for cleanup.",
              confidence: 0.9,
            });
            break;
          }
        }
      }
    }

    /* --- indexOf result used directly as an index -------------------- */
    if (/[\w.$[\]]+\[[^\]]*\.indexOf\(/.test(line)) {
      push(ctx, "indexof-unchecked", {
        severity: "medium",
        title: "indexOf() result used as an index without checking",
        description:
          "The result of `indexOf` indexes another collection directly. When the value is not found, `indexOf` returns `-1`, which resolves to the last element — or throws in stricter languages.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "Silently operates on the wrong element, or throws an index error.",
        recommendation:
          "Check the result against `-1` before using it, or use `find`/`findIndex` with a guard.",
        confidence: 0.7,
      });
    }

    /* --- JSON.parse outside try -------------------------------------- */
    if (/JSON\.parse\s*\(/.test(line) && !inTry(tryBlocks, i)) {
      push(ctx, "unguarded-json-parse", {
        severity: "low",
        title: "JSON.parse outside a try block",
        description:
          "`JSON.parse` throws on malformed input. This call is not inside a `try`, so a bad payload becomes an uncaught exception.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact: "Malformed input (a bad API response, a corrupt file) crashes the call site.",
        recommendation:
          "Wrap the parse in `try`/`catch` and return a fallback, or use a safe-parse helper.",
        confidence: 0.5,
      });
    }

    /* --- while (true) with no exit ---------------------------------- */
    if (/while\s*\(\s*true\s*\)/.test(line)) {
      const end = blockEnd(lines, i);
      const body = end > i ? lines.slice(i, end + 1).join("\n") : line;
      if (!/\b(break|return|throw)\b/.test(body)) {
        push(ctx, "unbounded-loop", {
          severity: "medium",
          title: "while(true) loop with no exit condition",
          description:
            "An unconditional loop contains no `break`, `return` or `throw`, so nothing in the body can end it.",
          filePath: file.path,
          lineStart: ln,
          evidence: snippet(line),
          impact:
            "Hangs the thread if the expected exit path (an exception, or a flag set elsewhere) never occurs.",
          recommendation:
            "Add an explicit exit condition, or a bounded iteration guard.",
          confidence: 0.5,
        });
      }
    }

    /* --- Duplicate branch condition ---------------------------------- */
    const branch = /^\s*\}?\s*(?:else\s+)?if\s*\((.+?)\)\s*\{?\s*$/.exec(line);
    if (branch) {
      const cond = branch[1].replace(/\s+/g, "");
      // Look ahead through the chain for the same condition.
      for (let j = i + 1; j < Math.min(lines.length, i + 120); j++) {
        const next = /^\s*\}?\s*(?:else\s+)?if\s*\((.+?)\)\s*\{?\s*$/.exec(lines[j]);
        if (!next) {
          if (/^\s*\}?\s*else\b/.test(lines[j])) continue;
          break;
        }
        if (next[1].replace(/\s+/g, "") === cond) {
          push(ctx, "duplicate-branch-condition", {
            severity: "medium",
            title: "Duplicate condition in an if / else-if chain",
            description:
              "The same condition appears twice in one `if`/`else if` chain, so the later branch is unreachable.",
            filePath: file.path,
            lineStart: j + 1,
            evidence: snippet(lines[j]),
            impact: "The duplicated branch can never run — its logic is dead.",
            recommendation: "Remove the duplicate branch, or correct its condition.",
            confidence: 0.8,
          });
          break;
        }
      }
    }

    /* --- Mutation of a collection being iterated --------------------- */
    const forOf = /for\s*\(\s*(?:const|let|var)\s+[\w$]+\s+of\s+([A-Za-z_$][\w$.]*)\s*\)/.exec(line);
    if (forOf) {
      const target = forOf[1];
      const end = blockEnd(lines, i);
      if (end > i) {
        const esc = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const mutates = new RegExp(
          `\\b${esc}\\s*\\.\\s*(push|pop|shift|unshift|splice|sort|reverse)\\s*\\(`
        );
        for (let j = i + 1; j < end; j++) {
          if (mutates.test(lines[j])) {
            push(ctx, "mutate-while-iterating", {
              severity: "high",
              title: "Collection mutated while being iterated",
              description:
                "A `for…of` loop mutates the same collection it is iterating. The iterator's position no longer matches the data, so elements are skipped or visited twice.",
              filePath: file.path,
              lineStart: j + 1,
              evidence: snippet(lines[j]),
              impact: "Elements silently skipped or processed twice — a classic source of intermittent bugs.",
              recommendation:
                "Iterate over a copy (`[...items]`), or collect changes and apply them after the loop.",
              confidence: 0.75,
            });
            break;
          }
        }
      }
    }

    /* --- String comparison with == (Java / C#) ----------------------- */
    if (file.language === "Java" || file.language === "C#") {
      if (/[A-Za-z_$][\w$]*\s*==\s*"/.test(line) || /"\s*==\s*[A-Za-z_$][\w$]*/.test(line)) {
        push(ctx, "string-reference-equality", {
          severity: "high",
          title: "Strings compared with == instead of .equals()",
          description:
            "In Java and C#, `==` compares object references, not string contents. Two equal strings are frequently different objects.",
          filePath: file.path,
          lineStart: ln,
          evidence: snippet(line),
          impact:
            "The comparison returns false for equal strings — a well-known source of production bugs.",
          recommendation:
            "Use `.equals()` (Java) or `==` on `string` with `string.Equals`/`==` operator semantics (C#); in Java prefer `Objects.equals(a, b)` when nulls are possible.",
          confidence: 0.8,
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rules — Python                                                      */
/* ------------------------------------------------------------------ */

function detectPython(ctx: Ctx): void {
  const { file } = ctx;
  const lines = file.lines;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    const ln = i + 1;

    /* --- Mutable default argument ---------------------------------- */
    if (/^\s*def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))/.test(line)) {
      push(ctx, "mutable-default-argument", {
        severity: "high",
        title: "Mutable default argument",
        description:
          "A list, dict or set is used as a default parameter value. Python evaluates defaults once at definition time, so the same object is shared across every call.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact:
          "State leaks between calls — the default accumulates data from unrelated invocations.",
        recommendation: "Default to `None` and create the container inside the function body.",
        confidence: 0.9,
      });
    }

    /* --- Bare except ------------------------------------------------ */
    if (/^\s*except\s*:/.test(line)) {
      push(ctx, "bare-except", {
        severity: "medium",
        title: "Bare except clause",
        description:
          "`except:` catches everything, including `KeyboardInterrupt` and `SystemExit`, which should normally propagate.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact: "The process cannot be interrupted cleanly, and real errors are hidden.",
        recommendation: "Catch a specific exception, or at minimum `except Exception:`.",
        confidence: 0.85,
      });
    }

    /* --- except: pass (swallowed) ----------------------------------- */
    const exc = /^\s*except\b[^:]*:\s*(.*)$/.exec(line);
    if (exc) {
      const inline = exc[1].trim();
      let swallowed = inline === "pass";
      if (!inline) {
        let j = i + 1;
        while (j < lines.length && isBlankOrComment(lines[j])) j++;
        swallowed = (lines[j]?.trim() ?? "") === "pass";
      }
      if (swallowed) {
        push(ctx, "swallowed-exception", {
          severity: "medium",
          title: "Exception caught and discarded with pass",
          description:
            "The handler does nothing, so the error leaves no trace and execution continues as if nothing failed.",
          filePath: file.path,
          lineStart: ln,
          evidence: snippet(line),
          impact: "Failures are invisible — the hardest class of bug to diagnose.",
          recommendation:
            "Log the exception (`logging.exception(...)`) or re-raise it with context.",
          confidence: 0.85,
        });
      }
    }

    /* --- Comparison with None using == ------------------------------ */
    if (/[!=]=\s*None\b|\bNone\s*[!=]=/.test(line) && !/\bis\s+not\b|\bis\b/.test(line)) {
      push(ctx, "none-equality", {
        severity: "low",
        title: "None compared with == instead of is",
        description:
          "PEP 8 requires `is None` / `is not None`. `==` can be overridden by `__eq__` and may not mean identity.",
        filePath: file.path,
        lineStart: ln,
        evidence: snippet(line),
        impact: "A custom `__eq__` can make the comparison return the wrong answer.",
        recommendation: "Use `is None` / `is not None`.",
        confidence: 0.9,
      });
    }

    /* --- List mutated while iterating ------------------------------- */
    const pyFor = /^\s*for\s+\w+\s+in\s+([A-Za-z_]\w*)\s*:/.exec(line);
    if (pyFor) {
      const target = pyFor[1];
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      const mutates = new RegExp(
        `\\b${target}\\s*\\.\\s*(remove|append|pop|insert|clear|sort|reverse)\\s*\\(`
      );
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) continue;
        const ind = l.match(/^\s*/)?.[0].length ?? 0;
        if (ind <= indent) break;
        if (mutates.test(l)) {
          push(ctx, "mutate-while-iterating", {
            severity: "high",
            title: "List mutated while iterating",
            description:
              "The loop mutates the same list it iterates, so the iteration order and length change underneath it.",
            filePath: file.path,
            lineStart: j + 1,
            evidence: snippet(l),
            impact: "Elements are skipped — a well-known Python pitfall.",
            recommendation: "Iterate over a copy (`for x in list(items):`) or build a new list.",
            confidence: 0.75,
          });
          break;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function analyzeBugs(files: SourceFile[]): RawFinding[] {
  const ctx: Ctx = { file: files[0] ?? { path: "", content: "", lines: [], language: "", bytes: 0 }, out: [] };

  for (const file of files) {
    ctx.file = file;
    if (BRACE_LANGS.has(file.language)) detectBraceLangs(ctx);
    else if (file.language === "Python") detectPython(ctx);
  }

  return ctx.out;
}
