import { asNumber, asString, getDb, parseJson, toJson } from "../db";
import { SAMPLE_ID } from "../sample";
import { ensureSampleReportRow } from "../store";
import { sampleGraph } from "./sample-graph";
import type { Finding } from "../types";
import type {
  ChangeImpactResult,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  GraphStats,
  ImpactedEntity,
  ImpactPath,
  NodeNeighbourhood,
} from "./types";

/**
 * Knowledge-graph persistence and traversal.
 *
 * Kept behind this module so the rest of the app never writes SQL for graph
 * data — the same seam that lets `lib/store.ts` move to Postgres applies here.
 * Every query is scoped by `analysis_id`, which is what prevents one report
 * from reading another's graph.
 */

const MAX_LIMIT = 4000;

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: asString(row.id),
    analysisId: asString(row.analysis_id),
    nodeType: asString(row.node_type) as GraphNodeType,
    name: asString(row.name),
    filePath: row.file_path == null ? null : asString(row.file_path),
    startLine: row.start_line == null ? null : asNumber(row.start_line),
    endLine: row.end_line == null ? null : asNumber(row.end_line),
    language: row.language == null ? null : asString(row.language),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: asString(row.id),
    analysisId: asString(row.analysis_id),
    sourceNodeId: asString(row.source_node_id),
    targetNodeId: asString(row.target_node_id),
    relationshipType: asString(row.relationship_type) as GraphEdgeType,
    confidence: asString(row.confidence, "confirmed") as GraphEdge["confidence"],
    evidence: asString(row.evidence),
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Replace the graph for an analysis.
 *
 * Delete-then-insert inside a transaction, so a re-run is idempotent and a
 * failure half-way cannot leave a partially-updated graph.
 */
