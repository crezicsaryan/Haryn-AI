import { NextResponse } from "next/server";
import { providerStatuses, providerSummary } from "@/lib/ai/multiprovider";
import { embeddingsStatus } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which AI providers are configured, and which one would answer right now.
 *
 * The reader needs this to understand what they are looking at: a badge saying
 * "offline retrieval" without saying *why* is not actionable, and a provider that
 * silently dropped out of the chain is invisible without this endpoint.
 */
export async function GET() {
  const providers = providerStatuses();
  const emb = embeddingsStatus();

  return NextResponse.json(
    {
      summary: providerSummary(),
      anyConfigured: providers.some((p) => p.configured),
      anyReady: providers.some((p) => p.configured && !p.cooling),
      providers: providers.map((p) => ({
        id: p.id,
        label: p.label,
        configured: p.configured,
        model: p.model,
        baseUrl: p.baseUrl,
        freeTier: p.freeTier,
        consoleUrl: p.consoleUrl,
        cooling: p.cooling,
        order: p.order,
        primary: p.primary,
        selfHosted: p.selfHosted,
        // Whether the env var is present but still holds placeholder text —
        // "configured: false" alone does not tell the reader that a key is
        // sitting there unedited and will never authenticate.
        placeholderKey: p.placeholderKey,
      })),
      embeddings: {
        enabled: emb.enabled,
        model: emb.model,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
