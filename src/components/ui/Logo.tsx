import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Haryn wordmark. The "H" sits in a soft teal tile and the name is set in an
 * elegant serif — echoing the reference's italic script logo, kept restrained.
 */
export function Logo({
  className,
  href = "/",
  showMark = true,
  size = "md",
}: {
  className?: string;
  href?: string | null;
  showMark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const text =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-lg" : "text-xl";
  const tile =
    size === "lg" ? "h-9 w-9 text-lg" : size === "sm" ? "h-7 w-7 text-sm" : "h-8 w-8";

  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark && (
        <span
          className={cn(
            "relative grid place-items-center rounded-[10px] font-display font-extrabold text-white shadow-[0_6px_16px_-6px_rgba(20,184,166,0.75)]",
            tile
          )}
          style={{
            background:
              "linear-gradient(140deg, var(--color-brand-400), var(--color-brand-600))",
          }}
          aria-hidden="true"
        >
          H
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-400 ring-2 ring-white" />
        </span>
      )}
      <span
        className={cn(
          "font-serif italic leading-none tracking-tight text-ink",
          text
        )}
      >
        Haryn
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      className="cursor-pointer rounded-md transition-opacity hover:opacity-80"
      aria-label="Haryn AI home"
    >
      {content}
    </Link>
  );
}
