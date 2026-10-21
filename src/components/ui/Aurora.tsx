import { cn } from "@/lib/utils";

/**
 * The signature Haryn backdrop: a near-white canvas, soft pastel gradient
 * blobs and a faint blueprint grid that fades out toward the edges.
 * Purely decorative — hidden from assistive tech.
 *
 * Performance note: animations respect prefers-reduced-motion. On hero
 * variant we render 3 blobs instead of 5 to cut compositing cost.
 */
export function Aurora({
  className,
  variant = "hero",
}: {
  className?: string;
  variant?: "hero" | "subtle" | "report";
}) {
  const intensity = variant === "hero" ? 1 : variant === "report" ? 0.6 : 0.45;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      {/* Blueprint grid */}
      <div className="absolute inset-0 bg-grid bg-grid-fade opacity-70" />

      {/* Pastel blobs — reduced count on hero, static when motion is disabled */}
      <div
        className="blob motion-safe:animate-float-slow"
        style={{
          width: "46rem",
          height: "46rem",
          top: "-18rem",
          left: "-14rem",
          background:
            "radial-gradient(circle at 40% 40%, var(--color-blob-mint), transparent 68%)",
          opacity: 0.75 * intensity,
        }}
      />
      <div
        className="blob motion-safe:animate-float-slower"
        style={{
          width: "40rem",
          height: "40rem",
          top: "-12rem",
          right: "-12rem",
          background:
            "radial-gradient(circle at 50% 50%, var(--color-blob-sky), transparent 68%)",
          opacity: 0.7 * intensity,
        }}
      />
      <div
        className="blob motion-safe:animate-float-slow"
        style={{
          width: "34rem",
          height: "34rem",
          bottom: "-16rem",
          left: "22%",
          background:
            "radial-gradient(circle at 50% 50%, var(--color-blob-lilac), transparent 70%)",
          opacity: 0.6 * intensity,
          animationDelay: "-6s",
        }}
      />

      {/* Soft top sheen */}
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-white/70 to-transparent" />
    </div>
  );
}
