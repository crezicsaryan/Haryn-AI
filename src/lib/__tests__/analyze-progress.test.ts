import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyProgress,
  errorFromUnknown,
  formatElapsed,
  initialStageRows,
  markAllDone,
  nextPercent,
  parseStreamChunk,
  readAnalysisStream,
  shortenRepoUrl,
  streamError,
  type StageRow,
} from "../analyze-progress";
import type { StreamEvent } from "../types";

const progress = (
  stage: string,
  status: "active" | "done" | "pending",
  pct: number
): StreamEvent => ({ type: "progress", stage: stage as never, label: stage, status, pct });

/* ------------------------------------------------------------------ */
/* Stage list                                                          */
/* ------------------------------------------------------------------ */

test("initialStageRows covers every pipeline stage and starts pending", () => {
  const rows = initialStageRows();
  assert.ok(rows.length >= 10);
  assert.ok(rows.every((r) => r.status === "pending" && r.pct === 0));
  assert.ok(rows.some((r) => r.stage === "fetching"));
});

test("applyProgress moves the named stage to its new status", () => {
  const rows = applyProgress(initialStageRows(), progress("fetching", "active", 10));
  assert.equal(rows.find((r) => r.stage === "fetching")?.status, "active");
  assert.equal(rows.find((r) => r.stage === "fetching")?.pct, 10);
});

test("a new active stage completes the previous one", () => {
  // Without this, a dropped `done` frame would leave a stage spinning forever.
  let rows = applyProgress(initialStageRows(), progress("fetching", "active", 10));
  rows = applyProgress(rows, progress("discovering", "active", 20));
  assert.equal(rows.find((r) => r.stage === "fetching")?.status, "done");
  assert.equal(rows.find((r) => r.stage === "discovering")?.status, "active");
});

test("applyProgress never mutates the input", () => {
  const before = initialStageRows();
  const snapshot = JSON.stringify(before);
  applyProgress(before, progress("fetching", "active", 10));
  assert.equal(JSON.stringify(before), snapshot);
});

test("applyProgress ignores non-progress events", () => {
  const before = initialStageRows();
  const after = applyProgress(before, { type: "error", code: "ANALYSIS_FAILED", message: "x" });
  assert.equal(after, before);
});

test("markAllDone completes every row", () => {
  const rows = markAllDone(initialStageRows());
  assert.ok(rows.every((r) => r.status === "done"));
});

test("nextPercent follows progress events and jumps to 100 on result", () => {
  assert.equal(nextPercent(30, progress("fetching", "active", 42)), 42);
  assert.equal(
    nextPercent(42, { type: "result", report: {} as never }),
    100
  );
  assert.equal(
    nextPercent(42, { type: "error", code: "ANALYSIS_FAILED", message: "x" }),
    42,
    "an error must not reset progress"
  );
});

test("streamError only reports error frames", () => {
  assert.equal(streamError(progress("fetching", "active", 1)), null);
  assert.deepEqual(
    streamError({ type: "error", code: "RATE_LIMITED", message: "slow down" }),
    { code: "RATE_LIMITED", message: "slow down" }
  );
});

/* ------------------------------------------------------------------ */
/* NDJSON parsing                                                      */
/* ------------------------------------------------------------------ */

test("parseStreamChunk splits complete frames and keeps the remainder", () => {
  const buffer = '{"a":1}\n{"a":2}\n{"a":3';
  const { events, rest } = parseStreamChunk(buffer);
  assert.equal(events.length, 2);
  assert.equal(rest, '{"a":3');
});

test("parseStreamChunk skips malformed frames without throwing", () => {
  const { events, rest } = parseStreamChunk('{"type":"progress"}\nnot json\n\n');
  assert.equal(events.length, 1);
  assert.equal(rest, "");
});

test("parseStreamChunk on a buffer with no newline yields nothing", () => {
  const { events, rest } = parseStreamChunk('{"type":"prog');
  assert.deepEqual(events, []);
  assert.equal(rest, '{"type":"prog');
});

/* ------------------------------------------------------------------ */
/* Stream reader                                                       */
/* ------------------------------------------------------------------ */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("readAnalysisStream emits every frame, including one split mid-chunk", async () => {
  const events: StreamEvent[] = [];
  // Frame 2 is deliberately cut in half across two network reads.
  await readAnalysisStream(
    streamOf(['{"type":"progress","stage":"fetching","label":"F","status":"active","pct":10}\n{"type":"pro',
      'gress","stage":"discovering","label":"D","status":"active","pct":20}\n']),
    (e) => events.push(e)
  );
  assert.equal(events.length, 2);
  assert.equal(events[1].type, "progress");
});

test("readAnalysisStream flushes a trailing frame with no newline", async () => {
  const events: StreamEvent[] = [];
  await readAnalysisStream(
    streamOf(['{"type":"error","code":"ANALYSIS_FAILED","message":"boom"}']),
    (e) => events.push(e)
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "error");
});

test("readAnalysisStream stops when shouldContinue turns false", async () => {
  const events: StreamEvent[] = [];
  let calls = 0;
  await readAnalysisStream(
    streamOf([
      '{"type":"progress","stage":"fetching","label":"F","status":"active","pct":1}\n',
      '{"type":"progress","stage":"fetching","label":"F","status":"active","pct":2}\n',
    ]),
    (e) => events.push(e),
    () => {
      calls++;
      return calls <= 1;
    }
  );
  assert.ok(events.length < 2, "the loop should stop after the first read");
});

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

test("errorFromUnknown normalises a thrown Error and a non-Error", () => {
  assert.deepEqual(errorFromUnknown(new Error("nope")), {
    code: "ANALYSIS_FAILED",
    message: "nope",
  });
  assert.equal(errorFromUnknown("weird").code, "ANALYSIS_FAILED");
  assert.equal(errorFromUnknown(null).message, "Analysis failed. Please try again.");
});

test("shortenRepoUrl drops the scheme only", () => {
  assert.equal(shortenRepoUrl("https://github.com/a/b"), "github.com/a/b");
  assert.equal(shortenRepoUrl("http://github.com/a/b"), "github.com/a/b");
  assert.equal(shortenRepoUrl("github.com/a/b"), "github.com/a/b");
});

test("formatElapsed renders seconds and minutes", () => {
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12), "12s");
  assert.equal(formatElapsed(64), "1m 04s");
  assert.equal(formatElapsed(-5), "0s");
  assert.equal(formatElapsed(Number.NaN), "0s");
});

test("StageRow stays structurally assignable", () => {
  const row: StageRow = { stage: "fetching", label: "Fetching", status: "done", pct: 100 };
  assert.equal(row.status, "done");
});
