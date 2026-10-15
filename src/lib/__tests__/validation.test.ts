import { test } from "node:test";
import assert from "node:assert/strict";

import { parseGitHubUrl } from "../validation";

/**
 * URL validation is the SSRF boundary, so both directions matter: every accepted
 * form must normalise to a canonical GitHub URL, and everything else must be
 * rejected rather than silently fetched.
 */

test("accepts the canonical forms and normalises them", () => {
  const expected = { owner: "vercel", name: "next.js", url: "https://github.com/vercel/next.js" };
  for (const input of [
    "https://github.com/vercel/next.js",
    "http://github.com/vercel/next.js",
    "github.com/vercel/next.js",
    "https://www.github.com/vercel/next.js",
    "https://github.com/vercel/next.js.git",
    "  https://github.com/vercel/next.js  ",
    "https://github.com/vercel/next.js/",
  ]) {
    const result = parseGitHubUrl(input);
    assert.ok(result.ok, `expected ${input} to be accepted`);
    if (result.ok) {
      assert.equal(result.repo.owner, expected.owner, input);
      assert.equal(result.repo.name, expected.name, input);
      assert.equal(result.repo.url, expected.url, input);
    }
  }
});

test("accepts a bare owner/name pair", () => {
  const result = parseGitHubUrl("crezicsaryan/Haryn-AI");
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.repo.url, "https://github.com/crezicsaryan/Haryn-AI");
});

test("keeps the ref from a /tree/ URL", () => {
  const result = parseGitHubUrl("https://github.com/vercel/next.js/tree/canary");
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.repo.ref, "canary");
});

test("rejects an empty or whitespace-only input", () => {
  for (const input of ["", "   "]) {
    const result = parseGitHubUrl(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_URL");
  }
});

test("rejects every non-GitHub host", () => {
  // The SSRF guard: an attacker-supplied host must never be fetched.
  for (const input of [
    "https://gitlab.com/vercel/next.js",
    "https://github.com.evil.com/vercel/next.js",
    "https://raw.githubusercontent.com/vercel/next.js/main/README.md",
    "https://127.0.0.1/vercel/next.js",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/vercel/next.js",
  ]) {
    const result = parseGitHubUrl(input);
    assert.equal(result.ok, false, `expected ${input} to be rejected`);
  }
});

test("rejects credentials embedded in the URL", () => {
  const result = parseGitHubUrl("https://user:pass@github.com/vercel/next.js");
  assert.equal(result.ok, false);
});

test("rejects a non-standard port", () => {
  const result = parseGitHubUrl("https://github.com:8443/vercel/next.js");
  assert.equal(result.ok, false);
});

test("rejects a URL with no repository segment", () => {
  for (const input of ["https://github.com/vercel", "https://github.com/"]) {
    assert.equal(parseGitHubUrl(input).ok, false, input);
  }
});
