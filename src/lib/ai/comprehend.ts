import type { Chunk } from "./chunk";
import type { Retrieved } from "./retrieve";
import { splitIdentifier, tokenize } from "./tokenize";

/**
 * Deterministic code comprehension.
 *
 * The offline path used to dump retrieved excerpts and stop. That is honest but
 * useless: the reader gets `frontend/src/utils/firebase.js:1` and a stray comment,
 * with no statement of what the code actually does. A dump is not an answer.
 *
 * This module reads the same retrieved chunks and *explains* them, using only
 * what the code literally says:
 *
 *  • **Roles** — what kind of thing each matched site is (route handler, guard,
 *    data access, component, config, test, entry point), inferred from its
 *    signature and body, not from its filename alone.
 *  • **Flow** — the calls a function makes, in order, so "how does X work"
 *    produces a sequence of steps rather than a list.
 *  • **Imports** — the external and internal modules the site depends on, which
 *    is often the real answer ("it uses jsonwebtoken and bcryptjs").
 *  • **Signals** — cheap, reliable facts: does it read env, query a database,
 *    validate input, catch errors, return a status code.
 *
 * Every sentence it produces is traceable to a `path:line`. It asserts nothing
 * the code does not show, and when the evidence is thin it says so rather than
 * padding. This is the offline floor: correct and specific, if less fluent than
 * a model's prose.
 */

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export type CodeRole =
  | "route"
  | "guard"
  | "data"
  | "component"
  | "state"
  | "config"
  | "test"
  | "entry"
  | "util"
  | "function"
  | "class"
  | "module";

interface RoleMeta {
  label: string;
  /** What this role means in a request or data flow. */
  describes: string;
}

export const ROLE_META: Record<CodeRole, RoleMeta> = {
  route: { label: "route handler", describes: "accepts an inbound request and produces a response" },
  guard: { label: "guard / middleware", describes: "intercepts a request before it reaches the handler" },
  data: { label: "data access", describes: "reads or writes persisted state" },
  component: { label: "UI component", describes: "renders part of the interface" },
  state: { label: "state container", describes: "holds and mutates shared state" },
  config: { label: "configuration", describes: "wires up clients, constants and environment" },
  test: { label: "test", describes: "exercises behaviour and asserts on it" },
  entry: { label: "entry point", describes: "starts the application or wires its dependencies" },
  util: { label: "helper", describes: "provides a reusable function" },
  function: { label: "function", describes: "performs one unit of work" },
  class: { label: "class", describes: "groups related behaviour and state" },
  module: { label: "module-level code", describes: "runs when the file is loaded" },
};

/**
 * Classify a chunk's role.
 *
 * Signature first, path second: a file called `auth.js` that exports a function
 * taking `(req, res, next)` is middleware regardless of its name, and a file in
 * `routes/` that only exports constants is not a route. Filenames are a hint,
 * not the answer.
 */
