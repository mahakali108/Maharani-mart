/**
 * Turso cache types.
 *
 * Turso is a strictly OPTIONAL, strictly NON-AUTHORITATIVE layer. Nothing in
 * here describes business state: every value is a derived copy of something
 * Supabase already owns, and every value has a TTL after which it is simply
 * re-read from Supabase.
 *
 * Rule of thumb enforced across `lib/turso/*`:
 *   Supabase answers "what is true".  Turso answers "what did we last see".
 */

/** Namespaces keep unrelated cached payloads from colliding on one key. */
export const CACHE_NAMESPACES = ['search-suggestions'] as const;

export type CacheNamespace = (typeof CACHE_NAMESPACES)[number];

export interface CacheEntry<T> {
  value: T;
  /** Unix epoch seconds when this entry was written. */
  cachedAt: number;
}

/** Default lifetime for a cached entry, in seconds. */
export const DEFAULT_TTL_SECONDS = 300;
