"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network, Info } from "lucide-react";
import type { Architecture, ArchNode } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ArchitectureGraph3D } from "./ArchitectureGraph3D";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tiers collapse the long layer list into a readable top-down flow.
 * Grouping keeps the diagram taller than it is wide, which fits the canvas
 * far better than one column per layer (that produced an unreadably wide strip).
 */
const TIERS: string[][] = [
  ["frontend"],
  ["routes", "config"],
  ["controllers", "auth"],
  ["services", "utils"],
  ["data", "external"],
  ["infra", "app"],
];

function tierOf(id: string): number {
  for (let i = 0; i < TIERS.length; i++) {
    if (TIERS[i].includes(id)) return i;
  }
  return TIERS.length - 1;
}

const NODE_W = 196;
const COL_GAP = 236;
const ROW_GAP = 116;

type FlowData = {
  label: string;
  type: string;
  files?: number;
  accent?: string;
  detail?: string;
};

function ArchNodeCard({ data, selected }: NodeProps) {
  const d = data as unknown as FlowData;
  return (
    <div
      className={cn(
        "w-[196px] rounded-xl border bg-surface px-3.5 py-3 shadow-sm transition-all",
        selected ? "border-brand-400 shadow-md" : "border-hair-strong"
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: d.accent ?? "#14b8a6" }}
        />
        <span className="truncate font-display text-[13px] font-bold tracking-tight text-ink">
          {d.label}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-4">
          {d.type}
        </span>
        {typeof d.files === "number" && (
          <span className="rounded-pill bg-surface-2 px-1.5 py-[1px] font-mono text-[10.5px] text-ink-3">
            {d.files} files
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes: NodeTypes = { arch: ArchNodeCard };

function buildGraph(architecture: Architecture): { nodes: Node[]; edges: Edge[] } {
  // Bucket nodes by tier, preserving the canonical order inside each tier.
  const buckets = new Map<number, ArchNode[]>();
  for (const n of architecture.nodes) {
    const t = tierOf(n.id);
    const list = buckets.get(t) ?? [];
    list.push(n);
    buckets.set(t, list);
  }

  const CENTER = 340;
  const nodes: Node[] = [];

  for (const [tier, list] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const n = list.length;
    list.forEach((node, i) => {
      nodes.push({
        id: node.id,
        type: "arch",
        position: {
          x: CENTER + (i - (n - 1) / 2) * COL_GAP - NODE_W / 2,
          y: tier * ROW_GAP,
        },
        data: {
          label: node.label,
          type: node.type,
          files: node.files,
          accent: node.accent,
          detail: node.detail,
        } satisfies FlowData,
        draggable: true,
      });
    });
  }

  const edges: Edge[] = architecture.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    animated: true,
    style: { stroke: "var(--color-hair-strong)", strokeWidth: 1.5 },
    label: e.label,
    labelStyle: { fontSize: 10, fill: "var(--color-ink-3)" },
    labelBgStyle: { fill: "var(--color-surface)" },
  }));

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ArchitectureGraph({
  architecture,
}: {
  architecture: Architecture;
}) {
  const { nodes: initialNodes, edges } = useMemo(
    () => buildGraph(architecture),
    [architecture]
  );
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [selected, setSelected] = useState<ArchNode | null>(null);
  /** 2D reads the layering precisely; 3D shows the same structure in depth. */
  const [view, setView] = useState<"2d" | "3d">("2d");

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const found = architecture.nodes.find((n) => n.id === node.id) ?? null;
      setSelected(found);
    },
    [architecture.nodes]
  );

  const onNodesChange = useCallback(
    (changes: Parameters<NonNullable<React.ComponentProps<typeof ReactFlow>["onNodesChange"]>>[0]) => {
      setNodes((prev) => {
        const next = [...prev];
        for (const c of changes) {
          if (c.type === "position" && c.position) {
            const idx = next.findIndex((n) => n.id === c.id);
            if (idx !== -1) next[idx] = { ...next[idx], position: c.position };
          }
        }
        return next;
      });
    },
    []
  );

  if (!architecture.nodes.length) {
    return (
      <Card>
        <CardHeader title="Architecture" icon={<Network className="h-4 w-4" />} />
        <div className="px-6 py-12 text-center text-[13.5px] text-ink-2">
          No architectural layers could be inferred from this repository.
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Architecture"
        subtitle={architecture.summary}
        icon={<Network className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 text-[11.5px] text-ink-3 lg:inline-flex">
              <Info className="h-3.5 w-3.5" />
              {view === "2d"
                ? "drag · zoom · click a node"
                : "drag to rotate · scroll to zoom"}
            </span>
            <div
              role="group"
              aria-label="Graph view"
              className="inline-flex shrink-0 rounded-pill border border-hair bg-surface-2 p-0.5"
            >
              {(["2d", "3d"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "cursor-pointer rounded-pill px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors",
                    view === v
                      ? "bg-ink text-white"
                      : "text-ink-3 hover:text-ink"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {view === "3d" ? (
        <div className="p-4 sm:p-5">
          <ArchitectureGraph3D architecture={architecture} height={520} />
          <div className="mt-4 flex flex-wrap gap-2">
            {architecture.nodes.map((n) => (
              <span
                key={n.id}
                className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: n.accent ?? "#14b8a6" }}
                />
                {n.label}
                <span className="text-ink-4">{n.files}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Each layer sits at its own depth, so rotating the graph shows the call
            order in space. Switch to 2D to click a node and inspect its files.
          </p>
        </div>
      ) : (
      <div className="grid lg:grid-cols-[1fr_268px]">
        <div
          className="h-[560px] w-full border-b border-hair lg:border-b-0 lg:border-r"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--color-hair) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.16, maxZoom: 1.15 }}
            minZoom={0.3}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="var(--color-hair)"
            />
            <Controls
              showInteractive={false}
              className="!bottom-3 !left-3 !rounded-lg !border !border-hair !shadow-sm"
            />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <aside className="bg-surface-2/40 p-5">
          {selected ? (
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: selected.accent ?? "#14b8a6" }}
                />
                <h4 className="font-display text-[15px] font-bold text-ink">
                  {selected.label}
                </h4>
              </div>
              <div className="mt-3 space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">Layer type</span>
                  <span className="font-mono text-ink-2">{selected.type}</span>
                </div>
                {typeof selected.files === "number" && (
                  <div className="flex items-center justify-between">
                    <span className="text-ink-3">Files</span>
                    <span className="font-mono text-ink-2">{selected.files}</span>
                  </div>
                )}
              </div>
              {selected.detail && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    Example files
                  </div>
                  <ul className="mt-2 space-y-1">
                    {selected.detail.split("\n").filter(Boolean).map((f) => (
                      <li
                        key={f}
                        className="truncate rounded-md border border-hair bg-surface px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2"
                        title={f}
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Detected layers
              </div>
              <ul className="mt-3 space-y-2">
                {architecture.nodes.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center justify-between gap-2 text-[12.5px]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: n.accent ?? "#14b8a6" }}
                      />
                      <span className="truncate text-ink-2">{n.label}</span>
                    </span>
                    <span className="font-mono text-ink-3">{n.files}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
                Click any node to inspect the files that were classified into that layer.
              </p>
            </div>
          )}
        </aside>
      </div>
      )}
    </Card>
  );
}
