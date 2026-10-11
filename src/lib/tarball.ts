import { gunzipSync } from "node:zlib";
import { GitHubError } from "./github";
import { LIMITS } from "./constants";

/**
 * Repository fetching via the GitHub tarball CDN (codeload.github.com).
 *
 * Why not the REST API?
 *  - `api.github.com` allows only 60 requests/hour for unauthenticated callers.
 *  - `codeload.github.com` is a plain CDN with no such limit, and one request
 *    returns the whole repository — every file, not a sample.
 *
 * This makes the analyzer work with zero configuration and no token, and gives
 * the analyzers full coverage instead of a heuristic subset.
 */

const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024; // compressed download cap
const MAX_UNPACKED_BYTES = 600 * 1024 * 1024; // zip-bomb guard (TRD §35)

export interface ArchiveEntry {
  /** Path relative to the repository root. */
  path: string;
  /** Decoded text content, or null for binary / oversized files. */
  content: string | null;
  /** Size in bytes as recorded in the archive. */
  bytes: number;
}

export interface Archive {
  entries: ArchiveEntry[];
  /** Total bytes of all entries. */
  totalBytes: number;
  /** Root directory prefix stripped from every path. */
  root: string;
}

/* ------------------------------------------------------------------ */
/* tar parsing (ustar / GNU / pax)                                     */
/* ------------------------------------------------------------------ */

function readStr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

/** Parse a POSIX tar archive into entries. */
function parseTar(buf: Buffer): { path: string; data: Buffer; bytes: number }[] {
  const out: { path: string; data: Buffer; bytes: number }[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let guard = 0;

  while (offset + 512 <= buf.length) {
    if (++guard > 200_000) break; // hard stop on malformed input

    const header = buf.subarray(offset, offset + 512);
    // Two consecutive zero blocks terminate the archive.
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const name = readStr(header, 0, 100);
    const prefix = readStr(header, 345, 155);
    const sizeOctal = readStr(header, 124, 12).trim();
    const size = parseInt(sizeOctal, 8);
    const typeflag = String.fromCharCode(header[156] || 48);

    if (!Number.isFinite(size) || size < 0) break;

    const dataStart = offset + 512;
    const padded = Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      // GNU long name — the real path lives in this block's data.
      longName = buf.subarray(dataStart, dataStart + size).toString("utf8").replace(/\0+$/, "");
    } else if (typeflag === "x" || typeflag === "g") {
      // pax extended header — may carry an over-long path.
      const text = buf.subarray(dataStart, dataStart + size).toString("utf8");
      const m = /(?:^|\n)\d+\s+path=([^\n]+)/.exec(text);
      if (m) paxPath = m[1];
    } else if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
      const full = longName ?? paxPath ?? (prefix ? `${prefix}/${name}` : name);
      out.push({ path: full, data: buf.subarray(dataStart, dataStart + size), bytes: size });
      longName = null;
      paxPath = null;
    } else {
      // Directories ('5'), symlinks ('2'), devices — nothing to analyse.
      longName = null;
      paxPath = null;
    }

    offset = dataStart + padded;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Binary / text detection                                             */
/* ------------------------------------------------------------------ */

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "webm", "wav", "ogg", "flac",
  "zip", "tar", "gz", "bz2", "7z", "rar", "jar", "war",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "pyc", "pyo",
  "sqlite", "db", "dat", "wasm", "snap", "lockb", "pdf",
]);

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

