import {
  analyseChangeImpact,
  getNeighbourhood,
  getNeighbours,
  graphStats,
  searchGraphNodes,
} from "./store";
import { NODE_TYPE_META, type GraphNode } from "./types";

/**
 * Answer graph-shaped questions from the knowledge graph.
 *
 * This is not a second chat engine. It is a resolver that runs *before* the
 * existing retrieval pipeline for questions the graph can answer exactly
 * ("what depends on X", "which routes touch this model"), and returns `null`
 * for everything else so the normal RAG path handles it unchanged.
 *
 * Answers are assembled from stored edges — no model is consulted, so a
 * relationship is either in the graph or it is reported as missing.
 */

export type GraphIntent = "dependents" | "impact" | "routes" | "tests" | "structure";

export interface GraphAnswer {
  intent: GraphIntent;
  answer: string;
  /** Entities the answer is anchored on. */
  entities: GraphNode[];
  /** `path:line` citations, matching the shape the chat UI already renders. */
  sources: string[];
  engine: "graph";
}

const PATTERNS: { intent: GraphIntent; re: RegExp }[] = [
  {
    intent: "impact",
    re: /\b(what (?:would |will |might )?break|impact|blast radius|regression|safe to (?:change|refactor)|affected by|ripple)\b/i,
  },
  {
    intent: "dependents",
    re: /\b(depends? on|dependents?|who calls|calls? (?:this|it)|used by|consumers? of|references? (?:this|it)|downstream)\b/i,
  },
  {
    intent: "routes",
    re: /\b(routes?|endpoints?|apis?|urls?)\b.*\b(use|using|touch|hit|call|for|behind)\b|\bwhich (?:routes?|endpoints?)\b/i,
  },
  {
    intent: "tests",
    re: /\b(tests?|specs?|coverage)\b.*\b(cover|for|relevant|related|touch)\b|\bwhich tests?\b/i,
  },
  {
    intent: "structure",
    re: /\b(what files|which files|structure of|how is .* organi[sz]ed|what is in)\b/i,
  },
];

/** Words that carry no entity information and would match everything. */
const STOP = new Set([
  "the", "a", "an", "this", "that", "these", "those", "what", "which", "who",
  "how", "does", "do", "is", "are", "was", "were", "be", "been", "and", "or",
  "if", "i", "we", "you", "it", "its", "for", "of", "to", "in", "on", "at",
  "by", "with", "from", "change", "changed", "changing", "depend", "depends",
  "dependent", "dependents", "break", "breaks", "call", "calls", "called",
  "use", "uses", "used", "using", "route", "routes", "endpoint", "endpoints",
  "test", "tests", "cover", "covers", "affect", "affected", "impact", "file",
  "files", "function", "functions", "class", "classes", "model", "models",
  "code", "repo", "repository", "please", "show", "list", "tell", "me", "about",
  "when", "where", "why", "can", "could", "would", "should", "might", "will",
]);

/** Candidate identifiers from a question: `foo.bar`, `processPayment`, `User`. */
export function extractCandidates(question: string): string[] {
  const tokens = question.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? [];
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (STOP.has(t.toLowerCase())) continue;
    out.push(t);
    // `paymentService.processPayment` also yields `processPayment`, which is
    // how the node is actually named.
    if (t.includes(".")) {
      const tail = t.split(".").pop()!;
      if (tail.length >= 3 && !STOP.has(tail.toLowerCase())) out.push(tail);
    }
  }
  // Longest first — the most specific identifier is the best anchor.
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/** Resolve the question to the single node it is most likely about. */
async function resolveSubject(
  analysisId: string,
  question: string
): Promise<{ node: GraphNode; candidates: GraphNode[] } | null> {
  const candidates = extractCandidates(question);
  if (!candidates.length) return null;

  const found: GraphNode[] = [];
  for (const c of candidates.slice(0, 6)) {
    const hits = await searchGraphNodes(analysisId, c, 5);
    for (const h of hits) if (!found.some((f) => f.id === h.id)) found.push(h);
    if (found.length) break;
  }
  if (!found.length) return null;

  // Prefer an exact (case-insensitive) name match, then the most "code-like"
  // node type over structural ones like a directory.
  const rank = (n: GraphNode): number => {
    const exact = candidates.some((c) => c.toLowerCase() === n.name.toLowerCase()) ? 0 : 10;
    const typeRank: Record<string, number> = {
      function: 0, class: 1, api_endpoint: 2, db_model: 3,
      service: 4, controller: 5, interface: 6, file: 7, test: 8,
      package: 9, env_var: 10, middleware: 11, directory: 20, repository: 30,
    };
    return exact + (typeRank[n.nodeType] ?? 15);
  };

  const sorted = [...found].sort((a, b) => rank(a) - rank(b));
  return { node: sorted[0], candidates: sorted.slice(0, 5) };
}

