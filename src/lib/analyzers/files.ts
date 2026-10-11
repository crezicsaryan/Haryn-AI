import type { TreeEntry } from "../github";
import type { LanguageStat } from "../types";
import type { SourceFile } from "./types";
import { languageColor } from "../constants";

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

const IGNORED_DIRS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".turbo/",
  ".cache/",
  "coverage/",
  "vendor/",
  "out/",
  "target/",
  "bin/",
  "obj/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "env/",
  ".idea/",
  ".vscode/",
  ".gradle/",
  "Pods/",
  "bower_components/",
  "jspm_packages/",
  ".terraform/",
  "site-packages/",
  ".pytest_cache/",
  ".mypy_cache/",
  "third_party/",
  "external/",
];

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "webm", "wav", "ogg", "flac",
  "zip", "tar", "gz", "bz2", "7z", "rar", "jar", "war",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "pyc", "pyo",
  "sqlite", "db", "dat", "wasm", "map", "lock", "snap",
]);

/** Generated / vendored / bundled artefacts we never analyse. */
const GENERATED_SUFFIXES = [
  ".min.js", ".min.css", ".bundle.js", ".chunk.js", ".d.ts",
];

/** Lock files are huge and add nothing to the analysis (we read the manifests). */
const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "poetry.lock",
  "pdm.lock",
  "packages.lock.json",
  "bun.lockb",
  "mix.lock",
  "pubspec.lock",
  "go.sum",
]);

export function isIgnoredPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (IGNORED_DIRS.some((d) => lower.startsWith(d) || lower.includes(`/${d}`))) {
    return true;
  }
  const base = lower.split("/").pop() ?? "";
  if (LOCK_FILES.has(base)) return true;
  if (GENERATED_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  const ext = extensionOf(path);
  if (ext && BINARY_EXT.has(ext)) return true;
  return false;
}

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Language detection                                                  */
/* ------------------------------------------------------------------ */

const EXT_LANGUAGE: Record<string, string> = {
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  py: "Python", pyi: "Python",
  java: "Java",
  cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++", hxx: "C++",
  c: "C", h: "C",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kt: "Kotlin", kts: "Kotlin",
  dart: "Dart",
  html: "HTML", htm: "HTML",
  css: "CSS",
  scss: "SCSS", sass: "SCSS", less: "Less",
  sh: "Shell", bash: "Shell", zsh: "Shell",
  vue: "Vue",
  svelte: "Svelte",
  ipynb: "Jupyter Notebook",
  lua: "Lua",
  scala: "Scala",
  ex: "Elixir", exs: "Elixir",
  hs: "Haskell",
  r: "R",
  pl: "Perl",
  clj: "Clojure", cljs: "Clojure",
  zig: "Zig",
  sql: "SQL",
  groovy: "Groovy",
  jl: "Julia",
  erl: "Erlang",
  fs: "F#",
  m: "Objective-C",
  mm: "Objective-C",
};

export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (/^dockerfile$/i.test(base)) return "Dockerfile";
  if (/^makefile$/i.test(base)) return "Makefile";
  const ext = extensionOf(path);
  return EXT_LANGUAGE[ext] ?? (ext ? ext.toUpperCase() : "Other");
}

/** Files whose extension marks them as analyzable source. */
export function isSourceFile(path: string): boolean {
  const lang = languageForPath(path);
  return (
    lang !== "Other" &&
    lang !== "Dockerfile" &&
    lang !== "Makefile" &&
    lang !== "SQL"
  );
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export interface ClassifiedFiles {
  sourceFiles: TreeEntry[];
  allFiles: TreeEntry[];
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  topLevelDirs: string[];
  extensionCounts: Record<string, number>;
}

export function classifyFiles(entries: TreeEntry[]): ClassifiedFiles {
  const allFiles: TreeEntry[] = [];
  const dirs = new Set<string>();
  let totalBytes = 0;
  const topLevel = new Set<string>();
  const extensionCounts: Record<string, number> = {};

  for (const e of entries) {
    const top = e.path.split("/")[0];
    if (e.type === "tree") {
      topLevel.add(top);
      continue;
    }
    if (isIgnoredPath(e.path)) continue;
    allFiles.push(e);
    totalBytes += e.size ?? 0;
    topLevel.add(top);
    const ext = extensionOf(e.path) || "(none)";
    extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;
  }

  // Derive directories from the file paths themselves. Archives (and GitHub's
  // tree API when truncated) do not always include explicit directory entries,
  // so counting tree nodes alone reports zero.
  for (const f of allFiles) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }

  const sourceFiles = allFiles.filter((f) => isSourceFile(f.path));

  return {
    sourceFiles,
    allFiles,
    fileCount: allFiles.length,
    dirCount: dirs.size,
    totalBytes,
    topLevelDirs: [...topLevel].filter(Boolean).sort(),
    extensionCounts,
  };
}

export function sizeClassFor(totalBytes: number): "Small" | "Medium" | "Large" | "Very large" {
  const mb = totalBytes / (1024 * 1024);
  if (mb < 2) return "Small";
  if (mb < 20) return "Medium";
  if (mb < 100) return "Large";
  return "Very large";
}

/* ------------------------------------------------------------------ */
/* Sampling — which files do we actually download & scan?              */
/* ------------------------------------------------------------------ */

const MANIFESTS = [
  "package.json", "requirements.txt", "pyproject.toml", "Pipfile",
  "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "Cargo.toml",
  "composer.json", "Gemfile", "setup.py", "setup.cfg",
];

