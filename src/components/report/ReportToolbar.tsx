"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Check,
  Download,
  FileJson,
  FileText,
  Link2,
  Printer,
  Plus,
} from "lucide-react";
import type { Report } from "@/lib/types";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * The report's top bar.
 *
 * It deliberately carries **no section navigation**. The view rail in
 * `ReportView` is the single navigation surface — it already lists every view
 * and is visible at every breakpoint. Rendering the same list here as well put
 * each section name on screen twice (the rail plus a top nav on `lg+`, and two
 * stacked horizontal strips on mobile), which crowded the bar and read as a
 * duplicated page.
 *
 * So this is branding + actions only: share, export, and start a new analysis.
 */
export function ReportToolbar({ report }: { report: Report }) {
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState(false);

  function shareLink() {
    const url = window.location.href;
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(done);
    } else {
      done();
    }
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function exportJson() {
    window.location.href = `/api/export/${report.id}?format=json`;
  }

  function exportMarkdown() {
    window.location.href = `/api/export/${report.id}?format=md`;
  }

  function exportPdf() {
    // The report page itself is a long scrolling document; printing it produced
    // whatever happened to be on screen. The print route is a purpose-built
    // three-page A4 report, and it opens its own print dialog.
    window.open(`/report/${report.id}/print?auto=1`, "_blank", "noopener");
  }

  return (
    <div
      data-print="hide"
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-300",
        scrolled ? "glass border-hair" : "border-transparent bg-canvas"
      )}
    >
      <div className="mx-auto flex max-w-[1560px] items-center gap-4 px-4 py-3 sm:px-6">
        <Logo size="sm" />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={shareLink}
            className={buttonClasses("secondary", "sm")}
            title="Copy a permanent link to this report"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-good" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className={buttonClasses("secondary", "sm")}
            title="Download a three-page PDF report"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">PDF</span>
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className={buttonClasses("secondary", "sm")}
            title="Download this report as Markdown"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">MD</span>
          </button>
          <button
            type="button"
            onClick={exportJson}
            className={buttonClasses("secondary", "sm")}
            title="Download the raw report as JSON"
          >
            <FileJson className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">JSON</span>
          </button>
          <Link href="/" className={buttonClasses("primary", "sm")}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* Small helper re-exported for the export menu in the header card. */
export function ExportHint() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
      <Download className="h-3.5 w-3.5" />
      3-page PDF · Markdown · JSON
    </span>
  );
}
