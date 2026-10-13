import { NextRequest } from "next/server";
import { getNeighbours } from "@/lib/graph/store";
import { apiError, isValidId, json, parseIntParam } from "@/lib/graph/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; nodeId: string }> };

/**
 * GET /api/analysis/:id/knowledge-graph/neighbors/:nodeId?depth=1
 *
 * The sub-graph around one node, used to expand the canvas progressively
 * instead of loading the whole repository.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, nodeId } = await ctx.params;

  if (!isValidId(id) || !isValidId(nodeId)) {
    return apiError("INVALID_URL", "That node id is not valid.", 400);
  }

  const depth = parseIntParam(new URL(req.url).searchParams.get("depth"), 1, 1, 3);

  const { nodes, edges } = await getNeighbours(id, nodeId, depth);
  if (!nodes.some((n) => n.id === nodeId)) {
    return apiError("ANALYSIS_FAILED", "That node does not exist in this analysis.", 404);
  }

  return json({ analysisId: id, nodes, edges, depth });
}
