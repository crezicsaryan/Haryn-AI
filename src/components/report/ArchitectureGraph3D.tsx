"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Architecture } from "@/lib/types";

/**
 * 3D architecture graph.
 *
 * Implemented directly on a canvas rather than pulling in a 3D library. The
 * scene is small (a handful of layers and edges), so all that is needed is a
 * rotation matrix, a perspective divide and a depth sort — roughly a hundred
 * lines, no dependency, and it stays in the light theme.
 *
 * The layout is meaningful rather than decorative: each architecture layer sits
 * at its own depth, so rotating the graph shows the call order in space.
 */

interface Node3D {
  id: string;
  label: string;
  accent: string;
  files: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

const FOV = 900;
/**
 * Layer depth vs. ring radius is a balance. Too much depth and the graph reads
 * as a straight line; too little and the layers stop being distinguishable.
 * These values give a roughly cubic volume for a 6–10 layer architecture.
 */
const LAYER_GAP = 88;
const RING_RADIUS = 158;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.9;

/** A three-quarter view — edge-on hides the depth, top-down hides the layering. */
const INITIAL_ROTATION = { x: -0.5, y: 0.85 };

export function ArchitectureGraph3D({
  architecture,
  height = 420,
}: {
  architecture: Architecture;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [scale, setScale] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);

  // Rotation lives in a ref: it changes every frame and must not re-render.
  const rot = useRef({ ...INITIAL_ROTATION });
  const drag = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const visible = useRef(true);
  const scaleRef = useRef(1);
  const autoRef = useRef(true);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    autoRef.current = autoRotate;
  }, [autoRotate]);

  /* --- Layout: layers along Z, nodes on a ring within each layer --- */
  const nodes = useMemo<Node3D[]>(() => {
    const list = architecture.nodes;
    if (!list.length) return [];

    const count = list.length;
    const mid = (count - 1) / 2;

    return list.map((n, i) => {
      const z = (i - mid) * LAYER_GAP;
      // Spread nodes around the ring; single-node layers sit on the axis.
      const angle = count > 1 ? (i / count) * Math.PI * 2 : 0;
      const ring = count > 1 ? RING_RADIUS : 0;
      const files = n.files ?? 0;
      return {
        id: n.id,
        label: n.label,
        accent: n.accent ?? "#14b8a6",
        files,
        // Alternate the ring phase so adjacent layers do not line up in a row.
        x: Math.cos(angle) * ring * (i % 2 ? 0.82 : 1),
        y: Math.sin(angle) * ring * 0.5,
        z,
        radius: 14 + Math.min(17, Math.sqrt(Math.max(1, files)) * 2.0),
      };
    });
  }, [architecture.nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, Node3D>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  /* --- Render loop ------------------------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !nodes.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Only animate while on screen.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    io.observe(wrap);

    let raf = 0;
    let dpr = 1;
    let w = 0;
    let h = 0;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = wrap.clientWidth;
      h = height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible.current) return;

      if (autoRef.current && !drag.current.active) {
        rot.current.y += 0.0035;
      }

      const { x: rx, y: ry } = rot.current;
      const cx = w / 2;
      const cy = h / 2;
      const zoom = scaleRef.current;

      ctx.clearRect(0, 0, w, h);

      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);

      const project = (p: { x: number; y: number; z: number }) => {
        // Rotate around Y, then X.
        const x1 = p.x * cosY + p.z * sinY;
        const z1 = -p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;

        const s = (FOV / (FOV + z2 + 320)) * zoom;
        return { x: cx + x1 * s, y: cy + y1 * s, z: z2, s };
      };

      const projected = new Map<string, { x: number; y: number; z: number; s: number }>();
      for (const n of nodes) projected.set(n.id, project(n));

      /* Edges — drawn first so nodes sit on top. */
      for (const e of architecture.edges) {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) continue;
        const pa = projected.get(a.id)!;
        const pb = projected.get(b.id)!;

        const depth = (pa.z + pb.z) / 2;
        // Fade distant edges so the front of the graph reads clearly.
        const alpha = Math.max(0.06, Math.min(0.4, 0.4 - depth / 1600));

        const grad = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
        grad.addColorStop(0, hexAlpha(a.accent, alpha));
        grad.addColorStop(1, hexAlpha(b.accent, alpha));

        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(0.6, 1.4 * ((pa.s + pb.s) / 2) * zoom);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      /* Nodes — far to near. */
      const ordered = [...nodes].sort(
        (a, b) => projected.get(b.id)!.z - projected.get(a.id)!.z
      );

      for (const n of ordered) {
        const p = projected.get(n.id)!;
        const r = Math.max(3, n.radius * p.s * zoom);

        // Depth cue: nearer nodes are more opaque and slightly brighter.
        const depth01 = Math.max(0, Math.min(1, (p.z + 400) / 800));
        const alpha = 0.55 + (1 - depth01) * 0.45;

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(n.accent, alpha);
        ctx.fill();

        ctx.lineWidth = Math.max(0.8, 1.6 * p.s);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();

        // Label — only when the node is big enough to read.
        if (r > 7) {
          ctx.font = `600 ${Math.max(9, Math.min(13, r * 0.62))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const label = n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label;
          const ly = p.y + r + 11;

          // A light halo keeps labels legible where nodes overlap in depth —
          // otherwise a far node's text smears into a near node's.
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = "rgba(255,255,255,0.92)";
          ctx.strokeText(label, p.x, ly);

          ctx.fillStyle = `rgba(15,23,42,${0.6 + (1 - depth01) * 0.4})`;
          ctx.fillText(label, p.x, ly);
        }
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [nodes, byId, architecture.edges, height]);

  /* --- Interaction ------------------------------------------------ */
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.lastX;
    const dy = e.clientY - drag.current.lastY;
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    rot.current.y += dx * 0.008;
    rot.current.x = Math.max(-1.2, Math.min(1.2, rot.current.x + dy * 0.006));
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current.active = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    setScale((s) =>
      Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * (e.deltaY > 0 ? 0.92 : 1.08)))
    );
  }

  if (!nodes.length) return null;

  return (
    <div ref={wrapRef} className="relative">
      <canvas
        ref={canvasRef}
        className="block w-full cursor-grab touch-none rounded-lg active:cursor-grabbing"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, var(--color-surface-2) 0%, var(--color-surface) 70%)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        aria-label="3D architecture graph — drag to rotate"
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
        <span className="pointer-events-auto rounded-pill border border-hair bg-surface/90 px-2.5 py-1 text-[10.5px] text-ink-3 backdrop-blur">
          drag to rotate · scroll to zoom
        </span>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            aria-pressed={autoRotate}
            className="cursor-pointer rounded-pill border border-hair bg-surface/90 px-2.5 py-1 text-[10.5px] font-medium text-ink-3 backdrop-blur transition-colors hover:text-ink"
          >
            {autoRotate ? "Pause spin" : "Auto spin"}
          </button>
          <button
            type="button"
            onClick={() => {
              rot.current = { ...INITIAL_ROTATION };
              setScale(1);
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded-pill border border-hair bg-surface/90 px-2.5 py-1 text-[10.5px] font-medium text-ink-3 backdrop-blur transition-colors hover:text-ink"
            title="Reset the view"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/** `#rrggbb` + alpha → `rgba(...)`. */
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
