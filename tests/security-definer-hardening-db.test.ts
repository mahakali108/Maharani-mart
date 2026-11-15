/**
 * Migration 0057 — SECURITY DEFINER hardening, EXECUTED against PostgreSQL
 * (PGlite) with every migration applied. Callers are impersonated the same way
 * PostgREST does it (see tests/helpers/pg-harness.ts), so the privilege checks
 * below are the real ones, not source-text assertions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createMigratedDb,
  createPack,
  createUser,
  errorOf,
  type Db,
  type PackFixture,
} from './helpers/pg-harness';

let db: Db;
let retailer: string;
let pack: PackFixture;

async function proconfig(name: string): Promise<string[] | null> {
  const { rows } = await db.query<{ proconfig: string[] | null }>(
    `select proconfig from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
    [name]
  );
  return rows[0]?.proconfig ?? null;
}

beforeAll(async () => {
  db = await createMigratedDb();
  retailer = await createUser(db, 'retailer');
  pack = await createPack(db);
}, 120_000);

describe('0057 — pinned search_path on all five flagged functions', () => {
  it.each(['is_user_access_valid', 'get_active_access', 'is_feature_enabled_for_user', 'log_audit', 'log_order_status_change'])(
    '%s has search_path pinned to public, pg_temp',
    async (name) => {
      const config = await proconfig(name);
      expect(config).not.toBeNull();
      expect(config).toContain('search_path=public, pg_temp');
    }
  );
});

describe('0057 — access-check functions are not callable by API roles', () => {
  const calls: Array<[string, string]> = [
    ['is_user_access_valid', `select public.is_user_access_valid($1)`],
    ['get_active_access', `select * from public.get_active_access($1)`],
    ['is_feature_enabled_for_user', `select public.is_feature_enabled_for_user($1, 'orders')`],
  ];

  it.each(calls)('anon cannot execute %s', async (_name, sql) => {
    const err = await errorOf(db, 'anon', (tx) => tx.query(sql, [retailer]));
    expect(err).toMatch(/permission denied/);
  });

  it.each(calls)('an authenticated retailer cannot execute %s for ANOTHER user', async (_name, sql) => {
    const other = await createUser(db, 'retailer');
    const err = await errorOf(db, retailer, (tx) => tx.query(sql, [other]));
    expect(err).toMatch(/permission denied/);
  });

  it.each(calls)('an authenticated retailer cannot execute %s for itself either (no client use)', async (_name, sql) => {
    const err = await errorOf(db, retailer, (tx) => tx.query(sql, [retailer]));
    expect(err).toMatch(/permission denied/);
  });

  it('the service role can still execute the access check', async () => {
    const err = await errorOf(db, 'service', (tx) => tx.query(`select public.is_user_access_valid($1)`, [retailer]));
    expect(err).toBeNull();
  });

  it('public EXECUTE is revoked at the catalogue level', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select (has_function_privilege('anon', 'public.get_active_access(uuid)', 'EXECUTE')
         or has_function_privilege('authenticated', 'public.get_active_access(uuid)', 'EXECUTE')) as ok`
    );
    expect(rows[0]?.ok).toBe(false);
  });
});

describe('0057 — audit trigger still fires after the search_path change', () => {
  it('a product update writes an audit row via log_audit()', async () => {
    const before = await db.query<{ n: string }>(
      `select count(*)::text as n from audit_logs where table_name = 'products' and record_id = $1`,
      [pack.productId]
    );
    // Any update is audited. An operational column is used because the name of a
    // product that is on sale is frozen until it is re-reviewed (0086 / 0087).
    await db.query(`update products set reorder_level = coalesce(reorder_level, 0) + 1 where id = $1`, [pack.productId]);
    const after = await db.query<{ n: string }>(
      `select count(*)::text as n from audit_logs where table_name = 'products' and record_id = $1`,
      [pack.productId]
    );
    expect(Number(after.rows[0]!.n)).toBeGreaterThan(Number(before.rows[0]!.n));
  });
});
