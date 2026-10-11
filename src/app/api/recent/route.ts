import { NextResponse } from "next/server";
import { listRecent } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recent analyses, used by the landing page.
 *
 * Served over an API route rather than rendered server-side so the landing page
 * stays statically prerendered and a database hiccup cannot break the hero.
 */
export async function GET() {
  try {
    const items = await listRecent(9);
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // An empty history is not an error worth surfacing to a visitor.
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
