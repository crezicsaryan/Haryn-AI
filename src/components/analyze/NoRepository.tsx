"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

/** Shown when `/analyze` is opened without a `?url=` parameter. */
export function NoRepository() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="font-display text-xl font-bold text-ink">
        No repository specified
      </h1>
      <p className="mt-2 text-[14px] text-ink-2">
        Paste a public GitHub repository URL to start an analysis.
      </p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </Link>
    </div>
  );
}
