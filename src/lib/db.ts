import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Database access.
 *
 * Uses Node's **built-in** SQLite driver (`node:sqlite`, Node 22.5+), so local
 * development needs no database server and no native dependency. The schema
 * below is deliberately written in portable SQL — the same statements run on
 * PostgreSQL with two substitutions (`TEXT` timestamps → `TIMESTAMPTZ`,
 * `TEXT` JSON columns → `JSONB`).
 *
 * Production is expected to run PostgreSQL. `lib/store.ts` is the only module
 * that touches this file, so moving to a server database — whether through
 * Prisma, Drizzle or a raw driver — is a single-file change.
 */

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * Canonical DDL. Applied on every connection with `IF NOT EXISTS`, so it is
 * idempotent and doubles as the migration for this stage of the project.
 *
 * PostgreSQL equivalents:
 *   created_at / completed_at  TEXT      → TIMESTAMPTZ
 *   payload / chunks / sources TEXT      → JSONB
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS analyses (
  id             TEXT PRIMARY KEY,
  repo_owner     TEXT NOT NULL,
  repo_name      TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  repo_url       TEXT NOT NULL DEFAULT '',
  default_branch TEXT NOT NULL DEFAULT 'HEAD',

  -- queued | running | completed | failed
  status         TEXT NOT NULL DEFAULT 'queued',

  health_score   INTEGER,
  finding_count  INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count     INTEGER NOT NULL DEFAULT 0,
  file_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,

  -- The full Report document, as JSON text.
  payload        TEXT,
  -- Capped chunk set so repository chat survives a restart.
  chunks         TEXT,

  error_code     TEXT,
  error_message  TEXT,

  created_at     TEXT NOT NULL,
  completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_analyses_created
  ON analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_repo
  ON analyses (repo_full_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_status
  ON analyses (status);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  engine      TEXT,
  intent      TEXT,
  sources     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_analysis
  ON chat_messages (analysis_id, created_at);
`;

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

const globalRef = globalThis as unknown as { __harynDb?: DatabaseSync };

/** Synchronous sleep — SQLite contention is brief, so a short backoff suffices. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Pragmas that must never prevent the app from booting. */
function safeExec(database: DatabaseSync, sql: string): void {
  try {
    database.exec(sql);
  } catch {
    /* non-fatal: a pragma is a tuning hint, not a requirement */
  }
}

/**
 * Apply the schema, retrying on lock contention.
 *
 * `next build` collects page data in parallel worker processes, so several
 * processes can initialise the database at the same instant. `CREATE TABLE IF
 * NOT EXISTS` is idempotent, but concurrent DDL still needs to win a write lock.
 */
function applySchema(database: DatabaseSync): void {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      database.exec(SCHEMA);
      return;
    } catch (err) {
      if (attempt === 5) throw err;
      sleepSync(40 * (attempt + 1));
    }
  }
}

function openDatabase(): DatabaseSync {
  const file =
    process.env.DATABASE_FILE ?? join(process.cwd(), "data", "haryn.db");

  mkdirSync(dirname(file), { recursive: true });

  const database = new DatabaseSync(file);

  // busy_timeout MUST come first. Switching to WAL needs a brief exclusive
  // lock, and without a timeout a concurrent opener fails with SQLITE_BUSY.
  safeExec(database, "PRAGMA busy_timeout = 10000;");
  // WAL keeps reads from blocking on writes — important because the report page
  // reads while an analysis may be writing. It is an optimisation, not a
  // requirement, so a failure here must not be fatal.
  safeExec(database, "PRAGMA journal_mode = WAL;");
  safeExec(database, "PRAGMA foreign_keys = ON;");

  applySchema(database);

  return database;
}

/**
 * Lazily-opened, process-wide singleton.
 *
 * Lazy on purpose: importing this module must not open a database handle.
 * Next.js imports route modules during the build's page-data collection, and
 * eagerly connecting there means build workers fight over the file.
 *
 * Cached on `globalThis` because Next.js hot-reloads modules in development
 * and would otherwise open a new handle on every edit.
 */
export function getDb(): DatabaseSync {
  if (globalRef.__harynDb) return globalRef.__harynDb;
  const opened = openDatabase();
  globalRef.__harynDb = opened;
  return opened;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Tolerant JSON reader.
 *
 * SQLite hands JSON columns back as strings. A future Postgres driver would
 * hand back parsed objects. Accept both rather than assuming — never
 * `JSON.parse(String(value))`, which throws the moment a driver returns an
 * object.
 */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") return value as T;
  return fallback;
}

/** Serialise a value for storage in a JSON column. */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** SQLite returns numbers as `number | bigint`; normalise for arithmetic. */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
