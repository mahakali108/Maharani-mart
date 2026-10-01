import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/mobile/http';

/**
 * Per-caller rate limiting for the mobile API (contract §1.6).
 *
 * HONEST LIMITATION — read before relying on this: the bucket lives in the
 * process memory of a single serverless instance. On Vercel that means the
 * limit is per-instance, not global: a burst spread across many cold instances
 * can exceed the numbers below. It is a cheap abuse/tight-loop guard, NOT a
 * security boundary (authentication still happens on every request, and login
 * attempts keep returning generic errors so nothing can be enumerated).
 *
 * A distributed limiter (Upstash Redis or a Postgres-backed bucket) is tracked
 * as a follow-up in the migration plan; until then this must not be described
 * to anyone as a hard global guarantee.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  'auth.login': { limit: 10, windowMs: 5 * 60_000 },
  'auth.refresh': { limit: 60, windowMs: 60 * 60_000 },
  'auth.password_reset': { limit: 5, windowMs: 60 * 60_000 },
  'read.catalog': { limit: 120, windowMs: 60_000 },
  'read.orders': { limit: 120, windowMs: 60_000 },
  'write.cart': { limit: 60, windowMs: 60_000 },
  'write.orders': { limit: 20, windowMs: 5 * 60_000 },
  'write.admin': { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitGroup = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Test hook — never called by application code. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Token bucket: capacity = `limit`, refilled continuously over `windowMs`.
 * Returns the decision plus what the caller should be told (`Retry-After`).
 */
export function consumeRateLimit(
  group: RateLimitGroup,
  key: string,
  now: number = Date.now()
): RateLimitResult {
  const rule = RATE_LIMITS[group];
  const refillPerMs = rule.limit / rule.windowMs;
  const bucketKey = `${group}:${key}`;

  const existing = buckets.get(bucketKey);
  const bucket: Bucket = existing ?? { tokens: rule.limit, updatedAt: now };
  if (existing) {
    const elapsed = Math.max(0, now - existing.updatedAt);
    bucket.tokens = Math.min(rule.limit, existing.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;
  }

  if (bucket.tokens < 1) {
    buckets.set(bucketKey, bucket);
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(deficit / refillPerMs / 1000)),
    };
  }

  bucket.tokens -= 1;
  buckets.set(bucketKey, bucket);
  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}

/**
 * Best-effort caller key: the first hop of `x-forwarded-for` (Vercel sets it),
 * falling back to a constant so the limit still applies globally rather than
 * silently excluding anyone.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown-client';
}

export function rateLimitResponse(result: RateLimitResult, requestId?: string): NextResponse {
  const response = jsonError('rate_limited', 'Too many attempts. Please wait and try again.', {
    status: 429,
    requestId,
  });
  response.headers.set('Retry-After', String(result.retryAfterSeconds));
  return response;
}

/**
 * Convenience guard: consume one token for the caller and return either `null`
 * (allowed) or the 429 response to return immediately.
 */
export function enforceRateLimit(
  group: RateLimitGroup,
  request: Request,
  options: { keySuffix?: string; requestId?: string } = {}
): NextResponse | null {
  const key = options.keySuffix ? `${clientKey(request)}:${options.keySuffix}` : clientKey(request);
  const result = consumeRateLimit(group, key);
  return result.allowed ? null : rateLimitResponse(result, options.requestId);
}
