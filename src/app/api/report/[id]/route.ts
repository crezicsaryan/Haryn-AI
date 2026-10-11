import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Declared locally so the route typechecks under plain `tsc` (see Next 16 notes). */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const report = await getReport(id);

  if (!report) {
    return NextResponse.json(
      {
        error: {
          code: "ANALYSIS_FAILED",
          message: "That report could not be found. It may have been deleted.",
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
