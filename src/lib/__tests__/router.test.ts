import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, isFactsIntent } from "../ai/router";

/**
 * Intent routing decides whether a question is answered from the analysis
 * (exact) or from retrieved code (approximate). Miscategorising sends a question
 * down the weaker path, which is how "What database do they use?" came to be
 * answered with a comment from index.css instead of the dependency manifest.
 */

test("questions about the data layer route to the database intent, not code", () => {
  for (const q of [
    "What database do they use?",
    "Which ORM is used?",
    "Where is the schema defined?",
    "Explain the migrations",
    "Is there a Mongo or Postgres setup?",
    "How is persistence handled?",
    "What models exist?",
  ]) {
    assert.equal(classifyIntent(q), "database", `wrong intent for: ${q}`);
  }
});

test("structural questions route to structure, not stack", () => {
  for (const q of [
    "Explain how the project is structured",
    "How is the code organised?",
    "What is the folder layout?",
    "How big is the repository?",
    "Is this a monorepo?",
  ]) {
    assert.equal(classifyIntent(q), "structure", `wrong intent for: ${q}`);
  }
});

test("technology questions route to stack", () => {
  for (const q of [
    "What technology is this project using?",
    "What framework is this built with?",
    "Which languages does it use?",
  ]) {
    assert.equal(classifyIntent(q), "stack", `wrong intent for: ${q}`);
  }
});

test("security, testing and dependency questions keep their intents", () => {
  assert.equal(classifyIntent("What are the security risks?"), "security");
  assert.equal(classifyIntent("Are there security vulnerabilities?"), "security");
  assert.equal(classifyIntent("Is there any test coverage?"), "testing");
  assert.equal(classifyIntent("Are any packages outdated?"), "dependencies");
});

test("a prioritising word moves a topic question to the action list", () => {
  // "the biggest risks" is asking what to do first, so the ranked
  // recommendation list is the better answer than the raw security dump.
  assert.equal(classifyIntent("What are the biggest security risks?"), "findings");
  assert.equal(classifyIntent("What should I fix first?"), "findings");
});

test("improvement questions take priority over topic words", () => {
  // "Which security files should I improve first" is an action question; the
  // prioritised recommendation list is the right answer, not a code search.
  assert.equal(classifyIntent("Which files should I improve first?"), "findings");
});

test("activity questions route to activity", () => {
  assert.equal(classifyIntent("How many commits last month?"), "activity");
  assert.equal(classifyIntent("Who are the contributors?"), "activity");
});

test("a genuine code question still routes to code", () => {
  for (const q of [
    "How does the login function work?",
    "What does the processPayment helper do?",
    "Trace the request through handleSubmit",
  ]) {
    assert.equal(classifyIntent(q), "code", `wrong intent for: ${q}`);
  }
});

test("every facts intent is treated as answerable from the report", () => {
  for (const q of [
    "What database do they use?",
    "How is the project structured?",
    "What are the security risks?",
    "Are tests present?",
    "What commits happened?",
    "Is the README good?",
    "Which dependencies are outdated?",
    "What stack is used?",
  ]) {
    assert.ok(isFactsIntent(classifyIntent(q)), `should be a facts intent: ${q}`);
  }
});
