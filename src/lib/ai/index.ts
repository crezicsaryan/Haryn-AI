import type { SourceFile } from "../analyzers/types";
import { chunkFiles, type Chunk } from "./chunk";
import { buildRetriever, type Retriever } from "./retrieve";

/**
 * The retrieval index for one analysed repository.
 *
 * Built once during analysis and held beside the report (never inside it — the
 * report is serialised to the client, the index is not). This is the seam that
 * would become a vector database in a larger deployment; today it is an
 * in-process BM25 index over lexical and structural signals.
 */
export interface RepoIndex {
  retriever: Retriever;
  chunkCount: number;
  fileCount: number;
  indexedBytes: number;
}

export async function buildIndex(files: SourceFile[]): Promise<RepoIndex> {
  return indexFromChunks(chunkFiles(files));
}

/**
 * Build an index from chunks that were already extracted (and persisted).
 *
 * Used when restoring a report after a restart: the chunks come back from the
 * database and the BM25 index is rebuilt in memory, which takes milliseconds.
 * Storing the index itself would be storing derived data.
 */
export async function indexFromChunks(chunks: Chunk[]): Promise<RepoIndex> {
  return {
    retriever: buildRetriever(chunks),
    chunkCount: chunks.length,
    fileCount: new Set(chunks.map((c) => c.path)).size,
    indexedBytes: chunks.reduce((a, c) => a + c.bytes, 0),
  };
}

/**
 * The chunk subset worth persisting.
 *
 * Full chunk text for a large repository is too heavy to store per report, so
 * the highest-signal chunks are kept — enough for chat to stay useful without
 * bloating the database.
 */
export function persistableChunks(index: RepoIndex): Chunk[] {
  /*
   * The byte cap is the real guard; the count is a secondary one.
   *
   * At 400 chunks a mid-sized repository kept less than half its index (827
   * chunks here), so after a restart the assistant could only search 48% of the
   * code — asking about a file late in the ordering returned an unrelated one.
   * The failure is silent: the answer looks like a normal answer. 1500 chunks is
   * enough for a typical repository, and 2 MB still bounds a large one.
   */
  const MAX_CHUNKS = 1500;
  const MAX_BYTES = 2 * 1024 * 1024;
  const out: Chunk[] = [];
  let bytes = 0;
  for (const c of index.retriever.chunks) {
    if (out.length >= MAX_CHUNKS || bytes + c.bytes > MAX_BYTES) break;
    bytes += c.bytes;
    out.push(c);
  }
  return out;
}

export type { Chunk, Retriever };
export { answerQuestion, retrieveFor } from "./answer";
export { diagnose, type Diagnosis } from "./diagnose";
