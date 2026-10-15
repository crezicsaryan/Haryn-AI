import { test } from "node:test";
import assert from "node:assert/strict";

import { computeScores, densityDivisor, penaltyScore } from "../scoring";
import { SCORE_WEIGHTS } from "../constants";
import type { Category, Finding, Severity } from "../types";

let seq = 0;

function finding(
  category: Category,
  severity: Severity,
  confidence = 1
): Finding {
  return {
    id: `f${seq++}`,
    category,
    severity,
    title: "t",
    description: "d",
    recommendation: "r",
    confidence,
    source: "static-analysis",
  };
}

const scoreFor = (findings: Finding[], filesAnalyzed = 60) =>
  computeScores(findings, 100, filesAnalyzed);

test("the category weights sum to 1", () => {
  const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test("a clean codebase scores 100", () => {
  assert.equal(scoreFor([]).healthScore, 100);
});

test("every category is scored, not silently skipped", () => {
  // A category missing from `computeScores` would vanish from the report while
  // still carrying weight — this shipped as a bug once.
  const bundle = scoreFor([]);
  const scored = new Set(bundle.scores.map((s) => s.category));
  for (const category of Object.keys(SCORE_WEIGHTS) as Category[]) {
    assert.ok(scored.has(category), `${category} was not scored`);
  }
});

test("a finding lowers its own category and the overall score", () => {
  const bundle = scoreFor([finding("security", "high")]);
  const security = bundle.scores.find((s) => s.category === "security");
  assert.ok(security);
  assert.ok(security.score < 100);
  assert.equal(security.issueCount, 1);
  assert.ok(bundle.healthScore < 100);
  assert.equal(bundle.scores.find((s) => s.category === "quality")?.score, 100);
});

test("two criticals cost more than one", () => {
  const one = scoreFor([finding("security", "critical")]).healthScore;
  const two = scoreFor([
    finding("security", "critical"),
    finding("security", "critical"),
  ]).healthScore;
  assert.ok(one < 100, "a critical must cost something");
  assert.ok(two < one, "the second critical must cost more");
  assert.ok(two <= 95, `expected a material drop, got ${two}`);
});

test("aggregation is a weighted mean, so one category cannot dominate", () => {
  // Documents the design: the overall score is a weighted average across the
  // eight categories, not a minimum. Security carries the largest weight (0.18),
  // so even a critical there is diluted by the other seven categories being
  // clean. Anything else would need a different aggregation rule.
  const bundle = scoreFor([finding("security", "critical")]);
  const security = bundle.scores.find((s) => s.category === "security");
  assert.ok(security && security.score < 85, "the category itself drops hard");
  assert.ok(bundle.healthScore >= 90, "the overall score only dips");
});

test("critical findings are not normalised away by codebase size", () => {
  const small = scoreFor([finding("security", "critical")], 60);
  const large = scoreFor([finding("security", "critical")], 3000);
  assert.equal(small.healthScore, large.healthScore);
});

test("density normalisation stops a large repo scoring near zero for being large", () => {
  const findings = Array.from({ length: 40 }, () => finding("quality", "low"));
  const small = scoreFor(findings, 60);
  const large = scoreFor(findings, 3000);
  assert.ok(
    large.healthScore > small.healthScore,
    `large=${large.healthScore} should beat small=${small.healthScore}`
  );
});

test("repeated findings of one severity have diminishing returns", () => {
  const one = penaltyScore([finding("quality", "medium")]);
  const ten = penaltyScore(Array.from({ length: 10 }, () => finding("quality", "medium")));
  assert.ok(ten < one);
  // Ten medium findings must not cost ten times one.
  assert.ok(100 - ten < (100 - one) * 5);
});

test("confidence scales the penalty", () => {
  const sure = penaltyScore([finding("quality", "medium", 1)]);
  const unsure = penaltyScore([finding("quality", "medium", 0.4)]);
  assert.ok(unsure > sure, "a low-confidence finding should cost less");
});

test("scores stay inside 0..100", () => {
  const flood = Array.from({ length: 400 }, () => finding("security", "critical"));
  const bundle = scoreFor(flood);
  assert.ok(bundle.healthScore >= 0 && bundle.healthScore <= 100);
  for (const s of bundle.scores) assert.ok(s.score >= 0 && s.score <= 100);
});

test("densityDivisor is clamped and monotonic", () => {
  assert.equal(densityDivisor(0), 1);
  assert.equal(densityDivisor(60), 1);
  assert.ok(densityDivisor(240) > 1);
  assert.equal(densityDivisor(100_000), 5);
  assert.ok(densityDivisor(500) < densityDivisor(1000));
});
