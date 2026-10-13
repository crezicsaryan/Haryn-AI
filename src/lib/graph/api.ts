import { NextResponse } from "next/server";
import type { GraphEdgeType, GraphNodeType } from "./types";

/**
 * Shared helpers for the knowledge-graph endpoints.
 *
 * Every handler returns the same error envelope as the rest of the API
 * (`{ error: { code, message } }`) so the client has one shape to handle, and
 * every response is `no-store` — graph data is derived per analysis and must
 * never be cached across reports.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json<T>(body: T, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: NO_STORE,
  });
}

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/** Reject anything that is not a plausible analysis or node id. */
export function isValidId(value: string | undefined): boolean {
  if (!value) return false;
  // Ids are `an_…` / `n_…` / `e_…` followed by a base-36 hash.
  return /^[a-z]{1,3}_[a-z0-9]{4,40}$/i.test(value);
}

export function parseCsv<T extends string>(value: string | null, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean) as T[];
  const filtered = parts.filter((p) => allowed.includes(p));
  return filtered.length ? filtered : undefined;
}

export function parseIntParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export const NODE_TYPES: readonly GraphNodeType[] = [
  "repository", "directory", "file", "function", "class", "interface",
  "api_endpoint", "db_model", "db_table", "package", "test", "env_var",
  "middleware", "controller", "service",
];

export const EDGE_TYPES: readonly GraphEdgeType[] = [
  "CONTAINS", "IMPORTS", "EXPORTS", "DEFINES", "CALLS", "EXTENDS", "IMPLEMENTS",
  "USES", "QUERIES", "READS", "WRITES", "EXPOSES_ROUTE", "TESTS", "DEPENDS_ON",
];
