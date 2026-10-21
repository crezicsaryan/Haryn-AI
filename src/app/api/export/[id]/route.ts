import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/store";
import { reportToMarkdown } from "@/lib/markdown";
import { renderReportPdf } from "@/lib/pdf-render";

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

  if (format === "pdf") {
    /*
     * A real download, not a print dialog. The previous implementation opened a
     * print view and called window.print(), so the PDF only existed if a popup
     * opened, the dialog appeared and the reader picked "Save as PDF" — three
     * pieces of browser UI between the click and the file. This returns the
     * bytes, the way `?format=md` already did.
     */
    try {
      const pdf = await renderReportPdf(report);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${name}.pdf"`,
          "Content-Length": String(pdf.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: {
            code: "ANALYSIS_FAILED",
            message: `Could not render the PDF: ${err instanceof Error ? err.message : "unknown error"}`,
          },
        },
        { status: 500 }
      );
    }
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
  // its own view. `format=pdf` is handled above.
  return NextResponse.json(
    { format, note: "Unknown format. Use pdf, md or json.", report },
    { headers: { "Cache-Control": "no-store" } }
  );
}
