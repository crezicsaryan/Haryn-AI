import { test } from "node:test";
import assert from "node:assert/strict";
import { isManifestPath } from "../analyzers/files";

/**
 * `isManifestPath` lets the answer layer distinguish "this match is source
 * code" from "this match is a declared dependency". Getting it wrong changes
 * which closing the offline answer uses, so the boundary is pinned here.
 */

test("recognises package manifests at the repo root", () => {
  for (const p of [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Pipfile",
    "go.mod",
    "Cargo.toml",
    "composer.json",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "setup.py",
    "setup.cfg",
  ]) {
    assert.equal(isManifestPath(p), true, `${p} should be a manifest`);
  }
});

test("recognises a manifest nested in a monorepo package", () => {
  assert.equal(isManifestPath("backend/package.json"), true);
  assert.equal(isManifestPath("packages/api/go.mod"), true);
  assert.equal(isManifestPath("apps/web/Cargo.toml"), true);
});

test("is case-insensitive about the file name", () => {
  assert.equal(isManifestPath("Package.JSON"), true);
  assert.equal(isManifestPath("BACKEND/Requirements.TXT"), true);
});

test("does not mistake source files for manifests", () => {
  for (const p of [
    "src/app.js",
    "src/package.ts",
    "src/config.json",
    "lib/requirements.js",
    "index.css",
    "README.md",
  ]) {
    assert.equal(isManifestPath(p), false, `${p} is not a manifest`);
  }
});

test("does not match a manifest name used as a directory", () => {
  // "package.json/index.ts" is not itself a manifest — the base name is the file.
  assert.equal(isManifestPath("package.json/index.ts"), false);
});
