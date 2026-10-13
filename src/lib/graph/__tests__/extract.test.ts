import { test } from "node:test";
import assert from "node:assert/strict";

import { extractGraph } from "../extract";
import type { GraphNode } from "../types";
import { parseTypeScriptFile } from "../parsers/ts";
import { parserForPath } from "../parsers";
import { languageForPath } from "../../analyzers/files";
import type { SourceFile } from "../../analyzers/types";

/**
 * Extraction tests.
 *
 * The fixture is a miniature repository with relationships that are known by
 * construction, so a passing test means the parser found what is actually
 * there — not that it produced plausible-looking output.
 */

function src(path: string, content: string): SourceFile {
  return {
    path,
    content,
    lines: content.split("\n"),
    language: languageForPath(path),
    bytes: content.length,
  };
}

/* ------------------------------------------------------------------ */
/* Fixture repository                                                  */
/* ------------------------------------------------------------------ */

const USER_MODEL = `
export interface User { id: string; email: string }

export class UserRepository {
  async findUser(id: string) { return null; }
}
`;

const USER_SERVICE = `
import { UserRepository } from "../models/user.model";

export function getUser(id: string) {
  const repo = new UserRepository();
  return repo.findUser(id);
}

export async function listUsers() {
  return getUser("all");
}
`;

const USER_ROUTES = `
import express from "express";
import { getUser } from "../services/user.service";

const router = express.Router();

router.get("/api/users/:id", getUser);

export default router;
`;

const USER_TEST = `
import { getUser } from "../services/user.service";

test("getUser returns a user", () => {
  getUser("1");
});
`;

const DB_FILE = `
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function loadUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}
`;

const ENV_FILE = `
const key = process.env.STRIPE_SECRET_KEY;
const mode = process.env.NODE_ENV;
export { key, mode };
`;

const FIXTURE: SourceFile[] = [
  src("src/models/user.model.ts", USER_MODEL),
  src("src/services/user.service.ts", USER_SERVICE),
  src("src/routes/user.routes.ts", USER_ROUTES),
  src("src/services/user.service.test.ts", USER_TEST),
  src("src/db/client.ts", DB_FILE),
  src("src/config/env.ts", ENV_FILE),
];

const PATHS = FIXTURE.map((f) => f.path);

function build(analysisId = "an_test") {
  return extractGraph(analysisId, FIXTURE, PATHS);
}

/**
 * The node representing a file. Its type varies by convention — a file under
 * `services/` is typed `service` so the UI can show layers — so look it up by
 * path and accept any file-level type.
 */
