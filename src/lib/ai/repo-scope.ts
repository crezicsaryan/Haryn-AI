import type { RepoMeta } from "../types";

/**
 * Repository-scope guard.
 *
 * A report covers exactly one repository. When a reader asks about a *different*
 * one — pasting another URL, or naming another project — the retrieval index has
 * no legitimate way to answer: every file it can search belongs to the loaded
 * repo. Before this guard existed, asking "analyse facebook/react" while viewing
 * `gym-saathi` retrieved `frontend/README.md`, matched the word "React", and
 * presented it as an answer about React's hooks. That is the worst failure mode a
 * grounded assistant has: a confident answer to a question it cannot answer.
 *
 * So the rule is: **detect a foreign repository and refuse, saying which
 * repository is actually loaded.** Never silently substitute one repo for
 * another.
 *
 * The hard part is precision. Plenty of ordinary questions contain slashes and
 * dots ("where is src/api/orders.js?", "what does app/page.tsx do?") and plenty
 * contain words that look like slugs. A guard that fires on those would refuse
 * legitimate questions about the loaded repository — worse in practice than the
 * bug it fixes. So detection is deliberately conservative and layered:
 *
 *   1. a GitHub URL is unambiguous — any owner/name in one is a real target;
 *   2. an explicit `owner/name` slug counts only when the owner segment carries
 *      no path/file signal (no extension, no known source directory);
 *   3. a bare repository name counts only when it is *not* the loaded repo, the
 *      question is clearly about a repository, and the name is not something the
 *      loaded repo plausibly contains.
 */

/** Hosts that unambiguously denote a GitHub repository. */
const GITHUB_HOSTS = /(?:^|\.)(?:github\.com|githubusercontent\.com)$/i;

/**
 * Directory names that make `a/b` a *path* rather than an `owner/name` slug.
 * "src/api" and "app/routes" are paths; "facebook/react" is a slug.
 */
const PATH_SEGMENTS = new Set([
  "src", "app", "pages", "lib", "libs", "dist", "build", "out", "bin", "cmd",
  "test", "tests", "spec", "specs", "testdata", "e2e", "cypress", "fixtures",
  "components", "component", "utils", "util", "helpers", "helper", "services",
  "service", "controllers", "controller", "models", "model", "routes", "route",
  "router", "routers", "views", "view", "layouts", "layout", "styles", "css",
  "assets", "static", "public", "config", "configs", "scripts", "script",
  "hooks", "hook", "store", "stores", "state", "api", "apis", "server",
  "client", "backend", "frontend", "web", "mobile", "docs", "doc", "migrations",
  "middleware", "middlewares", "handlers", "handler", "types", "interfaces",
  "schemas", "schema", "graphql", "screens", "features", "modules", "module",
]);

/** File extensions that make a token a filename rather than a repo name. */
const SOURCE_EXT =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|kts|cs|rs|php|swift|dart|scala|vue|svelte|sql|json|ya?ml|toml|ini|cfg|md|mdx|txt|env|lock|xml|html|css|scss|sass|less|sh|ps1|bat)$/i;

export interface RepoRef {
  /** `owner/name`, lower-cased, when the owner is known. */
  fullName?: string;
  /** The bare repository name, lower-cased. */
  name: string;
  /** Where it was found — affects how confidently we can compare. */
  source: "url" | "slug" | "bare";
}

