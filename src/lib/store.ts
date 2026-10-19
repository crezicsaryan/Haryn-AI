import type { Report } from "./types";
import type { Chunk, RepoIndex } from "./ai";
import { indexFromChunks, persistableChunks } from "./ai";
import { asNumber, asString, getDb, nowIso, parseJson, toJson } from "./db";
import { buildSampleReport, SAMPLE_ID } from "./sample";
import { makeId } from "./utils";

/**
 * Analysis persistence.
 *
 * Reports are stored in the database so they survive a restart and can be
 * shared by link. The retrieval index is **not** stored — it is derived data,
 * rebuilt in memory from the persisted chunks on first use.
 *
 * This module is the seam the TRD calls out. Every caller goes through these
 * functions, and none of them know how the data is stored, so the storage
 * engine can change underneath without touching anything else.
 */

/* ------------------------------------------------------------------ */
/* In-memory retrieval index cache                                     */
/* ------------------------------------------------------------------ */

const MAX_CACHED_INDEXES = 10;

const globalRef = globalThis as unknown as {
  __harynIndexCache?: Map<string, RepoIndex>;
};

function cache(): Map<string, RepoIndex> {
  if (!globalRef.__harynIndexCache) globalRef.__harynIndexCache = new Map();
  return globalRef.__harynIndexCache;
}