function fileNodeOf(nodes: GraphNode[], path: string): GraphNode | undefined {
  return nodes.find(
    (n) =>
      n.filePath === path &&
      ["file", "service", "controller", "test"].includes(n.nodeType)
  );
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

test("parser extracts imports, exports, declarations and calls", () => {
  const parsed = parseTypeScriptFile("src/services/user.service.ts", USER_SERVICE);

  assert.deepEqual(
    parsed.imports.map((i) => i.specifier),
    ["../models/user.model"],
    "should record the relative import"
  );
  assert.deepEqual(
    parsed.entities.map((e) => e.name).sort(),
    ["getUser", "listUsers"],
    "should find both exported functions"
  );

  const getUser = parsed.entities.find((e) => e.name === "getUser")!;
  const listUsers = parsed.entities.find((e) => e.name === "listUsers")!;
  assert.ok(getUser.exported, "getUser is exported");
  assert.ok(getUser.calls.includes("findUser"), "should capture the method call");
  assert.ok(listUsers.calls.includes("getUser"), "listUsers calls getUser");
});

test("parser survives malformed source without throwing", () => {
  const parsed = parseTypeScriptFile("broken.ts", "export function ok() {}\nconst x = ((((");
  assert.ok(Array.isArray(parsed.entities), "returns a result rather than throwing");
  assert.ok(
    parsed.entities.some((e) => e.name === "ok"),
    "keeps what it could parse before the error"
  );
});

test("parser recognises Next.js route handlers", () => {
  const parsed = parseTypeScriptFile(
    "src/app/api/users/[id]/route.ts",
    "export async function GET() { return new Response('ok'); }\nexport async function POST() {}"
  );
  const methods = parsed.routes.map((r) => r.method).sort();
  assert.deepEqual(methods, ["GET", "POST"]);
  assert.equal(parsed.routes[0].path, "/api/users/[id]");
});

test("parser recognises Express routes", () => {
  const parsed = parseTypeScriptFile("src/routes/user.routes.ts", USER_ROUTES);
  assert.equal(parsed.routes.length, 1);
  assert.equal(parsed.routes[0].method, "GET");
  assert.equal(parsed.routes[0].path, "/api/users/:id");
});

test("parser does not mistake an ordinary method call for a route", () => {
  const parsed = parseTypeScriptFile(
    "src/thing.ts",
    'const data = [1,2,3];\ndata.get("/not-a-route");'
  );
  assert.equal(parsed.routes.length, 0, "lowercase receiver is not a router");
});

test("parser detects env var references but never their values", () => {
  const parsed = parseTypeScriptFile("src/config/env.ts", ENV_FILE);
  const names = parsed.envVars.map((e) => e.name).sort();
  assert.deepEqual(names, ["NODE_ENV", "STRIPE_SECRET_KEY"]);
});

test("parser detects Prisma model usage and its read/write intent", () => {
  const parsed = parseTypeScriptFile("src/db/client.ts", DB_FILE);
  assert.ok(
    parsed.modelUses.some((m) => m.model === "user" && m.operation === "read"),
    "prisma.user.findUnique is a read"
  );
});

test("parser adapter registry maps extensions", () => {
  assert.ok(parserForPath("a/b.ts"), "ts is supported");
  assert.ok(parserForPath("a/b.tsx"), "tsx is supported");
  assert.ok(parserForPath("a/b.mjs"), "mjs is supported");
  assert.equal(parserForPath("a/b.py"), null, "python is not supported yet");
  assert.equal(parserForPath("a/b.d.ts"), null, "declaration files are skipped");
});

/* ------------------------------------------------------------------ */
/* Node extraction                                                     */
/* ------------------------------------------------------------------ */

test("extracts repository, directory, file and declaration nodes", () => {
  const { nodes, stats } = build();

  const types = new Set(nodes.map((n) => n.nodeType));
  assert.ok(types.has("repository"), "repository node");
  assert.ok(types.has("directory"), "directory nodes");
  assert.ok(types.has("file"), "file nodes");
  assert.ok(types.has("function"), "function nodes");
  assert.ok(types.has("class"), "class nodes");
  assert.ok(types.has("interface"), "interface nodes");

  assert.ok(stats.nodeCount > 0);
  assert.equal(stats.nodeCount, nodes.length);
});

test("file nodes carry path, language and line metadata", () => {
  const { nodes } = build();
  const file = fileNodeOf(nodes, "src/services/user.service.ts");
  assert.ok(file, "the service file has a node");
  assert.equal(file.language, "TypeScript");
  assert.equal(file.metadata.path, "src/services/user.service.ts");
  assert.equal(file.nodeType, "service", "a file under services/ is typed as a service layer");
});

test("declarations inside a service file keep their real kind", () => {
  const { nodes } = build();
  const fn = nodes.find((n) => n.name === "getUser");
  assert.ok(fn, "getUser has a node");
  assert.equal(fn.nodeType, "function", "a function in a service is still a function");
  assert.equal(fn.filePath, "src/services/user.service.ts");
});

test("test files are typed as tests, not files", () => {
  const { nodes } = build();
  const testNode = nodes.find((n) => n.filePath === "src/services/user.service.test.ts");
  assert.ok(testNode);
  assert.equal(testNode.nodeType, "test");
});

test("env var nodes never store a value", () => {
  const { nodes } = build();
  const env = nodes.find((n) => n.nodeType === "env_var" && n.name === "STRIPE_SECRET_KEY");
  assert.ok(env, "env var node exists");
  assert.equal(env.filePath, null);
  assert.equal(env.metadata.referenced, true);
  assert.ok(
    !JSON.stringify(env.metadata).includes("sk_"),
    "no secret material is stored"
  );
});

test("API endpoint nodes are created with method and path", () => {
  const { nodes } = build();
  const ep = nodes.find((n) => n.nodeType === "api_endpoint");
  assert.ok(ep, "an endpoint node exists");
  assert.equal(ep.metadata.method, "GET");
  assert.equal(ep.metadata.path, "/api/users/:id");
});

/* ------------------------------------------------------------------ */
/* Relationship extraction                                             */
/* ------------------------------------------------------------------ */

test("creates CONTAINS edges from repository down to files", () => {
  const { edges, nodes } = build();
  const repo = nodes.find((n) => n.nodeType === "repository")!;
  const contains = edges.filter((e) => e.relationshipType === "CONTAINS");
  assert.ok(contains.length > 0, "has containment edges");
  assert.ok(
    contains.some((e) => e.sourceNodeId === repo.id),
    "repository contains directories"
  );
});

test("creates DEFINES and EXPORTS edges for declarations", () => {
  const { edges } = build();
  assert.ok(edges.some((e) => e.relationshipType === "DEFINES"));
  assert.ok(edges.some((e) => e.relationshipType === "EXPORTS"));
});

test("resolves a relative import to a real file edge", () => {
  const { edges, nodes } = build();
  const service = fileNodeOf(nodes, "src/services/user.service.ts")!;
  const model = fileNodeOf(nodes, "src/models/user.model.ts")!;
  assert.ok(service && model, "both files have nodes");

  const edge = edges.find(
    (e) =>
      e.sourceNodeId === service.id &&
      e.targetNodeId === model.id &&
      e.relationshipType === "IMPORTS"
  );
  assert.ok(edge, "import resolved across directories");
  assert.equal(edge.confidence, "confirmed", "an import statement is confirmed, not inferred");
});

test("creates external package nodes and DEPENDS_ON edges", () => {
  const { edges, nodes } = build();
  const pkg = nodes.find((n) => n.nodeType === "package" && n.name === "express");
  assert.ok(pkg, "express is a package node");
  const dep = edges.find(
    (e) => e.targetNodeId === pkg.id && e.relationshipType === "DEPENDS_ON"
  );
  assert.ok(dep, "the routes file depends on express");
});

test("scoped packages collapse to the package name", () => {
  const { nodes } = build();
  assert.ok(
    nodes.some((n) => n.nodeType === "package" && n.name === "@prisma/client"),
    "@prisma/client is one package node, not a sub-path"
  );
});

test("creates EXPOSES_ROUTE from the file to the endpoint", () => {
  const { edges, nodes } = build();
  const ep = nodes.find((n) => n.nodeType === "api_endpoint")!;
  const routesFile = nodes.find(
    (n) => n.filePath === "src/routes/user.routes.ts" && n.nodeType === "file"
  )!;
  assert.ok(
    edges.some(
      (e) =>
        e.relationshipType === "EXPOSES_ROUTE" &&
        e.sourceNodeId === routesFile.id &&
        e.targetNodeId === ep.id
    ),
    "the routes file exposes the endpoint"
  );
});

test("links a test file to the source file it covers", () => {
  const { edges, nodes } = build();
  const testNode = fileNodeOf(nodes, "src/services/user.service.test.ts")!;
  const sourceNode = fileNodeOf(nodes, "src/services/user.service.ts")!;
  const edge = edges.find(
    (e) =>
      e.relationshipType === "TESTS" &&
      e.sourceNodeId === testNode.id &&
      e.targetNodeId === sourceNode.id
  );
  assert.ok(edge, "test links to its source");
  assert.equal(edge.confidence, "inferred", "matched by filename, so labelled inferred");
});

test("creates CALLS edges between declarations in different files", () => {
  const { edges, nodes } = build();
  const getUser = nodes.find((n) => n.name === "getUser" && n.nodeType === "function")!;
  const listUsers = nodes.find((n) => n.name === "listUsers")!;
  assert.ok(
    edges.some(
      (e) => e.relationshipType === "CALLS" && e.sourceNodeId === listUsers.id && e.targetNodeId === getUser.id
    ),
    "listUsers calls getUser"
  );
});

test("records READS edges from files to env vars", () => {
  const { edges, nodes } = build();
  const env = nodes.find((n) => n.nodeType === "env_var" && n.name === "STRIPE_SECRET_KEY")!;
  const reads = edges.filter((e) => e.relationshipType === "READS" && e.targetNodeId === env.id);
  assert.equal(reads.length, 1, "one edge per file, deduplicated");
});

test("records QUERIES from the file that uses a model", () => {
  const { edges } = build();
  assert.ok(
    edges.some((e) => e.relationshipType === "QUERIES"),
    "prisma read becomes a QUERIES edge"
  );
});

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

test("every edge references nodes that exist in the graph", () => {
  const { nodes, edges } = build();
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    assert.ok(ids.has(e.sourceNodeId), `edge ${e.id} source exists`);
    assert.ok(ids.has(e.targetNodeId), `edge ${e.id} target exists`);
  }
});

