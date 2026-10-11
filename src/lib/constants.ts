import type { Category, Severity } from "./types";

export interface SeverityMeta {
  key: Severity;
  label: string;
  /** Tailwind text color class */
  text: string;
  /** Tailwind background tint class */
  soft: string;
  /** Raw hex for charts / SVG */
  hex: string;
  /** Raw hex for soft background */
  hexSoft: string;
  /** Sort order, most severe first */
  order: number;
}

export const SEVERITIES: Record<Severity, SeverityMeta> = {
  critical: {
    key: "critical",
    label: "Critical",
    text: "text-crit",
    soft: "bg-crit-soft",
    hex: "#e5484d",
    hexSoft: "#fdecec",
    order: 0,
  },
  high: {
    key: "high",
    label: "High",
    text: "text-high",
    soft: "bg-high-soft",
    hex: "#f76808",
    hexSoft: "#fdf0e6",
    order: 1,
  },
  medium: {
    key: "medium",
    label: "Medium",
    text: "text-med",
    soft: "bg-med-soft",
    hex: "#f5a524",
    hexSoft: "#fdf5e3",
    order: 2,
  },
  low: {
    key: "low",
    label: "Low",
    text: "text-low",
    soft: "bg-low-soft",
    hex: "#0ea5e9",
    hexSoft: "#e8f4fd",
    order: 3,
  },
  info: {
    key: "info",
    label: "Info",
    text: "text-info",
    soft: "bg-info-soft",
    hex: "#7e868c",
    hexSoft: "#f1f3f5",
    order: 4,
  },
};

export const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export interface CategoryMeta {
  key: Category;
  label: string;
  short: string;
  hex: string;
  description: string;
}

export const CATEGORIES: Record<Category, CategoryMeta> = {
  security: {
    key: "security",
    label: "Security",
    short: "Security",
    hex: "#e5484d",
    description: "Secrets, injection risk, unsafe configuration",
  },
  bugs: {
    key: "bugs",
    label: "Bugs",
    short: "Bugs",
    hex: "#c026d3",
    description: "Constructs that behave incorrectly at runtime",
  },
  quality: {
    key: "quality",
    label: "Code Quality",
    short: "Quality",
    hex: "#14b8a6",
    description: "Complexity, duplication, dead code, smells",
  },
  performance: {
    key: "performance",
    label: "Performance",
    short: "Perf",
    hex: "#06b6d4",
    description: "N+1 queries, blocking calls, heavy loops",
  },
  testing: {
    key: "testing",
    label: "Testing",
    short: "Testing",
    hex: "#f5a524",
    description: "Coverage gaps and missing test suites",
  },
  dependency: {
    key: "dependency",
    label: "Dependencies",
    short: "Deps",
    hex: "#8b5cf6",
    description: "Outdated and vulnerable packages",
  },
  architecture: {
    key: "architecture",
    label: "Architecture",
    short: "Arch",
    hex: "#0ea5e9",
    description: "Layering, coupling and structure",
  },
  documentation: {
    key: "documentation",
    label: "Documentation",
    short: "Docs",
    hex: "#64748b",
    description: "README, comments and discoverability",
  },
};

/** Health-score weights — must sum to 1 (TRD §26). */
export const SCORE_WEIGHTS: Record<Category, number> = {
  // Correctness and security carry the most weight: a bug or a leaked secret
  // matters more than untidy code.
  bugs: 0.15,
  security: 0.18,
  quality: 0.15,
  architecture: 0.12,
  performance: 0.12,
  testing: 0.13,
  dependency: 0.1,
  documentation: 0.05,
};

/** Deterministic penalty applied per finding when scoring a category. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 22,
  high: 11,
  medium: 4.5,
  low: 1.6,
  info: 0.4,
};

/** GitHub language colors (subset — falls back to a hash tint). */
export const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Shell: "#89e051",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Lua: "#000080",
  Scala: "#c22d40",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  R: "#198CE7",
  Perl: "#0298c3",
  Clojure: "#db5855",
  Objective_C: "#438eff",
  Zig: "#ec915c",
};

const FALLBACK_LANG_COLORS = [
  "#14b8a6",
  "#06b6d4",
  "#8b5cf6",
  "#f5a524",
  "#e5484d",
  "#0ea5e9",
];

export function languageColor(name: string): string {
  if (LANGUAGE_COLORS[name]) return LANGUAGE_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_LANG_COLORS[h % FALLBACK_LANG_COLORS.length];
}

export const SUPPORTED_LANGUAGES = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C++",
  "Go",
  "Rust",
  "C#",
  "PHP",
  "Ruby",
  "Kotlin",
  "Swift",
];

export const EXAMPLE_REPOS = [
  { label: "expressjs/express", url: "https://github.com/expressjs/express" },
  { label: "sindresorhus/got", url: "https://github.com/sindresorhus/got" },
  { label: "psf/requests", url: "https://github.com/psf/requests" },
  { label: "tiangolo/fastapi", url: "https://github.com/tiangolo/fastapi" },
];

/** Analysis limits (TRD §10/§33) — mirrored from env with sane defaults. */
export const LIMITS = {
  maxRepoSizeMb: Number(process.env.MAX_REPOSITORY_SIZE_MB ?? 250),
  maxFiles: Number(process.env.MAX_FILES ?? 10000),
  maxFileSizeKb: Number(process.env.MAX_FILE_SIZE_MB ?? 1) * 1024,
  timeoutSeconds: Number(process.env.ANALYSIS_TIMEOUT_SECONDS ?? 600),
  /**
   * Wall-clock budget for downloading the repository archive.
   *
   * Sized from measurement, not guesswork: a large public repository
   * (amzn/selling-partner-api-samples) is an 89 MB tarball that takes ~39 s on a
   * good connection. A 60 s budget aborts it the moment the link is a little
   * slower, so the default is deliberately generous.
   */
  archiveTimeoutSeconds: Number(process.env.ARCHIVE_TIMEOUT_SECONDS ?? 180),
  /**
   * How many text files are passed to the content analyzers.
   *
   * Deliberately generous. An earlier value of 800 silently capped coverage on
   * large repositories — a 3,509-file repo had only 800 files scanned, so most
   * of it was never looked at. Regex analysis is cheap; the previous limit was
   * protecting against a cost that does not exist.
   */
  analyzedFiles: Number(process.env.ANALYZED_FILES ?? 3000),
  /** Ceiling on total bytes scanned. */
  analyzedBytes: Number(process.env.ANALYZED_BYTES_MB ?? 64) * 1024 * 1024,
  /** Chunks kept in the retrieval index (also bounds memory per report). */
  indexedChunks: Number(process.env.INDEXED_CHUNKS ?? 2600),
  indexedBytes: Number(process.env.INDEXED_BYTES_MB ?? 16) * 1024 * 1024,
};

/** Pipeline stages shown in the progress view (PRD §10). */
export const PIPELINE: { stage: string; label: string }[] = [
  { stage: "fetching", label: "Repository fetched" },
  { stage: "discovering", label: "File structure analyzed" },
  { stage: "languages", label: "Languages detected" },
  { stage: "dependencies", label: "Dependencies analyzed" },
  { stage: "security", label: "Running security analysis" },
  { stage: "bugs", label: "Scanning for likely bugs" },
  { stage: "quality", label: "Running code quality analysis" },
  { stage: "performance", label: "Running performance analysis" },
  { stage: "testing", label: "Analyzing test coverage" },
  { stage: "architecture", label: "Extracting architecture" },
  { stage: "scoring", label: "Calculating health score" },
  { stage: "ai", label: "Generating AI report" },
];
