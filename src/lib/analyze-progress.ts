import { PIPELINE } from "./constants";
import type { ErrorCode, StreamEvent } from "./types";

/**
 * Pure logic behind the streaming analysis screen.
 *
 * Everything the `/analyze` page does that is not rendering lives here: the
 * stage list reducer, the NDJSON frame parser and the stream reader. Keeping it
 * out of the component means the progress semantics — which are easy to get
 * subtly wrong, and were previously only verifiable by watching the UI — are
 * unit-testable without a DOM.
 */

export interface StageRow {
  stage: string;
  label: string;
  status: "pending" | "active" | "done";
  pct: number;
}

/** One row per pipeline stage, all pending. */
export function initialStageRows(): StageRow[] {
  return PIPELINE.map((p) => ({ ...p, status: "pending" as const, pct: 0 }));
}

/**
 * Fold a progress event into the stage list.
 *
 * The stage named by the event takes its new status. Any *other* row that is
 * still `active` is marked done: the server emits one active stage at a time, so
 * seeing a new active stage means the previous one finished. Without this a
 * stage would stay spinning forever if its own `done` frame was dropped.
 */
export function applyProgress(rows: StageRow[], evt: StreamEvent): StageRow[] {
  if (evt.type !== "progress") return rows;
  return rows.map((row) => {
    if (row.stage === evt.stage) {
      return { ...row, status: evt.status, label: evt.label, pct: evt.pct };
    }
    if (row.status === "active" && evt.status === "active") {
      return { ...row, status: "done" };
    }
    return row;
  });
}

/** Mark every stage complete — the analysis has produced its report. */
export function markAllDone(rows: StageRow[]): StageRow[] {
  return rows.map((row) => ({ ...row, status: "done" as const }));
}

/** Overall percentage implied by an event. */
export function nextPercent(current: number, evt: StreamEvent): number {
  if (evt.type === "progress") return evt.pct;
  if (evt.type === "result") return 100;
  return current;
}

/** The error carried by an event, or `null` if it is not an error frame. */
export function streamError(
  evt: StreamEvent
): { code: ErrorCode; message: string } | null {
  return evt.type === "error" ? { code: evt.code, message: evt.message } : null;
}

/**
 * Split an accumulated buffer into complete NDJSON frames.
 *
 * Returns the parsed events plus the trailing partial line, which the caller
 * must carry into the next chunk — a frame can be split across any two network
 * reads, so parsing the last line here would routinely drop events.
 *
 * A malformed line is skipped rather than thrown: a truncated frame must not
 * discard an otherwise valid analysis.
 */
export function parseStreamChunk(buffer: string): {
  events: StreamEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: StreamEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // Deliberately skipped — see the note above.
      continue;
    }
  }

  return { events, rest };
}

/**
 * Consume an NDJSON response body, invoking `onEvent` per frame.
 *
 * `shouldContinue` is polled between reads so an unmounted component can stop
 * the loop without aborting the request.
 */
export async function readAnalysisStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  shouldContinue: () => boolean = () => true
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!shouldContinue()) return;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseStreamChunk(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }

  // A final frame may arrive without a trailing newline.
  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail) as StreamEvent);
    } catch {
      // Ignored: a partial trailing frame carries no usable event.
    }
  }
}

/** Normalise anything thrown by `fetch` into the shape the UI renders. */
export function errorFromUnknown(e: unknown): { code: ErrorCode; message: string } {
  return {
    code: "ANALYSIS_FAILED",
    message:
      e instanceof Error ? e.message : "Analysis failed. Please try again.",
  };
}

/** `https://github.com/a/b` → `github.com/a/b`, for the header line. */
export function shortenRepoUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** Elapsed seconds as a compact `1m 04s` / `12s` label. */
export function formatElapsed(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  return `${minutes}m ${String(safe % 60).padStart(2, "0")}s`;
}
