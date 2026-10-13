import Link from "next/link";
import { Sparkles, ArrowDown, ArrowRight } from "lucide-react";
import { Aurora } from "@/components/ui/Aurora";
import { Nav } from "@/components/landing/Nav";
import { AnalyzeForm } from "@/components/landing/AnalyzeForm";
import { ReportPreview } from "@/components/landing/ReportPreview";
import { RecentAnalyses } from "@/components/landing/RecentAnalyses";
import {
  AnalyzeGrid,
  HowItWorks,
  Principle,
  Faq,
  CtaBand,
  Footer,
} from "@/components/landing/sections";

export default function Home() {
  return (
    <>
      <Nav />

      <main className="relative flex-1">
        {/* ============================= HERO ============================= */}
        <section className="relative overflow-hidden pb-20 pt-10 sm:pb-28 sm:pt-16">
          <Aurora variant="hero" />

          <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <div className="animate-rise inline-flex items-center gap-2 rounded-pill border border-hair-strong bg-surface/80 px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 shadow-xs backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                AI Codebase Doctor
                <span className="mx-1 h-3 w-px bg-hair-strong" />
                <span className="text-ink-3">V1 · No signup</span>
              </div>

              <h1 className="animate-rise mt-6 font-display text-[34px] font-extrabold leading-[1.06] tracking-[-0.03em] text-ink sm:text-[46px] lg:text-[56px]">
                Hi, I&rsquo;m Haryn&thinsp;—
                <br />
                Your <span className="text-gradient">AI Codebase Doctor</span>
              </h1>

              <p
                className="animate-rise mt-6 max-w-xl text-[15.5px] leading-relaxed text-ink-2 sm:text-[17px]"
                style={{ animationDelay: "0.06s" }}
              >
                Paste a public GitHub repository and I&rsquo;ll scan it for security,
                quality, performance, architecture and testing issues — then hand you an
                evidence-based engineering health report.
              </p>

              {/*
                `z-20` is load-bearing, not decoration. `.animate-rise` ends on a
                `translate3d`, which leaves a transform behind and makes every
                animated element its own stacking context — so the product
                preview below would paint over the history dropdown no matter how
                high its own z-index is. Raising this wrapper lifts the whole
                subtree above that sibling.
              */}
              <div
                className="animate-rise relative z-20 mt-9 flex w-full justify-center"
                style={{ animationDelay: "0.12s" }}
              >
                <AnalyzeForm />
              </div>

              <Link
                href="/report/an_sample"
                className="animate-rise mt-6 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-ink-2 underline decoration-hair-strong decoration-1 underline-offset-4 transition-colors hover:text-brand-600 hover:decoration-brand-400"
                style={{ animationDelay: "0.16s" }}
              >
                Or explore a sample report first
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Product preview */}
          <div
            className="animate-rise relative mx-auto mt-16 max-w-6xl px-4 sm:mt-20 sm:px-6"
            style={{ animationDelay: "0.2s" }}
          >
            <ReportPreview />
            <div className="mt-6 flex justify-center">
              <a
                href="#analyze"
                className="inline-flex cursor-pointer items-center gap-2 rounded-pill border border-hair-strong bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-2 shadow-xs transition-colors hover:text-ink"
              >
                See everything it checks
                <ArrowDown className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </section>

        {/* =========================== SECTIONS ========================== */}
        <div className="mx-auto max-w-6xl space-y-24 px-4 pb-8 sm:space-y-28 sm:px-6">
          <RecentAnalyses />
          <AnalyzeGrid />
          <HowItWorks />
          <Principle />
          <Faq />
          <CtaBand />
        </div>
      </main>

      <Footer />
    </>
  );
}
