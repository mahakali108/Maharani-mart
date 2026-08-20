import 'server-only';

/**
 * Catalog-shaped Turso helpers.
 *
 * SCOPE (deliberately tiny — see docs/turso.md):
 * the only thing cached today is the **search suggestions dropdown**, which is
 * read-only, catalog-wide, identical for every retailer, and harmless if a few
 * minutes stale.
 *
 * Explicitly NOT cached, and not to be added later without revisiting the
 * architecture rules: prices, credit, stock levels, cart contents, orders,
 * retailer approval state, permissions. Those are authoritative Supabase reads
 * and must stay that way.
 */

import { cacheInvalidateNamespace, cached } from './cache';

/** Suggestions change rarely; five minutes of staleness is invisible to users. */
const SEARCH_SUGGESTIONS_TTL_SECONDS = 300;

/**
 * Read-through cache for search suggestions.
 *
 * The cache key is the normalised query only — never the user id — because the
 * payload contains no per-retailer data (no prices, no favourites, no credit).
 * The caller still performs its own `requirePermission('products.view')` check
 * *before* reaching this function, so caching cannot bypass authorisation.
 */
export async function cachedSearchSuggestions<T>(
  normalisedQuery: string,
  loader: () => Promise<T>,
): Promise<T> {
  return cached('search-suggestions', normalisedQuery, loader, SEARCH_SUGGESTIONS_TTL_SECONDS);
}

/**
 * Invalidate every cached suggestion payload. Call after a bulk catalog
 * change (product/brand/category import) if suggestions look stale; it is a
 * no-op when Turso is not configured.
 */
export async function invalidateSearchSuggestions(): Promise<void> {
  await cacheInvalidateNamespace('search-suggestions');
}
