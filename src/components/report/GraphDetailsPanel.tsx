"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  FileText,
  GitBranch,
  Info,
  Loader2,
  MousePointerClick,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_TYPE_META } from "@/lib/graph/types";
import type { ChangeImpactResult, GraphEdge, GraphNode } from "@/lib/graph/types";

/**
 * Node details and change currentImpact.
 *
 * Everything shown is derived from the graph and the stored report. The impact
 * section in particular is pure traversal — it states which components
 * reference the selection, and never claims they *will* break.
 */

interface NodeDetail {
  node: GraphNode;
  description: string;
  incoming: { edge: GraphEdge; node: GraphNode }[];
  outgoing: { edge: GraphEdge; node: GraphNode }[];
  connectedFiles: string[];
  relatedFindings: {
    id: string;
    title: string;
    severity: string;
    category?: string;
    filePath?: string;
    lineStart?: number;
  }[];
  tests: GraphNode[];
}

const SEVERITY_HEX: Record<string, string> = {
  critical: "#e5484d",
  high: "#f76808",
  medium: "#f5a524",
  low: "#0ea5e9",
  info: "#7e868c",
};

export function GraphDetailsPanel({
  analysisId,
  node,
  repoUrl,
  onExplore,
  expanding,
  onClose,
}: {
  analysisId: string;
  node: GraphNode | null;
  repoUrl?: string;
  onExplore: () => Promise<void> | void;
  expanding: boolean;
  onClose?: () => void;
}) {
  /**
   * Every piece of state is tagged with the node id it belongs to.
   *
   * That lets "still loading" be *derived* (nothing for this node yet) rather
   * than set synchronously inside the effect — which React 19 flags as a
   * cascading render — and it also means a stale response can never be shown
   * against the wrong node.
   */
  const [detail, setDetail] = useState<{ id: string; data: NodeDetail } | null>(null);
  const [errorState, setErrorState] = useState<{ id: string; message: string } | null>(null);
  const [impact, setImpact] = useState<{ id: string; data: ChangeImpactResult } | null>(null);
  const [impactPending, setImpactPending] = useState<string | null>(null);

  const nodeId = node?.id ?? null;
  const currentDetail: NodeDetail | null =
    detail && detail.id === nodeId ? detail.data : null;
  const currentError: string | null =
    errorState && errorState.id === nodeId ? errorState.message : null;
  const currentImpact: ChangeImpactResult | null =
    impact && impact.id === nodeId ? impact.data : null;
  const loading = Boolean(nodeId) && !currentDetail && !currentError;
  const impactLoading = Boolean(nodeId) && impactPending === nodeId;

  useEffect(() => {
    if (!nodeId) return;

    let cancelled = false;
    fetch(`/api/analysis/${analysisId}/knowledge-graph/nodes/${nodeId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load this entity.");
        return (await res.json()) as NodeDetail;
      })
      .then((json) => {
        if (!cancelled) setDetail({ id: nodeId, data: json });
      })
      .catch((err: Error) => {
        if (!cancelled) setErrorState({ id: nodeId, message: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [analysisId, nodeId]);

  const analyseImpact = useCallback(async () => {
    if (!node) return;
    setImpactPending(node.id);
    try {
      const res = await fetch(`/api/analysis/${analysisId}/change-impact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id }),
      });
      const json = (await res.json()) as ChangeImpactResult | { error?: { message?: string } };
      if (!res.ok || "error" in json) {
        throw new Error(
          ("error" in json ? json.error?.message : null) ?? "Impact analysis failed."
        );
      }
      setImpact({ id: node.id, data: json as ChangeImpactResult });
      setErrorState(null);
    } catch (err) {
      setErrorState({
        id: node.id,
        message: err instanceof Error ? err.message : "Impact analysis failed.",
      });
    } finally {
      setImpactPending(null);
    }
  }, [analysisId, node]);

  /* ---- empty state ---- */
  if (!node) {
    return (
      <aside className="flex h-[620px] flex-col items-center justify-center gap-3 rounded-xl border border-hair bg-surface px-6 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-3">
          <MousePointerClick className="h-5 w-5" />
        </span>
        <p className="font-display text-[14.5px] font-bold text-ink">Select an entity</p>
        <p className="max-w-[260px] text-[12.5px] leading-relaxed text-ink-2">
          Click any node to see what it is, what it connects to, and what would be
          affected by changing it.
        </p>
      </aside>
    );
  }

  const meta = NODE_TYPE_META[node.nodeType];
  const sourceUrl =
    repoUrl && node.filePath
      ? `${repoUrl}/blob/HEAD/${node.filePath}${node.startLine ? `#L${node.startLine}` : ""}`
      : null;

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-xl border border-hair bg-surface">
      {/* header */}
      <div className="border-b border-hair px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: meta.hex }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="break-words font-display text-[14.5px] font-bold leading-snug text-ink">
              {node.name}
            </h3>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-3">
              {meta.label}
              {node.language ? ` · ${node.language}` : ""}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="shrink-0 cursor-pointer rounded p-1 text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {node.filePath && (
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-hair bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-2">
              {node.filePath}
              {node.startLine ? `:${node.startLine}` : ""}
              {node.endLine && node.endLine !== node.startLine ? `-${node.endLine}` : ""}
            </code>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                title="Open this file on GitHub"
                className="shrink-0 rounded border border-hair bg-surface-2 p-1.5 text-ink-3 hover:text-ink"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-[12.5px] text-ink-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading details…
          </div>
        )}

        {currentError && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-hair bg-crit-soft/50 px-3 py-2 text-[12px] text-ink-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crit" />
            {currentError}
          </p>
        )}

        {currentDetail && (
          <div className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-ink-2">{currentDetail.description}</p>

            {/* relationships */}
            <RelationshipList
              title="Depends on"
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              items={currentDetail.outgoing}
              empty="Nothing outgoing — this entity does not call or import anything in the analysed files."
            />
            <RelationshipList
              title="Used by"
              icon={<ArrowDownRight className="h-3.5 w-3.5" />}
              items={currentDetail.incoming}
              empty="Nothing references this entity in the analysed files."
            />

            {currentDetail.tests.length > 0 && (
              <Section title={`Covered by ${currentDetail.tests.length} test${currentDetail.tests.length === 1 ? "" : "s"}`}>
                <ul className="space-y-1">
                  {currentDetail.tests.slice(0, 8).map((t) => (
                    <li key={t.id} className="truncate font-mono text-[11px] text-ink-2" title={t.filePath ?? t.name}>
                      {t.filePath ?? t.name}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {currentDetail.connectedFiles.length > 0 && (
              <Section title={`Connected files (${currentDetail.connectedFiles.length})`}>
                <ul className="space-y-1">
                  {currentDetail.connectedFiles.slice(0, 10).map((f) => (
                    <li key={f} className="truncate font-mono text-[11px] text-ink-2" title={f}>
                      {f}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {currentDetail.relatedFindings.length > 0 && (
              <Section title={`Analysis findings (${currentDetail.relatedFindings.length})`}>
                <ul className="space-y-1.5">
                  {currentDetail.relatedFindings.slice(0, 8).map((f) => (
                    <li key={f.id} className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: SEVERITY_HEX[f.severity] ?? "#7e868c" }}
                      />
                      <span className="text-[12px] leading-snug text-ink-2">{f.title}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}

        {/* ---- change impact ---- */}
        {currentImpact && (
          <div className="mt-4 border-t border-hair pt-4">
            <div className="mb-2 flex items-center gap-2">
              <Waypoints className="h-3.5 w-3.5 text-brand-600" />
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
                Potential change impact
              </h4>
            </div>

            <p className="mb-3 rounded-lg border border-hair bg-surface-2/60 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
              These components reference the selection through the graph. They are{" "}
              <strong className="font-semibold text-ink">potentially affected</strong>, not
              guaranteed to break — the list is what the graph can prove, nothing more.
            </p>

            {currentImpact.risks.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {currentImpact.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-ink-4" />
                    {r}
                  </li>
                ))}
              </ul>
            )}

            {currentImpact.direct.length + currentImpact.indirect.length === 0 ? (
              <p className="text-[12px] text-ink-3">
                Nothing in the analysed files depends on this entity.
              </p>
            ) : (
              <div className="space-y-3">
                <ImpactGroup title={`Direct dependents (${currentImpact.direct.length})`} items={currentImpact.direct} />
                <ImpactGroup title={`Indirect dependents (${currentImpact.indirect.length})`} items={currentImpact.indirect} />
              </div>
            )}

            {(currentImpact.apiRoutes.length > 0 || currentImpact.dbModels.length > 0) && (
              <div className="mt-3 space-y-1.5 rounded-lg border border-hair bg-surface-2/50 px-3 py-2.5">
                {currentImpact.apiRoutes.length > 0 && (
                  <p className="text-[12px] text-ink-2">
                    <strong className="font-semibold">Externally reachable:</strong>{" "}
                    {currentImpact.apiRoutes.map((r) => r.name).join(", ")}
                  </p>
                )}
                {currentImpact.dbModels.length > 0 && (
                  <p className="text-[12px] text-ink-2">
                    <strong className="font-semibold">Touches data:</strong>{" "}
                    {currentImpact.dbModels.map((m) => m.name).join(", ")}
                  </p>
                )}
              </div>
            )}

            {currentImpact.relatedFindings.length > 0 && (
              <Section title={`Findings in affected files (${currentImpact.relatedFindings.length})`}>
                <ul className="space-y-1.5">
                  {currentImpact.relatedFindings.slice(0, 6).map((f) => (
                    <li key={f.id} className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: SEVERITY_HEX[f.severity] ?? "#7e868c" }}
                      />
                      <span className="text-[12px] leading-snug text-ink-2">{f.title}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </div>

      {/* actions */}
      <div className="border-t border-hair p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onExplore()}
            disabled={expanding}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-hair-strong bg-surface-2 px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
          >
            {expanding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            Explore connections
          </button>
          <button
            type="button"
            onClick={() => void analyseImpact()}
            disabled={impactLoading}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {impactLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Analyze impact
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function RelationshipList({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: { edge: GraphEdge; node: GraphNode }[];
  empty: string;
}) {
  return (
    <Section title={`${title} (${items.length})`}>
      {items.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-ink-4">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 14).map(({ edge, node }) => (
            <li key={edge.id} className="flex items-start gap-2">
              <span className="mt-1 shrink-0 text-ink-4">{icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide",
                      edge.confidence === "inferred"
                        ? "bg-surface-2 text-ink-3"
                        : "bg-brand-50 text-brand-700"
                    )}
                    title={
                      edge.confidence === "inferred"
                        ? "Inferred by name matching across files"
                        : "Stated directly by the syntax"
                    }
                  >
                    {edge.relationshipType.toLowerCase().replace(/_/g, " ")}
                  </span>
                  <span className="truncate text-[12px] text-ink-2" title={node.name}>
                    {node.name}
                  </span>
                </span>
              </span>
            </li>
          ))}
          {items.length > 14 && (
            <li className="text-[11px] text-ink-4">+{items.length - 14} more</li>
          )}
        </ul>
      )}
    </Section>
  );
}

function ImpactGroup({
  title,
  items,
}: {
  title: string;
  items: ChangeImpactResult["direct"];
}) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {items.slice(0, 12).map((x) => (
          <li key={x.node.id} className="rounded-lg border border-hair bg-surface-2/50 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: NODE_TYPE_META[x.node.nodeType].hex }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                {x.node.name}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-4">
                {NODE_TYPE_META[x.node.nodeType].short}
              </span>
            </div>
            <p className="mt-1 flex items-start gap-1.5 font-mono text-[10.5px] leading-relaxed text-ink-3">
              <FileText className="mt-[1px] h-2.5 w-2.5 shrink-0" />
              {x.path.description}
            </p>
          </li>
        ))}
        {items.length > 12 && (
          <li className="text-[11px] text-ink-4">+{items.length - 12} more</li>
        )}
      </ul>
    </Section>
  );
}
