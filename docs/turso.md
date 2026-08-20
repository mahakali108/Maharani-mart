# Turso (optional read cache)

Turso is an **optional, non-authoritative** layer. It stores derived,
disposable copies of data that Supabase already owns, purely to avoid repeating
cheap-but-frequent read queries.

**The app is fully functional with Turso switched off.** If the environment
variables are absent, or Turso is unreachable, every call falls through to the
Supabase query it was caching. That is the design, not a fallback bolted on
afterwards.

---

## What is cached

| Namespace | Contents | TTL | Why it is safe |
| --- | --- | --- | --- |
| `search-suggestions` | Product/brand/category name matches for the retailer search dropdown | 300 s | Catalog-wide and identical for every retailer — no prices, no favourites, no credit, no per-user data. A few minutes of staleness is invisible. |

That is the entire scope today.

## What is deliberately NOT cached

Never move these to Turso. They are authoritative reads and must stay on
Supabase, where RLS applies:

- Authentication, sessions, roles, permissions
- Cart contents and cart validation
- Checkout and order creation (`lib/orders/create-order.ts`)
- Pricing, GST, MOQ, scheme calculations
- Credit limits and outstanding balances
- Inventory / stock levels
- Retailer approval state
- Anything a user can write

"Recently viewed" also stays where it is — in `localStorage`, hydrated through
`loadPricedProductsAction`, so prices are always priced live per retailer.

## Guarantees enforced in code

`lib/turso/client.ts`:

- `getTursoClient()` returns `null` when either env var is missing. Callers
  must handle `null`; there is no throwing path.
- `ensureCacheSchema()` creates the table with `IF NOT EXISTS`, memoised per
  process, and returns `false` on failure instead of throwing.
- Failures are logged **once** per process (`warnOnce`), never repeatedly.

`lib/turso/cache.ts`:

- Every read/write is wrapped in try/catch. A Turso error is treated as a cache
  miss — the caller runs its Supabase query and continues.
- `cached(namespace, key, loader)` does **not** swallow `loader()` errors. A
  Supabase failure is a real failure and must surface; only Turso failures
  degrade silently.

`lib/turso/catalog.ts`:

- The only caller-facing helpers, scoped to search suggestions.
- The cache key is the normalised query string only — never a user id —
  because the payload contains nothing user-specific.

## Authorisation is never cached

In `lib/retailer/search-actions.ts`, `requirePermission('products.view')` runs
**before** the cache is consulted, on every single call. A cache hit therefore
cannot bypass a permission check, and because the payload holds no per-retailer
data, one retailer's cache entry is safe to serve to another.

## Schema

One generic key/value table. Business-shaped tables must not be added here —
that would create the duplicate business database the architecture forbids.

```sql
CREATE TABLE IF NOT EXISTS cache_entries (
  namespace  TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,   -- JSON
  cached_at  INTEGER NOT NULL,   -- unix seconds
  expires_at INTEGER NOT NULL,   -- unix seconds
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries (expires_at);
```

Created automatically on first use. No manual migration step.

## Setup

1. `turso db create maharani-cache`
2. `turso db show maharani-cache --url` → `TURSO_DATABASE_URL`
3. `turso db tokens create maharani-cache` → `TURSO_AUTH_TOKEN`

```bash
TURSO_DATABASE_URL=libsql://maharani-cache-<org>.turso.io
TURSO_AUTH_TOKEN=<token>   # server-only, never NEXT_PUBLIC_
```

`TURSO_AUTH_TOKEN` is read only by `lib/turso/client.ts`, which is marked
`server-only`.

## Operations

**Disable Turso:** unset both variables and redeploy. Nothing else to do.

**Stale suggestions after a bulk import:** call
`invalidateSearchSuggestions()` from `lib/turso/catalog.ts`, or just wait out
the 5-minute TTL.

**Expired rows:** entries are filtered by `expires_at` on read, so stale rows
are never served. To reclaim space periodically:

```sql
DELETE FROM cache_entries WHERE expires_at < unixepoch();
```

**Rollback:** remove the env vars. The `cachedSearchSuggestions()` wrapper
becomes a pass-through to the original Supabase query.
