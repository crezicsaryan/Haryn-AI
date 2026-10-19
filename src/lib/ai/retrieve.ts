import { Bm25Index } from "./bm25";
import { splitIdentifier, tokenize } from "./tokenize";
import type { Chunk } from "./chunk";

/**
 * Hybrid retriever.
 *
 * BM25 alone is a decent lexical baseline for code, but questions about a
 * codebase carry structural signal that term statistics miss: the name of a
 * symbol, the folder a file lives in, or a module it imports. Those are cheap,
 * high-precision signals, so they are scored explicitly on top of BM25 — and
 * optionally blended with embedding similarity when an API key is available.
 *
 * The result works with no configuration at all, and gets better with one.
 */

export interface Retrieved {
  chunk: Chunk;
  score: number;
  reasons: string[];
}

export interface SearchOptions {
  limit?: number;
  /** Max chunks returned per file, for diversity. */
  perFile?: number;
  /** Minimum score to be considered relevant. */
  minScore?: number;
  /** Pre-computed embedding for the query, enabling the semantic blend. */
  queryVector?: number[];
}

export interface Retriever {
  size: number;
  chunks: Chunk[];
  search(query: string, opts?: SearchOptions): Retrieved[];
  byPath(path: string): Chunk[];
  /** Chunks adjacent to the given one in the same file. */
  neighbours(chunk: Chunk, radius?: number): Chunk[];
  /** Files that are imported by / import the given chunk's file. */
  relatedFiles(path: string): string[];
}

export interface BuildOptions {
  /** chunkId → embedding vector. Optional. */
  embeddings?: Map<string, number[]>;
  /** How much weight embedding similarity carries (0–1). */
  embeddingWeight?: number;
}

