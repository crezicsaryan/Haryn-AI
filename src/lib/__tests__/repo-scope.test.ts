import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRepoScope, findRepoRefs, scopeRefusal } from "../ai/repo-scope";
import type { RepoMeta } from "../types";

const repo = {
  owner: "crezicsaryan",
  name: "gym-saathi",
  fullName: "crezicsaryan/gym-saathi",
  url: "https://github.com/crezicsaryan/gym-saathi",
} as RepoMeta;

const react = {
  owner: "facebook",
  name: "react",
  fullName: "facebook/react",
  url: "https://github.com/facebook/react",
} as RepoMeta;

/* ------------------------------------------------------------------ */
/* Must FIRE — a different repository is named                         */
/* ------------------------------------------------------------------ */

test("full github URL to another repo is out of scope", () => {
  const v = checkRepoScope(repo, "Analyze https://github.com/facebook/react and tell me about hooks");
  assert.equal(v.outOfScope, true);
  assert.ok(v.otherRepos.includes("facebook/react"));
});

test("github URL without protocol is out of scope", () => {
  const v = checkRepoScope(repo, "what does github.com/vercel/next.js do");
  assert.equal(v.outOfScope, true);
  assert.ok(v.otherRepos.includes("vercel/next.js"));
});

test("owner/name slug is out of scope", () => {
  const v = checkRepoScope(repo, "review the facebook/react repository structure");
  assert.equal(v.outOfScope, true);
  assert.ok(v.otherRepos.includes("facebook/react"));
});

test("trailing .git is stripped when comparing", () => {
  const v = checkRepoScope(repo, "clone https://github.com/facebook/react.git please");
  assert.equal(v.outOfScope, true);
  assert.ok(v.otherRepos.includes("facebook/react"));
});

test("the loaded repo given as its own URL is NOT out of scope", () => {
  const v = checkRepoScope(repo, "tell me about https://github.com/crezicsaryan/gym-saathi");
  assert.equal(v.outOfScope, false);
  assert.deepEqual(v.otherRepos, []);
});

test("the loaded repo given as an owner/name slug is NOT out of scope", () => {
  const v = checkRepoScope(repo, "what is crezicsaryan/gym-saathi about");
  assert.equal(v.outOfScope, false);
});

test("a bare name of another repo, with repo intent, is out of scope", () => {
  const v = checkRepoScope(repo, "analyse the Django repository for me");
  assert.equal(v.outOfScope, true);
  assert.ok(v.otherRepos.includes("django"));
});

test("multiple foreign repos are all reported", () => {
  const v = checkRepoScope(repo, "compare github.com/facebook/react with github.com/vuejs/core");
  assert.equal(v.outOfScope, true);
  assert.equal(v.otherRepos.length, 2);
});

/* ------------------------------------------------------------------ */
/* Must NOT fire — these are questions about the LOADED repo           */
/* ------------------------------------------------------------------ */

test("a file path is not a repository", () => {
  const v = checkRepoScope(repo, "what does src/api/orders.js do?");
  assert.equal(v.outOfScope, false);
});

test("a nested file path is not a repository", () => {
  const v = checkRepoScope(repo, "explain frontend/src/utils/firebase.js");
  assert.equal(v.outOfScope, false);
});

test("a known source directory prefix is not a repository", () => {
  const v = checkRepoScope(repo, "how is app/routes organised");
  assert.equal(v.outOfScope, false);
});

test("a filename with an extension is not a repository", () => {
  const v = checkRepoScope(repo, "where is next.config.ts");
  assert.equal(v.outOfScope, false);
});

test("path-like pairs inside a question are not repositories", () => {
  const v = checkRepoScope(repo, "in backend/middleware/auth.js which guard runs");
  assert.equal(v.outOfScope, false);
});

test("a bare word without repo intent is not a repository", () => {
  const v = checkRepoScope(repo, "how does react to user input work here");
  assert.equal(v.outOfScope, false);
});

test("the loaded repo's own bare name is not out of scope", () => {
  const v = checkRepoScope(repo, "what is gym-saathi about");
  assert.equal(v.outOfScope, false);
});

test("a word that is part of the loaded repo's name is not out of scope", () => {
  const v = checkRepoScope(repo, "how does the saathi flow work");
  assert.equal(v.outOfScope, false);
});

test("plain questions with no repo reference are in scope", () => {
  for (const q of [
    "How does authentication work?",
    "What are the biggest security risks?",
    "Which files should I improve first?",
    "What technology is this project using?",
    "How is the project structured?",
    "Where is the database connection handled?",
  ]) {
    assert.equal(checkRepoScope(repo, q).outOfScope, false, `should be in scope: ${q}`);
  }
});

test("generic uses of 'project'/'repo' do not name a repository", () => {
  for (const q of [
    "How is the project structured?",
    "What does this project do?",
    "Is the project well tested?",
    "Summarise the repository for me",
    "What is this codebase about?",
    "How big is this repo?",
  ]) {
    assert.equal(checkRepoScope(repo, q).outOfScope, false, `should be in scope: ${q}`);
  }
});

test("bare name in an explicit repo frame IS out of scope", () => {
  for (const q of [
    "analyse the django repository",
    "review the express repo please",
    "compare with the vue codebase",
    "check a repository called laravel",
  ]) {
    assert.equal(checkRepoScope(repo, q).outOfScope, true, `should be out of scope: ${q}`);
  }
});

test("the loaded repo's URL does not leak its host words as repo names", () => {
  const v = checkRepoScope(repo, "see https://github.com/crezicsaryan/gym-saathi for details");
  assert.equal(v.outOfScope, false);
  assert.deepEqual(v.otherRepos, []);
});

/* ------------------------------------------------------------------ */
/* Reference extraction                                                */
/* ------------------------------------------------------------------ */

test("findRepoRefs prefers url over bare for the same repo", () => {
  const refs = findRepoRefs("see https://github.com/facebook/react (react)");
  const react = refs.find((r) => r.name === "react");
  assert.ok(react);
  assert.equal(react!.source, "url");
  assert.equal(react!.fullName, "facebook/react");
});

test("findRepoRefs returns nothing for a path-only question", () => {
  const refs = findRepoRefs("what does src/lib/store.ts export");
  assert.deepEqual(refs, []);
});

/* ------------------------------------------------------------------ */
/* Refusal wording                                                     */
/* ------------------------------------------------------------------ */

test("refusal names the loaded repo and the foreign one, and never fabricates", () => {
  const text = scopeRefusal(react, ["facebook/react"]);
  assert.match(text, /facebook\/react/);
  assert.match(text, /only answer about/);
  assert.match(text, /won't guess/);
});

test("refusal for the wrong-repo-while-viewing case names both sides", () => {
  const text = scopeRefusal(repo, ["facebook/react"]);
  assert.match(text, /crezicsaryan\/gym-saathi/);
  assert.match(text, /facebook\/react/);
});
