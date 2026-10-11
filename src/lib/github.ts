import type {
  CommitAuthorStat,
  CommitMessageStats,
  CommitMonthBucket,
  CommitTypeStat,
  CommitWeek,
  Contributor,
  ErrorCode,
  RecentCommit,
  RepoActivity,
  RepoMeta,
} from "./types";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN ?? "";

export class GitHubError extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message: string, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.code = code;
    this.status = status;
  }
}

function headers(accept = "application/vnd.github+json"): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    "User-Agent": "Haryn-AI/1.0 (+codebase-analyzer)",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

/** Normalise GitHub HTTP failures into typed, user-facing errors. */
function classify(status: number, body: string): GitHubError {
  if (status === 404) {
    return new GitHubError(
      "REPOSITORY_NOT_FOUND",
      "Repository could not be found or is not publicly accessible.",
      status
    );
  }
  if (status === 451) {
    return new GitHubError(
      "PRIVATE_REPOSITORY",
      "This repository appears to be private or unavailable. Haryn AI supports public repositories only.",
      status
    );
  }
  if (status === 403 || status === 429) {
    const remaining = /rate limit/i.test(body);
    return new GitHubError(
      "RATE_LIMITED",
      remaining
        ? "GitHub API rate limit reached. Add a GITHUB_TOKEN or try again shortly."
        : "Access to this repository was refused by GitHub.",
      status
    );
  }
  return new GitHubError(
    "ANALYSIS_FAILED",
    `GitHub returned an unexpected response (${status}).`,
    status
  );
}

async function ghFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new GitHubError(
      "ANALYSIS_FAILED",
      "Could not reach GitHub. Check your network connection and try again."
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw classify(res.status, body);
  }
  return res;
}

export interface RepoFetchResult {
  meta: RepoMeta;
  apiCalls: number;
}

/** GET /repos/{owner}/{repo} */
export async function fetchRepoMeta(
  owner: string,
  name: string
): Promise<RepoFetchResult> {
  const res = await ghFetch(`/repos/${owner}/${name}`);
  const j = (await res.json()) as Record<string, unknown>;
  const license =
    j.license && typeof j.license === "object"
      ? ((j.license as { spdx_id?: string }).spdx_id ?? null)
      : null;

  const meta: RepoMeta = {
    owner: String((j.owner as { login?: string })?.login ?? owner),
    name: String(j.name ?? name),
    fullName: String(j.full_name ?? `${owner}/${name}`),
    url: String(j.html_url ?? `https://github.com/${owner}/${name}`),
    description: (j.description as string | null) ?? null,
    defaultBranch: String(j.default_branch ?? "main"),
    stars: Number(j.stargazers_count ?? 0),
    forks: Number(j.forks_count ?? 0),
    watchers: Number(j.subscribers_count ?? j.watchers_count ?? 0),
    openIssues: Number(j.open_issues_count ?? 0),
    license,
    sizeKb: Number(j.size ?? 0),
    createdAt: String(j.created_at ?? ""),
    pushedAt: String(j.pushed_at ?? ""),
    homepage: (j.homepage as string | null) ?? null,
    topics: Array.isArray(j.topics) ? (j.topics as string[]) : [],
    archived: Boolean(j.archived),
    isFork: Boolean(j.fork),
  };
  return { meta, apiCalls: 1 };
}

