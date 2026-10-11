/**
 * Haryn AI — shared domain model.
 * Mirrors the standard Finding schema from the TRD (§14) so every analyzer
 * emits a consistent shape and the report layer never special-cases a source.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "security"
  | "bugs"
  | "quality"
  | "performance"
  | "testing"
  | "dependency"
  | "architecture"
  | "documentation";

export type FindingSource = "static-analysis" | "dependency-scanner" | "ai";

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  evidence?: string;
  impact?: string;
  recommendation: string;
  /** 0..1 — how sure the analyzer is. Heuristic findings stay below 1. */
  confidence: number;
  source: FindingSource;
  /** True when the finding is a heuristic signal, not a proven defect. */
  isPotential?: boolean;
}

export interface RepoMeta {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  license: string | null;
  sizeKb: number;
  createdAt: string;
  pushedAt: string;
  homepage: string | null;
  topics: string[];
  archived: boolean;
  isFork: boolean;
  /**
   * True when repository metadata was derived from the archive rather than the
   * GitHub API (stars/forks/dates are then unknown rather than zero).
   */
  metaPartial?: boolean;
}

export interface LanguageStat {
  name: string;
  bytes: number;
  percent: number;
  color: string;
}

export interface RepoStructure {
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  sizeClass: "Small" | "Medium" | "Large" | "Very large";
  topLevelDirs: string[];
  extensionCounts: Record<string, number>;
  truncated: boolean;
}

export interface CategoryScore {
  category: Category;
  label: string;
  score: number;
  weight: number;
  issueCount: number;
}

/* ------------------------------------------------------------------ */
/* Repository activity (commit history)                                */
/* ------------------------------------------------------------------ */

export interface CommitWeek {
  /** ISO date of the week's start. */
  week: string;
  /** Commits in that week. */
  total: number;
  /** Per-day counts, Sunday → Saturday. */
  days: number[];
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  contributions: number;
  url: string;
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  /** Subject line (first line of the commit message). */
  message: string;
  /** Remaining lines of the commit message, when present. */
  body?: string;
  author: string;
  date: string;
  /** Conventional-commit type, or a derived bucket (feat / fix / merge / deps / other). */
  type: string;
}

/** Per-author summary across the fetched commit history. */
export interface CommitAuthorStat {
  login: string;
  commits: number;
  /** 0..1 share of the fetched commits. */
  share: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
}

/** Commits in one calendar month. */
export interface CommitMonthBucket {
  /** `YYYY-MM` */
  month: string;
  /** Short label for axes, e.g. "Aug". */
  label: string;
  total: number;
}

/** How commit messages are categorised. */
export interface CommitTypeStat {
  type: string;
  count: number;
  share: number;
}

export interface CommitMessageStats {
  /** How many commits were inspected. */
  scanned: number;
  /** How many carried a body beyond the subject line. */
  withBody: number;
  avgSubjectLength: number;
  longestSubject: string;
}

export interface RepoActivity {
  /** Total commits on the default branch, read from the pagination header. */
  totalCommits: number;
  /** Up to 52 weeks of commit counts. */
  weeklyCommits: CommitWeek[];
  contributors: Contributor[];
  /** Up to 100 most recent commits, newest first. */
  recentCommits: RecentCommit[];
  /** Commits per calendar month over the fetched history. */
  months: CommitMonthBucket[];
  authorStats: CommitAuthorStat[];
  messageTypes: CommitTypeStat[];
  messageStats: CommitMessageStats;
  lastCommitAt: string | null;
  /** Commits in the trailing 4 weeks vs the preceding 4 — momentum signal. */
  recentMonthly: number;
  priorMonthly: number;
  /**
   * True when GitHub could not supply history (still computing stats, or the
   * API was rate-limited). The report shows what it has and says so.
   */
  partial: boolean;
  /** Why activity is partial, when it is. */
  notice?: string;
}

export type DependencyStatus =
  | "healthy"
  | "outdated"
  | "vulnerable"
  | "unused"
  | "unknown";

export interface DependencyVuln {
  id: string;
  summary: string;
  severity?: string;
}

export interface DependencyItem {
  name: string;
  version: string;
  ecosystem: string;
  status: DependencyStatus;
  type?: string;
  vulns?: DependencyVuln[];
}

export interface DependencyAnalysis {
  stat: {
    total: number;
    healthy: number;
    outdated: number;
    vulnerable: number;
    unused: number;
    unknown: number;
  };
  items: DependencyItem[];
  manifests: string[];
}

export interface TestingAnalysis {
  testFiles: number;
  sourceFiles: number;
  ratio: number;
  frameworks: string[];
  hasTestDir: boolean;
  criticalUncovered: string[];
  /** Areas inferred to be under-tested, with a confidence tag. */
  areas: { name: string; status: "ok" | "warn" | "risk"; note: string }[];
}

export interface ArchNode {
  id: string;
  label: string;
  type: string;
  detail?: string;
  files?: number;
  accent?: string;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Architecture {
  nodes: ArchNode[];
  edges: ArchEdge[];
  layers: string[];
  summary: string;
}

export interface Recommendation {
  rank: number;
  severity: Severity;
  title: string;
  category: Category;
  findingId?: string;
  filePath?: string;
}

export interface Report {
  id: string;
  createdAt: string;
  completedAt: string;
  durationMs: number;
  repo: RepoMeta;
  languages: LanguageStat[];
  structure: RepoStructure;
  healthScore: number;
  scores: CategoryScore[];
  findings: Finding[];
  dependencies: DependencyAnalysis;
  testing: TestingAnalysis;
  architecture: Architecture;
  /** Commit history. Optional — the GitHub API may be unavailable. */
  activity?: RepoActivity;
  recommendations: Recommendation[];
  summary: string;
  /** Which engine produced the narrative summary. */
  summaryEngine?: "llm" | "retrieval";
  /** False when AI explanation could not run — deterministic results still valid. */
  aiAvailable: boolean;
  aiNotice?: string;
  stats: {
    filesAnalyzed: number;
    bytesAnalyzed: number;
    apiCalls: number;
    sourceFilesSampled: number;
    /** Chunks in the retrieval index for this repository. */
    indexedChunks?: number;
  };
}

export type Stage =
  | "queued"
  | "validating"
  | "fetching"
  | "discovering"
  | "languages"
  | "security"
  | "bugs"
  | "quality"
  | "dependencies"
  | "testing"
  | "performance"
  | "architecture"
  | "scoring"
  | "ai"
  | "completed"
  | "failed";

export interface ProgressEvent {
  type: "progress";
  stage: Stage;
  label: string;
  status: "active" | "done" | "pending";
  pct: number;
}

export interface ResultEvent {
  type: "result";
  report: Report;
}

export interface ErrorEvent {
  type: "error";
  code: ErrorCode;
  message: string;
}

export type StreamEvent = ProgressEvent | ResultEvent | ErrorEvent;

export type ErrorCode =
  | "INVALID_URL"
  | "REPOSITORY_NOT_FOUND"
  | "PRIVATE_REPOSITORY"
  | "REPOSITORY_TOO_LARGE"
  | "ANALYSIS_TIMEOUT"
  | "ANALYSIS_FAILED"
  | "AI_SERVICE_ERROR"
  | "RATE_LIMITED";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}