const HIGH_SIGNAL_NAMES = [
  ".env", ".env.local", ".env.production", ".env.example", ".env.sample",
  "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
  "config", "configuration", "settings", "secrets", "credentials",
  "keys", "auth", "database", "db", "index", "main", "app", "server",
];

function signalScore(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  let score = 0;

  if (MANIFESTS.some((m) => base === m.toLowerCase())) score += 100;
  if (base.startsWith(".env")) score += 120;
  if (HIGH_SIGNAL_NAMES.some((n) => base.includes(n))) score += 30;
  if (/(^|\/)(src|lib|app|server|api|core|services?)\//.test(lower)) score += 18;
  // Prefer shallower files — entry points live near the root.
  const depth = path.split("/").length;
  score += Math.max(0, 12 - depth * 2);
  // Prefer mid-sized files over tiny or huge ones.
  return score;
}

/* ------------------------------------------------------------------ */
/* Selecting files for content analysis                                */
/* ------------------------------------------------------------------ */

/** Config-ish files worth scanning for secrets and unsafe settings. */
const SCANNABLE_EXT = new Set([
  "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties",
  "env", "sh", "bash", "zsh", "ps1", "bat", "sql", "tf", "tfvars",
  "xml", "gradle", "prisma", "graphql", "gql", "proto", "dockerfile",
]);

function isScannable(path: string): boolean {
  if (isSourceFile(path)) return true;
  const base = path.split("/").pop() ?? "";
  if (/^dockerfile$/i.test(base) || /^makefile$/i.test(base)) return true;
  if (base.startsWith(".env")) return true;
  const ext = extensionOf(path);
  return ext ? SCANNABLE_EXT.has(ext) : false;
}

/**
 * Rank every text file in the archive and return the set worth scanning.
 *
 * Two things matter for coverage on a large repository:
 *
 * 1. **Manifests and secrets always get scanned.** They are cheap and carry the
 *    highest-signal findings, so they are taken first regardless of budget.
 * 2. **The rest is spread across the repository, not taken from the top of one
 *    global ranking.** A monorepo like `use-cases/<name>/...` has hundreds of
 *    sibling folders; ranking globally lets a handful of high-scoring folders
 *    consume the whole budget and the other use-cases are never looked at. So
 *    files are bucketed by their first two path segments and taken round-robin.
 */
export function selectAnalyzableFiles(
  entries: { path: string; content: string | null; bytes: number }[],
  limit: number,
  byteBudget: number
): SourceFile[] {
  const candidates = entries
    .filter((e) => e.content != null && !isIgnoredPath(e.path) && isScannable(e.path))
    .map((e) => {
      const content = e.content as string;
      const base = (e.path.split("/").pop() ?? "").toLowerCase();
      let score = signalScore(e.path);
      if (base.startsWith(".env")) score += 200;
      if (/config|secret|credential|auth|key|token|database|db/.test(base)) score += 60;
      if (MANIFESTS.some((m) => base === m.toLowerCase())) score += 150;
      return { path: e.path, content, bytes: e.bytes, score };
    });

  const out: SourceFile[] = [];
  const chosen = new Set<string>();
  let bytes = 0;

  const take = (c: (typeof candidates)[number]): boolean => {
    if (chosen.has(c.path)) return false;
    if (out.length >= limit) return false;
    if (bytes + c.bytes > byteBudget) return false;
    chosen.add(c.path);
    bytes += c.bytes;
    out.push({
      path: c.path,
      content: c.content,
      lines: c.content.split(/\r?\n/),
      language: languageForPath(c.path),
      bytes: c.bytes,
    });
    return true;
  };

  /* 1 — Manifests, env files and config first. */
  const priority = candidates
    .filter((c) => c.score >= 150)
    .sort((a, b) => b.score - a.score);
  for (const c of priority) take(c);

  /* 2 — Everything else, spread across repository areas. */
  const buckets = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (chosen.has(c.path)) continue;
    const parts = c.path.split("/");
    const key =
      parts.length > 2
        ? `${parts[0]}/${parts[1]}`
        : parts.length > 1
          ? parts[0]
          : "(root)";
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  const queues = [...buckets.values()].map((list) =>
    list.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  );

  let exhausted = false;
  while (!exhausted && out.length < limit) {
    exhausted = true;
    for (const queue of queues) {
      if (!queue.length) continue;
      exhausted = false;
      // Walk the queue until one file fits the remaining byte budget.
      while (queue.length) {
        const next = queue.shift()!;
        if (take(next)) break;
      }
      if (out.length >= limit) break;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Language stats fallback (when the API returns nothing)              */
/* ------------------------------------------------------------------ */

export function languagesFromExtensions(
  files: TreeEntry[]
): LanguageStat[] {
  const bytes = new Map<string, number>();
  for (const f of files) {
    const lang = languageForPath(f.path);
    if (lang === "Other") continue;
    bytes.set(lang, (bytes.get(lang) ?? 0) + (f.size ?? 1));
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
  return [...bytes.entries()]
    .map(([name, b]) => ({
      name,
      bytes: b,
      percent: (b / total) * 100,
      color: languageColor(name),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}

export function languagesFromApi(
  languages: Record<string, number>
): LanguageStat[] {
  const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(languages)
    .map(([name, b]) => ({
      name,
      bytes: b,
      percent: (b / total) * 100,
      color: languageColor(name),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
}