/** GET /repos/{owner}/{repo}/languages → bytes per language. */
export async function fetchLanguages(
  owner: string,
  name: string
): Promise<{ languages: Record<string, number>; apiCalls: number }> {
  const res = await ghFetch(`/repos/${owner}/${name}/languages`);
  const languages = (await res.json()) as Record<string, number>;
  return { languages: languages ?? {}, apiCalls: 1 };
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

/** GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1 */
export async function fetchTree(
  owner: string,
  name: string,
  ref: string
): Promise<{ entries: TreeEntry[]; truncated: boolean; apiCalls: number }> {
  const res = await ghFetch(
    `/repos/${owner}/${name}/git/trees/${encodeURIComponent(
      ref
    )}?recursive=1`
  );
  const j = (await res.json()) as {
    tree?: { path: string; type: string; size?: number }[];
    truncated?: boolean;
  };
  const entries: TreeEntry[] = (j.tree ?? [])
    .filter((e) => e.type === "blob" || e.type === "tree")
    .map((e) => ({
      path: e.path,
      type: e.type as TreeEntry["type"],
      size: e.size,
    }));
  return { entries, truncated: Boolean(j.truncated), apiCalls: 1 };
}

/* ------------------------------------------------------------------ */
/* Commit history                                                      */
/* ------------------------------------------------------------------ */

/**
 * Total item count from a pagination Link header.
 *
 * GitHub reports the last page number rather than a total, so asking for one
 * item per page turns the header into a commit count — one request instead of
 * paginating the whole history.
 */
function totalFromLinkHeader(res: Response): number {
  const link = res.headers.get("link");
  if (!link) return 0;
  const m = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : 0;
}

interface GhCommit {
  sha?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
}

/* --- Commit message classification ---------------------------------- */

/** Conventional-commit types worth keeping distinct. */
const CONVENTIONAL = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

/**
 * Bucket a commit subject.
 *
 * Prefers the conventional-commit prefix when present. Otherwise falls back to
 * a couple of high-confidence patterns (merge commits, dependency bumps) rather
 * than guessing — anything unrecognised is honestly labelled "other".
 */
function commitTypeOf(subject: string): string {
  const conventional = /^([a-zA-Z]+)(?:\([^)]*\))?!?:\s/.exec(subject);
  if (conventional) {
    const t = conventional[1].toLowerCase();
    if (CONVENTIONAL.has(t)) return t;
  }
  if (/^merge\b/i.test(subject)) return "merge";
  // Dependabot / Renovate phrasing, or an explicit version bump. The version
  // may carry a range operator (`>=1.11.1`) or a `v` prefix.
  if (/^bump\b/i.test(subject)) return "deps";
  if (/^(update|upgrade|downgrade)\b.*\b(dependenc|requirement|package|module|version)\b/i.test(subject)) {
    return "deps";
  }
  if (
    /\bfrom\s+[><=^~]*\s*v?[\d.]+(?:[-.][\w.]+)*\s+to\s+[><=^~]*\s*v?[\d.]+/i.test(subject)
  ) {
    return "deps";
  }
  return "other";
}

/**
 * Derive a 52-week grid from the commits we already have.
 *
 * GitHub's weekly statistics endpoint returns `202 Accepted` while it computes
 * the figure, which can leave the calendar empty on a first analysis. The commit
 * list is already in hand, so falling back to it is strictly better than showing
 * nothing — the caller labels it as partial.
 */
function buildWeeksFromCommits(commits: RecentCommit[]): CommitWeek[] {
  const DAY = 86_400_000;
  const now = new Date();
  // Align to the start of the current week (Sunday) so buckets line up.
  const startOfThisWeek = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay()
  );

  const weeks: CommitWeek[] = [];
  for (let i = 51; i >= 0; i--) {
    const weekStart = startOfThisWeek - i * 7 * DAY;
    weeks.push({ week: new Date(weekStart).toISOString(), total: 0, days: [0, 0, 0, 0, 0, 0, 0] });
  }

  const index = new Map<number, number>();
  weeks.forEach((w, i) => index.set(new Date(w.week).getTime(), i));

  for (const c of commits) {
    const t = new Date(c.date).getTime();
    if (!Number.isFinite(t)) continue;
    const day = new Date(t);
    const weekStart = Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate() - day.getUTCDay()
    );
    const wi = index.get(weekStart);
    if (wi === undefined) continue;
    const bucket = weeks[wi];
    bucket.total += 1;
    bucket.days[day.getUTCDay()] += 1;
  }

  return weeks;
}

/**
 * Recent commits, the exact total, and the derived analytics.
 *
 * Two requests on purpose. The pagination header reports the *last page
 * number*, not the item count, so asking for one item per page makes that
 * number equal the total — deriving it from a 100-per-page request instead
 * undercounts by a factor of 100.
 */
