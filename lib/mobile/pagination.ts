/**
 * Keyset/cursor pagination for the mobile API (contract §1.5).
 *
 * Cursors are OPAQUE to the client: base64url of a small JSON payload holding
 * the ordering key(s) of the last row. Clients must treat a cursor they cannot
 * advance as "stop" — the same guard the web's infinite scroll uses
 * (`lib/infinite-scroll/*`).
 *
 * No offsets: rows cannot be skipped or duplicated when data changes between
 * pages, which is what makes infinite scrolling safe for a live catalog.
 */

export const DEFAULT_PAGE_SIZE = 20;
/** Hard clamp per request; collections with a larger budget pass their own. */
export const MAX_PAGE_SIZE = 50;
/** Catalog budget, mirroring `lib/retailer/catalog-params.ts`. */
export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_MAX_ROWS = 240;

export interface PageParams {
  limit: number;
  cursor: string | null;
}

export interface PageEnvelope {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export function parsePageParams(
  url: URL | string,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): PageParams {
  const search = new URL(typeof url === 'string' ? url : url.toString()).searchParams;
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;

  const rawLimit = search.get('limit');
  const parsedLimit = rawLimit === null ? defaultLimit : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), maxLimit)
    : defaultLimit;

  const rawCursor = search.get('cursor');
  return { limit, cursor: rawCursor && rawCursor.length > 0 ? rawCursor : null };
}

export function encodeCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a client-supplied cursor. Malformed input returns `null` so the
 * caller can answer with `400 invalid_request` instead of crashing or, worse,
 * silently starting from the wrong position.
 */
export function decodeCursor(cursor: string | null): Record<string, string | number | null> | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return null;
    const clean: Record<string, string | number | null> = {};
    for (const [key, value] of entries) {
      if (value === null || typeof value === 'string' || typeof value === 'number') {
        clean[key] = value;
      } else {
        return null;
      }
    }
    return clean;
  } catch {
    return null;
  }
}

/**
 * Fetch `limit + 1` rows, hand them here with the last row's ordering key, and
 * receive both the trimmed list and the `page` block. `hasMore` is derived from
 * the extra row, never guessed.
 */
export function pageEnvelope<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => Record<string, string | number | null>
): { items: T[]; page: PageEnvelope } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    page: {
      nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null,
      hasMore,
      limit,
    },
  };
}
