import type { SourceFile } from "../analyzers/types";
import { chunkFiles, type Chunk } from "./chunk";
import { buildEmbeddings, type EmbeddingIndex } from "./embeddings";
import { buildRetriever, type Retriever } from "./retrieve";

/**
 * The retrieval index for one analysed repository.
 *
 * Built once during analysis and held beside the report (never inside it — the
 * report is serialised to the client, the index is not). This is the seam that
 * would become a vector database in a larger deployment; today it is an
 * in-process BM25 index with an optional embedding layer.
 */
export interface RepoIndex {
  retriever: Retriever;
  embeddings: EmbeddingIndex | null;
  chunkCount: number;
  fileCount: number;
  indexedBytes: number;
}

export interface BuildIndexOptions {
  /** Attempt to build the embedding layer (needs AI_API_KEY). */
  withEmbeddings?: boolean;
}

export async function buildIndex(
  files: SourceFile[],
  opts: BuildIndexOptions = {}
): Promise<RepoIndex> {
  const chunks: Chunk[] = chunkFiles(files);
  return indexFromChunks(chunks, opts);
}

/**
 * Build an index from chunks that were already extracted (and persisted).
 *
 * Used when restoring a report after a restart: the chunks come back from the
 * database and the BM25 index is rebuilt in memory, which takes milliseconds.
 * Storing the index itself would be storing derived data.
 */
export async function indexFromChunks(
  chunks: Chunk[],
  opts: BuildIndexOptions = {}
): Promise<RepoIndex> {
  let embeddings: EmbeddingIndex | null = null;
  if (opts.withEmbeddings) {
    // A failure here is expected when no key is set — the retriever still works.
    embeddings = await buildEmbeddings(chunks);
  }

  const retriever = buildRetriever(chunks, {
    embeddings: embeddings?.vectors,
    embeddingWeight: 0.45,
  });

  return {
    retriever,
    embeddings,
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
  const MAX_CHUNKS = 400;
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
export { generateAiSummary } from "./summary";
export { aiStatus, isAiConfigured, engineLabel } from "./provider";
export { embedQuery } from "./embeddings";
