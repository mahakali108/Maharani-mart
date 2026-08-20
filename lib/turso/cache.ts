import 'server-only';

/**
 * Generic read-through cache on top of Turso.
 *
 * Every function here is failure-tolerant by construction: a Turso error is
 * caught, logged once, and treated as a cache miss. The worst case for the
 * user is the exact behaviour they had before Turso existed — one more
 * Supabase query.
 */

import { ensureCacheSchema, getTursoClient, warnOnce } from './client';
import { DEFAULT_TTL_SECONDS, type CacheNamespace } from './types';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Read a cached JSON value. Returns `null` on a miss, an expired entry,
 * malformed JSON, or any Turso failure.
 */
export async function cacheGet<T>(namespace: CacheNamespace, key: string): Promise<T | null> {
  const client = getTursoClient();
  if (!client) return null;
  if (!(await ensureCacheSchema())) return null;

  try {
    const result = await client.execute({
      sql: 'SELECT value FROM cache_entries WHERE namespace = ? AND key = ? AND expires_at > ? LIMIT 1',
      args: [namespace, key, nowSeconds()],
    });

    const raw = result.rows[0]?.value;
    if (typeof raw !== 'string') return null;

    return JSON.parse(raw) as T;
  } catch (error) {
    warnOnce('Turso cache read failed', error);
    return null;
  }
}

/** Write a JSON value. Never throws; a failed write just means no caching. */
export async function cacheSet<T>(
  namespace: CacheNamespace,
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const client = getTursoClient();
  if (!client) return;
  if (!(await ensureCacheSchema())) return;

  const cachedAt = nowSeconds();

  try {
    await client.execute({
      sql: `INSERT INTO cache_entries (namespace, key, value, cached_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (namespace, key)
            DO UPDATE SET value = excluded.value,
                          cached_at = excluded.cached_at,
                          expires_at = excluded.expires_at`,
      args: [namespace, key, JSON.stringify(value), cachedAt, cachedAt + ttlSeconds],
    });
  } catch (error) {
    warnOnce('Turso cache write failed', error);
  }
}

/** Drop a single entry (used when the underlying Supabase data changes). */
export async function cacheDelete(namespace: CacheNamespace, key: string): Promise<void> {
  const client = getTursoClient();
  if (!client) return;
  if (!(await ensureCacheSchema())) return;

  try {
    await client.execute({
      sql: 'DELETE FROM cache_entries WHERE namespace = ? AND key = ?',
      args: [namespace, key],
    });
  } catch (error) {
    warnOnce('Turso cache delete failed', error);
  }
}

/** Drop every entry in a namespace. Safe to call after a bulk catalog import. */
export async function cacheInvalidateNamespace(namespace: CacheNamespace): Promise<void> {
  const client = getTursoClient();
  if (!client) return;
  if (!(await ensureCacheSchema())) return;

  try {
    await client.execute({
      sql: 'DELETE FROM cache_entries WHERE namespace = ?',
      args: [namespace],
    });
  } catch (error) {
    warnOnce('Turso cache invalidation failed', error);
  }
}

/**
 * Read-through helper: return the cached value if present, otherwise run
 * `loader()` (the Supabase query) and cache its result.
 *
 * `loader` errors are NOT swallowed — a Supabase failure is a real failure and
 * must surface. Only Turso failures degrade silently.
 */
export async function cached<T>(
  namespace: CacheNamespace,
  key: string,
  loader: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const hit = await cacheGet<T>(namespace, key);
  if (hit !== null) return hit;

  const value = await loader();
  await cacheSet(namespace, key, value, ttlSeconds);
  return value;
}
