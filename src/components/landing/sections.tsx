import Link from "next/link";
import {
  ShieldCheck,
  Gauge,
  Zap,
  Network,
  Boxes,
  TestTube2,
  Bug,
  Wrench,
  ArrowRight,
  ScanSearch,
  Lightbulb,
  Target,
  GitBranch,
  Layers,
  ListChecks,
  CircleSlash,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { Section } from "@/components/ui/primitives";
import { Logo } from "@/components/ui/Logo";

/* ------------------------------------------------------------------ */
/* What we analyze                                                     */
/* ------------------------------------------------------------------ */

const ANALYZES = [
  {
    icon: ShieldCheck,
    title: "Security",
    body: "Hardcoded secrets, injection patterns, unsafe deserialisation, permissive CORS and vulnerable packages.",
    hex: "#e5484d",
  },
  {
    icon: Gauge,
    title: "Code quality",
    body: "Cyclomatic complexity, oversized functions and files, duplication, dead code and swallowed errors.",
    hex: "#14b8a6",
  },
  {
    icon: Zap,
    title: "Performance",
    body: "N+1 queries, blocking synchronous I/O, nested loops, unbounded queries and whole-library imports.",
    hex: "#06b6d4",
  },
  {
    icon: Network,
    title: "Architecture",
    body: "Layer detection and a relationship graph — frontend, routes, controllers, services, data and external APIs.",
    hex: "#0ea5e9",
  },
  {
    icon: Boxes,
    title: "Dependencies",
    body: "Outdated and vulnerable packages cross-checked against the OSV advisory database, plus unused entries.",
    hex: "#8b5cf6",
  },
  {
    icon: TestTube2,
    title: "Testing",
    body: "Test-to-source ratio, detected frameworks and business-critical modules with no matching tests.",
    hex: "#f5a524",
  },
];

const ALSO = [
  { icon: Bug, label: "Potential bugs" },
  { icon: Wrench, label: "Maintainability" },
  { icon: Layers, label: "Technical debt" },
];

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  { icon: GitBranch, k: "Paste", body: "Drop in any public GitHub repository URL." },
  { icon: ScanSearch, k: "Analyze", body: "The repository is fetched and scanned by static analyzers." },
  { icon: Layers, k: "Understand", body: "Languages, structure and architecture are mapped." },
  { icon: Target, k: "Diagnose", body: "Issues are scored, ranked and given file references." },
  { icon: Lightbulb, k: "Improve", body: "A prioritised action plan tells you what to fix first." },
];

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQ = [
  {
    q: "Do I need an account?",
    a: "No. Paste a public repository URL and the analysis starts immediately. There is no signup, no OAuth and no configuration.",
  },
  {
    q: "Are private repositories supported?",
    a: "Not in this version. Haryn AI works with public GitHub repositories only, and will tell you clearly if a repository is private or unreachable.",
  },
  {
    q: "Is my source code stored?",
    a: "No. Files are fetched into memory only for the duration of the analysis and are never persisted. Reports hold findings and metadata, not your source.",
  },
  {
    q: "How is the health score calculated?",
    a: "Deterministically, from the findings. Security 20%, quality 20%, architecture 15%, performance 15%, testing 15%, dependencies 10%, documentation 5%. AI explains the score — it never decides it.",
  },
  {
    q: "Can the AI invent problems that aren't real?",
    a: "Findings come from static analyzers, and heuristic signals are explicitly labelled as potential. The AI layer only restates measured facts and cites the files behind them.",
  },
  {
    q: "What happens if the AI is unavailable?",
    a: "You still get the full deterministic report — scores, findings, architecture and recommendations — with a note that the narrative is temporarily unavailable.",
  },
];

