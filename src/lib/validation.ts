import type { ErrorCode } from "./types";

export interface ParsedRepo {
  owner: string;
  name: string;
  /** Canonical https://github.com/owner/name */
  url: string;
  /** Optional branch/ref found in a /tree/<ref> URL. */
  ref?: string;
}

export type ValidationResult =
  | { ok: true; repo: ParsedRepo }
  | { ok: false; code: ErrorCode; message: string };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Only the canonical GitHub host is ever allowed — blocks SSRF (TRD §35). */
const ALLOWED_HOSTS = new Set([
  "github.com",
  "www.github.com",
]);

/**
 * Validate and normalise a user-supplied GitHub repository URL.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main
 *   github.com/owner/repo
 *   owner/repo
 * Rejects everything else (non-GitHub hosts, IPs, ports, credentials, paths).
 */
export function parseGitHubUrl(input: string): ValidationResult {
  const raw = (input ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }

  // Bare "owner/repo" shorthand.
  let candidate = raw;
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(raw)) {
    candidate = `https://github.com/${raw}`;
  } else if (!/^https?:\/\//i.test(raw)) {
    candidate = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }

  // Reject credentials-in-URL, custom ports and non-GitHub hosts (SSRF guard).
  if (url.username || url.password) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }
  if (url.port && url.port !== "443" && url.port !== "80") {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return {
      ok: false,
      code: "INVALID_URL",
      message:
        "That doesn't look like a GitHub URL. Please enter a link such as https://github.com/owner/repo.",
    };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return {
      ok: false,
      code: "INVALID_URL",
      message:
        "Please include both the owner and repository name, e.g. https://github.com/owner/repo.",
    };
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");

  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }

  // Reserved GitHub paths that are not repositories.
  const RESERVED = new Set([
    "settings",
    "notifications",
    "explore",
    "marketplace",
    "sponsors",
    "topics",
    "collections",
    "trending",
    "features",
    "about",
    "pricing",
    "login",
    "signup",
    "orgs",
    "apps",
  ]);
  if (RESERVED.has(owner.toLowerCase())) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Please enter a valid public GitHub repository URL.",
    };
  }

  let ref: string | undefined;
  if (segments[2] === "tree" && segments[3]) {
    ref = decodeURIComponent(segments.slice(3).join("/"));
  }

  return {
    ok: true,
    repo: {
      owner,
      name,
      ref,
      url: `https://github.com/${owner}/${name}`,
    },
  };
}

/** Cheap client-side pre-check so the button can enable/disable live. */
export function looksLikeGitHubUrl(input: string): boolean {
  const v = (input ?? "").trim();
  if (!v) return false;
  return /^(https?:\/\/)?(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(v) ||
    /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v);
}
