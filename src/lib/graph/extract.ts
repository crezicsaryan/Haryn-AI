import type { SourceFile } from "../analyzers/types";
import { hashString } from "../utils";
import { LIMITS } from "../constants";
import { parserForPath, UNSUPPORTED_EXTENSIONS, type ParsedFile } from "./parsers";
import type {
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  GraphStats,
} from "./types";

/**
 * Build a knowledge graph from parsed source files.
 *
 * Design rules that matter:
 *
 * - **Evidence only.** A node exists because a declaration was found; an edge
 *   exists because the syntax (or a resolved reference) says so. When a call
 *   cannot be resolved to exactly one declaration it is dropped rather than
 *   guessed — a graph with invented edges is worse than a sparse one.
 * - **Confirmed vs inferred.** `import` statements and `extends` clauses are
 *   *confirmed*: the syntax states them. Cross-file name resolution is
 *   *inferred*, because the same name could exist in several modules.
 * - **Bounded.** A large repository can produce tens of thousands of nodes, so
 *   both node and edge counts are capped and the cap is reported.
 */

export interface ExtractResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

interface FileRecord {
  path: string;
  language: string;
  parsed: ParsedFile;
  /** Node id for this file. */
  fileNodeId: string;
  /** Names declared in this file → node id. */
  declared: Map<string, string>;
}

const TEST_PATH_RE =
  /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[jt]sx?$|(^|\/)[^/]*\.(test|spec)\.[jt]sx?$/i;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function nodeId(analysisId: string, kind: string, key: string): string {
  return `n_${hashString(`${analysisId}|${kind}|${key}`)}`;
}

function edgeId(analysisId: string, source: string, type: string, target: string): string {
  return `e_${hashString(`${analysisId}|${source}|${type}|${target}`)}`;
}

/** Directory chain for a path: `a/b/c.ts` → ["a", "a/b"] */
function directoryChain(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Resolve a relative import specifier to a real path in the repository.
 *
 * Tries the exact path, each source extension, `/index.<ext>`, and the common
 * `@/` → `src/` alias. Returns null when nothing matches, so an unresolvable
 * specifier becomes an external dependency rather than a fabricated edge.
 */
function resolveImport(
  fromPath: string,
  specifier: string,
  knownPaths: Set<string>
): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1);
    const segments = specifier.split("/");
    const stack = [...dir];
    for (const seg of segments) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") stack.pop();
      else stack.push(seg);
    }
    base = stack.join("/");
  } else if (specifier.startsWith("@/")) {
    // tsconfig path alias `@/*` → `src/*`, the conventional setup.
    base = `src/${specifier.slice(2)}`;
  } else {
    return null; // bare specifier → external package
  }

  const candidates: string[] = [base];
  for (const ext of SOURCE_EXTENSIONS) {
    candidates.push(`${base}${ext}`);
    candidates.push(`${base}/index${ext}`);
  }
  // `import "./styles.css"` and similar keep their extension.
  if (/\.[a-z0-9]+$/i.test(base)) candidates.unshift(base);

  for (const c of candidates) {
    if (knownPaths.has(c)) return c;
  }
  return null;
}

/** `src/services/payment.ts` → `payment`, used for test↔source matching. */
function stemOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  return base
    .replace(/\.(test|spec)\.[jt]sx?$/i, "")
    .replace(/\.[jt]sx?$/i, "")
    .toLowerCase();
}

