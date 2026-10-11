import { termFrequency, tokenize } from "./tokenize";

/**
 * A small BM25 implementation over an inverted index.
 *
 * Deliberately dependency-free and in-process: retrieval must work with zero
 * configuration and no API key, and a repository index is small enough
 * (thousands of chunks) that this is far cheaper than a vector database.
 *
 * BM25 params are the standard k1=1.2, b=0.75.
 */

const K1 = 1.2;
const B = 0.75;

interface Doc {
  id: string;
  tf: Map<string, number>;
  length: number;
}

interface Posting {
  doc: number;
  tf: number;
}

export interface Scored {
  id: string;
  score: number;
}

export class Bm25Index {
  private docs: Doc[] = [];
  private postings = new Map<string, Posting[]>();
  /** 3–4 char key → index terms sharing it. Gives cheap morphological recall. */
  private keyMap = new Map<string, string[]>();
  private avgdl = 0;

  /** Weight applied to fuzzy (same-stem) matches vs an exact term hit. */
  private static readonly FUZZY = 0.35;
  /**
   * Applied to documents that matched *only* via a stem, never an exact term.
   * Without this, a short config file that happens to contain "config" outranks
   * the file that actually contains the rare term the user asked about.
   */
  private static readonly STEM_ONLY = 0.55;

  private static keys(term: string): string[] {
    const out: string[] = [];
    if (term.length >= 4) out.push(term.slice(0, 4));
    if (term.length >= 3) out.push(term.slice(0, 3));
    return out;
  }

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = termFrequency(tokens);
    const idx = this.docs.length;
    this.docs.push({ id, tf, length: tokens.length });

    for (const [term, count] of tf) {
      const list = this.postings.get(term);
      if (list) list.push({ doc: idx, tf: count });
      else this.postings.set(term, [{ doc: idx, tf: count }]);

      for (const key of Bm25Index.keys(term)) {
        const bucket = this.keyMap.get(key);
        if (bucket) {
          if (!bucket.includes(term)) bucket.push(term);
        } else {
          this.keyMap.set(key, [term]);
        }
      }
    }
  }

  /**
   * Index terms that share a stem with the query term.
   *
   * Without this, a question about "authentication" never matches a file called
   * `auth.js`, and "configuration" misses `config/`. Code identifiers are
   * abbreviated constantly, so a 3–4 character stem key is a cheap, high-value
   * bridge — at reduced weight, so it adds recall without displacing exact hits.
   */
  private stemMatches(term: string): string[] {
    const out = new Set<string>();
    for (const key of Bm25Index.keys(term)) {
      for (const t of this.keyMap.get(key) ?? []) {
        if (t !== term) out.add(t);
      }
    }
    return [...out].slice(0, 24);
  }

  /** Must be called once after all documents are added. */
  finalize(): void {
    const total = this.docs.reduce((a, d) => a + d.length, 0);
    this.avgdl = this.docs.length ? total / this.docs.length : 1;
  }

  get size(): number {
    return this.docs.length;
  }

  /** Terms present in the index — used to detect "no results" early. */
  has(term: string): boolean {
    return this.postings.has(term);
  }

  search(query: string, limit = 40): Scored[] {
    const terms = tokenize(query);
    if (!terms.length || !this.docs.length) return [];

    const unique = [...new Set(terms)];
    const N = this.docs.length;
    const scores = new Map<number, number>();
    const exactHit = new Set<number>();

    const applyTerm = (term: string, weight: number, exact: boolean) => {
      const postings = this.postings.get(term);
      if (!postings) return;
      const df = postings.length;
      // BM25+ style idf — always positive, so rare terms cannot go negative.
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const p of postings) {
        const doc = this.docs[p.doc];
        const denom = p.tf + K1 * (1 - B + (B * doc.length) / this.avgdl);
        const contribution = idf * ((p.tf * (K1 + 1)) / denom) * weight;
        scores.set(p.doc, (scores.get(p.doc) ?? 0) + contribution);
        if (exact) exactHit.add(p.doc);
      }
    };

    for (const term of unique) {
      applyTerm(term, 1, true);
      // Add same-stem terms at reduced weight so exact matches still win.
      for (const stem of this.stemMatches(term)) {
        applyTerm(stem, Bm25Index.FUZZY, false);
      }
    }

    return [...scores.entries()]
      .map(([doc, score]) => ({
        id: this.docs[doc].id,
        score: exactHit.has(doc) ? score : score * Bm25Index.STEM_ONLY,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
