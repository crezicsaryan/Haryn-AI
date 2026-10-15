"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Aurora } from "@/components/ui/Aurora";
import { AnalyzeRunner } from "@/components/analyze/AnalyzeRunner";

/**
 * Streaming analysis screen.
 *
 * A thin shell: the backdrop, the suspense boundary and the runner. All progress
 * logic lives in `lib/analyze-progress` and the pieces in `components/analyze`.
 */
export default function AnalyzePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <Aurora variant="subtle" />
      <div className="relative">
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center">
              <Loader2 className="h-6 w-6 animate-spin-slow text-brand-500" />
            </div>
          }
        >
          <AnalyzeRunner />
        </Suspense>
      </div>
    </main>
  );
}