export function extractGraph(
  analysisId: string,
  files: SourceFile[],
  allPaths: string[],
  opts: { maxNodes?: number; maxEdges?: number } = {}
): ExtractResult {
  const maxNodes = opts.maxNodes ?? LIMITS.graphMaxNodes;
  const maxEdges = opts.maxEdges ?? LIMITS.graphMaxEdges;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  let truncated = false;

  const knownPaths = new Set(allPaths);
  const byNodeType: Record<string, number> = {};
  const byEdgeType: Record<string, number> = {};

  /* ---------------- node helpers ---------------- */

  const addNode = (node: GraphNode): boolean => {
    if (nodeIds.has(node.id)) return false;
    if (nodes.length >= maxNodes) {
      truncated = true;
      return false;
    }
    nodeIds.add(node.id);
    nodes.push(node);
    byNodeType[node.nodeType] = (byNodeType[node.nodeType] ?? 0) + 1;
    return true;
  };

  const addEdge = (
    source: string,
    target: string,
    relationshipType: GraphEdgeType,
    confidence: "confirmed" | "inferred",
    evidence: string
  ): void => {
    if (source === target) return;
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}|${relationshipType}|${target}`;
    if (edgeKeys.has(key)) return;
    if (edges.length >= maxEdges) {
      truncated = true;
      return;
    }
    edgeKeys.add(key);
    edges.push({
      id: edgeId(analysisId, source, relationshipType, target),
      analysisId,
      sourceNodeId: source,
      targetNodeId: target,
      relationshipType,
      confidence,
      evidence,
    });
    byEdgeType[relationshipType] = (byEdgeType[relationshipType] ?? 0) + 1;
  };

  /* ---------------- repository + directories ---------------- */

  const repoNodeId = nodeId(analysisId, "repository", "root");
  addNode({
    id: repoNodeId,
    analysisId,
    nodeType: "repository",
    name: "repository",
    filePath: null,
    startLine: null,
    endLine: null,
    language: null,
    metadata: { fileCount: files.length },
  });

  const dirNodeIds = new Map<string, string>();
  const ensureDir = (dir: string): string => {
    const existing = dirNodeIds.get(dir);
    if (existing) return existing;
    const id = nodeId(analysisId, "directory", dir);
    const created = addNode({
      id,
      analysisId,
      nodeType: "directory",
      name: dir.split("/").pop() ?? dir,
      filePath: dir,
      startLine: null,
      endLine: null,
      language: null,
      metadata: { path: dir, depth: dir.split("/").length },
    });
    if (!created) return repoNodeId;
    dirNodeIds.set(dir, id);
    // Link to the parent directory, or the repository for a top-level dir.
    const parent = dir.includes("/") ? dir.split("/").slice(0, -1).join("/") : null;
    addEdge(parent ? ensureDir(parent) : repoNodeId, id, "CONTAINS", "confirmed", `directory ${dir}`);
    return id;
  };

  /* ---------------- parse every file ---------------- */

  const records: FileRecord[] = [];
  const unsupportedPaths: string[] = [];
  let parseFailures = 0;

  for (const file of files) {
    const parser = parserForPath(file.path);
    if (!parser) {
      const ext = (file.path.split(".").pop() ?? "").toLowerCase();
      if (UNSUPPORTED_EXTENSIONS.has(ext)) unsupportedPaths.push(file.path);
      continue;
    }

    const parsed = parser.parse(file.path, file.content);
    if (parsed.parseError) parseFailures += 1;

    records.push({
      path: file.path,
      language: file.language,
      parsed,
      fileNodeId: nodeId(analysisId, "file", file.path),
      declared: new Map(),
    });
  }

  /* ---------------- file nodes ---------------- */

  for (const rec of records) {
    const isTest = TEST_PATH_RE.test(rec.path);
    // The *file* carries the layer classification (controller / service), which
    // is what the UI wants to distinguish. Declarations keep their real kind —
    // a function inside a service is still a function, and collapsing the two
    // would throw away information the graph is supposed to hold.
    const fileType: GraphNodeType = isTest
      ? "test"
      : /controller/i.test(rec.path)
        ? "controller"
        : /service/i.test(rec.path)
          ? "service"
          : "file";

    addNode({
      id: rec.fileNodeId,
      analysisId,
      nodeType: fileType,
      name: rec.path.split("/").pop() ?? rec.path,
      filePath: rec.path,
      startLine: 1,
      endLine: null,
      language: rec.language,
      metadata: {
        path: rec.path,
        importedBy: [],
        lines: null,
        isTest,
      },
    });

    const dir = directoryChain(rec.path);
    const parentDir = dir.length ? dir[dir.length - 1] : null;
    addEdge(
      parentDir ? ensureDir(parentDir) : repoNodeId,
      rec.fileNodeId,
      "CONTAINS",
      "confirmed",
      `file ${rec.path}`
    );

    if (rec.parsed.isMiddleware) {
      const midId = nodeId(analysisId, "middleware", rec.path);
      if (
        addNode({
          id: midId,
          analysisId,
          nodeType: "middleware",
          name: rec.path.split("/").pop() ?? rec.path,
          filePath: rec.path,
          startLine: 1,
          endLine: null,
          language: rec.language,
          metadata: { path: rec.path },
        })
      ) {
        addEdge(rec.fileNodeId, midId, "DEFINES", "confirmed", "middleware module");
      }
    }
  }

  /* ---------------- declaration nodes ---------------- */

  const declarationsByName = new Map<string, string[]>();

  for (const rec of records) {
    for (const entity of rec.parsed.entities) {
      const type: GraphNodeType =
        entity.kind === "function" ? "function" : entity.kind === "class" ? "class" : "interface";

      const id = nodeId(analysisId, type, `${rec.path}:${entity.name}:${entity.startLine}`);
      const created = addNode({
        id,
        analysisId,
        nodeType: type,
        name: entity.name,
        filePath: rec.path,
        startLine: entity.startLine,
        endLine: entity.endLine,
        language: rec.language,
        metadata: {
          kind: entity.kind,
          exported: entity.exported,
          methods: entity.methods ?? undefined,
        },
      });
      if (!created) continue;

      rec.declared.set(entity.name, id);
      const list = declarationsByName.get(entity.name);
      if (list) list.push(id);
      else declarationsByName.set(entity.name, [id]);

      addEdge(rec.fileNodeId, id, "DEFINES", "confirmed", `declares ${entity.kind} ${entity.name}`);
      if (entity.exported) {
        addEdge(rec.fileNodeId, id, "EXPORTS", "confirmed", `exported ${entity.kind}`);
      }

      // Inheritance is stated by the syntax, so it is confirmed.
      if (entity.extendsName) {
        const target = declarationsByName.get(entity.extendsName)?.[0];
        if (target) {
          addEdge(id, target, "EXTENDS", "confirmed", `class ${entity.name} extends ${entity.extendsName}`);
        }
      }
      for (const impl of entity.implementsNames ?? []) {
        const target = declarationsByName.get(impl)?.[0];
        if (target) {
          addEdge(id, target, "IMPLEMENTS", "confirmed", `class ${entity.name} implements ${impl}`);
        }
      }
    }
  }

  /* ---------------- API endpoints ---------------- */

  for (const rec of records) {
    for (const route of rec.parsed.routes) {
      const key = `${route.method} ${route.path}`;
      const id = nodeId(analysisId, "api_endpoint", `${key}:${rec.path}`);
      if (
        addNode({
          id,
          analysisId,
          nodeType: "api_endpoint",
          name: key,
          filePath: rec.path,
          startLine: route.line,
          endLine: route.line,
          language: rec.language,
          metadata: { method: route.method, path: route.path, handler: route.handler },
        })
      ) {
        addEdge(
          rec.fileNodeId,
          id,
          "EXPOSES_ROUTE",
          "confirmed",
          `${route.method} ${route.path} registered in ${rec.path}`
        );
        // Link the handler declaration to the endpoint it serves.
        if (route.handler) {
          const handlerNode = rec.declared.get(route.handler);
          if (handlerNode) {
            addEdge(handlerNode, id, "EXPOSES_ROUTE", "confirmed", `handler ${route.handler}`);
          }
        }

        // For an inline handler, link the endpoint to what the handler calls —
        // this is what makes "which functions does this route reach?" answerable.
        for (const call of route.calls ?? []) {
          const bare = call.includes(".") ? call.split(".").pop()! : call;
          if (!bare) continue;
          const local = rec.declared.get(bare);
          if (local && local !== id) {
            addEdge(id, local, "CALLS", "inferred", `${key} handler calls ${bare}`);
            continue;
          }
          const candidates = declarationsByName.get(bare);
          if (candidates && candidates.length === 1 && candidates[0] !== id) {
            addEdge(id, candidates[0], "CALLS", "inferred", `${key} handler calls ${bare}`);
          }
        }
      }
    }
  }

  /* ---------------- database models ---------------- */

  for (const rec of records) {
    for (const decl of rec.parsed.modelDeclarations) {
      const id = nodeId(analysisId, "db_model", decl.name);
      addNode({
        id,
        analysisId,
        nodeType: "db_model",
        name: decl.name,
        filePath: rec.path,
        startLine: decl.line,
        endLine: null,
        language: rec.language,
        metadata: { declaredIn: rec.path },
      });
    }
  }

  /* ---------------- imports + external packages ---------------- */

  const packageNodeIds = new Map<string, string>();

  for (const rec of records) {
    for (const imp of rec.parsed.imports) {
      const resolved = resolveImport(rec.path, imp.specifier, knownPaths);

      if (resolved) {
        const targetId = nodeId(analysisId, "file", resolved);
        if (nodeIds.has(targetId)) {
          addEdge(
            rec.fileNodeId,
            targetId,
            "IMPORTS",
            "confirmed",
            `import "${imp.specifier}"`
          );
        }
        continue;
      }

      // Bare specifier → external package. Sub-paths collapse to the package
      // name: `lodash/fp` is a dependency on `lodash`.
      if (imp.specifier.startsWith(".") || imp.specifier.startsWith("@/")) continue;

      const parts = imp.specifier.split("/");
      const pkgName = imp.specifier.startsWith("@")
        ? parts.slice(0, 2).join("/")
        : parts[0];
      if (!pkgName) continue;

      let pkgId = packageNodeIds.get(pkgName);
      if (!pkgId) {
        pkgId = nodeId(analysisId, "package", pkgName);
        const created = addNode({
          id: pkgId,
          analysisId,
          nodeType: "package",
          name: pkgName,
          filePath: null,
          startLine: null,
          endLine: null,
          language: null,
          metadata: { specifier: pkgName },
        });
        if (created) packageNodeIds.set(pkgName, pkgId);
      }
      addEdge(rec.fileNodeId, pkgId, "DEPENDS_ON", "confirmed", `import "${imp.specifier}"`);
    }
  }

  /* ---------------- environment variables ---------------- */

  for (const rec of records) {
    for (const env of rec.parsed.envVars) {
      const id = nodeId(analysisId, "env_var", env.name);
      if (
        addNode({
          id,
          analysisId,
          nodeType: "env_var",
          name: env.name,
          filePath: null,
          startLine: null,
          endLine: null,
          language: null,
          // Deliberately no value — only the fact that it is referenced.
          metadata: { referenced: true },
        })
      ) {
        // fall through to the edge below
      }
      addEdge(rec.fileNodeId, id, "READS", "confirmed", `reads env ${env.name}`);
    }
  }

  /* ---------------- database usage ---------------- */

  for (const rec of records) {
    for (const use of rec.parsed.modelUses) {
      const id = nodeId(analysisId, "db_model", use.model);
      // A model reached through a recognised ORM client is real evidence that
      // the model exists, even when its declaration lives outside the analysed
      // files (a Prisma schema, a migrations folder). Recorded as such.
      if (!nodeIds.has(id)) {
        const created = addNode({
          id,
          analysisId,
          nodeType: "db_model",
          name: use.model,
          filePath: null,
          startLine: null,
          endLine: null,
          language: null,
          metadata: { declaredIn: null, evidence: "accessed via an ORM client" },
        });
        if (!created) continue;
      }
      const type: GraphEdgeType =
        use.operation === "write" ? "WRITES" : use.operation === "read" ? "QUERIES" : "USES";
      addEdge(rec.fileNodeId, id, type, "inferred", `${use.model} ${use.operation} at line ${use.line}`);
    }
  }

  /* ---------------- test → source relationships ---------------- */

  const sourceByStem = new Map<string, string>();
  for (const rec of records) {
    if (TEST_PATH_RE.test(rec.path)) continue;
    const stem = stemOf(rec.path);
    if (!sourceByStem.has(stem)) sourceByStem.set(stem, rec.path);
  }

  for (const rec of records) {
    if (!TEST_PATH_RE.test(rec.path)) continue;
    const stem = stemOf(rec.path);
    const source = sourceByStem.get(stem);
    if (source) {
      const targetId = nodeId(analysisId, "file", source);
      if (nodeIds.has(targetId)) {
        addEdge(
          rec.fileNodeId,
          targetId,
          "TESTS",
          "inferred",
          `${rec.path} matches source ${source} by filename`
        );
      }
    }
    // Also link to any source file the test imports — confirmed by the import.
  }

  /* ---------------- calls ---------------- */

  for (const rec of records) {
    for (const entity of rec.parsed.entities) {
      const sourceId = rec.declared.get(entity.name);
      if (!sourceId) continue;

      for (const call of entity.calls) {
        const bare = call.includes(".") ? call.split(".").pop()! : call;
        if (!bare || bare === entity.name) continue;

        // Prefer a declaration in the same file, then a file this one imports.
        let target = rec.declared.get(bare) ?? null;
        const confidence: "confirmed" | "inferred" = "inferred";
        let evidence = `${entity.name} calls ${bare}`;

        if (!target) {
          const candidates = declarationsByName.get(bare);
          // Ambiguity is not resolved by guessing: only link when exactly one
          // declaration with that name exists in the repository.
          if (candidates && candidates.length === 1) {
            target = candidates[0];
            evidence = `${entity.name} calls ${bare} (single matching declaration)`;
          }
        }

        if (target) {
          addEdge(sourceId, target, "CALLS", confidence, evidence);
        }
      }
    }
  }

  const parsedFiles = records.length;
  const stats: GraphStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byNodeType,
    byEdgeType,
    parsedFiles,
    skippedFiles: unsupportedPaths.length + parseFailures,
    truncated,
  };

  return { nodes, edges, stats };
}
