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

export function ReportToolbar({
  report,
  sections,
  active,
  onSelect,
}: {
  report: Report;
  sections: { id: string; label: string }[];
  /** Controlled view id. When supplied, the nav switches views instead of scrolling. */
  active?: string;
  onSelect?: (id: string) => void;
}) {
  const [internalActive, setInternalActive] = useState(sections[0]?.id ?? "");
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState(false);

  const controlled = Boolean(onSelect);
  const current = controlled ? (active ?? "") : internalActive;

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

  // Scroll-spy only applies in the legacy single-column layout.
  useEffect(() => {
    if (controlled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setInternalActive(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: [0, 1] }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections, controlled]);

  function exportJson() {
    window.location.href = `/api/export/${report.id}?format=json`;
  }

  function exportMarkdown() {
    window.location.href = `/api/export/${report.id}?format=md`;
  }

  function exportPdf() {
    window.print();
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

        <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
          {sections.map((s) =>
            controlled ? (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect?.(s.id)}
                aria-current={current === s.id}
                className={cn(
                  "cursor-pointer rounded-pill px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  current === s.id
                    ? "bg-ink text-white"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                )}
              >
                {s.label}
              </button>
            ) : (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={cn(
                  "cursor-pointer rounded-pill px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  current === s.id
                    ? "bg-ink text-white"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                )}
              >
                {s.label}
              </a>
            )
          )}
        </nav>

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
            title="Print or save as PDF"
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

      {/* Mobile section scroller */}
      <div className="border-t border-hair lg:hidden">
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect?.(s.id)}
              className={cn(
                "shrink-0 cursor-pointer rounded-pill px-3 py-1 text-[12px] font-medium transition-colors",
                current === s.id ? "bg-ink text-white" : "bg-surface-2 text-ink-2"
              )}
            >
              {s.label}
            </button>
          ))}
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
      PDF via print · Markdown · JSON
    </span>
  );
}