export async function saveGraph(
  analysisId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<void> {
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM graph_edges WHERE analysis_id = ?").run(analysisId);
    db.prepare("DELETE FROM graph_nodes WHERE analysis_id = ?").run(analysisId);

    const insertNode = db.prepare(
      `INSERT OR REPLACE INTO graph_nodes
         (id, analysis_id, node_type, name, file_path, start_line, end_line, language, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const n of nodes) {
      insertNode.run(
        n.id,
        analysisId,
        n.nodeType,
        n.name,
        n.filePath ?? null,
        n.startLine ?? null,
        n.endLine ?? null,
        n.language ?? null,
        toJson(n.metadata)
      );
    }

    const insertEdge = db.prepare(
      `INSERT OR IGNORE INTO graph_edges
         (id, analysis_id, source_node_id, target_node_id, relationship_type, confidence, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of edges) {
      insertEdge.run(
        e.id,
        analysisId,
        e.sourceNodeId,
        e.targetNodeId,
        e.relationshipType,
        e.confidence,
        e.evidence
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* rollback on an already-aborted transaction is not interesting */
    }
    throw err;
  }
}

/** Remove a graph. Cascades from `analyses`, but exposed for explicit cleanup. */
export async function deleteGraph(analysisId: string): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM graph_edges WHERE analysis_id = ?").run(analysisId);
  db.prepare("DELETE FROM graph_nodes WHERE analysis_id = ?").run(analysisId);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Seed the bundled sample's graph on first read.
 *
 * The sample report is a code-level fixture and is never analysed, so it has no
 * graph rows — and its knowledge-graph view, which a visitor reaches straight
 * from the landing page, reported that the repository had no graph.
 *
 * The report row has to exist first: both graph tables reference `analyses(id)`,
 * so a graph cannot be written for an analysis that has no row. Seeding lazily
 * means every graph route (nodes, neighbours, change impact) keeps reading the
 * database as usual instead of each growing a sample branch.
 */
export async function ensureGraphSeeded(analysisId: string): Promise<void> {
  if (analysisId !== SAMPLE_ID) return;
  if (await hasGraph(analysisId)) return;
  await ensureSampleReportRow();
  const { nodes, edges } = sampleGraph(analysisId);
  await saveGraph(analysisId, nodes, edges);
}

export async function hasGraph(analysisId: string): Promise<boolean> {
  const row = getDb()
    .prepare("SELECT 1 AS present FROM graph_nodes WHERE analysis_id = ? LIMIT 1")
    .get(analysisId);
  return Boolean(row);
}

export async function graphStats(analysisId: string): Promise<GraphStats> {
  const db = getDb();
  const nodeCount = asNumber(
    db.prepare("SELECT COUNT(*) AS c FROM graph_nodes WHERE analysis_id = ?").get(analysisId)?.c
  );
  const edgeCount = asNumber(
    db.prepare("SELECT COUNT(*) AS c FROM graph_edges WHERE analysis_id = ?").get(analysisId)?.c
  );

  const byNodeType: Record<string, number> = {};
  for (const r of db
    .prepare("SELECT node_type AS t, COUNT(*) AS c FROM graph_nodes WHERE analysis_id = ? GROUP BY node_type")
    .all(analysisId)) {
    byNodeType[asString(r.t)] = asNumber(r.c);
  }

  const byEdgeType: Record<string, number> = {};
  for (const r of db
    .prepare(
      "SELECT relationship_type AS t, COUNT(*) AS c FROM graph_edges WHERE analysis_id = ? GROUP BY relationship_type"
    )
    .all(analysisId)) {
    byEdgeType[asString(r.t)] = asNumber(r.c);
  }

  const fileRow = db
    .prepare(
      "SELECT COUNT(*) AS c FROM graph_nodes WHERE analysis_id = ? AND node_type IN ('file','test')"
    )
    .get(analysisId);

  return {
    nodeCount,
    edgeCount,
    byNodeType,
    byEdgeType,
    parsedFiles: asNumber(fileRow?.c),
    skippedFiles: 0,
    truncated: false,
  };
}

export interface LoadGraphOptions {
  /** Restrict to these node types. */
  nodeTypes?: GraphNodeType[];
  /** Restrict to these relationship types. */
  edgeTypes?: GraphEdgeType[];
  /** Case-insensitive substring match on node name or file path. */
  search?: string;
  limit?: number;
  offset?: number;
  /** Node ids whose incident edges should always be included. */
  focusIds?: string[];
}

/**
 * Load a slice of the graph.
 *
 * When any filter is applied, edges are only returned if both endpoints made it
 * into the returned node set — a dangling edge would render as a broken link.
 */
export async function loadGraph(
  analysisId: string,
  opts: LoadGraphOptions = {}
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; total: number }> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 600, 1), MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: string[] = ["analysis_id = ?"];
  const params: (string | number)[] = [analysisId];

  if (opts.nodeTypes?.length) {
    where.push(`node_type IN (${opts.nodeTypes.map(() => "?").join(",")})`);
    params.push(...opts.nodeTypes);
  }
  if (opts.search?.trim()) {
    where.push("(LOWER(name) LIKE ? OR LOWER(file_path) LIKE ?)");
    const like = `%${opts.search.trim().toLowerCase()}%`;
    params.push(like, like);
  }

  const whereSql = where.join(" AND ");
  const total = asNumber(
    db.prepare(`SELECT COUNT(*) AS c FROM graph_nodes WHERE ${whereSql}`).get(...params)?.c
  );

  // Prefer connected nodes first so a truncated view still looks like a graph
  // rather than a list of isolated files.
  const nodes = db
    .prepare(
      `SELECT * FROM graph_nodes
        WHERE ${whereSql}
        ORDER BY
          CASE node_type
            WHEN 'repository' THEN 0 WHEN 'api_endpoint' THEN 1 WHEN 'class' THEN 2
            WHEN 'function' THEN 3 WHEN 'db_model' THEN 4 WHEN 'file' THEN 5
            ELSE 6
          END,
          name ASC
        LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)
    .map(rowToNode);

  const ids = new Set(nodes.map((n) => n.id));
  // Focus nodes are always kept, so an "expand from here" request never loses
  // the node the user clicked.
  for (const id of opts.focusIds ?? []) {
    if (ids.has(id)) continue;
    const row = db
      .prepare("SELECT * FROM graph_nodes WHERE analysis_id = ? AND id = ?")
      .get(analysisId, id);
    if (row) {
      nodes.push(rowToNode(row));
      ids.add(id);
    }
  }

  const edgeWhere = ["analysis_id = ?"];
  const edgeParams: (string | number)[] = [analysisId];
  if (opts.edgeTypes?.length) {
    edgeWhere.push(`relationship_type IN (${opts.edgeTypes.map(() => "?").join(",")})`);
    edgeParams.push(...opts.edgeTypes);
  }

  const allEdges = db
    .prepare(`SELECT * FROM graph_edges WHERE ${edgeWhere.join(" AND ")} LIMIT ?`)
    .all(...edgeParams, MAX_LIMIT * 4)
    .map(rowToEdge);

  // Drop CONTAINS first when trimming — structural edges are the least
  // informative and the most numerous.
  const rank = (e: GraphEdge) => (e.relationshipType === "CONTAINS" ? 1 : 0);
  const edges = allEdges
    .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit * 4);

  return { nodes, edges, total };
}

export async function getNode(analysisId: string, nodeId: string): Promise<GraphNode | null> {
  const row = getDb()
    .prepare("SELECT * FROM graph_nodes WHERE analysis_id = ? AND id = ?")
    .get(analysisId, nodeId);
  return row ? rowToNode(row) : null;
}

export async function getNodes(analysisId: string, ids: string[]): Promise<GraphNode[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM graph_nodes WHERE analysis_id = ? AND id IN (${placeholders})`)
    .all(analysisId, ...ids)
    .map(rowToNode);
}

