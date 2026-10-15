"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  Database,
  FileCode2,
  FolderTree,
  FunctionSquare,
  Layers,
  Loader2,
  Package,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Variable,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EDGE_TYPE_META, NODE_TYPE_META } from "@/lib/graph/types";
import type { GraphEdge, GraphEdgeType, GraphNode, GraphNodeType } from "@/lib/graph/types";
import { GraphDetailsPanel } from "./GraphDetailsPanel";
import { KnowledgeGraph3D, RINGS, RING_TINT } from "./KnowledgeGraph3D";

/**
 * Interactive codebase knowledge graph.
 *
 * Rendering every node of a large repository at once would freeze the browser
 * and tell the user nothing, so the view is deliberately bounded: a prioritised
 * slice is loaded, filters are applied server-side, and connected nodes are
 * pulled in on demand as the user explores.
 */

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Left-to-right tiers, ordered by how the code flows. A tier is a meaningful
 * axis here — containment, then declaration, then usage — so the layout itself
 * communicates structure instead of scattering nodes randomly.
 *
 * Kept deliberately compact. A sprawling layout fits the canvas at such a small
 * zoom that nothing is readable, so nodes-per-column is generous and the tier
 * gap tight: taller and narrower beats wide and microscopic.
 */
const TIER: Record<GraphNodeType, number> = {
  repository: 0,
  directory: 1,
  file: 2,
  service: 2,
  controller: 2,
  middleware: 2,
  test: 2,
  function: 3,
  class: 3,
  interface: 3,
  api_endpoint: 4,
  db_model: 4,
  db_table: 4,
  package: 4,
  env_var: 4,
};

const TIER_WIDTH = 240;
const COLUMN_WIDTH = 190;
const ROW_HEIGHT = 68;
const PER_COLUMN = 20;

/**
 * Node types hidden on first load.
 *
 * Directories and external packages are the two most numerous types and the
 * least informative for the questions this view exists to answer — a repository
 * with 18 dependencies and 9 folders would otherwise bury its 6 API endpoints
 * and 28 functions. They stay one click away in the filter row.
 */
const DEFAULT_HIDDEN: GraphNodeType[] = ["directory", "package"];

function layout(nodes: GraphNode[]): Node[] {
  const byTier = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const t = TIER[n.nodeType] ?? 3;
    const list = byTier.get(t);
    if (list) list.push(n);
    else byTier.set(t, [n]);
  }

  const out: Node[] = [];
  for (const [tier, list] of byTier) {
    list
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((n, i) => {
        out.push({
          id: n.id,
          type: "graphNode",
          position: {
            x: tier * TIER_WIDTH + Math.floor(i / PER_COLUMN) * COLUMN_WIDTH,
            y: (i % PER_COLUMN) * ROW_HEIGHT,
          },
          data: { node: n },
        });
      });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Custom node                                                         */
/* ------------------------------------------------------------------ */

const NODE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  repository: Boxes,
  directory: FolderTree,
  file: FileCode2,
  function: FunctionSquare,
  class: Layers,
  interface: Layers,
  api_endpoint: Route,
  db_model: Database,
  db_table: Database,
  package: Package,
  test: TestTube2,
  env_var: Variable,
  middleware: ShieldCheck,
  controller: Layers,
  service: Sparkles,
};

function GraphNodeCard({ data, selected }: NodeProps) {
  const node = (data as { node: GraphNode }).node;
  const meta = NODE_TYPE_META[node.nodeType];
  const Icon = NODE_ICON[node.nodeType] ?? FileCode2;
  const dimmed = (data as { dimmed?: boolean }).dimmed;
  const highlighted = (data as { highlighted?: boolean }).highlighted;

  return (
    <div
      className={cn(
        "group flex w-[210px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 shadow-sm transition-all",
        selected ? "border-brand-500 shadow-md ring-2 ring-brand-500/25" : "border-hair",
        highlighted && !selected && "border-brand-400 ring-2 ring-brand-500/15",
        dimmed && "opacity-25"
      )}
      style={{ borderLeft: `3px solid ${meta.hex}` }}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded"
        style={{ background: `${meta.hex}1a`, color: meta.hex }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-semibold leading-tight text-ink" title={node.name}>
          {node.name}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] uppercase tracking-wide text-ink-4">
          {meta.label}
          {node.filePath ? ` · ${node.filePath.split("/").pop()}` : ""}
        </span>
      </span>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
    </div>
  );
}