function looksBinary(data: Buffer, ext: string): boolean {
  if (BINARY_EXT.has(ext)) return true;
  const probe = Math.min(data.length, 1024);
  for (let i = 0; i < probe; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

/**
 * Download and unpack a repository archive.
 * `ref` may be a branch, tag, commit SHA, or "HEAD" for the default branch.
 *
 * The body is streamed rather than buffered by `res.arrayBuffer()` so that
 * progress can be reported while a large repository downloads, and so the
 * download can be abandoned as soon as it exceeds the size limit.
 */
export async function fetchRepoArchive(
  owner: string,
  name: string,
  ref = "HEAD",
  maxFileBytes = 1024 * 1024,
  onProgress?: (received: number, total: number | null) => void
): Promise<Archive> {
  const url = `https://codeload.github.com/${owner}/${name}/tar.gz/${encodeURIComponent(
    ref || "HEAD"
  )}`;

  const timeoutMs = LIMITS.archiveTimeoutSeconds * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Haryn-AI/1.0 (+codebase-analyzer)", Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (isAbort(err)) {
      throw new GitHubError(
        "ANALYSIS_TIMEOUT",
        `Downloading this repository took longer than ${LIMITS.archiveTimeoutSeconds} seconds. It is likely very large — try a smaller repository.`
      );
    }
    throw new GitHubError(
      "ANALYSIS_FAILED",
      "Could not reach GitHub to download the repository. Check your connection and try again."
    );
  }

  if (res.status === 404) {
    clearTimeout(timer);
    throw new GitHubError(
      "REPOSITORY_NOT_FOUND",
      "Repository could not be found or is not publicly accessible. Check the owner and repository name."
    );
  }
  if (res.status === 401 || res.status === 403) {
    clearTimeout(timer);
    throw new GitHubError(
      "PRIVATE_REPOSITORY",
      "This repository appears to be private. Haryn AI currently supports public repositories only."
    );
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new GitHubError(
      "ANALYSIS_FAILED",
      `GitHub returned an unexpected response (${res.status}) while downloading the repository.`
    );
  }

  const declaredHeader = Number(res.headers.get("content-length") ?? 0);
  const declared = Number.isFinite(declaredHeader) ? declaredHeader : 0;

  if (declared > MAX_ARCHIVE_BYTES) {
    clearTimeout(timer);
    throw new GitHubError(
      "REPOSITORY_TOO_LARGE",
      `This repository archive is ${(declared / 1024 / 1024).toFixed(0)} MB, which exceeds the ${(MAX_ARCHIVE_BYTES / 1024 / 1024).toFixed(0)} MB analysis limit. Try a smaller repository.`
    );
  }

  /* --- Stream the body, enforcing the size cap as we go --------------- */
  let compressed: Buffer;
  try {
    compressed = await readBody(res, declared, onProgress);
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GitHubError) throw err;
    if (isAbort(err)) {
      throw new GitHubError(
        "ANALYSIS_TIMEOUT",
        `Downloading this repository took longer than ${LIMITS.archiveTimeoutSeconds} seconds. It is likely very large — try a smaller repository.`
      );
    }
    throw new GitHubError(
      "ANALYSIS_FAILED",
      "The repository download was interrupted. Please try again."
    );
  } finally {
    clearTimeout(timer);
  }

  let raw: Buffer;
  try {
    raw = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new GitHubError(
      "REPOSITORY_TOO_LARGE",
      "This repository is too large to unpack within the analysis limit. Try a smaller repository."
    );
  }

  const parsed = parseTar(raw);
  if (!parsed.length) {
    throw new GitHubError(
      "ANALYSIS_FAILED",
      "The repository archive could not be read. It may be empty or use an unsupported format."
    );
  }

  // Strip the single top-level directory GitHub wraps every archive in.
  const root = parsed[0].path.split("/")[0] ?? "";

  const entries: ArchiveEntry[] = [];
  let totalBytes = 0;

  for (const p of parsed) {
    let path = p.path;
    if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
    if (!path) continue;

    totalBytes += p.bytes;
    const ext = extensionOf(path);
    const binary = looksBinary(p.data, ext);
    const content =
      binary || p.bytes > maxFileBytes ? null : p.data.toString("utf8");

    entries.push({ path, content, bytes: p.bytes });
  }

  return { entries, totalBytes, root };
}

/* ------------------------------------------------------------------ */
/* Streaming helpers                                                   */
/* ------------------------------------------------------------------ */

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * Read the response body into a buffer, reporting progress and aborting early
 * if the archive exceeds the size cap.
 */
async function readBody(
  res: Response,
  declared: number,
  onProgress?: (received: number, total: number | null) => void
): Promise<Buffer> {
  const total = declared > 0 ? declared : null;

  // No streaming body available (unusual, but possible) — fall back.
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ARCHIVE_BYTES) {
      throw new GitHubError(
        "REPOSITORY_TOO_LARGE",
        "This repository archive exceeds the analysis size limit. Try a smaller repository."
      );
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  let lastReported = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new GitHubError(
        "REPOSITORY_TOO_LARGE",
        `This repository archive exceeds the ${(MAX_ARCHIVE_BYTES / 1024 / 1024).toFixed(0)} MB analysis limit. Try a smaller repository.`
      );
    }

    chunks.push(Buffer.from(value));

    // Report at most ~every 2 MB, so the UI updates without flooding the stream.
    if (onProgress && received - lastReported > 2 * 1024 * 1024) {
      lastReported = received;
      onProgress(received, total);
    }
  }

  onProgress?.(received, total);
  return Buffer.concat(chunks, received);
}