/** Everything directly attached to one node. */
export async function getNeighbourhood(
  analysisId: string,
  nodeId: string
): Promise<NodeNeighbourhood | null> {
  const db = getDb();
  const node = await getNode(analysisId, nodeId);
  if (!node) return null;

  const outRows = db
    .prepare("SELECT * FROM graph_edges WHERE analysis_id = ? AND source_node_id = ?")
    .all(analysisId, nodeId)
    .map(rowToEdge);
  const inRows = db
    .prepare("SELECT * FROM graph_edges WHERE analysis_id = ? AND target_node_id = ?")
    .all(analysisId, nodeId)
    .map(rowToEdge);

  const otherIds = [
    ...new Set([...outRows.map((e) => e.targetNodeId), ...inRows.map((e) => e.sourceNodeId)]),
  ];
  const others = await getNodes(analysisId, otherIds);
  const byId = new Map(others.map((n) => [n.id, n]));

  return {
    node,
    outgoing: outRows
      .map((edge) => ({ edge, node: byId.get(edge.targetNodeId) }))
      .filter((x): x is { edge: GraphEdge; node: GraphNode } => Boolean(x.node)),
    incoming: inRows
      .map((edge) => ({ edge, node: byId.get(edge.sourceNodeId) }))
      .filter((x): x is { edge: GraphEdge; node: GraphNode } => Boolean(x.node)),
  };
}

