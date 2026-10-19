/**
 * Report-level Q&A helpers.
 *
 * This module used to hold a hand-written answer engine: one template per topic
 * (`auth`, `database`, `payment`, `tech`, `architecture`, …), each of which
 * emitted prose asserting behaviour the template author had assumed rather than
 * seen. The authentication template is the clearest example — it stated that
 * "credentials are validated, a session or token is issued, and middleware
 * guards protected routes" for *any* repository whose file list contained the
 * word "auth", whether or not that was true.
 *
 * That is exactly the failure mode this project is built to avoid. Answers must
 * come from the analysed evidence, so the templates are gone. The routing now
 * lives in `ai/router.ts` (intent classification plus deterministic facts
 * answers) and `ai/comprehend.ts` (code reading), both of which derive every
 * statement from the report or the source.
 *
 * What remains here is the suggested-question list, which is a UI affordance
 * rather than an answer.
 */

import type { Report } from "./types";
import { diagnoseCategory, diagnoseRepo } from "./ai/diagnose";
import { classifyIntent, factsAnswer, isFactsIntent } from "./ai/router";

export interface ChatAnswer {
  answer: string;
  sources: string[];
}

/**
 * Answer a question from the report alone.
 *
 * Kept as a thin delegation so any remaining caller gets evidence-derived text
 * rather than a template. Questions that need source code are answered by the
 * retrieval path in `ai/answer.ts`, not here.
 */
export function answerQuestion(report: Report, question: string): ChatAnswer {
  const q = (question ?? "").trim();
  if (!q) return overview(report);

  const intent = classifyIntent(q);

  // Diagnosis questions get the same deep answer the retrieval path gives —
  // a report without a source index is still enough to say what is wrong,
  // where, why it breaks and how to repair it.
  if (intent === "findings" || intent === "security" || intent === "bugs") {
    const d =
      intent === "security"
        ? diagnoseCategory(report, "security")
        : intent === "bugs"
          ? diagnoseCategory(report, "bugs")
          : diagnoseRepo(report, q);
    return { answer: d.answer, sources: d.sources };
  }

  const answer = factsAnswer(report, isFactsIntent(intent) ? intent : "findings");
  if (answer.trim()) return { answer, sources: [] };

  return overview(report);
}

function overview(report: Report): ChatAnswer {
  return {
    answer: [
      `${report.repo.fullName} — health score ${report.healthScore}/100.`,
      report.summary,
    ].join("\n\n"),
    sources: [],
  };
}

export const SUGGESTED_QUESTIONS = [
  "What is wrong in this repository?",
  "Which files should I fix first?",
  "What are the biggest security risks?",
  "Show me the bugs and how to fix them",
  "How does authentication work?",
  "What database does this use?",
];
