import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../ai/chunk";
import { buildRetriever } from "../ai/retrieve";

/**
 * Ranking tests.
 *
 * These cover the signals that are easy to get subtly wrong and impossible to
 * notice from the outside: a question that names a file must find that file,
 * and generic path segments must not make every sibling look relevant.
 */

function chunk(over: Partial<Chunk> & { path: string; text: string }): Chunk {
  return {
    id: `${over.path}:${over.startLine ?? 1}`,
    language: "TypeScript",
    symbol: over.symbol ?? null,
    kind: "function",
    startLine: 1,
    endLine: 20,
    imports: [],
    bytes: over.text.length,
    ...over,
  };
}

const CHUNKS: Chunk[] = [
  chunk({
    path: "src/lib/ai/diagnose.ts",
    symbol: "diagnose",
    text: "export function diagnose(input) { return diagnoseTarget(input); }",
  }),
  chunk({
    path: "src/lib/chat.ts",
    symbol: "answerQuestion",
    text: "export function answerQuestion(report, question) { return overview(report); }",
  }),
  chunk({
    path: "src/lib/sample.ts",
    symbol: "buildSampleReport",
    text: "export function buildSampleReport() { return { id: 'an_sample' }; }",
  }),
];

test("a file named in the question comes first", () => {
  // The boost used to compare the path against the whole lowercased question,
  // which can never match, so `src/lib/chat.ts` won on generic path segments.
  const r = buildRetriever(CHUNKS);
  const hits = r.search("Explain the diagnose function in src/lib/ai/diagnose.ts", {
    limit: 3,
  });
  assert.equal(hits[0]?.chunk.path, "src/lib/ai/diagnose.ts");
  assert.ok(
    hits[0].reasons.includes("referenced file"),
    `expected the referenced-file signal, got ${hits[0].reasons.join(", ")}`
  );
});

test("a bare filename in the question also pins the file", () => {
  const r = buildRetriever(CHUNKS);
  const hits = r.search("what does sample.ts do?", { limit: 3 });
  assert.equal(hits[0]?.chunk.path, "src/lib/sample.ts");
});

test("a question with no path does not get the referenced-file boost", () => {
  const r = buildRetriever(CHUNKS);
  const hits = r.search("how does the report get built", { limit: 3 });
  for (const h of hits) {
    assert.ok(!h.reasons.includes("referenced file"), h.chunk.path);
  }
});
