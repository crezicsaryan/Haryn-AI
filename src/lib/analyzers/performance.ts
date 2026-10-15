import type { RawFinding, SourceFile } from "./types";
import { snippet } from "./types";

const BRACE_LANGS = new Set([
  "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go",
  "Rust", "PHP", "Kotlin", "Swift", "Dart",
]);

const QUERY_CALL =
  /\b(?:await\s+)?(?:[\w.]*\b(?:findOne|findAll|findById|find|aggregate|count|query|execute|raw|select|insert|update|delete|save|create)\s*\(|prisma\.\w+|knex\s*\(|sequelize\.|db\.\w+\.|Model\.\w+|session\.query\s*\(|cursor\.execute\s*\(|fetch\s*\(|axios\.(?:get|post|put|delete)|requests\.(?:get|post)|http\.(?:get|request))/;

const LOOP_START =
  /\b(for|while)\s*\(|\.forEach\s*\(|\.map\s*\(|\.filter\s*\(|\.reduce\s*\(|for\s+\w+\s+in\s+|while\s+.*:\s*$/;

const SYNC_IO =
  /\b(readFileSync|writeFileSync|readdirSync|statSync|existsSync|execSync|appendFileSync|openSync)\s*\(|fs\.readFileSync|fs\.writeFileSync/;

function blockRange(
  lines: string[],
  start: number,
  language: string
): number {
  if (language === "Python") {
    const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
    let end = start;
    for (let j = start + 1; j < lines.length && j < start + 60; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      const ind = l.match(/^\s*/)?.[0].length ?? 0;
      if (ind <= indent) break;
      end = j;
    }
    return end;
  }
  let depth = 0;
  let started = false;
  for (let j = start; j < lines.length && j < start + 80; j++) {
    for (const ch of lines[j]) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") depth--;
    }
    if (started && depth <= 0) return j;
    if (!started && j > start + 3) return Math.min(lines.length - 1, start + 20);
  }
  return Math.min(lines.length - 1, start + 20);
}

export function analyzePerformance(files: SourceFile[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();
  const push = (f: RawFinding, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  let nPlusOne = 0;
  let seqAwait = 0;
  let nestedLoop = 0;

  for (const file of files) {
    const lines = file.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!LOOP_START.test(line)) continue;
      if (/^\s*(\/\/|#|\*)/.test(line)) continue;

      const end = blockRange(lines, i, file.language);
      const body = lines.slice(i, end + 1).join("\n");

      // Query / network call inside a loop → classic N+1.
      if (QUERY_CALL.test(body) && nPlusOne < 3) {
        nPlusOne++;
        const callLine =
          lines.findIndex((l, k) => k > i && k <= end && QUERY_CALL.test(l)) + 1;
        push(
          {
            category: "performance",
            severity: "high",
            title: "Potential N+1 query",
            description:
              "A database or network call appears to execute inside a loop. Each iteration issues its own round-trip, so the cost grows linearly with the number of records.",
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: end + 1,
            evidence: `loop at ${file.path}:${i + 1}${callLine ? ` → call at :${callLine}` : ""} · ${snippet(line, 90)}`,
            impact:
              "Response time degrades sharply as data grows, and the database sees a burst of small queries.",
            recommendation:
              "Batch the required records into a single query (e.g. an IN clause or a join) and process the result in memory.",
            confidence: 0.6,
            source: "static-analysis",
            isPotential: true,
          },
          `n+1:${file.path}:${i}`
        );
      }

      // Sequential awaits inside a loop → should be parallelised.
      // A stream drain is the exception: `await reader.read()` must run one read
      // at a time, so there is nothing to parallelise.
      const streamRead = /\bawait\s+[\w.$]*\.read\s*\(/.test(body);
      if (/await\s+/.test(body) && !streamRead && seqAwait < 2 && file.language !== "Python") {
        seqAwait++;
        push(
          {
            category: "performance",
            severity: "medium",
            title: "Sequential awaits inside a loop",
            description:
              "Independent asynchronous operations are awaited one after another, so total time is the sum of every call rather than the slowest one.",
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: end + 1,
            evidence: snippet(line, 90),
            impact: "Unnecessarily long request times.",
            recommendation:
              "Collect the promises and await them together with Promise.all (or a bounded concurrency helper).",
            confidence: 0.5,
            source: "static-analysis",
            isPotential: true,
          },
          `seq-await:${file.path}:${i}`
        );
      }

      // Nested loops → O(n²) risk.
      if (nestedLoop < 2) {
        const inner = lines
          .slice(i + 1, end + 1)
          .findIndex((l) => LOOP_START.test(l));
        if (inner !== -1) {
          nestedLoop++;
          push(
            {
              category: "performance",
              severity: "medium",
              title: "Nested loop",
              description:
                "A loop is nested inside another loop, giving O(n²) behaviour. This becomes a bottleneck as the collection grows.",
              filePath: file.path,
              lineStart: i + 1,
              lineEnd: end + 1,
              evidence: `outer loop ${file.path}:${i + 1} → inner loop :${i + 1 + inner + 1}`,
              impact: "Quadratic time complexity on large inputs.",
              recommendation:
                "Index one side in a Map/Set and iterate once, or push the work down to the database.",
              confidence: 0.5,
              source: "static-analysis",
              isPotential: true,
            },
            `nested:${file.path}:${i}`
          );
        }
      }
    }

    // Synchronous I/O on the hot path.
    lines.forEach((line, i) => {
      if (!SYNC_IO.test(line) || /^\s*(\/\/|#|\*)/.test(line)) return;
      push(
        {
          category: "performance",
          severity: "medium",
          title: "Blocking synchronous I/O",
          description:
            "A synchronous filesystem call blocks the event loop for its entire duration, stalling every other request the process is handling.",
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          evidence: snippet(line),
          impact: "Reduced throughput and request latency spikes under load.",
          recommendation:
            "Use the asynchronous variant (e.g. fs.promises.readFile) or move the work to a worker/queue.",
          confidence: 0.6,
          source: "static-analysis",
          isPotential: true,
        },
        `sync-io:${file.path}:${i}`
      );
    });

    // Whole-library imports that defeat tree-shaking.
    lines.forEach((line, i) => {
      const m = /import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+["'`](lodash|moment|underscore)["'`]|from\s+["'`](lodash|moment)["'`]/.exec(
        line
      );
      if (!m) return;
      const lib = m[1] ?? m[2];
      push(
        {
          category: "performance",
          severity: "low",
          title: `Whole-library import of ${lib}`,
          description: `Importing all of ${lib} pulls the entire package into the bundle even when a few functions are used.`,
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          evidence: snippet(line),
          impact: "Larger client bundle and slower initial load.",
          recommendation: `Import only the functions you need (e.g. import debounce from "${lib}/debounce"), or migrate to a lighter alternative.`,
          confidence: 0.65,
          source: "static-analysis",
        },
        `lib-import:${file.path}:${i}`
      );
    });

    // Unbounded queries.
    lines.forEach((line, i) => {
      if (
        /\.find\s*\(\s*\{\s*\}\s*\)|SELECT\s+\*\s+FROM|findAll\s*\(\s*\)/i.test(line) &&
        !/limit\s*\(/i.test(line)
      ) {
        push(
          {
            category: "performance",
            severity: "medium",
            title: "Unbounded query",
            description:
              "A query fetches every matching row with no limit or pagination. Result size is dictated entirely by the data.",
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: i + 1,
            evidence: snippet(line),
            impact: "Memory spikes and slow responses once the table grows.",
            recommendation:
              "Add an explicit limit/pagination and select only the columns you need.",
            confidence: 0.55,
            source: "static-analysis",
            isPotential: true,
          },
          `unbounded:${file.path}:${i}`
        );
      }
    });
  }

  // Oversized source files are a weak performance signal worth surfacing.
  const huge = files.filter((f) => f.bytes > 250_000);
  if (huge.length) {
    push(
      {
        category: "performance",
        severity: "low",
        title: "Oversized source file",
        description: `${huge.length} source file(s) exceed 250 KB. Very large modules are slow to parse and usually indicate generated or un-split code.`,
        filePath: huge[0].path,
        evidence: huge.slice(0, 3).map((f) => `${f.path} (${Math.round(f.bytes / 1024)} KB)`).join("\n"),
        impact: "Slower builds and larger bundles.",
        recommendation: "Split large modules and verify generated files are excluded from the bundle.",
        confidence: 0.6,
        source: "static-analysis",
        isPotential: true,
      },
      "huge-files"
    );
  }

  return findings;
}