function cite(node: GraphNode): string | null {
  if (!node.filePath) return null;
  return node.startLine ? `${node.filePath}:${node.startLine}` : node.filePath;
}

function label(node: GraphNode): string {
  return `${node.name} (${NODE_TYPE_META[node.nodeType].label.toLowerCase()})`;
}

export async function answerFromGraph(
  analysisId: string,
  question: string
): Promise<GraphAnswer | null> {
  const intent = PATTERNS.find((p) => p.re.test(question))?.intent;
  if (!intent) return null;

  // No graph stored for this analysis → let the normal pipeline answer.
  const stats = await graphStats(analysisId);
  if (!stats.nodeCount) return null;

  /* ---------------- structure: what is in this repository ---------------- */
  if (intent === "structure") {
    const subject = await resolveSubject(analysisId, question);
    if (!subject) return null;
    const hood = await getNeighbourhood(analysisId, subject.node.id);
    if (!hood) return null;

    const children = hood.outgoing.filter((o) => o.edge.relationshipType === "CONTAINS");
    const lines: string[] = [
      `${label(subject.node)} is connected to ${hood.outgoing.length + hood.incoming.length} entities in the graph.`,
    ];
    if (children.length) {
      lines.push("");
      lines.push(`It contains ${children.length}:`);
      children.slice(0, 20).forEach((c) => lines.push(`• ${c.node.name} — ${c.node.filePath ?? ""}`));
    }
    const deps = hood.outgoing.filter((o) => o.edge.relationshipType === "DEPENDS_ON");
    if (deps.length) {
      lines.push("");
      lines.push(`External packages: ${deps.map((d) => d.node.name).join(", ")}.`);
    }

    return {
      intent,
      answer: lines.join("\n"),
      entities: [subject.node, ...children.slice(0, 20).map((c) => c.node)],
      sources: [cite(subject.node), ...children.map((c) => cite(c.node))].filter(
        (s): s is string => Boolean(s)
      ),
      engine: "graph",
    };
  }

  /* ---------------- everything else needs a subject ---------------- */
  const subject = await resolveSubject(analysisId, question);
  if (!subject) {
    return {
      intent,
      answer:
        "I could not match that question to an entity in the knowledge graph. " +
        "Try naming a specific function, class, file or route — for example " +
        "\"what depends on processPayment\" or \"which tests cover orderService\".",
      entities: [],
      sources: [],
      engine: "graph",
    };
  }

  const { node } = subject;

  /* ---------------- impact / dependents ---------------- */
  if (intent === "impact" || intent === "dependents") {
    const impact = await analyseChangeImpact(analysisId, node.id, { maxDepth: 4 });
    if (!impact) return null;

    const lines: string[] = [];
    const total = impact.direct.length + impact.indirect.length;

    if (total === 0) {
      lines.push(
        `Nothing in the analysed files depends on ${label(node)}. ` +
          "Its blast radius appears contained — but only the files that were parsed can be checked."
      );
    } else {
      lines.push(
        intent === "impact"
          ? `Changing ${label(node)} could affect ${total} component${total === 1 ? "" : "s"} in the analysed files. These are potentially affected, not guaranteed to break.`
          : `${total} component${total === 1 ? "" : "s"} depend on ${label(node)}.`
      );
      if (impact.direct.length) {
        lines.push("");
        lines.push("Direct dependents:");
        impact.direct.slice(0, 12).forEach((d) =>
          lines.push(`• ${label(d.node)} — ${d.path.description}`)
        );
      }
      if (impact.indirect.length) {
        lines.push("");
        lines.push(`Indirect (${impact.indirect.length}):`);
        impact.indirect.slice(0, 10).forEach((d) =>
          lines.push(`• ${label(d.node)} — via ${d.path.description}`)
        );
      }
    }

    if (impact.apiRoutes.length) {
      lines.push("");
      lines.push(`Externally reachable through: ${impact.apiRoutes.map((r) => r.name).join(", ")}.`);
    }
    if (impact.dbModels.length) {
      lines.push(`Touches database models: ${impact.dbModels.map((m) => m.name).join(", ")}.`);
    }
    if (impact.tests.length) {
      lines.push(`Covered by ${impact.tests.length} test file${impact.tests.length === 1 ? "" : "s"}: ${impact.tests.map((t) => t.filePath ?? t.name).join(", ")}.`);
    } else {
      lines.push("No test in the analysed files covers this entity or its dependents.");
    }

    const all = [...impact.direct, ...impact.indirect].map((x) => x.node);
    return {
      intent,
      answer: lines.join("\n"),
      entities: [node, ...all.slice(0, 30)],
      sources: [cite(node), ...all.map(cite)].filter((s): s is string => Boolean(s)),
      engine: "graph",
    };
  }

  /* ---------------- routes / tests ---------------- */
  // Walk outwards, then filter by the node type the question is about.
  //
  // Depth 3, not 1: the chain from a model to its endpoint is typically
  // `endpoint — api.js — controller — model`, so a shallower walk would report
  // "no route found" for a repository that plainly has one.
  const ROUTE_DEPTH = 3;
  const { nodes: around, edges } = await getNeighbours(analysisId, node.id, ROUTE_DEPTH);
  const wanted = intent === "routes" ? "api_endpoint" : "test";
  const matches = around.filter((n) => n.nodeType === wanted);

  if (!matches.length) {
    return {
      intent,
      answer:
        intent === "routes"
          ? `No API endpoint in the analysed files was found within ${ROUTE_DEPTH} hops of ${label(node)}. The graph cannot show a route for it.`
          : `No test file in the analysed files was found within ${ROUTE_DEPTH} hops of ${label(node)}.`,
      entities: [node],
      sources: [cite(node)].filter((s): s is string => Boolean(s)),
      engine: "graph",
    };
  }

  const lines = [
    intent === "routes"
      ? `${matches.length} API endpoint${matches.length === 1 ? "" : "s"} were found within ${ROUTE_DEPTH} hops of ${label(node)}:`
      : `${matches.length} test file${matches.length === 1 ? "" : "s"} were found within ${ROUTE_DEPTH} hops of ${label(node)}:`,
  ];
  for (const m of matches.slice(0, 20)) {
    const path = edges.find(
      (e) =>
        (e.sourceNodeId === m.id && e.targetNodeId === node.id) ||
        (e.targetNodeId === m.id && e.sourceNodeId === node.id)
    );
    lines.push(
      `• ${m.name}${m.filePath ? ` — ${m.filePath}${m.startLine ? `:${m.startLine}` : ""}` : ""}${
        path ? ` (${path.relationshipType.toLowerCase()})` : ""
      }`
    );
  }

  return {
    intent,
    answer: lines.join("\n"),
    entities: [node, ...matches],
    sources: [cite(node), ...matches.map(cite)].filter((s): s is string => Boolean(s)),
    engine: "graph",
  };
}
