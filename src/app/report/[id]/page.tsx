import type { Metadata } from "next";
import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { getReport } from "@/lib/store";
import { ReportView } from "@/components/report/ReportView";
import { Aurora } from "@/components/ui/Aurora";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

type PageParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return { title: "Report not found — Haryn AI" };
  return {
    title: `${report.repo.fullName} — Health ${report.healthScore}/100 | Haryn AI`,
    description: report.summary.slice(0, 160),
  };
}

function Missing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <Aurora variant="subtle" />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
        <Logo />
        <span className="mt-8 grid h-14 w-14 place-items-center rounded-full border border-hair bg-surface text-ink-3 shadow-sm">
          <FileQuestion className="h-6 w-6" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-ink">
          This report isn&rsquo;t available
        </h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-2">
          No analysis exists with that id. Check the link, or run a fresh analysis
          from the home page.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/" className={buttonClasses("primary", "md")}>
            <ArrowLeft className="h-4 w-4" />
            Analyze a repository
          </Link>
          <Link href="/" className={buttonClasses("secondary", "md")}>
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function ReportPage({ params }: PageParams) {
  const { id } = await params;
  const report = await getReport(id);

  if (!report) return <Missing />;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Aurora variant="report" />
      <div className="relative">
        <ReportView report={report} />
      </div>
    </main>
  );
}
