import { NextRequest } from "next/server";
import { hasReport } from "@/lib/store";
import { graphStats, loadGraph, ensureGraphSeeded } from "@/lib/graph/store";
import {
  apiError,
  EDGE_TYPES,
  isValidId,
  json,
  NODE_TYPES,
  parseIntParam,
  parseCsv,
} from "@/lib/graph/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/analysis/:id/knowledge-graph
 *
 * Returns a slice of the graph. A repository can hold tens of thousands of
 * nodes, so the response is always bounded — the client expands from a focus
 * node rather than requesting everything.
 *
 * Query: nodeTypes, edgeTypes, q, limit, offset, focus (comma-separated ids)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidId(id)) {
    return apiError("INVALID_URL", "That analysis id is not valid.", 400);
  }

  if (!(await hasReport(id))) {
    return apiError("ANALYSIS_FAILED", "That analysis could not be found.", 404);
  }

  // The bundled sample is a code-level fixture that is never analysed, so its
  // graph is seeded on first read rather than written by an analysis run.
  await ensureGraphSeeded(id);

  const url = new URL(req.url);
  const nodeTypes = parseCsv(url.searchParams.get("nodeTypes"), NODE_TYPES);
  const edgeTypes = parseCsv(url.searchParams.get("edgeTypes"), EDGE_TYPES);
  const search = url.searchParams.get("q") ?? undefined;
  const limit = parseIntParam(url.searchParams.get("limit"), 600, 1, 4000);
  const offset = parseIntParam(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const focusIds = (url.searchParams.get("focus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => isValidId(s));

  const stats = await graphStats(id);
  if (stats.nodeCount === 0) {
    return json({
      analysisId: id,
      nodes: [],
      edges: [],
      stats,
      total: 0,
      truncated: false,
      empty: true,
    });
  }

  const { nodes, edges, total } = await loadGraph(id, {
    nodeTypes,
    edgeTypes,
    search,
    limit,
    offset,
    focusIds,
  });

  return json({
    analysisId: id,
    nodes,
    edges,
    stats,
    total,
    // Tell the client when it is looking at a subset, rather than letting it
    // assume the view is complete.
    truncated: total > nodes.length || stats.truncated,
  });
}
