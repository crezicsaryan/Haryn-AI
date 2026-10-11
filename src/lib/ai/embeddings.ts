import { embedTexts } from "./provider";
import type { Chunk } from "./chunk";

/**
 * Optional semantic layer.
 *
 * Embeddings are computed once per analysed repository and cached alongside the
 * index. They are strictly additive: when no API key is present the retriever
 * falls back to BM25 + structural signals, which needs no network at all.
 */

/** Cost guard — embedding an entire large repo would be wasteful. */
const MAX_EMBEDDED_CHUNKS = 500;
/** Characters per chunk sent to the embedding model. */
const MAX_CHARS = 1600;
const BATCH = 64;

export interface EmbeddingIndex {
  vectors: Map<string, number[]>;
  dimensions: number;
  embedded: number;
}

/**
 * Embed a subset of chunks (the highest-ranked ones, since `chunks` arrives
 * pre-ordered by signal). Returns null when embeddings are unavailable.
 */
export async function buildEmbeddings(
  chunks: Chunk[]
): Promise<EmbeddingIndex | null> {
  if (!chunks.length) return null;

  const targets = chunks.slice(0, MAX_EMBEDDED_CHUNKS);
  const vectors = new Map<string, number[]>();
  let dimensions = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const inputs = batch.map((c) =>
      `${c.path}${c.symbol ? ` :: ${c.symbol}` : ""}\n${c.text.slice(0, MAX_CHARS)}`
    );

    const result = await embedTexts(inputs);
    if (!result) {
      // Provider unavailable mid-way — keep whatever we already have.
      break;
    }

    result.forEach((vec, j) => {
      if (!vec?.length) return;
      vectors.set(batch[j].id, vec);
      dimensions = vec.length;
    });
  }

  if (!vectors.size) return null;
  return { vectors, dimensions, embedded: vectors.size };
}

/** Embed a single query string. Returns null when unavailable. */
export async function embedQuery(query: string): Promise<number[] | null> {
  const res = await embedTexts([query]);
  return res?.[0] ?? null;
}
