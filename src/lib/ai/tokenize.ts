/**
 * Code-aware tokenizer for the retrieval index.
 *
 * Prose tokenizers do badly on source code: identifiers are compound
 * (`processPayment`, `AUTH_MIDDLEWARE`, `user-repository`), and a question about
 * "payment processing" must match `processPayment`. So each identifier is emitted
 * twice — once whole, once split into its constituent words.
 */

const STOPWORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "onto",
  "and", "or", "not", "no", "but", "so", "than", "then", "if", "else",
  "this", "that", "these", "those", "it", "its", "as", "such",
  "i", "you", "we", "they", "he", "she", "my", "your", "our", "their",
  "do", "does", "did", "done", "can", "could", "should", "would", "will",
  "have", "has", "had", "may", "might", "must",
  "how", "what", "where", "which", "who", "when", "why", "whose",
  "all", "any", "some", "more", "most", "other", "another", "each", "every",
  "out", "up", "down", "over", "under", "again", "here", "there",
  "only", "own", "same", "too", "very", "just", "also", "about",
  "please", "tell", "explain", "show", "give", "want", "need",
  "work", "works", "working", "used", "use", "uses", "using",
  "make", "makes", "made", "get", "gets", "got",
  // Code noise
  "const", "let", "var", "function", "return", "new", "typeof", "instanceof",
  "true", "false", "null", "undefined", "void", "async", "await", "try", "catch",
  "throw", "finally", "class", "extends", "implements", "interface", "type",
  "public", "private", "protected", "static", "readonly", "abstract",
  "import", "export", "default", "from", "require", "module", "exports",
  "the", "def", "self", "none", "true", "false", "print", "lambda", "pass",
]);

/** Split a compound identifier into lowercase words. */
export function splitIdentifier(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
}

const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*|\d+/g;

/** Produce the searchable term stream for a piece of code or a question. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(text))) {
    const raw = m[0];

    if (/^\d+$/.test(raw)) {
      if (raw.length > 2) out.push(raw);
      continue;
    }

    const whole = raw.toLowerCase();
    if (whole.length > 2 && !STOPWORDS.has(whole)) out.push(whole);

    // Only expand identifiers that actually look compound.
    if (/[A-Z]/.test(raw) || raw.includes("_") || raw.includes("$")) {
      for (const part of splitIdentifier(raw)) {
        if (part.length > 1 && !STOPWORDS.has(part)) out.push(part);
      }
    }
  }

  return out;
}

/** Term frequencies for a document. */
export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}
