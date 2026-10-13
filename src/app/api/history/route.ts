import { NextRequest, NextResponse } from "next/server";
import { listRepoHistory } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Repositories the user has analysed before, for the URL field's history picker
 * and the landing page's history section.
 *
 * Grouped by repository rather than by run. A repository that has been analysed
 * seven times would otherwise fill the whole list with the same name — which is
 * precisely what a history view must not do.
 *
 * Served over an API route rather than rendered server-side so the landing page
 * stays statically prerendered and a database hiccup cannot break the hero.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;

  // Bounded so a crafted request cannot ask for the entire table.
  // Note `params.get` returns null when absent, and `Number(null)` is 0 — not
  // NaN — so a missing limit would clamp to 1 and quietly hide the history.
  const rawLimit = params.get("limit");
  const parsedLimit = rawLimit === null ? Number.NaN : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(parsedLimit)))
    : 20;

  // `owner/name` at most is ~140 chars; anything longer is not a search term.
  const q = (params.get("q") ?? "").slice(0, 140);

  try {
    const items = await listRepoHistory(q, limit);
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    // History is a convenience, so a failure must not break the form — but it
    // must not be silent either. Swallowing it entirely once turned a broken
    // query into what looked like an empty history.
    console.error("[api/history] query failed:", err);
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