async function fetchRecentCommits(
  owner: string,
  name: string
): Promise<{ commits: RecentCommit[]; total: number }> {
  const [recentRes, countRes] = await Promise.allSettled([
    ghFetch(`/repos/${owner}/${name}/commits?per_page=100`),
    ghFetch(`/repos/${owner}/${name}/commits?per_page=1`),
  ]);

  let total = 0;
  if (countRes.status === "fulfilled") {
    total = totalFromLinkHeader(countRes.value) || 1;
  }

  if (recentRes.status !== "fulfilled") return { commits: [], total };

  const j = (await recentRes.value.json()) as GhCommit[];
  const commits: RecentCommit[] = (Array.isArray(j) ? j : [])
    .filter((c) => c?.sha)
    .slice(0, 100)
    .map((c) => {
      const full = c.commit?.message ?? "";
      const lines = full.split("\n");
      const subject = (lines[0] ?? "").trim().slice(0, 200);
      const body = lines.slice(1).join("\n").trim().slice(0, 600);
      return {
        sha: String(c.sha),
        shortSha: String(c.sha).slice(0, 7),
        message: subject,
        body: body || undefined,
        author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
        date: c.commit?.author?.date ?? "",
        type: commitTypeOf(subject),
      };
    });

  return { commits, total };
}

/* --- Derived analytics ---------------------------------------------- */

function buildMonths(commits: RecentCommit[], count = 12): CommitMonthBucket[] {
  const buckets = new Map<string, number>();
  for (const c of commits) {
    const d = new Date(c.date);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Always emit a contiguous run ending at the newest month, so the chart has
  // no misleading gaps.
  const keys = [...buckets.keys()].sort();
  const newest = keys.at(-1);
  if (!newest) return [];

  const [ny, nm] = newest.split("-").map(Number);
  const out: CommitMonthBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ny, nm - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }),
      total: buckets.get(key) ?? 0,
    });
  }
  return out;
}

function buildAuthorStats(commits: RecentCommit[]): CommitAuthorStat[] {
  const map = new Map<
    string,
    { commits: number; first: string | null; last: string | null }
  >();

  for (const c of commits) {
    const entry = map.get(c.author) ?? { commits: 0, first: null, last: null };
    entry.commits += 1;
    if (c.date) {
      if (!entry.first || c.date < entry.first) entry.first = c.date;
      if (!entry.last || c.date > entry.last) entry.last = c.date;
    }
    map.set(c.author, entry);
  }

  const total = commits.length || 1;
  return [...map.entries()]
    .map(([login, e]) => ({
      login,
      commits: e.commits,
      share: e.commits / total,
      firstCommitAt: e.first,
      lastCommitAt: e.last,
    }))
    .sort((a, b) => b.commits - a.commits);
}

function buildMessageTypes(commits: RecentCommit[]): CommitTypeStat[] {
  const map = new Map<string, number>();
  for (const c of commits) map.set(c.type, (map.get(c.type) ?? 0) + 1);
  const total = commits.length || 1;
  return [...map.entries()]
    .map(([type, count]) => ({ type, count, share: count / total }))
    .sort((a, b) => b.count - a.count);
}

function buildMessageStats(commits: RecentCommit[]): CommitMessageStats {
  const lengths = commits.map((c) => c.message.length);
  const longest = commits.reduce(
    (best, c) => (c.message.length > best.length ? c.message : best),
    ""
  );
  return {
    scanned: commits.length,
    withBody: commits.filter((c) => c.body).length,
    avgSubjectLength: lengths.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : 0,
    longestSubject: longest.slice(0, 200),
  };
}

/**
 * Weekly commit counts for the last year.
 *
 * GitHub computes this statistic lazily and answers `202 Accepted` the first
 * time, so a short retry is required. A 202 on both attempts is not an error —
 * it just means the history is not available yet.
 */
