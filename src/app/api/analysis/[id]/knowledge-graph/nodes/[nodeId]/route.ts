import { NextRequest } from "next/server";
import { getReport } from "@/lib/store";
import { getNeighbourhood, ensureGraphSeeded } from "@/lib/graph/store";
import { apiError, isValidId, json } from "@/lib/graph/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; nodeId: string }> };

/**
 * GET /api/analysis/:id/knowledge-graph/nodes/:nodeId
 *
 * One node plus everything directly attached to it, the findings that touch its
 * file, and the tests that cover it — the payload behind the details panel.
 *
 * `getNeighbourhood` scopes every query by analysis id, so a node id belonging
 * to a different analysis resolves to nothing rather than leaking across.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id, nodeId } = await ctx.params;

  if (!isValidId(id) || !isValidId(nodeId)) {
    return apiError("INVALID_URL", "That node id is not valid.", 400);
  }

  // See the collection route: the bundled sample's graph is seeded on first read.
  await ensureGraphSeeded(id);

  const neighbourhood = await getNeighbourhood(id, nodeId);
  if (!neighbourhood) {
    return apiError(
      "ANALYSIS_FAILED",
      "That node does not exist in this analysis.",
      404
    );
  }

  const { node, incoming, outgoing } = neighbourhood;

  /* Findings attached to the node's file, and to files it is connected to. */
  const report = await getReport(id);
  const relatedFindings = report
    ? report.findings
        .filter((f) => f.filePath && f.filePath === node.filePath)
        .slice(0, 20)
        .map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          category: f.category,
          filePath: f.filePath,
          lineStart: f.lineStart,
        }))
    : [];

  /* Tests that cover this node's file. */
  const tests = outgoing
    .filter((x) => x.edge.relationshipType === "TESTS")
    .concat(incoming.filter((x) => x.edge.relationshipType === "TESTS"))
    .map((x) => x.node)
    .filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);

  /* A description built only from what the graph actually knows. */
  const parts: string[] = [];
  parts.push(
    `${node.name} is a ${node.nodeType.replace(/_/g, " ")}${
      node.filePath ? ` defined in ${node.filePath}` : ""
    }${node.startLine ? ` at line ${node.startLine}` : ""}.`
  );
  if (outgoing.length) {
    const byType = new Map<string, number>();
    for (const o of outgoing) byType.set(o.edge.relationshipType, (byType.get(o.edge.relationshipType) ?? 0) + 1);
    parts.push(
      `It has ${outgoing.length} outgoing relationship${outgoing.length === 1 ? "" : "s"} (${[...byType]
        .map(([t, n]) => `${n} ${t.toLowerCase().replace(/_/g, " ")}`)
        .join(", ")}).`
    );
  }
  if (incoming.length) {
    const byType = new Map<string, number>();
    for (const o of incoming) byType.set(o.edge.relationshipType, (byType.get(o.edge.relationshipType) ?? 0) + 1);
    parts.push(
      `${incoming.length} thing${incoming.length === 1 ? "" : "s"} reference it (${[...byType]
        .map(([t, n]) => `${n} ${t.toLowerCase().replace(/_/g, " ")}`)
        .join(", ")}).`
    );
  }
  if (!outgoing.length && !incoming.length) {
    parts.push(
      "Nothing in the analysed files connects to it, so it may be unused, or referenced only from files that were not parsed."
    );
  }

  return json({
    node,
    description: parts.join(" "),
    incoming,
    outgoing,
    connectedFiles: [
      ...new Set(
        [...incoming, ...outgoing]
          .map((x) => x.node.filePath)
          .filter((p): p is string => Boolean(p) && p !== node.filePath)
      ),
    ].slice(0, 50),
    relatedFindings,
    tests,
  });
}
