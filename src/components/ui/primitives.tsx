import * as React from "react";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";
import { SEVERITIES } from "@/lib/constants";
import { AlertOctagon, AlertTriangle, Info, ShieldAlert, CircleDot } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-hair bg-surface shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-hair px-5 py-4 sm:px-6",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Severity badge                                                      */
/* ------------------------------------------------------------------ */

const SEVERITY_ICON: Record<Severity, React.ComponentType<{ className?: string }>> = {
  critical: AlertOctagon,
  high: ShieldAlert,
  medium: AlertTriangle,
  low: CircleDot,
  info: Info,
};

export function SeverityBadge({
  severity,
  showIcon = true,
  className,
  size = "md",
}: {
  severity: Severity;
  showIcon?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const meta = SEVERITIES[severity];
  const Icon = SEVERITY_ICON[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-semibold uppercase tracking-wide",
        size === "sm"
          ? "px-2 py-[3px] text-[10px]"
          : "px-2.5 py-1 text-[11px]",
        meta.text,
        meta.soft,
        "border-current/15",
        className
      )}
    >
      {showIcon && <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />}
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chip / filter pill                                                  */
/* ------------------------------------------------------------------ */

export function Chip({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "border-ink bg-ink text-white"
          : "border-hair-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Section wrapper                                                     */
/* ------------------------------------------------------------------ */

export function Section({
  id,
  title,
  description,
  eyebrow,
  action,
  children,
  className,
}: {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      {(title || eyebrow) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            {eyebrow && (
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small labelled stat                                                 */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-hair bg-surface-2/60 p-3.5", className)}>
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-bold tracking-tight text-ink">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}
