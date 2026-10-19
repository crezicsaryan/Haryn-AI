import type { Report } from "../types";
import type { Retriever, Retrieved } from "./retrieve";
import { diagnose, diagnoseCategory, diagnoseRepo } from "./diagnose";
import {
  classifyIntent,
  factsAnswer,
  isFactsIntent,
  type Intent,
} from "./router";

/**
 * Answer generation.
 *
 * One path, deterministic: the question is routed to either a repository-wide
 * diagnosis or a targeted one, and every sentence in the result is either a
 * measurement from the report or a finding with a file and line behind it.
 *
 * There is deliberately no model here. An answer that cannot be traced back to
 * the analyzers is worse than no answer — it reads just as confidently and is
 * wrong in ways the reader cannot see. The depth comes from using more of the
 * evidence (findings, rule metadata, call graph, coverage) rather than from
 * asking something to sound insightful.
 */

export interface AnswerResult {
  answer: string;
  /** `path:line` references backing the answer. */
  sources: string[];
  engine: "retrieval" | "graph";
  /** How many pieces of evidence the answer was built from. */
  groundedIn: number;
  /** Which route the question took. */
  intent: Intent;
}

/** Intents answered by diagnosing the report rather than by searching code. */
function isDiagnosisIntent(intent: Intent): boolean {
  return intent === "findings" || intent === "security" || intent === "bugs";
}

/**
 * Answer a question about the repository.
 *
 * Three routes, chosen by what the question asks for:
 *   • `findings` / `security` / `bugs` — a diagnosis of the whole report (or of
 *     one category), ordered by severity with a repair per finding.
 *   • other facts intents (structure, stack, dependencies, database, testing,
 *     documentation) — a factual read of the analysis.
 *   • everything else — retrieve the code the question is about, then diagnose
 *     those files: what it does, what is wrong with it, how to fix it, and what
 *     else the change touches.
 */
export async function answerQuestion(args: {
  retriever: Retriever;
  report: Report;
  question: string;
}): Promise<AnswerResult> {
  const { retriever, report, question } = args;

  const intent = classifyIntent(question);

  if (isDiagnosisIntent(intent)) {
    const d =
      intent === "security"
        ? diagnoseCategory(report, "security")
        : intent === "bugs"
          ? diagnoseCategory(report, "bugs")
          : diagnoseRepo(report, question);
    return {
      answer: d.answer,
      sources: d.sources,
      engine: "retrieval",
      groundedIn: d.groundedIn,
      intent,
    };
  }

  if (isFactsIntent(intent)) {
    return {
      answer: factsAnswer(report, intent),
      sources: factsSources(report, intent),
      engine: "retrieval",
      groundedIn: 0,
      intent,
    };
  }

  const results = retrieveFor(retriever, question);

  if (!results.length) {
    // Nothing matched, so there is no code to diagnose. Offer the repository
    // view rather than a dead end — it is the useful answer to "I don't know
    // where this lives".
    const repo = diagnoseRepo(report, question);
    return {
      answer: [
        `I couldn't find code in ${report.repo.fullName} matching that question, so I can't point at the exact file.`,
        "",
        "That usually means the feature is absent, named differently, or outside the analysed file set. Here is what the analysis does know is wrong, which may be what you were looking for:",
        "",
        repo.answer,
      ].join("\n"),
      sources: repo.sources,
      engine: "retrieval",
      groundedIn: repo.groundedIn,
      intent,
    };
  }

  const d = diagnose({ report, question, retriever, results });
  return {
    answer: d.answer,
    sources: d.sources,
    engine: "retrieval",
    groundedIn: d.groundedIn,
    intent,
  };
}

/**
 * Retrieval detail for the UI, without building an answer.
 *
 * Kept separate so the chat API can show what was matched (file, line, score,
 * reasons) alongside the answer.
 */
export function retrieveFor(
  retriever: Retriever,
  question: string,
  queryVector?: number[] | null
): Retrieved[] {
  return retriever.search(question, {
    limit: 8,
    perFile: 3,
    queryVector: queryVector ?? undefined,
  });
}

/** Files behind a facts answer, so the UI can still cite something. */
function factsSources(report: Report, intent: Intent): string[] {
  const pick = (cats: Report["findings"][number]["category"][]) =>
    report.findings
      .filter((f) => cats.includes(f.category) && f.filePath)
      .slice(0, 6)
      .map((f) => `${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}`);

  switch (intent) {
    case "security":
      return pick(["security"]);
    case "bugs":
      return pick(["bugs"]);
    case "testing":
      return pick(["testing"]);
    case "dependencies":
      return report.dependencies.manifests.slice(0, 6);
    case "database":
      return [
        ...report.dependencies.manifests,
        ...report.findings
          .filter(
            (f) =>
              f.filePath &&
              /model|schema|migrat|db|database|repository|dao|entity|store/i.test(f.filePath)
          )
          .map((f) => f.filePath as string),
      ].slice(0, 6);
    case "documentation":
      return pick(["documentation"]);
    case "findings":
      return report.recommendations
        .map((r) => r.filePath)
        .filter((p): p is string => Boolean(p))
        .slice(0, 6);
    default:
      return [];
  }
}
