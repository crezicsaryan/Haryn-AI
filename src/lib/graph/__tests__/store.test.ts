import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Persistence and traversal tests.
 *
 * Run against a throwaway SQLite file so they never touch the development
 * database. `getDb()` is lazy, so setting DATABASE_FILE at module scope is
 * enough — the connection is not opened until the first store call.
 */

const TMP = mkdtempSync(join(tmpdir(), "haryn-graph-test-"));
process.env.DATABASE_FILE = join(TMP, "graph-test.db");

import {
  analyseChangeImpact,
  deleteGraph,
  getNeighbourhood,
  getNeighbours,
  getNode,
  getNodesForFile,
  graphStats,
  hasGraph,
  loadGraph,
  saveGraph,
  searchGraphNodes,
} from "../store";
import { createAnalysis } from "../../store";
import type { GraphEdge, GraphNode } from "../types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const A = "an_graphtest1";
const B = "an_graphtest2";

function node(
  analysisId: string,
  id: string,
  nodeType: GraphNode["nodeType"],
  name: string,
  filePath: string | null = null,
  startLine: number | null = null
): GraphNode {
  return {
    id,
    analysisId,
    nodeType,
    name,
    filePath,
    startLine,
    endLine: startLine,
    language: filePath ? "TypeScript" : null,
    metadata: {},
  };
}

function edge(
  analysisId: string,
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  relationshipType: GraphEdge["relationshipType"],
  confidence: GraphEdge["confidence"] = "confirmed"
): GraphEdge {
  return {
    id,
    analysisId,
    sourceNodeId,
    targetNodeId,
    relationshipType,
    confidence,
    evidence: `${sourceNodeId} ${relationshipType} ${targetNodeId}`,
  };
}

/**
 * A deliberate dependency chain:
 *
 *   route.ts --IMPORTS--> controller.ts --IMPORTS--> service.ts --CALLS--> helper
 *   route.ts --EXPOSES_ROUTE--> GET /api/orders
 *   service.ts --QUERIES--> Order (db model)
 *   order.test.ts --TESTS--> service.ts
 */
const NODES: GraphNode[] = [
  node(A, "n_route", "file", "route.ts", "src/route.ts", 1),
  node(A, "n_controller", "file", "controller.ts", "src/controller.ts", 1),
  node(A, "n_service", "service", "service.ts", "src/service.ts", 1),
  node(A, "n_helper", "function", "helper", "src/service.ts", 10),
  node(A, "n_endpoint", "api_endpoint", "GET /api/orders", "src/route.ts", 5),
  node(A, "n_model", "db_model", "Order", null, null),
  node(A, "n_test", "test", "order.test.ts", "src/order.test.ts", 1),
  node(A, "n_isolated", "file", "lonely.ts", "src/lonely.ts", 1),
];

const EDGES: GraphEdge[] = [
  edge(A, "e_1", "n_route", "n_controller", "IMPORTS"),
  edge(A, "e_2", "n_controller", "n_service", "IMPORTS"),
  edge(A, "e_3", "n_service", "n_helper", "CALLS", "inferred"),
  edge(A, "e_4", "n_route", "n_endpoint", "EXPOSES_ROUTE"),
  edge(A, "e_5", "n_service", "n_model", "QUERIES", "inferred"),
  edge(A, "e_6", "n_test", "n_service", "TESTS", "inferred"),
  // Structural edges must NOT be followed by impact analysis.
  edge(A, "e_7", "n_route", "n_controller", "CONTAINS"),
];

before(async () => {
  await createAnalysis(A, {
    owner: "acme",
    name: "graph-test-a",
    fullName: "acme/graph-test-a",
    url: "https://github.com/acme/graph-test-a",
    defaultBranch: "main",
  });
  await createAnalysis(B, {
    owner: "acme",
    name: "graph-test-b",
    fullName: "acme/graph-test-b",
    url: "https://github.com/acme/graph-test-b",
    defaultBranch: "main",
  });

  await saveGraph(A, NODES, EDGES);
  // A different analysis with a node that reuses the same id on purpose.
  await saveGraph(
    B,
    [node(B, "n_route", "file", "other-route.ts", "src/other.ts", 1)],
    []
  );
});

after(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* the OS will clean up */
  }
});

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

