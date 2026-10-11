import type { SourceFile } from "../analyzers/types";
import { hashString } from "../utils";
import { LIMITS } from "../constants";

/**
 * Semantic chunker for retrieval.
 *
 * Chunks follow declaration boundaries (functions, classes, methods, Python
 * defs) rather than fixed line windows, because a question about
 * "how does authentication work" should retrieve whole units of behaviour —
 * not an arbitrary 40-line slice that cuts a function in half.
 *
 * Lines outside any declaration (module setup, config, JSX trees, JSON) fall
 * back to overlapping windows so nothing is unsearchable.
 */

export interface Chunk {
  id: string;
  path: string;
  language: string;
  /** Best-guess symbol name, used to boost exact-name matches. */
  symbol: string | null;
  kind: "function" | "class" | "method" | "block" | "file";
  startLine: number;
  endLine: number;
  text: string;
  imports: string[];
  bytes: number;
}

const TARGET_LINES = 60;
const MAX_BLOCK_LINES = 140;
const OVERLAP = 10;

const BRACE_LANGS = new Set([
  "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go",
  "Rust", "PHP", "Kotlin", "Swift", "Dart", "Scala",
]);

/* ------------------------------------------------------------------ */
/* Declaration detection                                               */
/* ------------------------------------------------------------------ */

interface Decl {
  name: string;
  kind: Chunk["kind"];
}