const WEIGHTS = {
  bm25: 1,
  symbol: 0.95,
  path: 0.55,
  import: 0.28,
  phrase: 0.35,
  pathLiteral: 0.9,
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Tokens from a path: "src/services/payment.js" → [src, services, payment, js]. */
function pathTokens(path: string): string[] {
  return path
    .split("/")
    .flatMap((seg) => splitIdentifier(seg.replace(/\./g, " ")))
    .filter((t) => t.length > 1);
}

export function buildRetriever(chunks: Chunk[], opts: BuildOptions = {}): Retriever {
  const { embeddings, embeddingWeight = 0.45 } = opts;

  const byId = new Map(chunks.map((c) => [c.id, c]));

  /* --- Inverted index ------------------------------------------------- */
  const bm25 = new Bm25Index();
  for (const c of chunks) {
    // Index the symbol alongside the body so exact-name questions rank the
    // declaration itself highly.
    const indexed = c.symbol ? `${c.symbol} ${c.symbol} ${c.text}` : c.text;
    bm25.add(c.id, indexed);
  }
  bm25.finalize();

  /* --- Lookup tables for structural signals --------------------------- */
  const byPathMap = new Map<string, Chunk[]>();
  const pathTokenMap = new Map<string, Set<string>>();
  const importMap = new Map<string, Set<string>>();

  for (const c of chunks) {
    const list = byPathMap.get(c.path);
    if (list) list.push(c);
    else byPathMap.set(c.path, [c]);

    if (!pathTokenMap.has(c.path)) pathTokenMap.set(c.path, new Set(pathTokens(c.path)));
    if (!importMap.has(c.path)) {
      importMap.set(c.path, new Set(c.imports.flatMap((i) => pathTokens(i))));
    }
  }

  const symbolTokens = new Map<string, Set<string>>();
  for (const c of chunks) {
    if (!c.symbol) continue;
    if (!symbolTokens.has(c.id)) symbolTokens.set(c.id, new Set(splitIdentifier(c.symbol)));
  }

  function search(query: string, options: SearchOptions = {}): Retrieved[] {
    const { limit = 12, perFile = 3, minScore = 0.06 } = options;
    const q = query.trim();
    if (!q) return [];

    const qTerms = [...new Set(tokenize(q))];
    const qSet = new Set(qTerms);
    if (!qTerms.length) return [];

    /* 1 — BM25 candidates */
    const lexical = bm25.search(q, 120);
    const maxLexical = lexical[0]?.score ?? 0;

    /* 2 — Structural candidates BM25 may have missed */
    const candidateIds = new Set(lexical.map((s) => s.id));
    for (const c of chunks) {
      const sym = symbolTokens.get(c.id);
      if (sym && [...sym].some((t) => qSet.has(t))) candidateIds.add(c.id);
    }

    /*
     * 3 — A file path written in the question is a very strong signal.
     *
     * This used to be the whole lowercased question, so `chunk.path.includes()`
     * could never be true and the boost never fired: asking about
     * `src/lib/ai/diagnose.ts` returned `src/lib/chat.ts`, because generic
     * segments (`src`, `lib`) score as path matches for every sibling file.
     * The matched substring is the thing to look for, not the sentence.
     */
    const literalMatch = /[\w-]+\/[\w./-]+|[\w-]+\.(?:ts|tsx|js|jsx|py|go|java|rb|php|cs|rs|vue|svelte)\b/i.exec(
      q
    );
    const literalPath = literalMatch ? literalMatch[0].toLowerCase() : null;

    const lexicalMap = new Map(lexical.map((s) => [s.id, s.score]));

    /* 4 — Optional embedding similarity */
    const embedScores = new Map<string, number>();
    if (embeddings && embeddings.size && options.queryVector) {
      for (const c of chunks) {
        const v = embeddings.get(c.id);
        if (v) embedScores.set(c.id, cosine(options.queryVector, v));
      }
      // Strong semantic matches become candidates even without lexical overlap.
      const top = [...embedScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40);
      for (const [id] of top) candidateIds.add(id);
    }

    const results: Retrieved[] = [];

    for (const id of candidateIds) {
      const chunk = byId.get(id);
      if (!chunk) continue;

      const reasons: string[] = [];
      const raw = lexicalMap.get(id) ?? 0;
      const norm = maxLexical > 0 ? raw / maxLexical : 0;
      let score = norm * WEIGHTS.bm25;
      if (raw > 0) reasons.push("keyword match");

      /* Symbol match */
      const sym = symbolTokens.get(id);
      if (sym && sym.size) {
        const matched = [...sym].filter((t) => qSet.has(t)).length;
        if (matched) {
          const ratio = matched / sym.size;
          score += WEIGHTS.symbol * (0.5 + 0.5 * ratio);
          reasons.push(`symbol: ${chunk.symbol}`);
        }
      }

      /* Path match */
      const pt = pathTokenMap.get(chunk.path);
      if (pt) {
        const matched = [...pt].filter((t) => qSet.has(t)).length;
        if (matched) {
          score += WEIGHTS.path * Math.min(1, matched / 2);
          reasons.push(`path: ${chunk.path}`);
        }
      }

      /* Import match */
      const im = importMap.get(chunk.path);
      if (im) {
        const matched = [...im].filter((t) => qSet.has(t)).length;
        if (matched) score += WEIGHTS.import * Math.min(1, matched / 2);
      }

      /* Exact phrase */
      if (q.length > 6 && chunk.text.toLowerCase().includes(q.toLowerCase())) {
        score += WEIGHTS.phrase;
        reasons.push("exact phrase");
      }

      /* Literal file path in the question */
      if (literalPath && chunk.path.toLowerCase().includes(literalPath)) {
        score += WEIGHTS.pathLiteral;
        reasons.push("referenced file");
      }

      /* Embedding blend */
      const emb = embedScores.get(id);
      if (emb !== undefined) score += embeddingWeight * emb;

      if (score >= minScore) results.push({ chunk, score, reasons });
    }

    /* 5 — Rank, then enforce per-file diversity */
    results.sort((a, b) => b.score - a.score);

    const perFileCount = new Map<string, number>();
    const out: Retrieved[] = [];
    for (const r of results) {
      const n = perFileCount.get(r.chunk.path) ?? 0;
      if (n >= perFile) continue;
      perFileCount.set(r.chunk.path, n + 1);
      out.push(r);
      if (out.length >= limit) break;
    }

    return out;
  }

  function byPath(path: string): Chunk[] {
    return byPathMap.get(path) ?? [];
  }

  function neighbours(chunk: Chunk, radius = 1): Chunk[] {
    const siblings = (byPathMap.get(chunk.path) ?? []).slice().sort(
      (a, b) => a.startLine - b.startLine
    );
    const idx = siblings.findIndex((c) => c.id === chunk.id);
    if (idx === -1) return [];
    return siblings.slice(Math.max(0, idx - radius), idx + radius + 1);
  }

  function relatedFiles(path: string): string[] {
    const out = new Set<string>();
    const own = importMap.get(path);
    if (!own) return [];

    // Files whose path tokens overlap this file's imports.
    for (const [p, tokens] of importMap) {
      if (p === path) continue;
      const pt = pathTokenMap.get(p);
      if (!pt) continue;
      for (const t of own) {
        if (pt.has(t) && t.length > 3) {
          out.add(p);
          break;
        }
      }
      void tokens;
    }
    return [...out].slice(0, 10);
  }

  return { size: chunks.length, chunks, search, byPath, neighbours, relatedFiles };
}