/** Extract every `owner/name` GitHub URL in the text. */
function urlsIn(text: string): RepoRef[] {
  const out: RepoRef[] = [];
  const re = /(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\/([^/\s?#]+)\/([^/\s?#]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const host = m[1].replace(/^www\./i, "").toLowerCase();
    if (!GITHUB_HOSTS.test(host)) continue;

    const owner = m[2];
    const raw = m[3];
    // Strip a trailing `.git` and any trailing punctuation.
    const name = raw.replace(/\.git$/i, "").replace(/[),.;:'"]+$/, "");
    if (!owner || !name) continue;
    if (!/^[a-z0-9._-]+$/i.test(owner) || !/^[a-z0-9._-]+$/i.test(name)) continue;
    out.push({ fullName: `${owner}/${name}`.toLowerCase(), name: name.toLowerCase(), source: "url" });
  }
  return out;
}

/**
 * Find `owner/name` slugs that are almost certainly repositories.
 *
 * Requires a two-segment shape, a plausible owner, and that the first segment is
 * not a familiar source directory. Extension-bearing segments are excluded so
 * `src/api/orders.js` never registers.
 */
function slugsIn(text: string): RepoRef[] {
  const out: RepoRef[] = [];
  // Walk slash-separated chains so multi-segment paths can be rejected wholesale.
  const re = /(?:^|[\s([<"'`])([a-z0-9][a-z0-9._-]{0,38})\/([a-z0-9][a-z0-9._-]{0,38})(?![a-z0-9._/-])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const owner = m[1];
    const name = m[2];

    if (SOURCE_EXT.test(owner) || SOURCE_EXT.test(name)) continue;
    if (owner.toLowerCase() === "www") continue;
    if (PATH_SEGMENTS.has(owner.toLowerCase())) continue;
    if (PATH_SEGMENTS.has(name.toLowerCase())) continue;
    // A dotted owner is a host, not a GitHub user.
    if (owner.includes(".")) continue;

    out.push({ fullName: `${owner}/${name}`.toLowerCase(), name: name.toLowerCase(), source: "slug" });
  }
  return out;
}

/**
 * Phrases that explicitly name a repository as the *object* of the question.
 *
 * A bare word is only a repository reference when it sits in one of these
 * frames. "how does react work" is a question about a concept; "analyse the
 * react repository" is a question about a project. Without this gate almost
 * every ordinary question would look like it names a foreign repo.
 *
 * Every alternative requires the proper noun to be adjacent to the repo word —
 * either before it ("analyse django repo") or after it ("a repo called django").
 * A demonstrative on its own is not enough: "how is the project structured"
 * uses "the project" generically and names nothing.
 */
const NAMES_A_REPO =
  // "analyse/review/... <name> repository"  — the name precedes the noun.
  // A short run of filler ("with the", "against") may sit between verb and name.
  /(?:\b(?:analyse|analyze|review|check|inspect|scan|examine|clone|fork|compare|explain|describe)\b(?:\s+(?:with|against|to|and|the|a|an|my|this|that)){0,3}\s+([A-Za-z][\w.-]{2,39})\s+(?:repo|repository|project|codebase)\b)/i;

/** "… a repository called/named <name>" — the name follows the noun. */
const REPO_NAMED =
  /\b(?:repo|repository|project|codebase)\b\s+(?:called|named)\s+([A-Za-z][\w.-]{2,39})\b/i;

/**
 * Words that never name a repository, whatever their position.
 *
 * The sentence frame alone is not enough — "analyse this project" passes the
 * gate above and its content words would then be treated as names. Common
 * English function words and question words must be excluded explicitly, since
 * they are what a reader actually writes in an ordinary question.
 */
const STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "there", "here", "its", "it's",
  "and", "for", "with", "from", "into", "over", "under", "about", "what",
  "which", "where", "when", "why", "how", "who", "are", "was", "were", "been",
  "has", "have", "had", "does", "did", "doing", "can", "could", "should",
  "would", "will", "shall", "may", "might", "must", "our", "their", "your",
  "my", "his", "her", "any", "all", "some", "most", "more", "less", "than",
  "then", "also", "just", "only", "very", "much", "many", "each", "every",
  "repo", "repository", "project", "codebase", "github", "code", "files",
  "file", "folder", "structure", "use", "uses", "using", "work", "works",
  "working", "tell", "give", "show", "explain", "describe", "summarise",
  "summarize", "summary", "overview", "please", "help", "need", "want",
  "like", "look", "looks", "make", "made", "built", "build", "analyse",
  "analyze", "review", "check", "inspect", "scan", "examine", "clone", "fork",
  "compare", "named", "called", "main", "current", "loaded", "same", "other",
  "another", "technology", "technologies", "stack", "framework", "language",
  "languages", "database", "auth", "authentication", "security", "test",
  "tests", "testing", "dependencies", "quality", "bugs", "performance",
  "architecture", "documentation", "docs", "readme", "improve", "fix", "start",
]);

/**
 * Bare repository names — the weakest signal of the three.
 *
 * Only counted when the question contains an explicit "analyse the X repository"
 * style frame, and only for a word that survives the stopword filter. This keeps
 * the guard's precision high: refusing a legitimate question about the *loaded*
 * repository is worse than missing an oblique reference to another one, because
 * the reader gets no answer at all.
 */
function bareNamesIn(text: string): RepoRef[] {
  const out: RepoRef[] = [];
  const seen = new Set<string>();

  const consider = (raw: string) => {
    const w = raw.trim().replace(/[),.;:'"]+$/, "");
    const lower = w.toLowerCase();
    if (lower.length < 3 || lower.length > 40) return;
    if (SOURCE_EXT.test(lower)) return;
    if (STOPWORDS.has(lower)) return;
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push({ name: lower, source: "bare" });
  };

  // Only the captured proper noun, never the surrounding sentence words.
  const a = NAMES_A_REPO.exec(text);
  if (a?.[1]) consider(a[1]);
  const b = REPO_NAMED.exec(text);
  if (b?.[1]) consider(b[1]);

  return out;
}

export function findRepoRefs(text: string): RepoRef[] {
  const urls = urlsIn(text);
  const slugs = slugsIn(text);

  /*
   * Bare names are harvested from a copy of the text with every URL removed.
   * Otherwise the words inside `https://github.com/facebook/react` — "github",
   * "com", "facebook" — are each read as a candidate bare repository name, and
   * the loaded repo's own URL reports itself as foreign.
   */
  const withoutUrls = text.replace(
    /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[^\s]*/gi,
    " "
  );
  const bare = bareNamesIn(withoutUrls);

  // De-duplicate, keeping the strongest source for each identity.
  const byKey = new Map<string, RepoRef>();
  const rank = { url: 3, slug: 2, bare: 1 } as const;
  for (const r of [...urls, ...slugs, ...bare]) {
    const key = r.fullName ?? r.name;
    const prev = byKey.get(key);
    if (!prev || rank[r.source] > rank[prev.source]) byKey.set(key, r);
  }
  return [...byKey.values()];
}

export interface ScopeVerdict {
  /** True when the question refers to a repository other than the loaded one. */
  outOfScope: boolean;
  /** The foreign repositories the question referred to, best-effort. */
  otherRepos: string[];
}

/**
 * Does the question refer to a repository other than `repo`?
 *
 * A reference matching the loaded repository is never out of scope, even when it
 * arrives as a URL. A *bare* name is only out of scope when it does not match —
 * bare names are matched loosely because the reader may write "gym-saathi" for
 * `crezicsaryan/gym-saathi`.
 */
export function checkRepoScope(repo: RepoMeta, question: string): ScopeVerdict {
  const refs = findRepoRefs(question);
  const loadedFull = repo.fullName.toLowerCase();
  const loadedName = repo.name.toLowerCase();

  const other: string[] = [];
  for (const ref of refs) {
    // A URL or slug carrying an owner is a definite statement of identity.
    if (ref.source !== "bare" && ref.fullName) {
      if (ref.fullName === loadedFull) continue;
      other.push(ref.fullName);
      continue;
    }
    // A bare name only counts when it clearly is not this repository.
    if (ref.name === loadedName || ref.name === loadedFull) continue;
    if (PATH_SEGMENTS.has(ref.name)) continue;
    // The name of the loaded repo split into words ("gym-saathi" → gym, saathi)
    // should not look foreign.
    if (loadedName.split(/[-_.]/).includes(ref.name)) continue;
    other.push(ref.name);
  }

  const uniq = [...new Set(other)];
  return { outOfScope: uniq.length > 0, otherRepos: uniq };
}

/** The refusal shown when a question targets a repository that is not loaded. */
export function scopeRefusal(repo: RepoMeta, otherRepos: string[]): string {
  const named = otherRepos.slice(0, 3).join(", ");
  return [
    `I can only answer about the repository that is currently loaded: **${repo.fullName}**.`,
    "",
    `Your question refers to a different repository${otherRepos.length === 1 ? "" : "s"} (${named}), and I have no analysed code for ${otherRepos.length === 1 ? "it" : "them"} — only for ${repo.fullName}. I won't guess at code I haven't read.`,
    "",
    `To ask about ${named}, run an analysis on it first and open that report; the assistant here is scoped to ${repo.fullName}.`,
  ].join("\n");
}
