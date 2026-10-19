import { NextRequest, NextResponse } from "next/server";
import {
  getChatMessages,
  getIndex,
  getReport,
  saveChatMessage,
} from "@/lib/store";
import { answerQuestion, retrieveFor } from "@/lib/ai";
import { checkRepoScope, scopeRefusal } from "@/lib/ai/repo-scope";
import { classifyIntent, factsAnswer, isFactsIntent } from "@/lib/ai/router";
import { answerFromGraph } from "@/lib/graph/query";
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

  /* --- Scope guard ---------------------------------------------------
   * A report covers exactly one repository. If the reader asks about a
   * different one, every file this report can search belongs to the wrong
   * project — so retrieval would confidently answer the wrong question.
   * Refuse and name the loaded repository instead. This runs first, before
   * the graph path, so no downstream route can answer out of scope.
   */
  const scope = checkRepoScope(report.repo, message);
  if (scope.outOfScope) {
    const answer = scopeRefusal(report.repo, scope.otherRepos);
    await saveChatMessage(id, {
      role: "assistant",
      content: answer,
      engine: "retrieval",
      intent: "out-of-scope",
      sources: [],
    });
    return NextResponse.json(
      {
        answer,
        sources: [] as string[],
        engine: "retrieval" as const,
        intent: "out-of-scope" as const,
        groundedIn: 0,
        matches: [] as ChatMatch[],
        outOfScope: scope.otherRepos,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

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
    const result = await answerQuestion({
      retriever: index.retriever,
      report,
      question: message,
    });

    // Only code questions have meaningful retrieved chunks to show.
    const matches =
      result.intent === "code" ? retrieveFor(index.retriever, message) : [];

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

  /* --- Fallback: report-only Q&A (e.g. the bundled sample) -----------
   * No retrieval index means there is no source to ground a code answer in.
   * Only report-level facts can be answered, so the question is routed through
   * the deterministic facts answer rather than the old template engine, which
   * asserted behaviour it had never read.
   */
  const intent = classifyIntent(message);
  const answer =
    factsAnswer(report, isFactsIntent(intent) ? intent : "findings") ||
    `I can answer about the analysis of ${report.repo.fullName}, but this report has no source index, so I cannot cite specific code. Try asking about the findings, scores, structure or dependencies.`;

  await saveChatMessage(id, {
    role: "assistant",
    content: answer,
    engine: "retrieval",
    intent: isFactsIntent(intent) ? intent : "findings",
    sources: [],
  });

  return NextResponse.json(
    {
      answer,
      sources: [] as string[],
      engine: "retrieval" as const,
      intent: (isFactsIntent(intent) ? intent : "findings") as string,
      groundedIn: 0,
      matches: [] as ChatMatch[],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
