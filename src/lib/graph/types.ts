/**
 * Codebase knowledge graph — domain model.
 *
 * The graph is produced by static analysis of real source files. Nothing here
 * is authored by a language model: every node traces to a file and line range,
 * and every edge carries the evidence that justified it plus a confidence
 * value. Inferred relationships are marked so the UI can distinguish them from
 * confirmed ones.
 */

export type GraphNodeType =
  | "repository"
  | "directory"
  | "file"
  | "function"
  | "class"
  | "interface"
  | "api_endpoint"
  | "db_model"
  | "db_table"
  | "package"
  | "test"
  | "env_var"
  | "middleware"
  | "controller"
  | "service";

export type GraphEdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "EXPORTS"
  | "DEFINES"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "USES"
  | "QUERIES"
  | "READS"
  | "WRITES"
  | "EXPOSES_ROUTE"
  | "TESTS"
  | "DEPENDS_ON";

/**
 * How the relationship was established.
 *
 * - `confirmed` — the syntax states it (an import statement, a class `extends`,
 *   a route registration). Not a guess.
 * - `inferred` — resolved by name across files, or matched by convention. Real
 *   evidence, but ambiguity is possible, so the UI labels it.
 */
export type EdgeConfidence = "confirmed" | "inferred";

export interface GraphNode {
  /** Stable, deterministic id derived from analysis + type + name + location. */
  id: string;
  analysisId: string;
  nodeType: GraphNodeType;
  name: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  /** Type-specific extras (route method, model fields, package version, …). */
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  analysisId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: GraphEdgeType;
  confidence: EdgeConfidence;
  /** Human-readable justification, e.g. `import { getUser } from "./user"`. */
  evidence: string;
}

/** A node together with everything directly attached to it. */
export interface NodeNeighbourhood {
  node: GraphNode;
  incoming: { edge: GraphEdge; node: GraphNode }[];
  outgoing: { edge: GraphEdge; node: GraphNode }[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  byNodeType: Record<string, number>;
  byEdgeType: Record<string, number>;
  /** Files that were parsed, and files skipped as unsupported/binary. */
  parsedFiles: number;
  skippedFiles: number;
  /** True when the node/edge cap was hit, so the graph is a subset. */
  truncated: boolean;
  /** Populated when graph generation failed — the report itself still stands. */
  error?: string;
}

/** The graph payload returned by the API. */
export interface KnowledgeGraph {
  analysisId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

/* ------------------------------------------------------------------ */
/* Change impact                                                       */
/* ------------------------------------------------------------------ */

export interface ImpactPath {
  /** Node ids from the selected entity to the affected node. */
  nodeIds: string[];
  /** Edge ids along the same path. */
  edgeIds: string[];
  /** `a --CALLS--> b --IMPORTS--> c` */
  description: string;
}

export interface ImpactedEntity {
  node: GraphNode;
  /** 1 = direct dependent, 2+ = transitive. */
  distance: number;
  viaRelationship: GraphEdgeType;
  path: ImpactPath;
}

export interface ChangeImpactResult {
  analysisId: string;
  /** The entity the user selected. */
  origin: GraphNode;
  direct: ImpactedEntity[];
  indirect: ImpactedEntity[];
  apiRoutes: GraphNode[];
  dbModels: GraphNode[];
  tests: GraphNode[];
  /** Findings attached to the origin or to any affected file. */
  relatedFindings: { id: string; title: string; severity: string; filePath?: string }[];
  /** Deterministic, evidence-based risks — not AI speculation. */
  risks: string[];
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Presentation metadata                                               */
/* ------------------------------------------------------------------ */

export const NODE_TYPE_META: Record<
  GraphNodeType,
  { label: string; short: string; hex: string }
> = {
  repository: { label: "Repository", short: "Repo", hex: "#0f172a" },
  directory: { label: "Directory", short: "Dir", hex: "#64748b" },
  file: { label: "File", short: "File", hex: "#0ea5e9" },
  function: { label: "Function", short: "Fn", hex: "#14b8a6" },
  class: { label: "Class", short: "Class", hex: "#8b5cf6" },
  interface: { label: "Interface", short: "Iface", hex: "#a855f7" },
  api_endpoint: { label: "API endpoint", short: "API", hex: "#f76808" },
  db_model: { label: "Database model", short: "Model", hex: "#f5a524" },
  db_table: { label: "Database table", short: "Table", hex: "#eab308" },
  package: { label: "External package", short: "Pkg", hex: "#94a3b8" },
  test: { label: "Test file", short: "Test", hex: "#22c55e" },
  env_var: { label: "Env variable", short: "Env", hex: "#e5484d" },
  middleware: { label: "Middleware", short: "MW", hex: "#06b6d4" },
  controller: { label: "Controller", short: "Ctrl", hex: "#3b82f6" },
  service: { label: "Service", short: "Svc", hex: "#6366f1" },
};

export const EDGE_TYPE_META: Record<GraphEdgeType, { label: string; hex: string }> = {
  CONTAINS: { label: "contains", hex: "#cbd5e1" },
  IMPORTS: { label: "imports", hex: "#0ea5e9" },
  EXPORTS: { label: "exports", hex: "#38bdf8" },
  DEFINES: { label: "defines", hex: "#14b8a6" },
  CALLS: { label: "calls", hex: "#f43f5e" },
  EXTENDS: { label: "extends", hex: "#8b5cf6" },
  IMPLEMENTS: { label: "implements", hex: "#a855f7" },
  USES: { label: "uses", hex: "#f5a524" },
  QUERIES: { label: "queries", hex: "#eab308" },
  READS: { label: "reads", hex: "#22c55e" },
  WRITES: { label: "writes", hex: "#f76808" },
  EXPOSES_ROUTE: { label: "exposes route", hex: "#f76808" },
  TESTS: { label: "tests", hex: "#22c55e" },
  DEPENDS_ON: { label: "depends on", hex: "#94a3b8" },
};
