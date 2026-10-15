import { NextRequest } from "next/server";
import { getReport } from "@/lib/store";
import {
  analyseChangeImpact,
  ensureGraphSeeded,
  findingsForImpact,
  getNodesForFile,
} from "@/lib/graph/store";
import { apiError, isValidId, json, parseIntParam } from "@/lib/graph/api";
import { clientKey, RATE_LIMITS, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/analysis/:id/change-impact
 *
 * Body: `{ nodeId }` or `{ filePath }`, plus optional `maxDepth`.
 *
 * Pure graph traversal — deterministic, and identical for the same graph every
 * time. No model is involved, because "what might break" is exactly the kind of
 * question where a plausible-sounding answer is worse than a precise one.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  if (!isValidId(id)) {
    return apiError("INVALID_URL", "That analysis id is not valid.", 400);
  }

  // See the collection route: the bundled sample's graph is seeded on first read.
  await ensureGraphSeeded(id);

  const rl = rateLimit(clientKey(req, "impact"), RATE_LIMITS.chat, RATE_LIMITS.windowMs);
  if (!rl.ok) {
    const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
    return apiError(
      "RATE_LIMITED",
      `Too many requests from this address. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
      429
    );
  }

  let body: { nodeId?: unknown; filePath?: unknown; maxDepth?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("INVALID_URL", "A JSON body with `nodeId` or `filePath` is required.", 400);
  }

  const maxDepth = parseIntParam(
    typeof body.maxDepth === "number" ? String(body.maxDepth) : null,
    4,
    1,
    6
  );

  /* Resolve the origin node. */
  let nodeId: string | null = null;

  if (typeof body.nodeId === "string") {
    if (!isValidId(body.nodeId)) {
      return apiError("INVALID_URL", "That node id is not valid.", 400);
    }
    nodeId = body.nodeId;
  } else if (typeof body.filePath === "string" && body.filePath.trim()) {
    const nodes = await getNodesForFile(id, body.filePath.trim());
    // Prefer the file-level node; fall back to any node in that file.
    const preferred =
      nodes.find((n) => ["file", "test", "service", "controller"].includes(n.nodeType)) ??
      nodes[0];
    if (!preferred) {
      return apiError(
        "ANALYSIS_FAILED",
        "No graph node was found for that file. It may not have been parsed.",
        404
      );
    }
    nodeId = preferred.id;
  } else {
    return apiError(
      "INVALID_URL",
      "Provide either `nodeId` or `filePath` to analyse.",
      400
    );
  }

  const result = await analyseChangeImpact(id, nodeId, { maxDepth });
  if (!result) {
    // Either the analysis has no graph, or the node belongs to another one —
    // both resolve to the same answer, which is also what keeps analyses apart.
    return apiError(
      "ANALYSIS_FAILED",
      "That node does not exist in this analysis.",
      404
    );
  }

  /* Attach findings from the report so impact and diagnostics line up. */
  const report = await getReport(id);
  const withFindings = report ? findingsForImpact(report.findings, result) : result;

  return json(withFindings);
}
