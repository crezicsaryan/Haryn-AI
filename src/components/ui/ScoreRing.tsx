"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./AnimatedNumber";
import { gradeFor } from "@/lib/scoring";

/**
 * The headline Codebase Health Score dial. A gradient-stroked SVG arc that
 * sweeps from 0 to the score on mount, with the grade in the centre.
 */
export function ScoreRing({
  score,
  size = 208,
  stroke = 14,
  className,
  showGrade = true,
  label = "Codebase Health",
}: {
  score: number;
  size?: number;
  stroke?: number;
  className?: string;
  showGrade?: boolean;
  label?: string;
}) {
  const [sweep, setSweep] = useState(0);
  const grade = useMemo(() => gradeFor(score), [score]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, sweep)) / 100;
  const dash = circumference * pct;

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const t = window.setTimeout(() => setSweep(score), 0);
      return () => window.clearTimeout(t);
    }
    const start = performance.now();
    const duration = 1200;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setSweep(score * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const id = `ring-${Math.round(score)}`;

  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`Codebase health score ${score} out of 100`}
      >
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="55%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-hair)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="flex items-baseline justify-center gap-1">
            <AnimatedNumber
              value={score}
              className="font-display text-[52px] font-extrabold leading-none tracking-tight text-ink"
            />
            <span className="font-display text-lg font-bold text-ink-3">/100</span>
          </div>
          {showGrade && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface px-2.5 py-1 shadow-xs">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: grade.hex }}
              />
              <span className="text-[12px] font-semibold text-ink">{grade.label}</span>
            </div>
          )}
          <div className="mt-2 text-[11.5px] font-medium uppercase tracking-[0.14em] text-ink-3">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}
