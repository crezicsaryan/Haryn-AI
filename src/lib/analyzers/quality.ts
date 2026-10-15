import type { RawFinding, SourceFile } from "./types";
import { snippet } from "./types";
import { maskNonCode } from "./code-mask";

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const FILE_LINES_WARN = 400;
const FILE_LINES_HIGH = 800;
const FN_LINES_WARN = 60;
const FN_LINES_HIGH = 120;
const COMPLEXITY_WARN = 12;
const COMPLEXITY_HIGH = 20;

const BRACE_LANGS = new Set([
  "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go",
  "Rust", "PHP", "Kotlin", "Swift", "Dart", "Scala", "Groovy",
]);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*");
}

function decisionPoints(line: string): number {
  // Counted on the code-only view. `&&`, `||` and `|` inside a string or a regex
  // literal are not branches, and counting them inflated the complexity of any
  // function that contains a pattern — a six-line helper with one
  // alternation-heavy regex was reported as complexity 20.
  const t = maskNonCode(line);
  const re =
    /\b(if|else\s+if|elif|for|while|case|when|catch|except|rescue)\b|\?\?|\?\.|&&|\|\||\?(?![.?])/g;
  return (t.match(re) ?? []).length;
}

interface FnBlock {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
}

const FN_START_BRACE =
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=)]*\)?\s*=>|([A-Za-z_$][\w$]*)\s*\([^;)]*\)\s*(?::\s*[\w<>[\]|.\s]+)?\{/;

function findBraceFunctions(file: SourceFile): FnBlock[] {
  const blocks: FnBlock[] = [];
  const lines = file.lines;
  for (let i = 0; i < lines.length; i++) {
    const m = FN_START_BRACE.exec(lines[i]);
    if (!m) continue;
    const name = m[1] ?? m[2] ?? m[3];
    if (!name || ["if", "for", "while", "switch", "catch", "return"].includes(name)) {
      continue;
    }
    // Walk forward balancing braces.
    let depth = 0;
    let started = false;
    let end = -1;
    for (let j = i; j < lines.length && j < i + 400; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (started && depth <= 0) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;
    let cx = 0;
    for (let j = i; j <= end; j++) cx += decisionPoints(lines[j]);
    blocks.push({ name, startLine: i + 1, endLine: end + 1, complexity: cx + 1 });
    i = end;
  }
  return blocks;
}

const PY_DEF = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;

function findPythonFunctions(file: SourceFile): FnBlock[] {
  const blocks: FnBlock[] = [];
  const lines = file.lines;
  for (let i = 0; i < lines.length; i++) {
    const m = PY_DEF.exec(lines[i]);
    if (!m) continue;
    const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      const ind = l.match(/^\s*/)?.[0].length ?? 0;
      if (ind <= indent && !isCommentLine(l)) break;
      end = j;
    }
    let cx = 0;
    for (let j = i; j <= end; j++) cx += decisionPoints(lines[j]);
    blocks.push({ name: m[1], startLine: i + 1, endLine: end + 1, complexity: cx + 1 });
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export function analyzeQuality(files: SourceFile[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();
  const push = (f: RawFinding, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  for (const file of files) {
    const loc = file.lines.length;

    /* --- File length ------------------------------------------------- */
    if (loc >= FILE_LINES_HIGH) {
      push(
        {
          category: "quality",
          severity: "medium",
          title: "Very large file",
          description: `This file is ${loc} lines long, well beyond the ${FILE_LINES_WARN}-line guideline. Large files tend to mix responsibilities and are hard to review.`,
          filePath: file.path,
          lineStart: 1,
          lineEnd: loc,
          evidence: `${loc} lines`,
          impact: "Slower code review, higher merge-conflict rate, harder navigation.",
          recommendation:
            "Split the file along responsibility boundaries — extract cohesive modules, helpers or services.",
          confidence: 0.9,
          source: "static-analysis",
        },
        `file-len:${file.path}`
      );
    } else if (loc >= FILE_LINES_WARN) {
      push(
        {
          category: "quality",
          severity: "low",
          title: "Large file",
          description: `This file is ${loc} lines long. Consider whether it still holds a single responsibility.`,
          filePath: file.path,
          lineStart: 1,
          lineEnd: loc,
          evidence: `${loc} lines`,
          impact: "Reduced readability as the file keeps growing.",
          recommendation: "Extract related logic into focused modules.",
          confidence: 0.7,
          source: "static-analysis",
          isPotential: true,
        },
        `file-len-warn:${file.path}`
      );
    }

    /* --- Function length & complexity -------------------------------- */
    const blocks = BRACE_LANGS.has(file.language)
      ? findBraceFunctions(file)
      : file.language === "Python"
        ? findPythonFunctions(file)
        : [];

    let fnFindings = 0;
    for (const b of blocks) {
      if (fnFindings >= 4) break;
      const len = b.endLine - b.startLine + 1;
      if (len >= FN_LINES_HIGH || b.complexity >= COMPLEXITY_HIGH) {
        fnFindings++;
        push(
          {
            category: "quality",
            severity: "high",
            title: "Complex function",
            description: `${b.name}() is ${len} lines with an estimated cyclomatic complexity of ${b.complexity}. High complexity correlates with defects and makes the function hard to test.`,
            filePath: file.path,
            lineStart: b.startLine,
            lineEnd: b.endLine,
            evidence: `${b.name}() · ${len} lines · complexity ≈ ${b.complexity}`,
            impact: "Difficult to reason about, test and safely change.",
            recommendation:
              "Split validation, decision-making and side-effects into separate functions, and return early instead of nesting.",
            confidence: 0.75,
            source: "static-analysis",
          },
          `fn-complex:${file.path}:${b.startLine}`
        );
      } else if (len >= FN_LINES_WARN || b.complexity >= COMPLEXITY_WARN) {
        fnFindings++;
        push(
          {
            category: "quality",
            severity: "medium",
            title: "Long function",
            description: `${b.name}() is ${len} lines with an estimated complexity of ${b.complexity}.`,
            filePath: file.path,
            lineStart: b.startLine,
            lineEnd: b.endLine,
            evidence: `${b.name}() · ${len} lines · complexity ≈ ${b.complexity}`,
            impact: "Harder to unit-test in isolation.",
            recommendation: "Extract cohesive steps into named helper functions.",
            confidence: 0.65,
            source: "static-analysis",
            isPotential: true,
          },
          `fn-long:${file.path}:${b.startLine}`
        );
      }
    }

    /* --- Empty catch blocks ------------------------------------------ */
    file.lines.forEach((line, i) => {
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}\s*;?\s*$/.test(line) || /except[^:]*:\s*pass\s*$/.test(line)) {
        push(
          {
            category: "quality",
            severity: "medium",
            title: "Swallowed exception",
            description:
              "An error is caught and silently ignored. Failures will disappear without a trace, making production issues very hard to diagnose.",
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: i + 1,
            evidence: snippet(line),
            impact: "Silent failures, misleading behaviour and hard-to-trace bugs.",
            recommendation:
              "Handle the error, log it with context, or rethrow a typed error instead of ignoring it.",
            confidence: 0.8,
            source: "static-analysis",
          },
          `empty-catch:${file.path}:${i}`
        );
      }
    });

    /* --- TODO / FIXME / HACK ----------------------------------------- */
    file.lines.forEach((line, i) => {
      const m = /\b(TODO|FIXME|HACK|XXX|BUG)\b[:\s]*(.*)/.exec(line);
      if (!m) return;
      if (seen.has(`todo:${file.path}`)) return;
      push(
        {
          category: "quality",
          severity: "info",
          title: `${m[1]} marker left in the code`,
          description: `Unresolved ${m[1]} comment: “${snippet(m[2], 90) || "no detail"}”.`,
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          evidence: snippet(line),
          impact: "Known gaps can be forgotten and ship to production.",
          recommendation: "Resolve it, or track it as an issue and remove the inline marker.",
          confidence: 0.95,
          source: "static-analysis",
        },
        `todo:${file.path}`
      );
    });

    /* --- Debug logging ----------------------------------------------- */
    if (!/\.(test|spec)\./.test(file.path) && !/__tests__/.test(file.path)) {
      const logs = file.lines.filter((l) =>
        /console\.(log|debug|dir)\s*\(|\bprint\s*\(/.test(l) && !isCommentLine(l)
      ).length;
      if (logs >= 3) {
        push(
          {
            category: "quality",
            severity: "low",
            title: "Debug statements left in source",
            description: `${logs} console/print statements found in a non-test file.`,
            filePath: file.path,
            evidence: `${logs} statements`,
            impact: "Noisy logs and a minor performance cost in production.",
            recommendation:
              "Replace them with a structured logger or remove them before release.",
            confidence: 0.8,
            source: "static-analysis",
          },
          `logs:${file.path}`
        );
      }
    }
  }

  /* --- Cross-file duplication ---------------------------------------- */
  const windows = new Map<string, { path: string; line: number; raw: string }>();
  const dupHits: { path: string; line: number; raw: string }[] = [];

  for (const file of files) {
    if (file.bytes > 120_000) continue;
    for (let i = 0; i + 6 <= file.lines.length; i++) {
      const windowLines = file.lines.slice(i, i + 6);
      if (windowLines.filter((l) => l.trim().length > 3 && !isCommentLine(l)).length < 5) {
        continue;
      }
      const key = windowLines
        .map((l) => l.trim().replace(/\s+/g, " "))
        .join("|");
      if (key.length < 60) continue;
      const prev = windows.get(key);
      if (prev) {
        dupHits.push({ path: file.path, line: i + 1, raw: windowLines[1] ?? windowLines[0] });
        break;
      }
      windows.set(key, { path: file.path, line: i + 1, raw: windowLines[0] });
    }
  }

  if (dupHits.length >= 2) {
    const sample = dupHits.slice(0, 3);
    push(
      {
        category: "quality",
        severity: dupHits.length >= 5 ? "medium" : "low",
        title: "Duplicated code blocks",
        description: `${dupHits.length} near-identical code blocks were found across the repository. Duplication multiplies the cost of every future change.`,
        filePath: sample[0].path,
        lineStart: sample[0].line,
        evidence: sample.map((d) => `${d.path}:${d.line} · ${snippet(d.raw, 70)}`).join("\n"),
        impact: "A single logic change must be replicated in several places, inviting drift and bugs.",
        recommendation:
          "Extract the shared logic into a single reusable function or module and call it from each site.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      "duplication"
    );
  }

  return findings;
}
