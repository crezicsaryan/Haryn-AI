import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk } from "../ai/chunk";
import type { Retriever } from "../ai/retrieve";
import { persistableChunks, type RepoIndex } from "../ai/index";

/**
 * What survives a restart.
 *
 * Chat after a restart searches only the persisted chunks, so a cap that is too
 * tight silently narrows the assistant's view of the repository — the answers
 * still look normal, they are just drawn from part of the code.
 */

function chunk(i: number, bytes = 1200): Chunk {
  return {
    id: `c${i}`,
    path: `src/file${i}.ts`,
    language: "TypeScript",
    symbol: `fn${i}`,
    kind: "function",
    startLine: 1,
    endLine: 40,
    text: "x".repeat(bytes),
    imports: [],
    bytes,
  };
}

function index(chunks: Chunk[]): RepoIndex {
  return {
    retriever: { chunks } as unknown as Retriever,
    chunkCount: chunks.length,
    fileCount: new Set(chunks.map((c) => c.path)).size,
    indexedBytes: chunks.reduce((a, c) => a + c.bytes, 0),
  };
}

test("a mid-sized repository is persisted whole", () => {
  // 800 chunks is ordinary; at the old 400 cap half of it was dropped.
  const chunks = Array.from({ length: 800 }, (_, i) => chunk(i));
  const kept = persistableChunks(index(chunks));
  assert.equal(kept.length, 800);
});

test("the byte cap still bounds a large repository", () => {
  const chunks = Array.from({ length: 3000 }, (_, i) => chunk(i, 4000));
  const kept = persistableChunks(index(chunks));
  const bytes = kept.reduce((a, c) => a + c.bytes, 0);
  assert.ok(bytes <= 2 * 1024 * 1024, `kept ${bytes} bytes`);
  assert.ok(kept.length > 0, "must keep something");
  assert.ok(kept.length < 3000, "must not keep everything");
});