const BRACE_DECLS: { re: RegExp; kind: Chunk["kind"] }[] = [
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
  },
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/,
    kind: "function",
  },
  { re: /^\s*func\s+\([^)]*\)\s*([A-Za-z_$][\w$]*)\s*\(/, kind: "method" },
  { re: /^\s*func\s+([A-Za-z_$][\w$]*)\s*\(/, kind: "function" },
  {
    re: /^\s*(?:export\s+)?(?:public|private|protected|static|async|final|override|virtual|synchronized|\s)*[A-Za-z_$][\w$<>[\],.|?\s]*\s+([A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?::[^{;]+)?\s*\{/,
    kind: "method",
  },
];

const PY_DECL = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;

function detectDecl(line: string, python: boolean): Decl | null {
  if (python) {
    const m = PY_DECL.exec(line);
    if (m) {
      return {
        name: m[1],
        kind: /^\s*class\b/.test(line) ? "class" : "function",
      };
    }
    return null;
  }
  for (const d of BRACE_DECLS) {
    const m = d.re.exec(line);
    if (m?.[1] && !["if", "for", "while", "switch", "catch", "return"].includes(m[1])) {
      return { name: m[1], kind: d.kind };
    }
  }
  return null;
}

function braceBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let started = false;
  for (let i = start; i < lines.length && i < start + 600; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (started && depth <= 0) return i;
  }
  return -1;
}

function pythonBlockEnd(lines: string[], start: number): number {
  const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  let end = start;
  for (let i = start + 1; i < lines.length && i < start + 600; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const ind = l.match(/^\s*/)?.[0].length ?? 0;
    if (ind <= indent) break;
    end = i;
  }
  return end;
}

/* ------------------------------------------------------------------ */
/* Imports                                                             */
/* ------------------------------------------------------------------ */

function extractImports(file: SourceFile): string[] {
  const out = new Set<string>();
  for (const line of file.lines) {
    let m: RegExpExecArray | null;
    if ((m = /\bfrom\s+["'`]([^"'`]+)["'`]/.exec(line))) out.add(m[1]);
    else if ((m = /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/.exec(line))) out.add(m[1]);
    else if ((m = /^\s*import\s+["'`]([^"'`]+)["'`]/.exec(line))) out.add(m[1]);
    else if ((m = /^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/.exec(line))) out.add(m[1]);
    if (out.size > 80) break;
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Chunk construction                                                  */
/* ------------------------------------------------------------------ */

function makeChunk(
  file: SourceFile,
  start: number,
  end: number,
  symbol: string | null,
  kind: Chunk["kind"],
  imports: string[]
): Chunk {
  const text = file.lines.slice(start, end + 1).join("\n");
  return {
    id: `c_${hashString(`${file.path}:${start}:${end}`)}`,
    path: file.path,
    language: file.language,
    symbol,
    kind,
    startLine: start + 1,
    endLine: end + 1,
    text,
    imports,
    bytes: text.length,
  };
}

/** Split a file into retrievable chunks. */
export function chunkFile(file: SourceFile, maxChunks = 40): Chunk[] {
  const lines = file.lines;
  if (!lines.length || !file.content.trim()) return [];

  const imports = extractImports(file);
  const isPython = file.language === "Python";
  const isBrace = BRACE_LANGS.has(file.language);
  const canParse = isPython || isBrace;

  const chunks: Chunk[] = [];
  const covered = new Array<boolean>(lines.length).fill(false);

  /* 1 — Declaration-aligned chunks */
  if (canParse) {
    let i = 0;
    while (i < lines.length) {
      const decl = detectDecl(lines[i], isPython);
      if (!decl) {
        i++;
        continue;
      }
      const end = isPython ? pythonBlockEnd(lines, i) : braceBlockEnd(lines, i);
      if (end <= i) {
        i++;
        continue;
      }

      const len = end - i + 1;
      if (len <= MAX_BLOCK_LINES) {
        chunks.push(makeChunk(file, i, end, decl.name, decl.kind, imports));
      } else {
        for (let s = i; s <= end; s += MAX_BLOCK_LINES - OVERLAP) {
          const e = Math.min(end, s + MAX_BLOCK_LINES - 1);
          chunks.push(makeChunk(file, s, e, decl.name, decl.kind, imports));
          if (e >= end) break;
        }
      }

      for (let k = i; k <= end; k++) covered[k] = true;
      i = end + 1;
    }
  }

  /* 2 — Windowed chunks for everything else */
  let runStart = -1;
  const flushRun = (endExclusive: number) => {
    if (runStart === -1) return;
    const from = runStart;
    const to = endExclusive - 1;
    if (to - from + 1 < 6) {
      runStart = -1;
      return;
    }
    for (let s = from; s <= to; s += TARGET_LINES - OVERLAP) {
      const e = Math.min(to, s + TARGET_LINES - 1);
      const text = lines.slice(s, e + 1).join("\n");
      // Skip runs that are pure whitespace / braces.
      if (text.replace(/[\s{}()[\];,]/g, "").length < 40) break;
      chunks.push(makeChunk(file, s, e, null, "block", imports));
      if (e >= to) break;
    }
    runStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    if (!covered[i]) {
      if (runStart === -1) runStart = i;
    } else {
      flushRun(i);
    }
  }
  flushRun(lines.length);

  /* 3 — Nothing matched: treat the whole file as one chunk */
  if (!chunks.length && lines.length) {
    chunks.push(
      makeChunk(file, 0, Math.min(lines.length - 1, 200), null, "file", imports)
    );
  }

  return chunks.slice(0, maxChunks);
}

export interface ChunkOptions {
  /** Cap on chunks indexed per file. */
  maxChunksPerFile?: number;
  /** Overall cap on chunks, highest-signal files first (input order is kept). */
  maxChunks?: number;
  /** Overall cap on indexed bytes. */
  maxBytes?: number;
}

/** Chunk a set of already-ranked files, respecting global caps. */
export function chunkFiles(files: SourceFile[], opts: ChunkOptions = {}): Chunk[] {
  const {
    maxChunksPerFile = 40,
    maxChunks = LIMITS.indexedChunks,
    maxBytes = LIMITS.indexedBytes,
  } = opts;

  const out: Chunk[] = [];
  let bytes = 0;

  for (const file of files) {
    if (out.length >= maxChunks || bytes >= maxBytes) break;
    for (const c of chunkFile(file, maxChunksPerFile)) {
      if (out.length >= maxChunks || bytes + c.bytes > maxBytes) break;
      bytes += c.bytes;
      out.push(c);
    }
  }

  return out;
}