export function classifyRole(chunk: Chunk): CodeRole {
  const p = chunk.path.toLowerCase();
  const t = chunk.text;
  const name = (chunk.symbol ?? "").toLowerCase();

  // Tests are unambiguous — the path or the assertions give them away.
  if (
    /(^|\/)(__tests__|tests?|specs?|e2e|cypress)\//.test(p) ||
    /\.(test|spec)\.[a-z]+$/.test(p) ||
    /\b(describe|it|test)\s*\(/.test(t) && /\bexpect\s*\(/.test(t)
  ) {
    return "test";
  }

  // Express/Koa-style middleware: (req, res, next).
  if (/\bnext\b/.test(t) && /\breq\b/.test(t) && /\bres\b/.test(t)) return "guard";
  if (/\b(req|request)\s*[,)]/.test(t) && /\b(res|response)\s*[,)]/.test(t)) return "route";
  if (/\b(app|router|route)\.(get|post|put|patch|delete|use|all)\s*\(/i.test(t)) return "route";
  if (/\b(req|request)\s*\.\s*(body|params|query|headers)\b/.test(t)) return "route";

  // Data access. The ORM/namespace form (`prisma.user.findUnique`) and the
  // driver form (`pool.query`) are different shapes and both are common, so the
  // model verbs are checked with and without a leading namespace.
  if (ORM_METHOD_RE.test(t)) return "data";
  if (
    /\.(find|findOne|findById|findAll|aggregate|insertOne|updateOne|deleteOne|create|save|upsert|query|exec)\s*\(/.test(t) &&
    DATABASE_WORD_RE.test(t)
  ) {
    return "data";
  }
  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(t)) return "data";

  // Config: env reads and client construction at module scope.
  if (/\bprocess\.env\b/.test(t) || /\bos\.environ\b/.test(t)) {
    if (/^\s*(?:const|let|var|export const)\b/m.test(t)) return "config";
  }
  if (/\bcreateClient\s*\(|\binitializeApp\s*\(|\bnew\s+(?:Pool|Client|PrismaClient|Firestore|MongoClient)\b/.test(t)) {
    return "config";
  }

  // UI.
  if (/\.(tsx|jsx|vue|svelte)$/.test(p) || /<[A-Z][A-Za-z]*[\s/>]/.test(t)) {
    if (/\buse(State|Effect|Reducer|Context|Ref|Memo)\s*\(/.test(t)) return "state";
    return "component";
  }
  if (/\b(useState|useReducer|createContext|useStore|defineStore)\s*\(/.test(t)) return "state";

  // Entry points.
  if (
    /(^|\/)(main|index|server|app|bootstrap|start)\.[a-z]+$/.test(p) &&
    /\b(listen|createServer|bootstrap|createApp|main)\s*\(/.test(t)
  ) {
    return "entry";
  }

  if (chunk.kind === "class") return "class";

  // Helpers vs plain functions: a small, dependency-light body is a helper.
  if (chunk.kind === "function" || chunk.kind === "method") {
    if (name && /^(get|set|is|has|to|from|parse|format|build|make|create|convert|normalis|normaliz|validate|sanitiz)/.test(name)) {
      return "util";
    }
    return "function";
  }

  return "module";
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/**
 * ORM access in its namespaced form: `prisma.user.findUnique(...)`,
 * `db.collection(...).insertOne(...)`, `mongoose.model('X').find(...)`.
 *
 * The vocabulary is fixed and small, which makes this precise: matching
 * `prisma.<anything>.<modelVerb>(` cannot fire on unrelated code the way a loose
 * word search would.
 */
const ORM_METHOD_RE =
  /\b(?:prisma|db|database|mongoose|sequelize|typeorm|knex|pool|conn|connection|client|collection|model|repo|repository|dao|store|tx)\.[A-Za-z_$][\w$]*\s*\.\s*(?:find\w*|create\w*|update\w*|delete\w*|upsert|aggregate|count|save|insert\w*|query|exec|raw)\s*\(/i;

/** Words that indicate the subject really is persistence. */
const DATABASE_WORD_RE =
  /\b(db|database|collection|model|repo|repository|dao|prisma|knex|sequelize|typeorm|mongoose|pool|client|conn|connection|table|store)\b/i;

/** Call sites, in source order, excluding language builtins and noise. */
const IGNORED_CALLS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "await", "then",
  // Control-flow keywords that are followed by `(` and so look like calls.
  "async", "function", "else", "do", "case", "with", "delete", "void", "new",
  "in", "of", "yield", "super", "this", "throw", "instanceof",
  // Collection and string methods — ubiquitous, never the interesting step.
  "map", "filter", "reduce", "forEach", "some", "every", "find", "push", "pop",
  "slice", "splice", "join", "split", "trim", "replace", "toString", "concat",
  "includes", "indexOf", "keys", "values", "entries", "stringify", "parse",
  "shift", "unshift", "sort", "reverse", "flat", "fill", "at", "padStart",
  "padEnd", "toLowerCase", "toUpperCase", "startsWith", "endsWith", "match",
  "test", "exec", "substring", "substr", "charAt", "repeat",
  // Response/serialisation helpers: part of the return, not a delegation.
  "json", "send", "sendStatus", "end", "redirect", "render", "setHeader",
  "writeHead", "status", "cookie", "clearCookie", "attachment", "type",
  // Logging and globals.
  "log", "warn", "error", "debug", "info", "trace", "Number", "String",
  "Boolean", "Object", "Array", "JSON", "Math", "Date", "Promise", "Set", "Map",
  "console", "require", "import", "parseInt", "parseFloat", "isNaN", "alert",
  "encodeURIComponent", "decodeURIComponent", "setTimeout", "setInterval",
]);

/** Namespace prefixes whose calls are library plumbing, not app flow. */
const PLUMBING_NAMESPACES = new Set([
  "res", "req", "response", "request", "console", "process", "os", "fs",
  "path", "logger", "log", "window", "document", "this", "props", "state",
  "e", "ev", "event", "err", "error",
]);

/**
 * Call names in source order.
 *
 * Qualified calls keep their namespace — `bcrypt.compare(...)` yields
 * `bcrypt.compare`, not `compare`. The bare method name alone is meaningless in
 * a summary ("does what — compare?"), and the namespace is exactly the detail a
 * reader wants: which library is being used and for what.
 */
function callNames(text: string): string[] {
  const out: string[] = [];

  // Qualified first, so `bcrypt.compare` is captured before the bare `compare`.
  const qualified = new Set<string>();
  for (const m of text.matchAll(/\b([a-z_$][\w$]*)\.([a-z_$][\w$]*)\s*\(/g)) {
    const [ns, method] = [m[1], m[2]];
    if (IGNORED_CALLS.has(method)) continue;
    // `res.status(...).json(...)` is plumbing shared by every handler; listing it
    // as a step says nothing about what this unit does.
    if (PLUMBING_NAMESPACES.has(ns)) continue;
    qualified.add(`${ns}.${method}`);
  }

  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (IGNORED_CALLS.has(name)) continue;
    // Skip a bare method name when it is already covered by a qualified form.
    if ([...qualified].some((q) => q.endsWith(`.${name}`))) continue;
    if (!out.includes(name)) out.push(name);
  }

  return [...qualified, ...out];
}

/** Import specifiers, both ESM and CJS, plus Python `from x import y`. */
function importNames(text: string): string[] {
  const out: string[] = [];

  // ESM: `import x from 'pkg'` / `import 'pkg'` — capture only the specifier.
  for (const m of text.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
    out.push(m[1]);
  }
  // CJS: `require('pkg')`.
  for (const m of text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(m[1]);
  }
  /*
   * Python: `from pkg import x` / `import pkg.sub`.
   *
   * Only a *root* module name, and only when the line really is a Python import.
   * An earlier, looser pattern matched any `from <word>` — including the
   * `from 'jsonwebtoken'` half of an ESM import, which is how `jwt` (the local
   * binding) ended up reported as a package.
   */
  for (const m of text.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/gm)) {
    out.push(m[1]);
  }
  for (const m of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)\s*$/gm)) {
    out.push(m[1]);
  }

  return [...new Set(out)];
}

/**
 * Is this import specifier a third-party package?
 *
 * Only quoted specifiers reach here now, so relative paths, aliases and Node
 * builtins are the whole exclusion set. A specifier must also look like a
 * package name — lowercase, optionally scoped — because an uppercase root
 * (`User`) is a local module being imported by alias, not a dependency.
 */
function isExternalModule(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) return false;
  if (/^(node:)?(fs|path|http|https|os|url|util|crypto|stream|events|child_process|buffer|assert|zlib|net|tls|dns|querystring|readline|worker_threads|perf_hooks|timers|string_decoder|v8|vm|cluster|dgram|inspector|module|repl|tty)$/.test(spec)) {
    return false;
  }
  // A scoped package: @scope/name.
  if (spec.startsWith("@")) return /^@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/i.test(spec);
  // A bare package name: lowercase, may contain dots or dashes.
  if (!/^[a-z0-9][\w.-]*$/i.test(spec)) return false;
  // An uppercase initial marks a local alias (`User`, `Firebase`), not a package.
  if (/^[A-Z]/.test(spec)) return false;
  return true;
}

/** Plain-English meaning for the status codes that carry real information. */
const RESPONSE_MEANING: Record<number, string> = {
  200: "ok",
  201: "created",
  204: "no content",
  301: "moved",
  302: "redirect",
  400: "bad request",
  401: "unauthorised",
  403: "forbidden",
  404: "not found",
  409: "conflict",
  422: "unprocessable",
  429: "rate limited",
  500: "server error",
  502: "bad gateway",
  503: "unavailable",
};

interface Signals {
  env: string[];
  httpMethods: string[];
  dbHints: string[];
  throws: boolean;
  catches: boolean;
  async: boolean;
  statusCodes: number[];
  authWords: string[];
}

function extractSignals(text: string): Signals {
  const env = [...new Set([...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  const httpMethods = [
    ...new Set(
      [...text.matchAll(/\b(?:app|router|route)\.(get|post|put|patch|delete|all)\s*\(/gi)].map((m) =>
        m[1].toUpperCase()
      )
    ),
  ];
  const dbHints = [
    ...new Set(
      [...text.matchAll(/\b(prisma|mongoose|sequelize|typeorm|knex|pg|mysql2?|mysql|sqlite|mongodb|firestore|redis|dynamodb|supabase)\b/gi)].map(
        (m) => m[1].toLowerCase()
      )
    ),
  ];
  const statusCodes = [
    ...new Set(
      [...text.matchAll(/\.status\s*\(\s*(\d{3})\s*\)/g)].map((m) => Number(m[1]))
    ),
  ];
  const authWords = [
    ...new Set(
      [...text.matchAll(/\b(jwt|jsonwebtoken|bcrypt|bcryptjs|argon2|passport|oauth|session|bearer|token|cookie)\b/gi)].map(
        (m) => m[1].toLowerCase()
      )
    ),
  ];

  return {
    env,
    httpMethods,
    dbHints,
    throws: /\bthrow\s+new\b/.test(text),
    catches: /\bcatch\s*\(|\bcatch\s*\{/.test(text),
    async: /\basync\b|\bawait\b/.test(text),
    statusCodes,
    authWords,
  };
}

/**
 * The chunk's opening declaration.
 *
 * Import and export-from lines are skipped: they are the first non-comment lines
 * in many files but say nothing about what the unit does. The reader wants the
 * signature — `const protect = async (req, res, next) => {`.
 */
function signatureOf(chunk: Chunk): string | null {
  const lines = chunk.text.split("\n").map((l) => l.trim());
  const first = lines.find(
    (l) =>
      l &&
      !l.startsWith("//") &&
      !l.startsWith("#") &&
      !l.startsWith("*") &&
      !l.startsWith("/*") &&
      !/^import\b/.test(l) &&
      !/^export\s+(?:\*|\{)\s*.*\bfrom\b/.test(l) &&
      !/^(?:const|let|var)\s+\w+\s*=\s*require\s*\(/.test(l) &&
      !/^["']use (?:strict|client|server)["'];?$/.test(l)
  );
  return first ? first.slice(0, 160) : null;
}

/* ------------------------------------------------------------------ */
/* Relevance                                                           */
/* ------------------------------------------------------------------ */

/**
 * Score how well a chunk answers the question, so the explanation leads with the
 * most relevant site rather than whatever retrieval happened to return first.
 *
 * Term overlap uses the same tokenizer as retrieval (so `processPayment` matches
 * "payment"), with a heavy bonus when the matched term is the *symbol name* —
 * the function the reader is most likely asking about.
 */
export function relevance(chunk: Chunk, question: string): number {
  const terms = new Set(tokenize(question));
  if (!terms.size) return 0;

  let score = 0;
  const hay = chunk.text.toLowerCase();
  for (const t of terms) {
    if (t.length < 3) continue;
    if (hay.includes(t)) score += 1;
  }

  if (chunk.symbol) {
    const sym = splitIdentifier(chunk.symbol);
    for (const t of terms) {
      if (sym.includes(t)) score += 2.5;
    }
    if (chunk.symbol.toLowerCase().includes(question.toLowerCase())) score += 3;
  }

  const pathTerms = splitIdentifier(chunk.path);
  for (const t of terms) {
    if (pathTerms.includes(t)) score += 1.5;
  }

  // Prefer substantive bodies over one-line matches.
  if (chunk.text.split("\n").length > 12) score += 0.5;

  return score;
}

/* ------------------------------------------------------------------ */
/* Explanation                                                         */
/* ------------------------------------------------------------------ */

export interface ExplainedSite {
  chunk: Chunk;
  role: CodeRole;
  signals: Signals;
  calls: string[];
  imports: string[];
  externals: string[];
  relevance: number;
}

export function explainChunk(chunk: Chunk, question: string): ExplainedSite {
  const imports = importNames(chunk.text);
  return {
    chunk,
    role: classifyRole(chunk),
    signals: extractSignals(chunk.text),
    calls: callNames(chunk.text).slice(0, 12),
    imports,
    externals: imports.filter(isExternalModule).slice(0, 8),
    relevance: relevance(chunk, question),
  };
}

/**
 * Build the body of an offline answer.
 *
 * Structure, in order of what a reader wants:
 *   1. a direct summary of what the matched code does;
 *   2. the sequence of calls, when the question is about flow;
 *   3. the dependencies each site needs;
 *   4. notable signals (auth, env, database, error handling);
 *   5. honest coverage limits.
 */
/**
 * How the answer should close.
 *
 * The old text always said "add an LLM key", which is actively misleading when
 * a key *is* configured but every provider was rate-limited or returned an
 * error — the reader goes looking for a configuration problem that does not
 * exist. The caller says which situation applies.
 */
export type OfflineReason = "no-provider" | "provider-failed" | "external-only";

function closingFor(reason: OfflineReason): string {
  if (reason === "external-only") {
    return ". This is the offline answer drawn from the repository's own package manifest. Add an AI provider key for a written, reasoned explanation.";
  }
  return reason === "provider-failed"
    ? ". This is the offline answer: an AI provider is configured but did not respond (rate limit, quota or error), so the source was summarised directly."
    : ". Add an AI provider key for a written, reasoned explanation.";
}

export function comprehend(
  reportName: string,
  question: string,
  results: Retrieved[],
  offlineReason: OfflineReason = "no-provider"
): { answer: string; sources: string[] } {
  if (!results.length) {
    return {
      answer: [
        `I couldn't find anything in ${reportName} matching that question.`,
        "",
        "That usually means one of:",
        "• the feature does not exist in this repository,",
        "• it is named differently — try a symbol, file or folder name, or",
        "• the code sits outside the analysed file set.",
      ].join("\n"),
      sources: [],
    };
  }

  const sites = results.map((r) => explainChunk(r.chunk, question));
  sites.sort((a, b) => b.relevance - a.relevance);

  const lead = sites[0];
  const files = [...new Set(sites.map((s) => s.chunk.path))];
  const closing = closingFor(offlineReason);
  const lines: string[] = [];

  /* --- 1. What the matched code is ---------------------------------- */
  const roleWord = ROLE_META[lead.role].label;
  if (lead.chunk.symbol) {
    lines.push(
      `The clearest match is \`${lead.chunk.symbol}\` — a ${roleWord} in ${lead.chunk.path} (line ${lead.chunk.startLine}), which ${ROLE_META[lead.role].describes}.`
    );
  } else {
    lines.push(
      `The clearest match is ${lead.chunk.path} (line ${lead.chunk.startLine}) — ${roleWord} that ${ROLE_META[lead.role].describes}.`
    );
  }

  const sig = signatureOf(lead.chunk);
  if (sig && lead.chunk.symbol && !lines[0].includes(sig)) {
    lines.push("");
    lines.push("```");
    lines.push(sig);
    lines.push("```");
  }

  /* --- 2. Flow: the calls it makes ---------------------------------- */
  const flow = lead.calls.filter((c) => c !== lead.chunk.symbol);
  if (flow.length) {
    lines.push("");
    lines.push(
      flow.length === 1
        ? "It delegates to one other function:"
        : `It delegates to ${flow.length} other functions, in order:`
    );
    flow.forEach((c, i) => lines.push(`${i + 1}. \`${c}\``));
  }

  /* --- 3. Dependencies ---------------------------------------------
   * Packages are attributed to the file that imports them. A single merged list
   * reads as "this codebase uses mongoose and firestore and express" when in
   * fact those came from three unrelated files — an over-claim that is exactly
   * what an evidence-based answer must avoid.
   */
  const withExternals = sites.filter((s) => s.externals.length > 0);
  if (withExternals.length === 1) {
    lines.push("");
    lines.push(
      `It imports: ${withExternals[0].externals.map((e) => `\`${e}\``).join(", ")}.`
    );
  } else if (withExternals.length > 1) {
    lines.push("");
    lines.push("Packages each match depends on:");
    for (const s of withExternals.slice(0, 4)) {
      lines.push(
        `• ${s.chunk.path} → ${s.externals.map((e) => `\`${e}\``).join(", ")}`
      );
    }
  }

  /* --- 4. Signals --------------------------------------------------- */
  const envVars = [...new Set(sites.flatMap((s) => s.signals.env))];
  const db = [...new Set(sites.flatMap((s) => s.signals.dbHints))];
  const auth = [...new Set(sites.flatMap((s) => s.signals.authWords))];
  const methods = [...new Set(sites.flatMap((s) => s.signals.httpMethods))];
  const codes = [...new Set(sites.flatMap((s) => s.signals.statusCodes))].sort((a, b) => a - b);

  const notable: string[] = [];
  if (methods.length) notable.push(`routes registered: ${methods.join(", ")}`);
  if (db.length) notable.push(`data stores referenced: ${db.join(", ")}`);
  if (auth.length) notable.push(`auth primitives: ${auth.join(", ")}`);
  // Status codes say what the code does on success and failure — often the
  // clearest statement of its contract, so they are reported explicitly.
  if (codes.length) {
    notable.push(
      `HTTP responses: ${codes
        .map((c) => `${c}${RESPONSE_MEANING[c] ? ` (${RESPONSE_MEANING[c]})` : ""}`)
        .join(", ")}`
    );
  }
  if (envVars.length) notable.push(`environment variables: ${envVars.join(", ")}`);
  if (sites.some((s) => s.signals.catches)) notable.push("error handling present");
  if (sites.some((s) => s.signals.async)) notable.push("asynchronous work");

  if (notable.length) {
    lines.push("");
    lines.push(`What the matched code touches: ${notable.join("; ")}.`);
  }

  /* --- 5. Other places it appears ---------------------------------- */
  if (sites.length > 1) {
    lines.push("");
    lines.push(
      `The same thread appears in ${sites.length - 1} other place${sites.length === 2 ? "" : "s"}:`
    );
    for (const s of sites.slice(1, 6)) {
      const sym = s.chunk.symbol ? `\`${s.chunk.symbol}\` — ` : "";
      lines.push(`• ${sym}${s.chunk.path}:${s.chunk.startLine} (${ROLE_META[s.role].label})`);
    }
  }

  /* --- 6. Honest limits -------------------------------------------- */
  lines.push("");
  lines.push(
    `Assembled directly from the source in ${files.length} file${files.length === 1 ? "" : "s"} — ${sites.length} match${sites.length === 1 ? "" : "es"}${closing}`,
  );

  return {
    answer: lines.join("\n"),
    sources: sites.slice(0, 6).map((s) => `${s.chunk.path}:${s.chunk.startLine}`),
  };
}
