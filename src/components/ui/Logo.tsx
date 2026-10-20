import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Haryn logo — a teal squircle holding a white "H", a cyan node on its corner,
 * and the name set in the display face.
 *
 * The mark reads as a module with a connection point: the squircle is the unit
 * of code, the dot is the graph node attached to it. That is what the product
 * does, so the logo says it rather than decorating it.
 *
 * The tile is drawn in CSS rather than as an image so it stays crisp at every
 * size, inherits the brand tokens, and costs no request.
 */

type Size = "sm" | "md" | "lg";

const SIZES: Record<
  Size,
  {
    tile: string;
    letter: string;
    dot: string;
    ring: string;
    offset: string;
    word: string;
    gap: string;
  }
> = {
  sm: {
    tile: "h-[26px] w-[26px] rounded-[8px]",
    letter: "text-[18px]",
    dot: "h-[9px] w-[9px]",
    ring: "ring-[1.5px]",
    offset: "-right-[3px] -top-[3px]",
    word: "text-[19px]",
    gap: "gap-2",
  },
  md: {
    tile: "h-[32px] w-[32px] rounded-[10px]",
    letter: "text-[22px]",
    dot: "h-[11px] w-[11px]",
    ring: "ring-[1.5px]",
    offset: "-right-[4px] -top-[4px]",
    word: "text-[24px]",
    gap: "gap-2.5",
  },
  lg: {
    tile: "h-[38px] w-[38px] rounded-[12px]",
    letter: "text-[26px]",
    dot: "h-[13px] w-[13px]",
    ring: "ring-[2px]",
    offset: "-right-[5px] -top-[5px]",
    word: "text-[30px]",
    gap: "gap-3",
  },
};

export function Logo({
  className,
  href = "/",
  showMark = true,
  size = "md",
}: {
  className?: string;
  href?: string | null;
  showMark?: boolean;
  size?: Size;
}) {
  const s = SIZES[size];

  const content = (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      {showMark && (
        <span className="relative inline-flex" aria-hidden="true">
          <span
            className={cn("relative grid place-items-center", s.tile)}
            style={{
              // A soft sheen over the teal ramp — a flat fill reads as a placeholder.
              background:
                "radial-gradient(125% 125% at 20% 16%, rgba(255,255,255,0.34), rgba(255,255,255,0) 48%), linear-gradient(145deg, var(--color-brand-400), var(--color-brand-600))",
              boxShadow:
                "0 6px 16px -8px rgba(13,148,136,0.85), inset 0 1px 0 rgba(255,255,255,0.28)",
            }}
          >
            <span
              className={cn(
                "font-display font-extrabold leading-none tracking-[-0.04em] text-white",
                s.letter
              )}
              style={{ transform: "translateY(0.02em)" }}
            >
              H
            </span>
          </span>

          {/* The node. Sits on the corner, not inside the tile. */}
          <span
            className={cn(
              // The ring is the surface colour, not white: it has to cut the dot
              // out of whatever the logo sits on.
              "absolute rounded-full bg-accent-400 ring-[color:var(--color-surface)]",
              s.offset,
              s.dot,
              s.ring
            )}
          />
        </span>
      )}

      <span
        className={cn(
          "font-display font-extrabold leading-none tracking-[-0.035em] text-ink",
          s.word
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
      className="cursor-pointer rounded-lg transition-opacity hover:opacity-85"
      aria-label="Haryn AI home"
    >
      {content}
    </Link>
  );
}