/** Nodes connected in either direction, plus the edges between them. */
export async function getNeighbours(
  analysisId: string,
  nodeId: string,
  depth = 1
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const maxDepth = Math.min(Math.max(depth, 1), 3);
  const db = getDb();

  const seenNodes = new Set<string>([nodeId]);
  const seenEdges = new Map<string, GraphEdge>();
  let frontier = [nodeId];

  for (let d = 0; d < maxDepth; d++) {
    if (!frontier.length) break;
    const placeholders = frontier.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT * FROM graph_edges
          WHERE analysis_id = ?
            AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))`
      )
      .all(analysisId, ...frontier, ...frontier)
      .map(rowToEdge);

    const next: string[] = [];
    for (const e of rows) {
      seenEdges.set(e.id, e);
      for (const id of [e.sourceNodeId, e.targetNodeId]) {
        if (!seenNodes.has(id)) {
          seenNodes.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }

  const nodes = await getNodes(analysisId, [...seenNodes]);
  return { nodes, edges: [...seenEdges.values()] };
}

/** Name/path search, used by the graph UI and by graph-aware chat. */
export async function searchGraphNodes(
  analysisId: string,
  query: string,
  limit = 25
): Promise<GraphNode[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getDb()
    .prepare(
      `SELECT * FROM graph_nodes
        WHERE analysis_id = ?
          AND (LOWER(name) LIKE ? OR LOWER(file_path) LIKE ?)
        ORDER BY
          CASE WHEN LOWER(name) = ? THEN 0
               WHEN LOWER(name) LIKE ? THEN 1
               ELSE 2 END,
          LENGTH(name) ASC
        LIMIT ?`
    )
    .all(analysisId, `%${q}%`, `%${q}%`, q, `${q}%`, Math.min(limit, 200))
    .map(rowToNode);
}

/** Nodes for a given file — used to attach findings to graph entities. */
export async function getNodesForFile(
  analysisId: string,
  filePath: string
): Promise<GraphNode[]> {
  return getDb()
    .prepare("SELECT * FROM graph_nodes WHERE analysis_id = ? AND file_path = ?")
    .all(analysisId, filePath)
    .map(rowToNode);
}

/* ------------------------------------------------------------------ */
/* Change impact                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reverse-dependency traversal.
 *
 * Walks incoming edges (who depends on this) breadth-first. Deterministic:
 * the result is a function of the stored graph, never of a model.
 *
 * `CONTAINS` is excluded from the walk — a file "containing" a function is a
 * structural fact, not a dependency, and following it would report the whole
 * repository as impacted.
 */
const IMPACT_EXCLUDED: GraphEdgeType[] = ["CONTAINS", "DEFINES", "EXPORTS"];

export async function analyseChangeImpact(
  analysisId: string,
  originId: string,
  opts: { maxDepth?: number; maxNodes?: number } = {}
): Promise<ChangeImpactResult | null> {
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? 4, 1), 6);
  const maxNodes = Math.min(Math.max(opts.maxNodes ?? 120, 10), 400);

  const db = getDb();
  const origin = await getNode(analysisId, originId);
  if (!origin) return null;

  /* ---- BFS over incoming edges ---- */
  const visited = new Map<
    string,
    { distance: number; via: GraphEdge; path: ImpactPath; types: GraphEdgeType[] }
  >();
  visited.set(originId, {
    distance: 0,
    via: {
      id: "",
      analysisId,
      sourceNodeId: originId,
      targetNodeId: originId,
      relationshipType: "USES",
      confidence: "confirmed",
      evidence: "",
    },
    path: { nodeIds: [originId], edgeIds: [], description: "" },
    types: [],
  });

  const nodesById = new Map<string, GraphNode>([[origin.id, origin]]);
  let frontier = [originId];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (!frontier.length || visited.size >= maxNodes) {
      if (frontier.length) truncated = true;
      break;
    }

    const placeholders = frontier.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT * FROM graph_edges
          WHERE analysis_id = ?
            AND target_node_id IN (${placeholders})
            AND relationship_type NOT IN (${IMPACT_EXCLUDED.map(() => "?").join(",")})`
      )
      .all(analysisId, ...frontier, ...IMPACT_EXCLUDED)
      .map(rowToEdge);

    const next: string[] = [];
    for (const edge of rows) {
      if (visited.has(edge.sourceNodeId)) continue;
      const parent = visited.get(edge.targetNodeId);
      if (!parent) continue;

      const path: ImpactPath = {
        nodeIds: [edge.sourceNodeId, ...parent.path.nodeIds],
        edgeIds: [edge.id, ...parent.path.edgeIds],
        // Filled in below once node names are known — an id is not a
        // description anyone can read.
        description: "",
      };
      visited.set(edge.sourceNodeId, {
        distance: depth,
        via: edge,
        path,
        types: [edge.relationshipType, ...parent.types],
      });
      next.push(edge.sourceNodeId);
      if (visited.size >= maxNodes) {
        truncated = true;
        break;
      }
    }
    frontier = next;
  }

  /* ---- hydrate ---- */
  const affectedIds = [...visited.keys()].filter((id) => id !== originId);
  const affected = await getNodes(analysisId, affectedIds);
  for (const n of affected) nodesById.set(n.id, n);

  /** Render a path as `a —CALLS→ b —IMPORTS→ c` using real node names. */
  const describePath = (nodeIds: string[], types: GraphEdgeType[]): string => {
    const names = nodeIds.map((nid) => nodesById.get(nid)?.name ?? nid);
    let out = names[0] ?? "";
    for (let i = 0; i < types.length; i++) {
      out += ` —${types[i]}→ ${names[i + 1] ?? "?"}`;
    }
    return out;
  };

  const entities: ImpactedEntity[] = affected
    .map((node) => {
      const v = visited.get(node.id)!;
      return {
        node,
        distance: v.distance,
        viaRelationship: v.via.relationshipType,
        path: {
          ...v.path,
          description: describePath(v.path.nodeIds, v.types),
        },
      };
    })
    .sort((a, b) => a.distance - b.distance || a.node.name.localeCompare(b.node.name));

  // "Related" is not only "depends on me". A route that exposes the changed
  // file, or a model it reads or writes, is affected too — and those are
  // *outgoing* edges, which the dependent walk above deliberately ignores.
  const relatedIds = new Set<string>();
  const scope = [...visited.keys()];
  if (scope.length) {
    const placeholders = scope.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT target_node_id AS id FROM graph_edges
          WHERE analysis_id = ?
            AND source_node_id IN (${placeholders})
            AND relationship_type IN ('EXPOSES_ROUTE','USES','QUERIES','WRITES')`
      )
      .all(analysisId, ...scope);
    for (const r of rows) relatedIds.add(asString(r.id));
  }

  const related = (await getNodes(analysisId, [...relatedIds])).filter(
    (n) => !visited.has(n.id)
  );

  const apiRoutes = [
    ...entities.filter((e) => e.node.nodeType === "api_endpoint").map((e) => e.node),
    ...related.filter((n) => n.nodeType === "api_endpoint"),
  ].filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);

  const dbModels = [
    ...entities
      .filter((e) => e.node.nodeType === "db_model" || e.node.nodeType === "db_table")
      .map((e) => e.node),
    ...related.filter((n) => n.nodeType === "db_model" || n.nodeType === "db_table"),
  ].filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);

  const tests = [
    ...entities.filter((e) => e.node.nodeType === "test").map((e) => e.node),
    ...related.filter((n) => n.nodeType === "test"),
  ].filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);

  // Tests that target the origin or any affected file directly.
  const testRows = db
    .prepare(
      `SELECT n.* FROM graph_nodes n
         JOIN graph_edges e ON e.source_node_id = n.id
        WHERE e.analysis_id = ? AND e.relationship_type = 'TESTS'
          AND e.target_node_id IN (${[...visited.keys()].map(() => "?").join(",") || "''"})`
    )
    .all(analysisId, ...visited.keys())
    .map(rowToNode);
  for (const t of testRows) {
    if (!tests.some((x) => x.id === t.id)) tests.push(t);
  }

  /* ---- risks, stated as evidence rather than prediction ---- */
  const risks: string[] = [];
  if (apiRoutes.length) {
    risks.push(
      `${apiRoutes.length} API endpoint${apiRoutes.length === 1 ? "" : "s"} reach this code, so a change is externally observable: ${apiRoutes
        .slice(0, 4)
        .map((r) => r.name)
        .join(", ")}${apiRoutes.length > 4 ? ", …" : ""}.`
    );
  }
  if (dbModels.length) {
    risks.push(
      `It reads or writes ${dbModels.length} database model${dbModels.length === 1 ? "" : "s"} (${dbModels
        .slice(0, 4)
        .map((m) => m.name)
        .join(", ")}), so a change may affect persisted data.`
    );
  }
  if (!tests.length) {
    risks.push(
      "No test was found that covers this entity or its dependents — changes here are unverified by the existing suite."
    );
  } else {
    risks.push(
      `${tests.length} test file${tests.length === 1 ? "" : "s"} cover this area; update them alongside the change.`
    );
  }
  if (!entities.length) {
    risks.push(
      "Nothing in the analysed files depends on this entity, so the blast radius appears contained — but only the files that were parsed can be checked."
    );
  }
  if (truncated) {
    risks.push(
      `The traversal stopped at ${maxNodes} nodes, so further dependents may exist beyond what is listed.`
    );
  }

  return {
    analysisId,
    origin,
    direct: entities.filter((e) => e.distance === 1),
    indirect: entities.filter((e) => e.distance > 1),
    apiRoutes,
    dbModels,
    tests,
    relatedFindings: [],
    risks,
    truncated,
  };
}

/** Attach report findings to an impact result by file path. */
export function findingsForImpact(
  findings: Finding[],
  result: ChangeImpactResult
): ChangeImpactResult {
  const files = new Set(
    [
      result.origin.filePath,
      ...result.direct.map((e) => e.node.filePath),
      ...result.indirect.map((e) => e.node.filePath),
    ].filter((p): p is string => Boolean(p))
  );

  return {
    ...result,
    relatedFindings: findings
      .filter((f) => f.filePath && files.has(f.filePath))
      .slice(0, 25)
      .map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        filePath: f.filePath,
      })),
  };
}