/** React Flow's node-type registry (distinct from the `nodeTypes` filter state). */
const flowNodeTypes: NodeTypes = { graphNode: GraphNodeCard };

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
  truncated: boolean;
  empty?: boolean;
  stats?: { nodeCount: number; edgeCount: number };
}

export function KnowledgeGraphView({
  analysisId,
  repoUrl,
}: {
  analysisId: string;
  repoUrl?: string;
}) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphInner analysisId={analysisId} repoUrl={repoUrl} />
    </ReactFlowProvider>
  );
}

/**
 * Canvas height for the graph.
 *
 * A fixed 640px put the bottom of the graph off-screen on a short laptop. This
 * keeps the generous height on a large display but never claims more than about
 * two thirds of the viewport, with a floor so the graph stays usable on a phone.
 */
function useCanvasHeight(): number {
  const [height, setHeight] = useState(640);

  useEffect(() => {
    const measure = () =>
      setHeight(Math.round(Math.min(640, Math.max(360, window.innerHeight * 0.68))));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return height;
}

function KnowledgeGraphInner({
  analysisId,
  repoUrl,
}: {
  analysisId: string;
  repoUrl?: string;
}) {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const { fitView } = useReactFlow();
  const fittedFor = useRef<string>("");
  /**
   * State is keyed by the filter set it belongs to.
   *
   * This is not incidental bookkeeping — it lets `loading` be *derived*
   * ("nothing for these filters yet") instead of being set synchronously inside
   * the fetch effect, which would trigger a cascading render on every mount.
   */
  const [loaded, setLoaded] = useState<{ key: string; data: GraphResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(
    null
  );
  const [expanding, setExpanding] = useState(false);

  const [query, setQuery] = useState("");
  /**
   * Which renderer to use.
   *
   * 3D is the default because the circular layout communicates the hierarchy —
   * a reader can see that a function sits outside its file and an endpoint
   * outside the function that serves it. 2D stays available for reading a dense
   * subgraph where an exact edge routing matters more than the shape.
   */
  const [view, setView] = useState<"2d" | "3d">("3d");
  /**
   * Canvas height.
   *
   * Capped against the viewport, not fixed at 640. A fixed height meant that on a
   * laptop the canvas began around 840px down a 900px screen, so the view opened
   * on controls and a legend with the graph itself out of sight.
   */
  const canvasHeight = useCanvasHeight();
  /** Node types hidden from the canvas. Client-side, so toggling is instant. */
  const [hiddenTypes, setHiddenTypes] = useState<Set<GraphNodeType>>(
    new Set(DEFAULT_HIDDEN)
  );
  const [edgeTypes, setEdgeTypes] = useState<Set<GraphEdgeType>>(new Set());

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const filterKey = `${analysisId}|${[...edgeTypes].sort().join(",")}`;
  const data = loaded?.key === filterKey ? loaded.data : null;
  const error = errorState?.key === filterKey ? errorState.message : null;
  const loading = !data && !error;

  /* ---- fetch ---- */
  const fetchGraph = useCallback(
    async (opts: { search?: string; keepSelection?: boolean } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const key = filterKey;
      try {
        const params = new URLSearchParams({ limit: "260" });
        if (opts.search?.trim()) params.set("q", opts.search.trim());
        if (edgeTypes.size) params.set("edgeTypes", [...edgeTypes].join(","));

        const res = await fetch(
          `/api/analysis/${analysisId}/knowledge-graph?${params}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        const json = (await res.json()) as GraphResponse;
        setLoaded({ key, data: json });
        setErrorState(null);
        if (!opts.keepSelection) {
          setSelected(null);
          setHighlight(new Set());
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setErrorState({
          key,
          message: err instanceof Error ? err.message : "Could not load the graph.",
        });
      }
    },
    [analysisId, edgeTypes, filterKey]
  );

  useEffect(() => {
    // `fetchGraph` only touches state after its `await`, so nothing is set
    // synchronously here — the rule cannot see across the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchGraph();
    // Intentionally only on mount and when server-side filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeTypes]);

  /* ---- derived ---- */
  /**
   * `hiddenTypes` is applied client-side so toggling a type is instant — the
   * data is already here, and a round-trip per click would feel broken.
   */
  const visibleNodes = useMemo(
    () => (data ? data.nodes.filter((n) => !hiddenTypes.has(n.nodeType)) : []),
    [data, hiddenTypes]
  );

  /** Edges are kept only when both endpoints survived the type filter. */
  const visibleEdges = useMemo(() => {
    if (!data) return [];
    const present = new Set(visibleNodes.map((n) => n.id));
    return data.edges.filter(
      (e) => present.has(e.sourceNodeId) && present.has(e.targetNodeId)
    );
  }, [data, visibleNodes]);

  const flowNodes = useMemo(() => {
    return layout(visibleNodes).map((n) => ({
      ...n,
      data: {
        ...n.data,
        dimmed: highlight.size > 0 && !highlight.has(n.id),
        highlighted: highlight.size > 0 && highlight.has(n.id),
      },
    }));
  }, [visibleNodes, highlight]);

  const flowEdges = useMemo<Edge[]>(() => {
    return visibleEdges.map((e) => {
      const meta = EDGE_TYPE_META[e.relationshipType];
      const touched =
        highlight.size > 0 && highlight.has(e.sourceNodeId) && highlight.has(e.targetNodeId);
      return {
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: highlight.size > 0 && touched ? meta.label : undefined,
        animated: touched,
        style: {
          stroke: meta.hex,
          strokeWidth: touched ? 2.2 : 1.1,
          // Inferred relationships are dashed — the visual distinction the
          // backend records, surfaced rather than lost.
          strokeDasharray: e.confidence === "inferred" ? "5 4" : undefined,
          opacity: highlight.size > 0 && !touched ? 0.12 : 0.75,
        },
        labelStyle: { fontSize: 9, fill: "var(--color-ink-3)" },
        labelBgStyle: { fill: "var(--color-surface)" },
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 4,
      };
    });
  }, [visibleEdges, highlight]);

  /* ---- interactions ---- */
  /**
   * Fit the graph once the canvas actually has a size.
   *
   * The report shows one view at a time, so this pane mounts inside a hidden
   * section — React Flow's own `fitView` runs against a zero-sized container and
   * silently does nothing. Watching the element's size and fitting on the first
   * non-zero measurement is what makes the graph appear centred and scaled.
   */
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;

    const signature = `${analysisId}:${flowNodes.length}`;
    const attempt = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      if (fittedFor.current === signature) return;
      fittedFor.current = signature;
      // A frame's delay lets React Flow finish measuring the nodes first.
      requestAnimationFrame(() => fitView({ padding: 0.18, maxZoom: 1, duration: 260 }));
    };

    attempt();
    const ro = new ResizeObserver(attempt);
    ro.observe(el);
    return () => ro.disconnect();
    // `view` matters: the canvas only exists in 2D, so switching back to it has
    // to re-run the fit.
  }, [analysisId, flowNodes.length, fitView, view]);

  /** Select a node and highlight everything directly connected to it. */
  const selectNode = useCallback(
    (gn: GraphNode | null) => {
      setSelected(gn);
      if (!gn) {
        setHighlight(new Set());
        return;
      }
      const ids = new Set<string>([gn.id]);
      for (const e of visibleEdges) {
        if (e.sourceNodeId === gn.id) ids.add(e.targetNodeId);
        if (e.targetNodeId === gn.id) ids.add(e.sourceNodeId);
      }
      setHighlight(ids);
    },
    [visibleEdges]
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      selectNode((node.data as { node: GraphNode }).node);
    },
    [selectNode]
  );

  /** Pull in the neighbours of the selected node and merge them. */
  const explore = useCallback(async () => {
    if (!selected) return;
    setExpanding(true);
    try {
      const res = await fetch(
        `/api/analysis/${analysisId}/knowledge-graph/neighbors/${selected.id}?depth=1`
      );
      if (!res.ok) throw new Error("Could not expand this node.");
      const json = (await res.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
      setLoaded((prev) => {
        if (!prev) return prev;
        const knownNodes = new Map(prev.data.nodes.map((n) => [n.id, n]));
        for (const n of json.nodes) knownNodes.set(n.id, n);
        const knownEdges = new Map(prev.data.edges.map((e) => [e.id, e]));
        for (const e of json.edges) knownEdges.set(e.id, e);
        return {
          key: prev.key,
          data: {
            ...prev.data,
            nodes: [...knownNodes.values()],
            edges: [...knownEdges.values()],
          },
        };
      });
      setHighlight(new Set(json.nodes.map((n) => n.id)));
    } catch (err) {
      setErrorState({
        key: filterKey,
        message: err instanceof Error ? err.message : "Could not expand this node.",
      });
    } finally {
      setExpanding(false);
    }
  }, [analysisId, selected, filterKey]);

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const availableNodeTypes = useMemo(() => {
    const counts = new Map<GraphNodeType, number>();
    for (const n of data?.nodes ?? []) counts.set(n.nodeType, (counts.get(n.nodeType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const availableEdgeTypes = useMemo(() => {
    const counts = new Map<GraphEdgeType, number>();
    for (const e of data?.edges ?? []) {
      counts.set(e.relationshipType, (counts.get(e.relationshipType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  /* ---- states ---- */
  if (loading && !data) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border border-hair bg-surface">
        <div className="flex items-center gap-2.5 text-[13.5px] text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading the knowledge graph…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-[560px] flex-col items-center justify-center gap-3 rounded-xl border border-hair bg-surface px-6 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-crit-soft text-crit">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <p className="font-display text-[15px] font-bold text-ink">Could not load the graph</p>
        <p className="max-w-md text-[13px] text-ink-2">{error}</p>
        <button
          type="button"
          onClick={() => void fetchGraph()}
          className="mt-1 cursor-pointer rounded-pill border border-hair-strong bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink"
        >
          Try again
        </button>
      </div>
    );
  }

  if (data?.empty || !data?.nodes.length) {
    return (
      <div className="flex h-[560px] flex-col items-center justify-center gap-3 rounded-xl border border-hair bg-surface px-6 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
          <Layers className="h-5 w-5" />
        </span>
        <p className="font-display text-[15px] font-bold text-ink">No graph for this repository</p>
        <p className="max-w-lg text-[13px] leading-relaxed text-ink-2">
          {flowNodes.length === 0 && (hiddenTypes.size > 0 || edgeTypes.size || query)
            ? "No entities match the current filters. Reset to see the graph."
            : "The knowledge graph is built from JavaScript and TypeScript source. This repository had no files the parser could read — its code is likely in a language that is not supported yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---------------- toolbar ---------------- */}
      <div className="rounded-xl border border-hair bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchGraph({ search: query });
              }}
              placeholder="Search entities by name or file…"
              className="h-9 w-full rounded-lg border border-hair-strong bg-surface pl-9 pr-3 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-brand-400 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.12)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void fetchGraph({ search: query })}
            className="cursor-pointer rounded-lg border border-hair-strong bg-surface-2 px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:text-ink"
          >
            Search
          </button>
          <div
            role="group"
            aria-label="Graph renderer"
            className="inline-flex items-center rounded-lg border border-hair-strong bg-surface-2 p-0.5"
          >
            {(["3d", "2d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                title={
                  v === "3d"
                    ? "Circular 3D view — the hierarchy is laid out in rings"
                    : "Flat view — easier for tracing an exact edge through a dense area"
                }
                className={cn(
                  "cursor-pointer rounded-[6px] px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide transition-colors",
                  view === v ? "bg-ink text-white" : "text-ink-3 hover:text-ink"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {view === "2d" && (
            <button
              type="button"
              onClick={() => fitView({ padding: 0.18, maxZoom: 1, duration: 260 })}
              title="Fit the graph to the canvas"
              className="cursor-pointer rounded-lg border border-hair-strong bg-surface-2 px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:text-ink"
            >
              Fit
            </button>
          )}
          {(query || hiddenTypes.size !== DEFAULT_HIDDEN.length || edgeTypes.size) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setHiddenTypes(new Set(DEFAULT_HIDDEN));
                setEdgeTypes(new Set());
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hair-strong bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-3 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <span className="ml-auto text-[11.5px] text-ink-3">
            {flowNodes.length} of {data.total} entities shown
            {data.truncated ? " · subset" : ""}
          </span>
        </div>

        {/*
          Collapsed by default. Expanded, these two rows of chips pushed the
          canvas a further ~160px down the page — enough that on a laptop the
          view opened showing controls and a legend and no graph at all.
        */}
        {(availableNodeTypes.length > 0 || availableEdgeTypes.length > 0) && (
          <details className="mt-2.5">
            <summary className="cursor-pointer text-[11.5px] font-medium text-ink-3 hover:text-ink">
              Filters
              <span className="ml-1.5 font-normal text-ink-4">
                {availableNodeTypes.length} entity types · {availableEdgeTypes.length}{" "}
                relationships
                {hiddenTypes.size !== DEFAULT_HIDDEN.length || edgeTypes.size > 0
                  ? " · narrowed"
                  : ""}
              </span>
            </summary>

            <div className="mt-2 space-y-2">
              {availableNodeTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {availableNodeTypes.map(([type, count]) => {
                    const meta = NODE_TYPE_META[type];
                    const on = !hiddenTypes.has(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggle(hiddenTypes, type, setHiddenTypes)}
                        aria-pressed={on}
                        title={on ? "Hide this entity type" : "Show this entity type"}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                          on
                            ? "border-ink bg-ink text-white"
                            : "border-hair-strong bg-surface text-ink-3 line-through decoration-1 hover:text-ink"
                        )}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: meta.hex, opacity: on ? 1 : 0.4 }}
                        />
                        {meta.label}
                        <span className="opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {availableEdgeTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {availableEdgeTypes.map(([type, count]) => {
                    const meta = EDGE_TYPE_META[type];
                    const on = edgeTypes.has(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggle(edgeTypes, type, setEdgeTypes)}
                        aria-pressed={on}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          on
                            ? "border-ink bg-ink text-white"
                            : "border-hair bg-surface text-ink-3 hover:text-ink"
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hex }} />
                        {meta.label}
                        <span className="opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      {/* ---------------- canvas + panel ---------------- */}
      {/*
        The canvas takes the full content width and the details panel overlays
        it. Side-by-side would leave the canvas ~470px, which forces the graph
        to a zoom where nothing is legible — and a graph you cannot read is not
        a graph.
      */}
      <div className="relative">
        {view === "3d" ? (
          <KnowledgeGraph3D
            nodes={visibleNodes}
            edges={visibleEdges}
            selected={selected}
            highlight={highlight}
            onSelect={selectNode}
            height={canvasHeight}
          />
        ) : (
          <div
            ref={flowRef}
            className="relative overflow-hidden rounded-xl border border-hair"
            style={{
              height: canvasHeight,
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--color-hair) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          >
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={flowNodeTypes}
              onNodeClick={onNodeClick}
              onPaneClick={() => selectNode(null)}
              fitView
              fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
              minZoom={0.08}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-hair)" />
              <Controls
                showInteractive={false}
                className="!bottom-3 !left-3 !rounded-lg !border !border-hair !shadow-sm"
              />
              <MiniMap
                pannable
                zoomable
                className="!bottom-3 !right-3 !h-24 !w-36 !rounded-lg !border !border-hair"
                nodeColor={(n) => {
                  const gn = (n.data as { node?: GraphNode })?.node;
                  return gn ? NODE_TYPE_META[gn.nodeType].hex : "#cbd5e1";
                }}
              />
            </ReactFlow>

            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill border border-hair bg-surface/95 px-3 py-1 text-[10.5px] text-ink-3 backdrop-blur">
              solid = confirmed · dashed = inferred · click a node for details
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-20 grid place-items-center rounded-xl bg-surface/60 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
          </div>
        )}

        {data.truncated && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-pill border border-hair bg-surface/95 px-2.5 py-1 text-[11px] text-ink-3 backdrop-blur">
            Showing a subset — use search or filters to narrow down
          </div>
        )}

        {/* Details overlay — only present once a node is chosen, so the graph
            keeps the full width the rest of the time. */}
        {selected && (
          <div className="absolute inset-y-3 right-3 w-[360px] max-w-[88%] shadow-lg">
            <GraphDetailsPanel
              analysisId={analysisId}
              node={selected}
              repoUrl={repoUrl}
              onExplore={explore}
              expanding={expanding}
              onClose={() => selectNode(null)}
            />
          </div>
        )}
      </div>

      {/*
        Placed *after* the canvas on purpose. This explains a layout the reader
        has to see first; above the canvas it added ~200px and pushed the graph
        itself below the fold, so the view opened on a legend with no graph.
      */}
      {view === "3d" && (
        <div className="rounded-xl border border-hair bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Reading the rings — each ring is one level of the codebase
          </p>
          <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {RINGS.map((ring, i) => (
              <li key={ring.label} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="h-3 w-3 text-ink-4" />}
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2">
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                    style={{ background: RING_TINT[i] ?? "#64748b" }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium text-ink">{ring.label}</span>
                  <span className="text-ink-3">
                    {ring.types.map((t) => NODE_TYPE_META[t].label.toLowerCase()).join(", ")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            A node&apos;s <strong className="font-semibold text-ink-2">size</strong> is how many
            relationships it has — the biggest entities are the ones the codebase leans on.
            Solid lines are confirmed by syntax; dashed lines are inferred from a name match
            and are labelled with a question mark. Click any node to see what it connects to.
          </p>
        </div>
      )}

      {/* ---------------- legend ---------------- */}
      <details className="rounded-xl border border-hair bg-surface px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-medium text-ink-2">
          What the graph contains
          <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Entity types
            </p>
            <ul className="space-y-1">
              {Object.entries(NODE_TYPE_META).map(([key, meta]) => (
                <li key={key} className="flex items-center gap-2 text-[12px] text-ink-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} />
                  {meta.label}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Relationships
            </p>
            <ul className="space-y-1">
              {Object.entries(EDGE_TYPE_META).map(([key, meta]) => (
                <li key={key} className="flex items-center gap-2 text-[12px] text-ink-2">
                  <span className="h-0.5 w-3 rounded" style={{ background: meta.hex }} />
                  {meta.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 border-t border-hair pt-3 text-[11.5px] leading-relaxed text-ink-3">
          Built by parsing the source with the TypeScript compiler — every node comes from a
          real declaration and every edge from real syntax or a resolved reference. Dashed
          edges are inferred (a name matched across files) and are labelled as such. Nothing
          here is generated by a language model.
        </p>
      </details>
    </div>
  );
}