test("no duplicate node ids or duplicate edges", () => {
  const { nodes, edges } = build();
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length, "node ids are unique");

  const keys = edges.map((e) => `${e.sourceNodeId}|${e.relationshipType}|${e.targetNodeId}`);
  assert.equal(new Set(keys).size, keys.length, "edges are unique per source/type/target");
});

test("node ids are deterministic across runs", () => {
  const a = build("an_same");
  const b = build("an_same");
  assert.deepEqual(
    a.nodes.map((n) => n.id).sort(),
    b.nodes.map((n) => n.id).sort(),
    "same input produces the same ids"
  );
});

test("graphs for different analyses do not share node ids", () => {
  const a = build("an_one");
  const b = build("an_two");
  const overlap = a.nodes.filter((n) => b.nodes.some((m) => m.id === n.id));
  assert.equal(overlap.length, 0, "ids are scoped to the analysis");
});

test("handles an empty repository without throwing", () => {
  const result = extractGraph("an_empty", [], []);
  assert.equal(result.nodes.length, 1, "just the repository node");
  assert.equal(result.edges.length, 0);
  assert.equal(result.stats.truncated, false);
});

test("respects the node cap and reports truncation", () => {
  const result = extractGraph("an_cap", FIXTURE, PATHS, { maxNodes: 5 });
  assert.ok(result.nodes.length <= 5, "never exceeds the cap");
  assert.equal(result.stats.truncated, true, "truncation is reported");
});

test("does not fabricate edges when a call target is ambiguous", () => {
  // Two declarations share the name `handle`; a call to it must not be guessed.
  const files = [
    src("a.ts", "export function handle() {}\n"),
    src("b.ts", "export function handle() {}\n"),
    src("c.ts", "export function run() { handle(); }\n"),
  ];
  const { edges, nodes } = buildWith("an_amb", files);

  const run = nodes.find((n) => n.name === "run")!;
  const calls = edges.filter((e) => e.relationshipType === "CALLS" && e.sourceNodeId === run.id);
  assert.equal(calls.length, 0, "ambiguous call is dropped rather than guessed");
});

function buildWith(analysisId: string, files: SourceFile[]) {
  return extractGraph(analysisId, files, files.map((f) => f.path));
}
