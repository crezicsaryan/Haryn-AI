"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#analyze", label: "Analyzes" },
  { href: "#how", label: "How it works" },
  { href: "#principle", label: "Approach" },
  { href: "#faq", label: "FAQ" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled ? "py-2" : "py-4"
      )}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <nav
          className={cn(
            "flex items-center justify-between rounded-pill border px-4 py-2.5 transition-all duration-300 sm:px-5",
            scrolled
              ? "glass border-hair shadow-sm"
              : "border-transparent bg-transparent"
          )}
        >
          <Logo />

          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="cursor-pointer rounded-pill px-3.5 py-2 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/analyze"
              className={buttonClasses("primary", "sm", "hidden sm:inline-flex")}
            >
              Get started
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-pill border border-hair-strong bg-surface text-ink-2 md:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>

        {open && (
          <div className="glass mt-2 rounded-lg border border-hair p-2 shadow-md md:hidden">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/analyze"
              onClick={() => setOpen(false)}
              className={buttonClasses("primary", "sm", "mt-1 w-full")}
            >
              Get started
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
