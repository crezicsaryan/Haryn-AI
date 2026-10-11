import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "accent"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-pill font-medium cursor-pointer select-none " +
    "transition-[transform,box-shadow,background-color,color,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-45 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

  const sizes: Record<ButtonSize, string> = {
    sm: "h-9 px-4 text-[13px]",
    md: "h-11 px-5 text-sm",
    lg: "h-[52px] px-7 text-[15px]",
  };

  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-ink text-white shadow-[0_10px_24px_-12px_rgba(10,15,28,0.6)] hover:bg-[#161d2e] hover:shadow-[0_16px_32px_-14px_rgba(10,15,28,0.65)]",
    secondary:
      "bg-surface text-ink border border-hair-strong shadow-xs hover:border-ink-4 hover:bg-surface-2",
    ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
    accent:
      "text-white shadow-[0_12px_28px_-12px_rgba(20,184,166,0.7)] hover:brightness-[1.05] bg-[linear-gradient(120deg,var(--color-brand-500),var(--color-brand-600))]",
    danger:
      "bg-crit text-white shadow-[0_10px_24px_-12px_rgba(229,72,77,0.6)] hover:brightness-[1.05]",
  };

  return cn(base, sizes[size], variants[variant], className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-current border-t-transparent opacity-70"
        />
      )}
      {children}
    </button>
  )
);
Button.displayName = "Button";
