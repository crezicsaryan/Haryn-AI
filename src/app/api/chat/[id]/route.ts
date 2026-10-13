import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessages,
  getIndex,
  getReport,
  saveChatMessage,
} from "@/lib/store";
import { answerQuestion, embedQuery, retrieveFor } from "@/lib/ai";
import { answerFromGraph } from "@/lib/graph/query";
import { answerQuestion as keywordAnswer } from "@/lib/chat";
import { clientKey, RATE_LIMITS, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export interface ChatMatch {
  path: string;
  line: number;
  endLine: number;
  symbol: string | null;
  kind: string;
  score: number;
  reasons: string[];
}

/** `?history=1` returns the persisted transcript instead of answering. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const report = await getReport(id);
  if (!report) {
    return NextResponse.json(
      { error: { code: "ANALYSIS_FAILED", message: "Report not found." } },
      { status: 404 }
    );
  }
  const turns = await getChatMessages(id);
  return NextResponse.json({ turns }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const rl = rateLimit(clientKey(req, "chat"), RATE_LIMITS.chat, RATE_LIMITS.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many questions. Please slow down." } },
      { status: 429 }
    );
  }

  const report = await getReport(id);
  if (!report) {
    return NextResponse.json(
      { error: { code: "ANALYSIS_FAILED", message: "Report not found. Please run the analysis again." } },
      { status: 404 }
    );
  }

  let message = "";
  try {
    const body = (await req.json()) as { message?: string };
    message = String(body.message ?? "").slice(0, 1000);
  } catch {
    return NextResponse.json(
      { error: { code: "ANALYSIS_FAILED", message: "Invalid request body." } },
      { status: 400 }
    );
  }

  if (!message.trim()) {
    return NextResponse.json(
      { error: { code: "ANALYSIS_FAILED", message: "Please enter a question." } },
      { status: 400 }
    );
  }

  // Persist the question before answering so a failed answer still leaves a trail.
  await saveChatMessage(id, { role: "user", content: message });

  /* --- Knowledge-graph path -----------------------------------------
   * Questions about dependencies, impact, routes and tests are answered
   * exactly from the graph. This runs *before* retrieval and returns null for
   * anything else, so the existing RAG pipeline is untouched — the graph
   * extends it rather than replacing it.
   */
  try {
    const graphAnswer = await answerFromGraph(id, message);
    if (graphAnswer) {
      await saveChatMessage(id, {
        role: "assistant",
        content: graphAnswer.answer,
        engine: "graph",
        intent: graphAnswer.intent,
        sources: graphAnswer.sources,
      });

      return NextResponse.json(
        {
          answer: graphAnswer.answer,
          sources: graphAnswer.sources,
          engine: "graph" as const,
          intent: graphAnswer.intent,
          groundedIn: graphAnswer.sources.length,
          matches: [] as ChatMatch[],
          entities: graphAnswer.entities.slice(0, 12).map((e) => ({
            id: e.id,
            name: e.name,
            nodeType: e.nodeType,
            filePath: e.filePath,
            startLine: e.startLine,
          })),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch {
    /* A graph lookup must never block a normal answer. */
  }

  const index = await getIndex(id);

  /* --- Retrieval-augmented path ------------------------------------- */
  if (index) {
    // A semantic query vector is only attempted when embeddings were built.
    const queryVector = index.embeddings ? await embedQuery(message) : null;

    const result = await answerQuestion({
      retriever: index.retriever,
      report,
      question: message,
      queryVector,
    });

    // Only code questions have meaningful retrieved chunks to show.
    const matches =
      result.intent === "code"
        ? retrieveFor(index.retriever, message, queryVector)
        : [];

    await saveChatMessage(id, {
      role: "assistant",
      content: result.answer,
      engine: result.engine,
      intent: result.intent,
      sources: result.sources,
    });

    return NextResponse.json(
      {
        answer: result.answer,
        sources: result.sources,
        engine: result.engine,
        intent: result.intent,
        groundedIn: result.groundedIn,
        matches: matches.map<ChatMatch>((m) => ({
          path: m.chunk.path,
          line: m.chunk.startLine,
          endLine: m.chunk.endLine,
          symbol: m.chunk.symbol,
          kind: m.chunk.kind,
          score: Number(m.score.toFixed(3)),
          reasons: m.reasons,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  /* --- Fallback: report-only Q&A (e.g. the bundled sample) ----------- */
  const { answer, sources } = keywordAnswer(report, message);

  await saveChatMessage(id, {
    role: "assistant",
    content: answer,
    engine: "retrieval",
    intent: "findings",
    sources,
  });

  return NextResponse.json(
    {
      answer,
      sources,
      engine: "retrieval" as const,
      intent: "findings" as const,
      groundedIn: sources.length,
      matches: [] as ChatMatch[],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
