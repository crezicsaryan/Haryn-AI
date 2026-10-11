/**
 * Minimal in-memory, per-IP fixed-window rate limiter (TRD §34).
 * V1 has no auth, so this is the only abuse control on the analysis endpoint.
 * A production deployment would back this with Redis.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const globalRef = globalThis as unknown as { __harynBuckets?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  if (!globalRef.__harynBuckets) globalRef.__harynBuckets = new Map();
  return globalRef.__harynBuckets;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const map = buckets();
  const existing = map.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    map.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, limit };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt, limit };
  }

  existing.count++;
  return {
    ok: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    limit,
  };
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

export const RATE_LIMITS = {
  analyze: Number(process.env.RATE_LIMIT_ANALYSIS ?? 10),
  chat: Number(process.env.RATE_LIMIT_CHAT ?? 60),
  windowMs: 60 * 60 * 1000,
};
