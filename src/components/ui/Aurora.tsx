import { cn } from "@/lib/utils";

/**
 * The signature Haryn backdrop: a near-white canvas, soft pastel gradient
 * blobs and a faint blueprint grid that fades out toward the edges.
 * Purely decorative — hidden from assistive tech.
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

      {/* Pastel blobs */}
      <div
        className="blob animate-float-slow"
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
        className="blob animate-float-slower"
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
        className="blob animate-float-slow"
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
      {variant === "hero" && (
        <>
          <div
            className="blob animate-float-slower"
            style={{
              width: "26rem",
              height: "26rem",
              top: "30%",
              right: "6%",
              background:
                "radial-gradient(circle at 50% 50%, var(--color-blob-blush), transparent 70%)",
              opacity: 0.5,
              animationDelay: "-12s",
            }}
          />
          <div
            className="blob animate-float-slow"
            style={{
              width: "22rem",
              height: "22rem",
              top: "8%",
              left: "38%",
              background:
                "radial-gradient(circle at 50% 50%, var(--color-blob-butter), transparent 72%)",
              opacity: 0.4,
              animationDelay: "-3s",
            }}
          />
        </>
      )}

      {/* Soft top sheen */}
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-white/70 to-transparent" />
    </div>
  );
}