test("saves and reads back nodes and edges", async () => {
  assert.equal(await hasGraph(A), true);

  const stats = await graphStats(A);
  assert.equal(stats.nodeCount, NODES.length);
  assert.equal(stats.edgeCount, EDGES.length);
  assert.equal(stats.byNodeType.file, 3, "route, controller and lonely are files");
  assert.equal(stats.byNodeType.test, 1);
});

test("preserves node metadata and line numbers", async () => {
  const n = await getNode(A, "n_helper");
  assert.ok(n);
  assert.equal(n.name, "helper");
  assert.equal(n.nodeType, "function");
  assert.equal(n.filePath, "src/service.ts");
  assert.equal(n.startLine, 10);
});

test("re-saving is idempotent and cannot duplicate edges", async () => {
  await saveGraph(A, NODES, EDGES);
  await saveGraph(A, NODES, EDGES);

  const stats = await graphStats(A);
  assert.equal(stats.nodeCount, NODES.length, "no duplicate nodes");
  assert.equal(stats.edgeCount, EDGES.length, "no duplicate edges");
});

test("preserves the confirmed vs inferred distinction", async () => {
  const { edges } = await loadGraph(A, { limit: 100 });
  const imports = edges.find((e) => e.id === "e_1");
  const calls = edges.find((e) => e.id === "e_3");
  assert.equal(imports?.confidence, "confirmed");
  assert.equal(calls?.confidence, "inferred");
});

test("loads with a node-type filter", async () => {
  const { nodes } = await loadGraph(A, { nodeTypes: ["api_endpoint", "db_model"] });
  assert.equal(nodes.length, 2);
  assert.ok(nodes.every((n) => n.nodeType === "api_endpoint" || n.nodeType === "db_model"));
});

test("an edge is never returned without both endpoints", async () => {
  const { nodes, edges } = await loadGraph(A, { nodeTypes: ["db_model"] });
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    assert.ok(ids.has(e.sourceNodeId) && ids.has(e.targetNodeId), "edge endpoints present");
  }
});

test("searches nodes by name", async () => {
  const hits = await searchGraphNodes(A, "service");
  assert.ok(hits.length > 0);
  assert.ok(hits.some((n) => n.name === "service.ts"));
});

test("finds nodes belonging to a file", async () => {
  const nodes = await getNodesForFile(A, "src/service.ts");
  assert.equal(nodes.length, 2, "the service file node and the helper function");
});

/* ------------------------------------------------------------------ */
/* Traversal                                                           */
/* ------------------------------------------------------------------ */

test("returns incoming and outgoing relationships for a node", async () => {
  const hood = await getNeighbourhood(A, "n_service");
  assert.ok(hood);
  assert.equal(hood.node.name, "service.ts");

  const outTypes = hood.outgoing.map((o) => o.edge.relationshipType).sort();
  assert.deepEqual(outTypes, ["CALLS", "QUERIES"], "calls the helper and queries the model");

  const inTypes = hood.incoming.map((o) => o.edge.relationshipType).sort();
  assert.deepEqual(inTypes, ["IMPORTS", "TESTS"], "imported by the controller, tested");
});

test("returns null for a node that does not exist", async () => {
  assert.equal(await getNeighbourhood(A, "n_does_not_exist"), null);
});

test("expands neighbours by depth", async () => {
  const one = await getNeighbours(A, "n_service", 1);
  const two = await getNeighbours(A, "n_service", 2);

  assert.ok(one.nodes.length >= 4, "depth 1 reaches the model, helper, test and controller");
  assert.ok(
    two.nodes.length >= one.nodes.length,
    "depth 2 reaches at least as far"
  );
  assert.ok(
    two.nodes.some((n) => n.id === "n_route"),
    "depth 2 reaches the route through the controller"
  );
});

/* ------------------------------------------------------------------ */
/* Change impact                                                       */
/* ------------------------------------------------------------------ */

test("change impact finds direct and indirect dependents", async () => {
  const impact = await analyseChangeImpact(A, "n_service");
  assert.ok(impact);

  const directIds = impact.direct.map((d) => d.node.id).sort();
  assert.deepEqual(directIds, ["n_controller", "n_test"], "imported by controller, tested by test");

  const indirectIds = impact.indirect.map((d) => d.node.id);
  assert.ok(indirectIds.includes("n_route"), "the route is indirectly affected");
  assert.equal(impact.indirect.every((d) => d.distance > 1), true);
});

