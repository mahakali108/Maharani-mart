import 'server-only';

/**
 * Turso (libSQL) connection handling.
 *
 * DESIGN CONTRACT — read before extending this file:
 *
 *  1. Turso is OPTIONAL. If `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` are not
 *     set, `getTursoClient()` returns `null` and every caller falls back to
 *     Supabase. The app must run identically with Turso switched off.
 *  2. Turso is NEVER authoritative. It holds derived, disposable copies only.
 *     Auth, cart, checkout, orders, credit, pricing, inventory, retailer
 *     approval and admin permissions must never read from it.
 *  3. Failures are non-fatal. Connection errors are swallowed (and logged
 *     once) rather than propagated, so a Turso outage can never take down a
 *     Supabase-backed page.
 *  4. `TURSO_AUTH_TOKEN` is server-only and must never be exposed to the
 *     browser or committed anywhere.
 */

import { createClient, type Client } from '@libsql/client';

let cached: Client | null = null;
let initialised = false;
let schemaReady: Promise<boolean> | null = null;
let warnedUnavailable = false;

function readEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** True when both Turso env vars are present. Safe to call anywhere on the server. */
export function isTursoConfigured(): boolean {
  return readEnv('TURSO_DATABASE_URL') !== null && readEnv('TURSO_AUTH_TOKEN') !== null;
}

/**
 * Lazily create the libSQL client. Returns `null` when Turso is not
 * configured or cannot be constructed — callers MUST handle `null`.
 */
export function getTursoClient(): Client | null {
  if (initialised) return cached;
  initialised = true;

  const url = readEnv('TURSO_DATABASE_URL');
  const authToken = readEnv('TURSO_AUTH_TOKEN');

  if (!url || !authToken) {
    cached = null;
    return null;
  }

  try {
    cached = createClient({ url, authToken });
  } catch (error) {
    warnOnce('Turso client could not be created', error);
    cached = null;
  }

  return cached;
}

/**
 * Create the cache table on first use. Idempotent (`IF NOT EXISTS`) and
 * memoised per process, so this costs one round-trip per deployment.
 *
 * The schema is intentionally a single generic key/value table: adding
 * business-shaped tables here would violate the "no duplicate business
 * database" rule.
 */
export async function ensureCacheSchema(): Promise<boolean> {
  const client = getTursoClient();
  if (!client) return false;

  schemaReady ??= (async () => {
    try {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          namespace  TEXT    NOT NULL,
          key        TEXT    NOT NULL,
          value      TEXT    NOT NULL,
          cached_at  INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, key)
        )
      `);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries (expires_at)',
      );
      return true;
    } catch (error) {
      warnOnce('Turso cache schema could not be prepared', error);
      // Reset so a later request can retry after a transient outage.
      schemaReady = null;
      return false;
    }
  })();

  return schemaReady;
}

/** Log a degraded-mode warning at most once per process, never a stack of noise. */
export function warnOnce(message: string, error?: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  const detail = error instanceof Error ? error.message : error;
  console.warn(`[turso] ${message} — falling back to Supabase.`, detail ?? '');
}

/** Test seam: forget the memoised client/schema state. */
export function resetTursoClientForTests(): void {
  cached = null;
  initialised = false;
  schemaReady = null;
  warnedUnavailable = false;
}