export function AnalyzeGrid() {
  return (
    <Section
      id="analyze"
      eyebrow="Coverage"
      title="Nine dimensions of a codebase, in one pass"
      description="Every finding is evidence-based, references the exact file and line where possible, and carries a severity and confidence level."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ANALYZES.map((f) => (
          <div
            key={f.title}
            className="group relative overflow-hidden rounded-xl border border-hair bg-surface p-5 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:border-hair-strong hover:shadow-md"
          >
            <div
              className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: `linear-gradient(90deg, transparent, ${f.hex}, transparent)` }}
            />
            <span
              className="grid h-10 w-10 place-items-center rounded-lg"
              style={{ background: `${f.hex}14`, color: f.hex }}
            >
              <f.icon className="h-[18px] w-[18px]" />
            </span>
            <h3 className="mt-4 font-display text-[16px] font-bold tracking-tight text-ink">
              {f.title}
            </h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{f.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed border-hair-strong bg-surface-2/50 px-5 py-4">
        <span className="text-[13px] font-medium text-ink-2">Also covered:</span>
        {ALSO.map((a) => (
          <span
            key={a.label}
            className="inline-flex items-center gap-1.5 rounded-pill border border-hair bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2"
          >
            <a.icon className="h-3.5 w-3.5 text-ink-3" />
            {a.label}
          </span>
        ))}
      </div>
    </Section>
  );
}

export function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="The loop"
      title="Paste. Analyze. Understand. Diagnose. Improve."
      description="From URL to an engineering action plan in minutes — no setup, no configuration, nothing to install."
    >
      <div className="relative grid gap-4 md:grid-cols-5">
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-[26px] hidden h-px md:block"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--color-hair-strong) 12%, var(--color-hair-strong) 88%, transparent)",
          }}
        />
        {STEPS.map((s, i) => (
          <div key={s.k} className="relative">
            <div className="mb-4 flex items-center gap-3 md:block">
              <span className="relative z-10 grid h-13 w-13 shrink-0 place-items-center rounded-full border border-hair bg-surface text-brand-600 shadow-sm md:h-[52px] md:w-[52px]">
                <s.icon className="h-5 w-5" />
              </span>
              <span className="font-mono text-[11px] font-semibold text-ink-3 md:mt-3 md:block">
                0{i + 1}
              </span>
            </div>
            <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
              {s.k}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Principle() {
  return (
    <Section id="principle">
      <div className="overflow-hidden rounded-xl border border-hair bg-surface shadow-sm">
        <div className="grid lg:grid-cols-2">
          <div className="border-b border-hair p-7 sm:p-9 lg:border-b-0 lg:border-r">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-600">
              Our principle
            </div>
            <h2 className="mt-3 font-display text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-[30px]">
              Deterministic analysis finds the facts.{" "}
              <span className="text-gradient">AI explains them.</span>
            </h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">
              Haryn AI is not a chatbot that guesses whether your code is good. Static
              analyzers measure the codebase, then a language model turns those
              measurements into something you can act on — always citing the files
              behind each claim.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Evidence-based", "File & line references", "Confidence levels", "No signup"].map(
                (t) => (
                  <span
                    key={t}
                    className="rounded-pill border border-hair bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink-2"
                  >
                    {t}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="grid gap-px bg-hair sm:grid-cols-2">
            <div className="bg-surface p-6">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                <ListChecks className="h-4 w-4 text-brand-500" />
                What we measure
              </div>
              <ul className="mt-3 space-y-2 text-[13px] text-ink-2">
                {[
                  "Secrets and unsafe patterns",
                  "Function and file complexity",
                  "Query-in-loop heuristics",
                  "Package advisories (OSV)",
                  "Test file coverage signals",
                  "Layer and import structure",
                ].map((x) => (
                  <li key={x} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-surface p-6">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                <CircleSlash className="h-4 w-4 text-crit" />
                What we never do
              </div>
              <ul className="mt-3 space-y-2 text-[13px] text-ink-2">
                {[
                  "Claim runtime speed we didn't measure",
                  "Report code coverage we didn't compute",
                  "Invent files or APIs",
                  "Store your source code",
                  "Run your repository's code",
                  "Ask for a GitHub password",
                ].map((x) => (
                  <li key={x} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-crit/60" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function Faq() {
  return (
    <Section
      id="faq"
      eyebrow="Questions"
      title="Everything you might be wondering"
      description="Short answers about privacy, scoring and what the AI is allowed to claim."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {FAQ.map((f) => (
          <details
            key={f.q}
            className="group rounded-xl border border-hair bg-surface px-5 py-4 shadow-xs transition-colors open:border-hair-strong hover:border-hair-strong"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-semibold text-ink marker:content-none">
              {f.q}
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-hair text-ink-3 transition-transform group-open:rotate-45">
                <span className="text-base leading-none">+</span>
              </span>
            </summary>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function CtaBand() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-hair bg-surface p-8 text-center shadow-sm sm:p-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 120% at 50% 0%, rgba(45,212,191,0.16), transparent 70%), radial-gradient(50% 100% at 80% 100%, rgba(222,216,248,0.24), transparent 70%)",
        }}
      />
      <div className="relative">
        <h2 className="mx-auto max-w-2xl font-display text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-[32px]">
          Understand any repository in minutes
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-2">
          No signup. No configuration. Paste a public GitHub repository and get an
          evidence-based engineering report.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href="/analyze" className={buttonClasses("primary", "lg")}>
            Analyze a repository
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/report/an_sample" className={buttonClasses("secondary", "lg")}>
            View a sample report
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hair">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col justify-between gap-8 sm:flex-row">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              An AI-powered codebase intelligence platform. Paste a public GitHub
              repository, get an evidence-based engineering health report.
            </p>
            <p className="mt-3 font-serif text-[15px] italic text-ink-3">
              Understand. Diagnose. Improve Code.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <div className="mb-2 font-semibold text-ink">Product</div>
              <a href="#analyze" className="block py-1 text-ink-2 hover:text-ink">Coverage</a>
              <a href="#how" className="block py-1 text-ink-2 hover:text-ink">How it works</a>
              <a href="#principle" className="block py-1 text-ink-2 hover:text-ink">Approach</a>
            </div>
            <div>
              <div className="mb-2 font-semibold text-ink">Resources</div>
              <a href="#faq" className="block py-1 text-ink-2 hover:text-ink">FAQ</a>
              <Link href="/analyze" className="block py-1 text-ink-2 hover:text-ink">New analysis</Link>
            </div>
            <div>
              <div className="mb-2 font-semibold text-ink">Status</div>
              <span className="block py-1 text-ink-2">V1 MVP</span>
              <span className="block py-1 text-ink-2">Public repos only</span>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-hair pt-6 text-[12.5px] text-ink-3 sm:flex-row">
          <span>© {new Date().getFullYear()} Haryn AI. Analysis is advisory, not a security audit.</span>
          <span className="font-mono">Built for developers, by developers.</span>
        </div>
      </div>
    </footer>
  );
}
