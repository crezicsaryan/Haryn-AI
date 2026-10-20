import { test } from "node:test";
import assert from "node:assert/strict";
import type { Finding } from "../types";
import { fixFor, ruleIdOf, verifyFor } from "../ai/repair";

/**
 * Repair guidance is the part of a diagnosis a reader acts on, so these tests
 * pin the three sources it draws from, in priority order: the rule guide, the
 * title guide, then the analyzer's own recommendation.
 */

let seq = 0;
function finding(over: Partial<Finding> & { title: string }): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    category: "bugs",
    severity: "high",
    description: "Something is wrong.",
    recommendation: "Fix it.",
    confidence: 0.8,
    source: "static-analysis",
    ...over,
  };
}

test("a known rule gets a concrete fix and a way to verify it", () => {
  const f = finding({
    title: "Loop bound runs one past the end",
    description: "Off by one.\n\n_Rule: off-by-one-loop-bound_",
  });
  assert.equal(ruleIdOf(f), "off-by-one-loop-bound");
  assert.match(fixFor(f)!, /<=` to `<`/);
  assert.match(verifyFor(f), /empty collection/);
});

test("a quality finding is matched by title, since it carries no rule id", () => {
  const f = finding({ title: "Complex function", category: "quality" });
  assert.equal(ruleIdOf(f), null);
  assert.match(fixFor(f)!, /Extract each branch into a named function/);
  assert.match(verifyFor(f), /hardest to reach/);
});

test("an unknown finding falls back to the analyzer's own recommendation", () => {
  const f = finding({ title: "Something new", recommendation: "Do the specific thing." });
  assert.equal(fixFor(f), "Do the specific thing.");
  assert.match(verifyFor(f), /Reproduce the path in a test/);
});

test("a finding with no recommendation yields no fix rather than a guess", () => {
  // An empty "Fix:" line would read as though there were nothing to do.
  const f = finding({ title: "Something new", recommendation: "" });
  assert.equal(fixFor(f), null);
});

test("verification advice is never empty", () => {
  for (const category of ["bugs", "security", "quality", "performance"] as const) {
    const f = finding({ title: "Unmapped", category });
    assert.ok(verifyFor(f).length > 10, category);
  }
});
