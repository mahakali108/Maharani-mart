/**
 * Migration 0082 rollback precondition — the helper cannot be dropped while
 * the restated checkout bodies still call it.
 *
 * 0082 re-stated create_order_atomic (0056) and create_order_atomic_v2 (0065)
 * with a category-price gate. Dropping public.pack_category_price_per_piece
 * before those bodies are restored would leave checkout raising
 * "function does not exist" on every order, so the rollback now fails closed
 * with SQLSTATE 55000 instead.
 *
 * These cases run the REAL rollback file on PostgreSQL 16 (PGlite) and prove:
 *   * it refuses while the gated bodies are live, changing nothing;
 *   * it proceeds once the authentic 0056/0065 bodies are restored;
 *   * the restored body is byte-identical to the migration source (no invented
 *     body), keeps SECURITY DEFINER + the pinned search_path, and keeps the
 *     EXECUTE grant that 0056/0065 issued.
 *
 * No hosted database is contacted and nothing is applied anywhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDb, type Db } from './helpers/pg-harness';

const ROOT = join(__dirname, '..');
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');

const DOWN_SQL = read('supabase/rollbacks/0082_category_tier_pricing.down.sql');
const MIGRATION_0056 = read('supabase/migrations/0056_mobile_checkout_atomic.sql');
const MIGRATION_0065 = read('supabase/migrations/0065_checkout_split_rpcs.sql');

type PgError = Error & { code?: string; detail?: string; hint?: string };

/** Returns the complete `create or replace function public.<name>( ... $$;` block. */
function extractFunction(source: string, name: string): string {
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const bodyStart = tail.indexOf('$$');
  const bodyEnd = tail.indexOf('$$;', bodyStart + 2);
  expect(bodyEnd, `unterminated body for ${name}`).toBeGreaterThan(0);
  return tail.slice(0, bodyEnd + 3);
}

/** The SQL body between the outer dollar quotes. */
function functionBody(definition: string): string {
  const open = definition.indexOf('$$');
  const close = definition.lastIndexOf('$$;');
  return definition.slice(open + 2, close);
}

async function runRollback(db: Db): Promise<PgError | null> {
  let failure: PgError | null = null;
  try {
    await db.exec(DOWN_SQL);
  } catch (error) {
    failure = error as PgError;
  } finally {
    try {
      await db.exec('rollback');
    } catch {
      /* no transaction in progress */
    }
  }
  return failure;
}

async function rows<T>(db: Db, sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

const helperExists = (db: Db) =>
  rows<{ exists: boolean }>(
    db,
    `select to_regprocedure('public.pack_category_price_per_piece(uuid, uuid)') is not null as exists`
  ).then((result) => result[0]?.exists);

describe('0082 rollback refuses to strand checkout', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createMigratedDb();
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('raises SQLSTATE 55000 while the gated checkout bodies are still live', async () => {
    const error = await runRollback(db);

    expect(error).not.toBeNull();
    expect((error as PgError).code).toBe('55000');
    expect((error as PgError).message).toContain('MIGRATION_0082_ROLLBACK_BLOCKED');
    expect((error as PgError).detail).toContain('create_order_atomic(');
    expect((error as PgError).detail).toContain('create_order_atomic_v2(');
    expect((error as PgError).hint).toContain('0056_mobile_checkout_atomic.sql');
    expect((error as PgError).hint).toContain('0065_checkout_split_rpcs.sql');
    // Nothing was dropped.
    expect(await helperExists(db)).toBe(true);
  });

  it('proceeds once the authentic 0056/0065 bodies are restored, and restores them byte-for-byte', async () => {
    const originalV1 = extractFunction(MIGRATION_0056, 'create_order_atomic');
    const originalV2 = extractFunction(MIGRATION_0065, 'create_order_atomic_v2');
    await db.exec(originalV1);
    await db.exec(originalV2);

    const error = await runRollback(db);
    expect(error).toBeNull();

    // The helper and both trigger functions are gone.
    expect(await helperExists(db)).toBe(false);
    const left = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('validate_product_tier_prices', 'guard_product_tier_prices_write')`
    );
    expect(left).toEqual([]);

    // The pricing CONFIGURATION is retained (owner decision), with its policies.
    const table = await rows<{ exists: boolean }>(
      db,
      `select to_regclass('public.product_tier_prices') is not null as exists`
    );
    expect(table[0]?.exists).toBe(true);
    const policies = await rows<{ policyname: string }>(
      db,
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'product_tier_prices'
        order by policyname`
    );
    expect(policies.map((row) => row.policyname)).toEqual([
      'product_tier_prices_admin_delete',
      'product_tier_prices_admin_insert',
      'product_tier_prices_admin_update',
      'product_tier_prices_read',
    ]);

    // The deployed bodies are the migration sources, not a reconstruction.
    const deployed = await rows<{ proname: string; prosrc: string; prosecdef: boolean; proconfig: string[] }>(
      db,
      `select p.proname, p.prosrc, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_order_atomic', 'create_order_atomic_v2')
        order by p.proname`
    );
    expect(deployed).toHaveLength(2);
    const byName = Object.fromEntries(deployed.map((row) => [row.proname, row]));
    expect(byName.create_order_atomic?.prosrc).toBe(functionBody(originalV1));
    expect(byName.create_order_atomic_v2?.prosrc).toBe(functionBody(originalV2));
    for (const row of deployed) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig, row.proname).toContain('search_path=public, pg_temp');
    }

    // CREATE OR REPLACE preserved the ACL: the server keeps sole EXECUTE.
    const grants = await rows<{ anon: boolean; authn: boolean }>(
      db,
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_order_atomic', 'create_order_atomic_v2')`
    );
    for (const grant of grants) {
      expect(grant.anon).toBe(false);
      expect(grant.authn).toBe(false);
    }
  }, 120_000);
});