test("change impact surfaces API routes and database models", async () => {
  const impact = await analyseChangeImpact(A, "n_service");
  assert.ok(impact);
  assert.ok(impact.apiRoutes.some((r) => r.name === "GET /api/orders"));
  assert.ok(impact.dbModels.some((m) => m.name === "Order"));
  assert.ok(impact.tests.some((t) => t.name === "order.test.ts"));
});

test("change impact does not follow containment edges", async () => {
  // `n_route --CONTAINS--> n_controller` exists, but a file containing another
  // is not a dependency. Starting at the controller must not report the route
  // through that edge alone.
  const impact = await analyseChangeImpact(A, "n_helper");
  assert.ok(impact);
  const ids = [...impact.direct, ...impact.indirect].map((d) => d.node.id);
  assert.ok(ids.includes("n_service"), "the caller is a real dependent");
});

test("every impact result carries the relationship path that produced it", async () => {
  const impact = await analyseChangeImpact(A, "n_service");
  assert.ok(impact);
  for (const d of [...impact.direct, ...impact.indirect]) {
    assert.ok(d.path.description.length > 0, "path is described");
    assert.ok(
      d.path.description.includes("→"),
      "the description shows the relationships, not raw ids"
    );
    assert.ok(
      !/^n_[a-z0-9]+ —/.test(d.path.description),
      "the path starts with a readable name, not a node id"
    );
  }
});

test("impact on an isolated node reports a contained blast radius", async () => {
  const impact = await analyseChangeImpact(A, "n_isolated");
  assert.ok(impact);
  assert.equal(impact.direct.length, 0);
  assert.equal(impact.indirect.length, 0);
  assert.ok(
    impact.risks.some((r) => /nothing in the analysed files depends/i.test(r)),
    "says so plainly instead of returning silence"
  );
});

test("impact for an unknown node returns null rather than inventing one", async () => {
  assert.equal(await analyseChangeImpact(A, "n_missing"), null);
});

test("impact traversal respects the depth limit", async () => {
  const shallow = await analyseChangeImpact(A, "n_service", { maxDepth: 1 });
  assert.ok(shallow);
  assert.equal(shallow.indirect.length, 0, "depth 1 cannot reach indirect dependents");
});

/* ------------------------------------------------------------------ */
/* Isolation                                                           */
/* ------------------------------------------------------------------ */

test("the same node id in another analysis is a different node", async () => {
  const a = await getNode(A, "n_route");
  const b = await getNode(B, "n_route");
  assert.ok(a && b);
  assert.notEqual(a.name, b.name, "each analysis has its own node");
});

test("node lookups never leak across analyses", async () => {
  // `n_controller` exists only in analysis A.
  assert.ok(await getNode(A, "n_controller"));
  assert.equal(await getNode(B, "n_controller"), null, "not visible from analysis B");
});

test("impact analysis cannot traverse into another analysis", async () => {
  assert.equal(await analyseChangeImpact(B, "n_controller"), null);
});

test("deleting one graph leaves the other intact", async () => {
  await deleteGraph(B);
  assert.equal(await hasGraph(B), false);
  assert.equal(await hasGraph(A), true);

  const stats = await graphStats(A);
  assert.equal(stats.nodeCount, NODES.length);
});

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

test("an analysis with no graph reports empty rather than erroring", async () => {
  const C = "an_graphtest3";
  await createAnalysis(C, {
    owner: "acme",
    name: "graph-test-c",
    fullName: "acme/graph-test-c",
    url: "https://github.com/acme/graph-test-c",
    defaultBranch: "main",
  });

  assert.equal(await hasGraph(C), false);
  const stats = await graphStats(C);
  assert.equal(stats.nodeCount, 0);
  assert.equal(stats.edgeCount, 0);

  const { nodes, edges } = await loadGraph(C, {});
  assert.equal(nodes.length, 0);
  assert.equal(edges.length, 0);

  await saveGraph(C, [], []);
  assert.equal((await graphStats(C)).nodeCount, 0);
});
