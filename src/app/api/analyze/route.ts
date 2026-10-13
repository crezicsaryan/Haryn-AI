import { NextRequest } from "next/server";
import { parseGitHubUrl } from "@/lib/validation";
import { runAnalysis } from "@/lib/analyze";
import { completeAnalysis, createAnalysis, failAnalysis } from "@/lib/store";
import { saveGraph } from "@/lib/graph/store";
import { GitHubError } from "@/lib/github";
import { clientKey, RATE_LIMITS, rateLimit } from "@/lib/ratelimit";
import { makeId } from "@/lib/utils";
import type { ErrorCode, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NDJSON = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
} as const;

function errorResponse(code: ErrorCode, message: string, status = 400) {
  const body: StreamEvent = { type: "error", code, message };
  return new Response(JSON.stringify(body) + "\n", {
    status,
    headers: NDJSON,
  });
}

export async function POST(req: NextRequest) {
  /* --- Rate limit --------------------------------------------------- */
  const rl = rateLimit(
    clientKey(req, "analyze"),
    RATE_LIMITS.analyze,
    RATE_LIMITS.windowMs
  );
  if (!rl.ok) {
    const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
    return errorResponse(
      "RATE_LIMITED",
      `Too many analyses from this address. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
      429
    );
  }

  /* --- Body --------------------------------------------------------- */
  let payload: { repositoryUrl?: string } = {};
  try {
    payload = (await req.json()) as { repositoryUrl?: string };
  } catch {
    return errorResponse(
      "INVALID_URL",
      "Please enter a valid public GitHub repository URL."
    );
  }

  const parsed = parseGitHubUrl(payload.repositoryUrl ?? "");
  if (!parsed.ok) {
    return errorResponse(parsed.code, parsed.message);
  }

  /* --- Stream the pipeline ------------------------------------------ */
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      // Record the run up front so history survives even a hard failure.
      const id = makeId("an");
      await createAnalysis(id, {
        owner: parsed.repo.owner,
        name: parsed.repo.name,
        fullName: `${parsed.repo.owner}/${parsed.repo.name}`,
        url: parsed.repo.url,
        defaultBranch: parsed.repo.ref ?? "HEAD",
      }).catch(() => {
        /* history is best-effort — never block the analysis itself */
      });

      try {
        const { report, index, graph } = await runAnalysis(parsed.repo, send, { id });
        await completeAnalysis(report, index);

        // The graph is stored separately and its failure is contained: the
        // report is already complete and valid without it.
        if (graph && graph.nodes.length) {
          try {
            await saveGraph(id, graph.nodes, graph.edges);
          } catch (graphErr) {
            send({
              type: "progress",
              stage: "graph",
              label: `Knowledge graph could not be stored — ${
                graphErr instanceof Error ? graphErr.message : "write failed"
              }`,
              status: "done",
              pct: 100,
            });
          }
        }

        send({ type: "result", report });
      } catch (err) {
        if (err instanceof GitHubError) {
          await failAnalysis(id, err.code, err.message);
          send({ type: "error", code: err.code, message: err.message });
        } else {
          const message =
            err instanceof Error
              ? `Analysis failed: ${err.message}`
              : "Analysis failed. Please try again.";
          await failAnalysis(id, "ANALYSIS_FAILED", message);
          send({ type: "error", code: "ANALYSIS_FAILED", message });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: NDJSON });
}
