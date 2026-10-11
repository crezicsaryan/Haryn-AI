import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/store";
import { reportToMarkdown } from "@/lib/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function slug(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const report = await getReport(id);
  if (!report) {
    return NextResponse.json(
      { error: { code: "ANALYSIS_FAILED", message: "Report not found." } },
      { status: 404 }
    );
  }

  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const name = `Haryn_AI_Report_${slug(report.repo.name)}`;

  if (format === "json") {
    const payload = {
      generator: "Haryn AI",
      version: "1.0",
      generatedAt: new Date().toISOString(),
      ...report,
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "md" || format === "markdown") {
    return new NextResponse(reportToMarkdown(report), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.md"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Everything else: hand back the structured report so the client can render
  // a print-optimised view and use the browser's "Save as PDF".
  return NextResponse.json(
    {
      format,
      note: "PDF export is produced client-side from the report view (print → save as PDF).",
      report,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