function cacheIndex(id: string, index: RepoIndex): void {
  const c = cache();
  c.set(id, index);
  while (c.size > MAX_CACHED_INDEXES) {
    const oldest = c.keys().next().value;
    if (oldest === undefined) break;
    c.delete(oldest);
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * One repository the user has analysed before, as the history picker sees it.
 *
 * Grouped by repository rather than by run: people think in repositories, and a
 * repo analysed three times would otherwise fill the list with near-duplicates.
 * The row carries the **latest** run, so selecting it opens the newest report,
 * plus a run count so a stale result is recognisable.
 */
export interface RepoHistoryEntry {
  /** Id of the most recent completed run for this repository. */
  id: string;
  repoFullName: string;
  repoUrl: string;
  healthScore: number | null;
  findingCount: number;
  criticalCount: number;
  highCount: number;
  fileCount: number;
  lastAnalyzedAt: string;
  runCount: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  intent?: string | null;
  sources?: string[];
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The store's public API is deliberately **async**, even though the SQLite
 * driver is synchronous. A server database (Postgres) genuinely awaits, so
 * keeping the contract async now means swapping engines later touches only this
 * file — no call site changes.
 */

/** Record the run up front, so history survives even a hard failure. */
export async function createAnalysis(
  id: string,
  repo: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
    defaultBranch: string;
  }
): Promise<void> {
  getDb().prepare(
    `INSERT INTO analyses
       (id, repo_owner, repo_name, repo_full_name, repo_url, default_branch, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
     ON CONFLICT(id) DO UPDATE SET
       status = 'running',
       repo_full_name = excluded.repo_full_name`
  ).run(
    id,
    repo.owner,
    repo.name,
    repo.fullName,
    repo.url,
    repo.defaultBranch,
    nowIso()
  );
}

export async function completeAnalysis(
  report: Report,
  index: RepoIndex | null
): Promise<void> {
  const critical = report.findings.filter((f) => f.severity === "critical").length;
  const high = report.findings.filter((f) => f.severity === "high").length;

  const chunks = index ? toJson(persistableChunks(index)) : null;

  getDb().prepare(
    `INSERT INTO analyses
       (id, repo_owner, repo_name, repo_full_name, repo_url, default_branch,
        status, health_score, finding_count, critical_count, high_count,
        file_count, duration_ms, payload, chunks, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status         = 'completed',
       health_score   = excluded.health_score,
       finding_count  = excluded.finding_count,
       critical_count = excluded.critical_count,
       high_count     = excluded.high_count,
       file_count     = excluded.file_count,
       duration_ms    = excluded.duration_ms,
       payload        = excluded.payload,
       -- Keep previously stored chunks if this run produced none.
       chunks         = COALESCE(excluded.chunks, analyses.chunks),
       completed_at   = excluded.completed_at,
       error_code     = NULL,
       error_message  = NULL`
  ).run(
    report.id,
    report.repo.owner,
    report.repo.name,
    report.repo.fullName,
    report.repo.url,
    report.repo.defaultBranch,
    report.healthScore,
    report.findings.length,
    critical,
    high,
    report.structure.fileCount,
    report.durationMs,
    toJson(report),
    chunks,
    report.createdAt,
    report.completedAt
  );

  if (index) cacheIndex(report.id, index);
}

/** History is best-effort — never let a logging failure mask the real error. */
export async function failAnalysis(
  id: string,
  code: string,
  message: string
): Promise<void> {
  try {
    getDb().prepare(
      `INSERT INTO analyses
         (id, repo_owner, repo_name, repo_full_name, status, error_code, error_message, created_at, completed_at)
       VALUES (?, 'unknown', 'unknown', 'unknown', 'failed', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status        = 'failed',
         error_code    = excluded.error_code,
         error_message = excluded.error_message,
         completed_at  = excluded.completed_at`
    ).run(id, code, message.slice(0, 500), nowIso(), nowIso());
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Register the bundled sample as a stored analysis.
 *
 * The sample report itself is a code-level fixture and needs no row. Its
 * *knowledge graph* does: `graph_nodes` and `graph_edges` both reference
 * `analyses(id)`, so a graph cannot exist for an analysis that has no row. This
 * writes the one row the foreign key needs, so every graph route keeps reading
 * the database as usual instead of each growing a sample branch.
 *
 * Idempotent, and the sample is excluded from the history list — it is a demo
 * fixture, not something the user analysed.
 */
export async function ensureSampleReportRow(): Promise<void> {
  const report = buildSampleReport();
  const count = (severity: string) =>
    report.findings.filter((f) => f.severity === severity).length;

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO analyses
         (id, repo_owner, repo_name, repo_full_name, repo_url, default_branch,
          status, health_score, finding_count, critical_count, high_count,
          file_count, duration_ms, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      SAMPLE_ID,
      report.repo.owner,
      report.repo.name,
      report.repo.fullName,
      report.repo.url,
      report.repo.defaultBranch,
      report.healthScore,
      report.findings.length,
      count("critical"),
      count("high"),
      report.structure.fileCount,
      report.durationMs,
      report.createdAt,
      report.completedAt
    );
}

export async function getReport(id: string): Promise<Report | null> {
  // The bundled sample is a code-level fixture, always resolvable.
  if (id === SAMPLE_ID) return buildSampleReport();

  const row = getDb()
    .prepare(`SELECT payload FROM analyses WHERE id = ?`)
    .get(id);

  return parseJson<Report | null>(row?.payload, null);
}

/**
 * Retrieval index for an analysis.
 *
 * Rebuilt from the persisted chunks when it is not already in memory — which is
 * the case for every report after a server restart. Embeddings are not rebuilt
 * (that would need API calls), so a restored index is lexical + structural.
 */
export async function getIndex(id: string): Promise<RepoIndex | null> {
  const cached = cache().get(id);
  if (cached) return cached;
  if (id === SAMPLE_ID) return null;

  const row = getDb()
    .prepare(`SELECT chunks FROM analyses WHERE id = ?`)
    .get(id);

  const chunks = parseJson<Chunk[] | null>(row?.chunks, null);
  if (!chunks?.length) return null;

  const index = await indexFromChunks(chunks);
  cacheIndex(id, index);
  return index;
}

export async function hasReport(id: string): Promise<boolean> {
  if (id === SAMPLE_ID) return true;
  return Boolean(
    getDb().prepare(`SELECT id FROM analyses WHERE id = ?`).get(id)
  );
}

/**
 * Repositories the user has analysed before, newest first.
 *
 * `q` matches against `owner/name`, so typing a partial URL narrows the list.
 * The filter is deliberately `LOWER(...) LIKE LOWER(...)` rather than plain
 * `LIKE`: SQLite's `LIKE` is case-insensitive for ASCII but Postgres's is not,
 * and this query has to keep working when the store moves to Postgres.
 *
 * The window functions do the grouping in one pass — `rn = 1` picks the latest
 * run per repository and `run_count` reports how many times it has been run.
 */
export async function listRepoHistory(
  q = "",
  limit = 20
): Promise<RepoHistoryEntry[]> {
  const needle = q.trim();
  // `%` and `_` are wildcards in LIKE, so a user typing one would match far more
  // than they asked for. Escaping them needs an explicit ESCAPE clause, and the
  // escape character must be exactly one character — `'\\'` in SQL source is a
  // two-character string and SQLite rejects it.
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);

  const rows = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT id, repo_full_name, repo_url, health_score, finding_count,
                critical_count, high_count, file_count, created_at,
                ROW_NUMBER() OVER (PARTITION BY repo_full_name ORDER BY created_at DESC) AS rn,
                COUNT(*)    OVER (PARTITION BY repo_full_name)                     AS run_count
           FROM analyses
          WHERE status = 'completed'
            AND id <> ?
            ${needle ? "AND LOWER(repo_full_name) LIKE LOWER(?) ESCAPE '\\'" : ""}
       ) WHERE rn = 1
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...(needle ? [SAMPLE_ID, `%${escaped}%`, limit] : [SAMPLE_ID, limit]));

  return rows.map((r) => ({
    id: asString(r.id),
    repoFullName: asString(r.repo_full_name),
    repoUrl: asString(r.repo_url),
    healthScore:
      r.health_score === null || r.health_score === undefined
        ? null
        : asNumber(r.health_score),
    findingCount: asNumber(r.finding_count),
    criticalCount: asNumber(r.critical_count),
    highCount: asNumber(r.high_count),
    fileCount: asNumber(r.file_count),
    lastAnalyzedAt: asString(r.created_at),
    runCount: asNumber(r.run_count),
  }));
}

export async function countAnalyses(): Promise<number> {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM analyses WHERE status = 'completed'`)
    .get();
  return asNumber(row?.c);
}

/* ------------------------------------------------------------------ */
/* Chat transcript                                                     */
/* ------------------------------------------------------------------ */

export async function saveChatMessage(
  analysisId: string,
  msg: {
    role: "user" | "assistant";
    content: string;
    engine?: string | null;
    intent?: string | null;
    sources?: string[] | null;
  }
): Promise<void> {
  try {
    getDb().prepare(
      `INSERT INTO chat_messages
         (id, analysis_id, role, content, engine, intent, sources, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      makeId("msg"),
      analysisId,
      msg.role,
      msg.content.slice(0, 8000),
      msg.engine ?? null,
      msg.intent ?? null,
      toJson(msg.sources ?? null),
      nowIso()
    );
  } catch {
    /* a lost transcript line must never break an answer */
  }
}

export async function getChatMessages(
  analysisId: string,
  limit = 50
): Promise<ChatTurn[]> {
  const rows = getDb()
    .prepare(
      `SELECT role, content, engine, intent, sources, created_at
         FROM chat_messages
        WHERE analysis_id = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?`
    )
    .all(analysisId, limit);

  return rows.map((r) => ({
    role: asString(r.role) === "user" ? "user" : "assistant",
    content: asString(r.content),
    engine: r.engine === null ? null : asString(r.engine),
    intent: r.intent === null ? null : asString(r.intent),
    sources: parseJson<string[] | undefined>(r.sources, undefined),
    createdAt: asString(r.created_at),
  }));
}

export { SAMPLE_ID };