async function fetchWeeklyActivity(owner: string, name: string): Promise<CommitWeek[]> {
  // GitHub computes this lazily; the first requests return 202 while it builds
  // the statistic in the background. Three attempts covers a cold cache.
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/repos/${owner}/${name}/stats/commit_activity`, {
        headers: headers(),
        cache: "no-store",
      });
    } catch {
      return [];
    }

    if (res.status === 202) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) return [];

    const j = (await res.json().catch(() => null)) as
      | { week?: number; total?: number; days?: number[] }[]
      | null;
    if (!Array.isArray(j)) return [];

    return j.slice(-52).map((w) => ({
      week: new Date(Number(w.week ?? 0) * 1000).toISOString(),
      total: Number(w.total ?? 0),
      days: Array.isArray(w.days) ? w.days.map(Number) : [],
    }));
  }
  return [];
}

/** Top contributors by commit count. */
async function fetchContributors(owner: string, name: string): Promise<Contributor[]> {
  const res = await ghFetch(`/repos/${owner}/${name}/contributors?per_page=12`);
  const j = (await res.json()) as {
    login?: string;
    avatar_url?: string;
    contributions?: number;
    html_url?: string;
  }[];
  return (Array.isArray(j) ? j : [])
    .filter((c) => c?.login)
    .slice(0, 12)
    .map((c) => ({
      login: String(c.login),
      avatarUrl: String(c.avatar_url ?? ""),
      contributions: Number(c.contributions ?? 0),
      url: String(c.html_url ?? ""),
    }));
}

/**
 * Repository activity, assembled from three best-effort requests.
 *
 * Every part is independently optional: a rate-limited or not-yet-computed
 * statistic must degrade to "less history shown", never to a failed analysis.
 */
export async function fetchRepoActivity(
  owner: string,
  name: string
): Promise<{ activity: RepoActivity; apiCalls: number }> {
  const [commitsRes, weeklyRes, contributorsRes] = await Promise.allSettled([
    fetchRecentCommits(owner, name),
    fetchWeeklyActivity(owner, name),
    fetchContributors(owner, name),
  ]);

  const recent = commitsRes.status === "fulfilled" ? commitsRes.value : null;
  const weekly = weeklyRes.status === "fulfilled" ? weeklyRes.value : [];
  const contributors = contributorsRes.status === "fulfilled" ? contributorsRes.value : [];

  let apiCalls = 0;
  if (commitsRes.status === "fulfilled") apiCalls += 1;
  if (weeklyRes.status === "fulfilled" && weekly.length) apiCalls += 1;
  if (contributorsRes.status === "fulfilled") apiCalls += 1;

  const recentCommits = recent?.commits ?? [];
  const totalCommits = recent?.total || weekly.reduce((a, w) => a + w.total, 0);

  // GitHub's weekly statistic can be unavailable (still computing). The commit
  // list is already in hand, so derive a grid from it rather than showing an
  // empty calendar.
  const derived = weekly.length ? null : buildWeeksFromCommits(recentCommits);
  const weeklyGrid = weekly.length ? weekly : (derived ?? []);
  const weeklyIsDerived = Boolean(derived?.length);

  // Trailing 4 weeks vs the preceding 4 — a simple momentum signal.
  const tail = weeklyGrid.slice(-8);
  const recentMonthly = tail.slice(-4).reduce((a, w) => a + w.total, 0);
  const priorMonthly = tail.slice(0, 4).reduce((a, w) => a + w.total, 0);

  const lastCommitAt =
    recentCommits[0]?.date ??
    (weeklyGrid.length ? weeklyGrid[weeklyGrid.length - 1].week : null);

  const partial = !recent && !weekly.length && !contributors.length;

  return {
    activity: {
      totalCommits,
      weeklyCommits: weeklyGrid,
      contributors,
      recentCommits,
      months: buildMonths(recentCommits),
      authorStats: buildAuthorStats(recentCommits),
      messageTypes: buildMessageTypes(recentCommits),
      messageStats: buildMessageStats(recentCommits),
      lastCommitAt,
      recentMonthly,
      priorMonthly,
      partial,
      notice: partial
        ? "GitHub did not return commit history for this repository — the API may be rate-limited, or the history is still being computed."
        : weeklyIsDerived
          ? "GitHub was still computing the full weekly history, so the calendar and momentum figures below are derived from the 100 most recent commits rather than the whole history."
          : undefined,
    },
    apiCalls,
  };
}
/** Fetch a single file's text from raw.githubusercontent (not rate-limited). */
export async function fetchRawFile(
  owner: string,
  name: string,
  ref: string,
  path: string,
  maxBytes = 400_000
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(
    ref
  )}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Haryn-AI/1.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      // Read a truncated prefix rather than dropping the file entirely.
      const slice = buf.slice(0, maxBytes);
      return new TextDecoder("utf-8", { fatal: false }).decode(slice);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}
