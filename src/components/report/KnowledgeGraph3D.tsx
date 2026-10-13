"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import { EDGE_TYPE_META, NODE_TYPE_META } from "@/lib/graph/types";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/lib/graph/types";

/**
 * 3D knowledge graph — concentric circular layout.
 *
 * Why circles rather than a force-directed cloud: a knowledge graph has a
 * natural hierarchy (repository → folders → files → declarations → interfaces),
 * and a hierarchy drawn as a cloud tells the reader nothing. Placing each level
 * on its own ring makes the structure explicit — you can see at a glance that a
 * function sits outside its file, and that an API endpoint sits outside the
 * function that serves it.
 *
 * Rendered directly on a canvas: a rotation matrix, a perspective divide and a
 * depth sort is all this needs, so there is no 3D dependency to load, nothing to
 * break at build time, and the light theme is preserved exactly.
 *
 * Readability is the hard part, not the maths. Three things do the work:
 *  - depth fading, so the front of the graph is crisp and the back recedes;
 *  - label collision avoidance with a white halo, so text never smears;
 *  - node size by degree, so the entities that matter are the ones you see.
 */

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * One ring per level of the hierarchy, innermost first.
 *
 * Exported so the surrounding view can label the rings without duplicating the
 * mapping — the legend and the layout cannot drift apart.
 *
 * A node type that is not listed anywhere falls back to the outermost ring,
 * so adding a type to the backend never makes it invisible here.
 */
export const RINGS: { label: string; types: GraphNodeType[]; radius: number }[] = [
  { label: "Repository", types: ["repository"], radius: 0 },
  { label: "Folders", types: ["directory"], radius: 148 },
  {
    label: "Files",
    types: ["file", "service", "controller", "middleware", "test"],
    radius: 292,
  },
  {
    label: "Declarations",
    types: ["function", "class", "interface"],
    radius: 428,
  },
  {
    label: "Interfaces & data",
    types: ["api_endpoint", "db_model", "db_table", "env_var", "package"],
    radius: 556,
  },
];

const RING_OF: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  RINGS.forEach((ring, index) => {
    for (const type of ring.types) map[type] = index;
  });
  return map;
})();

/** Shallow lens: outer rings sit slightly higher, so the rings separate in depth. */
const RING_LIFT = 30;
/** Degrees of phase shift per ring, so nodes do not line up radially. */
const RING_PHASE = 0.42;

/** Guide tint per ring, matched to the dominant entity colour in it. */
export const RING_TINT = ["#0f172a", "#64748b", "#0ea5e9", "#14b8a6", "#f76808"];

const FOV = 1100;
const CAM_DIST = 700;

/**
 * Room reserved around each node when fitting to the canvas.
 *
 * Labels are set in screen space, so they do not shrink with the graph — a long
 * endpoint name is the widest thing on screen, and a fit that ignores it clips
 * exactly the labels the reader needs most.
 */
const LABEL_PAD_X = 46;
const LABEL_PAD_Y = 18;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const INITIAL_PITCH = -0.62;
const INITIAL_YAW = 0.6;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

type Shape = "circle" | "square" | "diamond" | "hex";

/**
 * Shape carries the entity class, colour carries the exact type.
 *
 * Colour alone would make a 12-type legend unreadable at a glance; pairing it
 * with four silhouettes means you can tell an endpoint from a file without
 * consulting the legend at all.
 */
const SHAPE: Record<GraphNodeType, Shape> = {
  repository: "hex",
  directory: "square",
  file: "square",
  service: "hex",
  controller: "square",
  middleware: "hex",
  test: "circle",
  function: "circle",
  class: "square",
  interface: "diamond",
  api_endpoint: "diamond",
  db_model: "hex",
  db_table: "hex",
  package: "square",
  env_var: "diamond",
};

function tracePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  shape: Shape
) {
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case "square": {
      const s = r * 0.86;
      ctx.roundRect(x - s, y - s, s * 2, s * 2, Math.max(1.5, r * 0.3));
      break;
    }
    case "diamond":
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r * 1.15, y);
      ctx.lineTo(x, y + r * 1.15);
      ctx.lineTo(x - r * 1.15, y);
      ctx.closePath();
      break;
    case "hex": {
      const a = r * 1.08;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(ang) * a;
        const py = y + Math.sin(ang) * a;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

interface Node3D {
  id: string;
  node: GraphNode;
  label: string;
  shortLabel: string;
  hex: string;
  shape: Shape;
  x: number;
  y: number;
  z: number;
  radius: number;
  degree: number;
  ring: number;
}

interface Projected {
  x: number;
  y: number;
  z: number;
  s: number;
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shorten a long identifier without hiding which one it is. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function KnowledgeGraph3D({
  nodes,
  edges,
  selected,
  highlight,
  height = 640,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: GraphNode | null;
  highlight: Set<string>;
  height?: number;
  onSelect: (node: GraphNode | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [autoSpin, setAutoSpin] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(
    null
  );

  /* Camera. Rotation, pan and zoom live in refs because they change per frame
     and must never trigger a React render. */
  const rot = useRef({ x: INITIAL_PITCH, y: INITIAL_YAW });
  const pan = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const autoRef = useRef(false);
  const fitted = useRef(false);

  const drag = useRef<{
    active: boolean;
    mode: "rotate" | "pan";
    lastX: number;
    lastY: number;
    moved: number;
  }>({ active: false, mode: "rotate", lastX: 0, lastY: 0, moved: 0 });

  const hoverId = useRef<string | null>(null);
  const visible = useRef(true);
  /** Where the camera is easing toward after a selection. Null = not easing. */
  const panTarget = useRef<{ x: number; y: number } | null>(null);
  /** Projected geometry from the last frame — used for hit testing. */
  const hits = useRef<{ id: string; x: number; y: number; r: number; z: number }[]>([]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    autoRef.current = autoSpin;
  }, [autoSpin]);

  /* ---- Layout: one ring per level, nodes spread evenly around it ---- */
  const { nodes3d, byId } = useMemo(() => {
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) ?? 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) ?? 0) + 1);
    }

    // Group by ring so each ring can be spaced independently.
    const buckets = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const ring = RING_OF[n.nodeType] ?? RINGS.length - 1;
      const list = buckets.get(ring);
      if (list) list.push(n);
      else buckets.set(ring, [n]);
    }

    const out: Node3D[] = [];

    for (const [ringIndex, list] of buckets) {
      const ring = RINGS[ringIndex] ?? RINGS[RINGS.length - 1];
      // Most connected first, so the strongest entities take the positions that
      // read best and the eye finds them first.
      const ordered = [...list].sort((a, b) => {
        const da = degree.get(a.id) ?? 0;
        const db = degree.get(b.id) ?? 0;
        return db - da || a.name.localeCompare(b.name);
      });

      const count = ordered.length;
      const radius = ring.radius;

      ordered.forEach((n, i) => {
        const angle = (i / Math.max(1, count)) * Math.PI * 2 + ringIndex * RING_PHASE;
        const deg = degree.get(n.id) ?? 0;
        const base = n.nodeType === "repository" ? 19 : 8.5;

        out.push({
          id: n.id,
          node: n,
          label: n.name,
          shortLabel: shorten(n.name, 26),
          hex: NODE_TYPE_META[n.nodeType].hex,
          shape: SHAPE[n.nodeType] ?? "circle",
          // A single-node ring (the repository) sits on the axis.
          x: count === 1 && radius === 0 ? 0 : Math.cos(angle) * radius,
          y: (ringIndex - (RINGS.length - 1) / 2) * RING_LIFT,
          z: count === 1 && radius === 0 ? 0 : Math.sin(angle) * radius,
          radius: base + Math.min(12, Math.sqrt(deg) * 2.9),
          degree: deg,
          ring: ringIndex,
        });
      });
    }

    const index = new Map<string, Node3D>();
    for (const n of out) index.set(n.id, n);

    return { nodes3d: out, byId: index };
  }, [nodes, edges]);

  /**
   * Zoom that makes the whole graph fit, whatever the canvas size.
   *
   * Measured by projecting every node at zoom 1 and taking the real bounding
   * box, rather than assuming the outermost ring equals the visible extent.
   * That assumption is wrong twice over: perspective magnifies the near side of
   * the disc, and a long label such as `POST /payment/create-order` reaches far
   * past the node it belongs to. Projecting costs one pass over a few hundred
   * nodes and gets both right, at any rotation.
   */
  const computeFit = useCallback(
    (w: number, h: number) => {
      if (!nodes3d.length || w === 0 || h === 0) return 1;

      const { x: rx, y: ry } = rot.current;
      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const n of nodes3d) {
        const x1 = n.x * cosY + n.z * sinY;
        const z1 = -n.x * sinY + n.z * cosY;
        const y1 = n.y * cosX - z1 * sinX;
        const z2 = n.y * sinX + z1 * cosX;
        const s = FOV / (FOV + z2 + CAM_DIST);

        const r = Math.max(5, n.radius * s);
        const sx = x1 * s;
        const sy = y1 * s;

        // Room for the label, which is wider than the node and sits below it.
        minX = Math.min(minX, sx - r - LABEL_PAD_X);
        maxX = Math.max(maxX, sx + r + LABEL_PAD_X);
        minY = Math.min(minY, sy - r);
        maxY = Math.max(maxY, sy + r + LABEL_PAD_Y);
      }

      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);

      return Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.min((w * 0.94) / spanX, (h * 0.9) / spanY))
      );
    },
    [nodes3d]
  );

  const resetView = useCallback(() => {
    rot.current = { x: INITIAL_PITCH, y: INITIAL_YAW };
    pan.current = { x: 0, y: 0 };
    const wrap = wrapRef.current;
    if (wrap) setZoom(computeFit(wrap.clientWidth, height));
    else setZoom(1);
  }, [computeFit, height]);

  const fitToScreen = useCallback(() => {
    const wrap = wrapRef.current;
    panTarget.current = null;
    pan.current = { x: 0, y: 0 };
    if (wrap) setZoom(computeFit(wrap.clientWidth, height));
  }, [computeFit, height]);

  /**
   * Bring a newly selected node into the clear.
   *
   * The details panel covers the right-hand third of the canvas, so a node
   * sitting there would be hidden behind the very panel describing it — the
   * worst possible outcome for a click. The camera eases instead of jumping, so
   * the reader keeps track of where the node went.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !selected) return;
    const n = byId.get(selected.id);
    const w = wrap.clientWidth;
    if (!n || !w) return;

    const h = height;
    const { x: rx, y: ry } = rot.current;
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);

    const x1 = n.x * cosY + n.z * sinY;
    const z1 = -n.x * sinY + n.z * cosY;
    const y1 = n.y * cosX - z1 * sinX;
    const z2 = n.y * sinX + z1 * cosX;
    const s = (FOV / (FOV + z2 + CAM_DIST)) * zoomRef.current;

    const nowX = w / 2 + pan.current.x + x1 * s;
    const nowY = h / 2 + pan.current.y + y1 * s;

    // Centre of the area the panel does not cover.
    const panelW = Math.min(360, w * 0.88);
    panTarget.current = {
      x: pan.current.x + ((w - panelW) / 2 - nowX),
      y: pan.current.y + (h * 0.42 - nowY),
    };
  }, [selected, byId, height]);

  /* ---- Render loop -------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !nodes3d.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // A hidden section still has a canvas; pausing off-screen keeps the main
    // thread free while the user reads another view.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
      },
      { threshold: 0.03 }
    );
    io.observe(wrap);

    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = wrap.clientWidth;
      h = height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // First real measurement: scale the graph to the canvas. Doing it here
      // rather than on mount is what makes the view correct inside a section
      // that was hidden when the component first rendered.
      if (!fitted.current && w > 0) {
        fitted.current = true;
        const z = computeFit(w, h);
        zoomRef.current = z;
        setZoom(z);
      }
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible.current || w === 0) return;

      if (autoRef.current && !drag.current.active) {
        rot.current.y += 0.0026;
      }

      // Ease the camera toward a selection, then stop — no endless animation.
      const target = panTarget.current;
      if (target) {
        pan.current.x += (target.x - pan.current.x) * 0.16;
        pan.current.y += (target.y - pan.current.y) * 0.16;
        if (
          Math.abs(target.x - pan.current.x) < 0.4 &&
          Math.abs(target.y - pan.current.y) < 0.4
        ) {
          pan.current.x = target.x;
          pan.current.y = target.y;
          panTarget.current = null;
        }
      }

      const { x: rx, y: ry } = rot.current;
      const cx = w / 2 + pan.current.x;
      const cy = h / 2 + pan.current.y;
      const zoomNow = zoomRef.current;

      ctx.clearRect(0, 0, w, h);

      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);

      const project = (px: number, py: number, pz: number): Projected => {
        const x1 = px * cosY + pz * sinY;
        const z1 = -px * sinY + pz * cosY;
        const y1 = py * cosX - z1 * sinX;
        const z2 = py * sinX + z1 * cosX;
        const s = (FOV / (FOV + z2 + CAM_DIST)) * zoomNow;
        return { x: cx + x1 * s, y: cy + y1 * s, z: z2, s };
      };

      const projected = new Map<string, Projected>();
      for (const n of nodes3d) projected.set(n.id, project(n.x, n.y, n.z));

      /* ---- 1. Ring guides ------------------------------------------
         Without these the circular layout reads as a random scatter. The
         guides are what make the hierarchy visible, so each ring is tinted
         after the kind of entity it holds — the files ring reads blue, the
         declarations ring teal — which ties a ring to its contents at a
         glance instead of needing the legend. */
      const ringCounts = new Map<number, number>();
      for (const n of nodes3d) ringCounts.set(n.ring, (ringCounts.get(n.ring) ?? 0) + 1);

      const captions: { x: number; y: number; text: string; hex: string }[] = [];

      for (const [ringIndex, count] of ringCounts) {
        const ring = RINGS[ringIndex];
        if (!ring || ring.radius === 0) continue;
        const ry3d = (ringIndex - (RINGS.length - 1) / 2) * RING_LIFT;
        const tint = RING_TINT[ringIndex] ?? "#64748b";

        ctx.beginPath();
        const SEGMENTS = 72;
        for (let i = 0; i <= SEGMENTS; i++) {
          const ang = (i / SEGMENTS) * Math.PI * 2;
          const p = project(Math.cos(ang) * ring.radius, ry3d, Math.sin(ang) * ring.radius);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = hexAlpha(tint, 0.34);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Caption sits in the empty annulus *between* this ring and the next,
        // not on the ring itself — the ring is exactly where the nodes are, so
        // a caption there would land on top of the labels it is meant to
        // explain. Drawn last, once the nodes are down, so it is never buried.
        const nextRadius = RINGS[ringIndex + 1]?.radius ?? ring.radius + 70;
        const captionRadius = ring.radius + (nextRadius - ring.radius) / 2;
        const anchor = project(0, ry3d, -captionRadius);
        captions.push({
          x: anchor.x,
          y: anchor.y,
          text: `${ring.label.toUpperCase()} · ${count}`,
          hex: tint,
        });
      }

      /* ---- 2. Edges ------------------------------------------------ */
      const selectionActive = Boolean(selected) || highlight.size > 0;
      const focus = selected ? selected.id : null;

      for (const e of edges) {
        const a = byId.get(e.sourceNodeId);
        const b = byId.get(e.targetNodeId);
        if (!a || !b) continue;
        const pa = projected.get(a.id);
        const pb = projected.get(b.id);
        if (!pa || !pb) continue;

        const touchesFocus =
          focus !== null && (e.sourceNodeId === focus || e.targetNodeId === focus);
        const inHighlight = highlight.has(e.sourceNodeId) && highlight.has(e.targetNodeId);

        const depth = (pa.z + pb.z) / 2;
        // Fade by depth so the far side of the graph recedes instead of
        // competing with the front for attention.
        const depthFade = Math.max(0.1, Math.min(1, 1 - (depth + 560) / 1300));

        /**
         * Containment edges outnumber everything else — one per file, all
         * converging on the repository node — and they carry the least
         * information, because a file being inside a repository is not a
         * surprise. Drawing them at full strength is what turns the graph into
         * an unreadable web. The relationships a reader actually came for
         * (calls, imports, routes) keep their weight.
         */
        const structural = e.relationshipType === "CONTAINS";

        let alpha = (structural ? 0.14 : 0.36) * depthFade + 0.05;
        let width = structural ? 0.8 : 1;
        if (selectionActive) {
          if (touchesFocus) {
            alpha = 0.95;
            width = 2.4;
          } else if (inHighlight) {
            alpha = 0.5;
            width = 1.6;
          } else {
            alpha = 0.05;
            width = 0.8;
          }
        }

        const meta = EDGE_TYPE_META[e.relationshipType];
        const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
        grad.addColorStop(0, hexAlpha(a.hex, alpha));
        grad.addColorStop(1, hexAlpha(b.hex, alpha));

        ctx.strokeStyle = selectionActive && !touchesFocus && !inHighlight ? hexAlpha("#cbd5e1", alpha) : grad;
        ctx.lineWidth = width;
        if (e.confidence === "inferred") ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrowhead, but only where it can actually be read — on a focused
        // edge. Drawing thousands of arrowheads is noise.
        if (touchesFocus || inHighlight) {
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const r = Math.max(3, b.radius * pb.s * zoomNow);
          const tipX = pb.x - ux * (r + 2);
          const tipY = pb.y - uy * (r + 2);
          const size = 6;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
          ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(meta.hex, Math.min(0.95, alpha + 0.2));
          ctx.fill();
        }
      }

      /* ---- 3. Nodes, far to near ----------------------------------- */
      const ordered = [...nodes3d].sort(
        (a, b) => (projected.get(b.id)?.z ?? 0) - (projected.get(a.id)?.z ?? 0)
      );

      const hitList: { id: string; x: number; y: number; r: number; z: number }[] = [];
      const labels: {
        n: Node3D;
        p: Projected;
        r: number;
        depth01: number;
        priority: number;
      }[] = [];

      for (const n of ordered) {
        const p = projected.get(n.id)!;
        const r = Math.max(3, n.radius * p.s * zoomNow);
        const depth01 = Math.max(0, Math.min(1, (p.z + 560) / 1120));

        const isSelected = selected?.id === n.id;
        const isHovered = hoverId.current === n.id;
        const isHighlighted = highlight.has(n.id);
        const dimmed = selectionActive && !isSelected && !isHighlighted && !isHovered;

        const alpha = dimmed ? 0.16 : 0.5 + (1 - depth01) * 0.5;

        // Soft shadow gives the node volume, which is what sells the depth.
        if (!dimmed) {
          ctx.beginPath();
          ctx.arc(p.x + 1, p.y + r * 0.22, r * 1.05, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(15, 23, 42, ${0.1 * (1 - depth01)})`;
          ctx.fill();
        }

        tracePath(ctx, p.x, p.y, r, n.shape);
        ctx.fillStyle = hexAlpha(n.hex, alpha);
        ctx.fill();
        ctx.lineWidth = isSelected || isHovered ? 2.4 : Math.max(0.8, 1.5 * p.s);
        ctx.strokeStyle = isSelected
          ? "#0f172a"
          : hexAlpha("#ffffff", Math.min(1, alpha + 0.35));
        ctx.stroke();

        // A halo marks the focus and its neighbours without moving anything.
        if (isSelected || isHovered || isHighlighted) {
          tracePath(ctx, p.x, p.y, r + (isSelected ? 6 : 4), n.shape);
          ctx.strokeStyle = isSelected
            ? "rgba(15,23,42,0.85)"
            : hexAlpha(n.hex, isHighlighted ? 0.75 : 0.45);
          ctx.lineWidth = isSelected ? 2 : 1.6;
          ctx.stroke();
        }

        hitList.push({ id: n.id, x: p.x, y: p.y, r: Math.max(r, 9), z: p.z });

        // Labels compete for space, so they are collected and placed later in
        // priority order rather than drawn as each node happens to come up.
        if (!dimmed) {
          const priority =
            (isSelected ? 1000 : 0) +
            (isHovered ? 900 : 0) +
            (isHighlighted ? 500 : 0) +
            (1 - depth01) * 200 +
            Math.min(120, n.degree * 6);
          labels.push({ n, p, r, depth01, priority });
        }
      }

      hits.current = hitList;

      /* ---- 4. Labels ----------------------------------------------
         Placed nearest-first with a white halo, and skipped when they would
         overlap something already drawn. Overlapping text is what makes a graph
         of this size unreadable; a missing label is merely an inconvenience. */
      const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const MAX_LABELS = 130;

      for (const item of labels.sort((a, b) => b.priority - a.priority)) {
        if (placed.length >= MAX_LABELS) break;

        const { n, p, r, depth01 } = item;
        const size = Math.max(9.5, Math.min(12.5, r * 0.85 + 6));
        ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const text = n.shortLabel;
        const width = ctx.measureText(text).width;
        const ly = p.y + r + size * 0.95;
        const box = {
          x1: p.x - width / 2 - 2,
          y1: ly - size * 0.62,
          x2: p.x + width / 2 + 2,
          y2: ly + size * 0.62,
        };

        const overlaps = placed.some(
          (b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1
        );
        const essential =
          item.priority >= 500 ||
          n.node.nodeType === "api_endpoint" ||
          n.node.nodeType === "db_model";
        if (overlaps && !essential) continue;

        // Half a label hanging off the canvas edge looks like a rendering bug,
        // so a label that will not fit is dropped rather than cropped. The ones
        // that matter — the selection, the hovered node, endpoints and models —
        // are pulled back inside instead, because losing them loses the point.
        const margin = 3;
        let lx = p.x;
        if (essential) {
          const half = width / 2;
          lx = Math.max(half + margin, Math.min(w - half - margin, p.x));
        } else if (
          box.x1 < margin ||
          box.x2 > w - margin ||
          box.y1 < margin ||
          box.y2 > h - margin
        ) {
          continue;
        }

        placed.push({ x1: lx - width / 2 - 2, y1: box.y1, x2: lx + width / 2 + 2, y2: box.y2 });

        const ink = 0.42 + (1 - depth01) * 0.5;
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.strokeText(text, lx, ly);
        ctx.fillStyle = `rgba(15,23,42,${ink})`;
        ctx.fillText(text, lx, ly);
      }

      /* ---- 5. Ring captions ----------------------------------------
         Last, so they sit above the graph and stay readable. Each gets a
         solid pill because a caption over a dense area is worse than no
         caption at all. */
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 10px ui-sans-serif, system-ui, sans-serif";
      for (const caption of captions) {
        const tw = ctx.measureText(caption.text).width;
        const x = Math.max(tw / 2 + 6, Math.min(w - tw / 2 - 6, caption.x));
        const y = Math.max(12, Math.min(h - 12, caption.y));

        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.beginPath();
        ctx.roundRect(x - tw / 2 - 5, y - 8.5, tw + 10, 17, 8);
        ctx.fill();
        ctx.strokeStyle = hexAlpha(caption.hex, 0.28);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = hexAlpha(caption.hex, 0.95);
        ctx.fillText(caption.text, x, y);
      }

      /* ---- 6. Relationship labels on the focused edges -------------- */
      if (focus) {
        const origin = projected.get(focus);
        if (origin) {
          for (const e of edges) {
            const other = e.sourceNodeId === focus ? e.targetNodeId : e.sourceNodeId;
            if (e.sourceNodeId !== focus && e.targetNodeId !== focus) continue;
            const po = projected.get(other);
            if (!po) continue;

            const mx = (origin.x + po.x) / 2;
            const my = (origin.y + po.y) / 2;
            const meta = EDGE_TYPE_META[e.relationshipType];
            const text = e.confidence === "inferred" ? `${meta.label}?` : meta.label;

            ctx.font = "600 9.5px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const tw = ctx.measureText(text).width;

            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.beginPath();
            ctx.roundRect(mx - tw / 2 - 3.5, my - 7, tw + 7, 14, 4);
            ctx.fill();

            ctx.fillStyle = meta.hex;
            ctx.fillText(text, mx, my);
          }
        }
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [nodes3d, byId, edges, height, selected, highlight, computeFit]);

  /* ---- Hit testing -------------------------------------------------- */

  /** Nearest node under the pointer, or null. Searched front-to-back. */
  const pick = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const ordered = [...hits.current].sort((a, b) => a.z - b.z);
    for (const hit of ordered) {
      // A little slack so small nodes are still easy to hit.
      if (Math.hypot(hit.x - x, hit.y - y) <= hit.r + 4) return hit.id;
    }
    return null;
  }, []);

  /* ---- Interaction -------------------------------------------------- */

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    // Taking the pointer cancels any camera easing — the user is driving now.
    panTarget.current = null;
    // Middle button and right button pan; left button rotates. Shift+left also
    // pans, which is the convention most 3D viewers use.
    const mode: "rotate" | "pan" =
      e.button === 1 || e.button === 2 || e.shiftKey ? "pan" : "rotate";
    drag.current = { active: true, mode, lastX: e.clientX, lastY: e.clientY, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current.active) {
      const id = pick(e.clientX, e.clientY);
      if (id !== hoverId.current) {
        hoverId.current = id;
        const node = id ? nodes.find((n) => n.id === id) ?? null : null;
        const canvas = canvasRef.current;
        if (node && canvas) {
          const rect = canvas.getBoundingClientRect();
          setHovered({ node, x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else {
          setHovered(null);
        }
      } else if (id && hoverId.current) {
        // Follow the pointer while the same node stays under it.
        const canvas = canvasRef.current;
        const node = nodes.find((n) => n.id === id);
        if (canvas && node) {
          const rect = canvas.getBoundingClientRect();
          setHovered({ node, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }
      return;
    }

    const dx = e.clientX - drag.current.lastX;
    const dy = e.clientY - drag.current.lastY;
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.current.mode === "pan") {
      pan.current.x += dx;
      pan.current.y += dy;
    } else {
      rot.current.y += dx * 0.0075;
      rot.current.x = Math.max(-1.35, Math.min(1.35, rot.current.x + dy * 0.006));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const wasRotate = drag.current.mode === "rotate";
    const moved = drag.current.moved;
    drag.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }

    // A click is a press that did not turn into a drag.
    if (wasRotate && moved < 5) {
      const id = pick(e.clientX, e.clientY);
      onSelect(id ? nodes.find((n) => n.id === id) ?? null : null);
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.9 : 1.11;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor));
    const k = next / zoomRef.current;

    // Zoom toward the pointer: keep whatever is under the cursor in place, so
    // zooming feels like moving a lens rather than scaling the picture.
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ox = px - (rect.width / 2 + pan.current.x);
    const oy = py - (rect.height / 2 + pan.current.y);
    pan.current.x -= ox * (k - 1);
    pan.current.y -= oy * (k - 1);

    zoomRef.current = next;
    setZoom(next);
  }

  if (!nodes3d.length) return null;

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-hair">
      <canvas
        ref={canvasRef}
        className="block w-full cursor-grab touch-none active:cursor-grabbing"
        style={{
          background:
            "radial-gradient(120% 95% at 50% 0%, var(--color-surface-2) 0%, var(--color-surface) 72%)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hoverId.current = null;
          setHovered(null);
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="3D knowledge graph — drag to rotate, shift-drag to pan, scroll to zoom"
      />

      {/* Hover card — HTML rather than canvas so the text stays crisp. */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 max-w-[280px] rounded-lg border border-hair bg-surface/97 px-2.5 py-2 shadow-lg backdrop-blur"
          style={{
            left: Math.min(Math.max(hovered.x + 14, 8), 9999),
            top: hovered.y + 14,
          }}
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: NODE_TYPE_META[hovered.node.nodeType].hex }}
            />
            <span className="truncate">{hovered.node.name}</span>
          </p>
          <p className="mt-0.5 text-[10.5px] uppercase tracking-wide text-ink-3">
            {NODE_TYPE_META[hovered.node.nodeType].label}
            {hovered.node.startLine ? ` · line ${hovered.node.startLine}` : ""}
          </p>
          {hovered.node.filePath && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
              {hovered.node.filePath}
            </p>
          )}
        </div>
      )}

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
        <span className="pointer-events-auto rounded-pill border border-hair bg-surface/92 px-2.5 py-1 text-[10.5px] text-ink-3 backdrop-blur">
          drag rotate · shift-drag pan · scroll zoom · click a node
        </span>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <span className="rounded-pill border border-hair bg-surface/92 px-2.5 py-1 font-mono text-[10.5px] text-ink-3 backdrop-blur">
            {nodes3d.length} entities · {edges.length} relations · {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setAutoSpin((v) => !v)}
            aria-pressed={autoSpin}
            className="inline-flex cursor-pointer items-center gap-1 rounded-pill border border-hair bg-surface/92 px-2.5 py-1 text-[10.5px] font-medium text-ink-3 backdrop-blur transition-colors hover:text-ink"
          >
            {autoSpin ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {autoSpin ? "Stop spin" : "Auto spin"}
          </button>
          <button
            type="button"
            onClick={fitToScreen}
            title="Fit the graph to the canvas"
            className="inline-flex cursor-pointer items-center gap-1 rounded-pill border border-hair bg-surface/92 px-2.5 py-1 text-[10.5px] font-medium text-ink-3 backdrop-blur transition-colors hover:text-ink"
          >
            <Maximize2 className="h-3 w-3" />
            Fit
          </button>
          <button
            type="button"
            onClick={resetView}
            title="Reset rotation, pan and zoom"
            className="inline-flex cursor-pointer items-center gap-1 rounded-pill border border-hair bg-surface/92 px-2.5 py-1 text-[10.5px] font-medium text-ink-3 backdrop-blur transition-colors hover:text-ink"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
