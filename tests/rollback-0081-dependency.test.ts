/**
 * Migration 0081 rollback safety — fail-closed dependency guard (regression).
 *
 * The 0081 rollback (supabase/rollbacks/0081_retailer_categories_and_approval.down.sql)
 * must refuse to drop retailers.retailer_category while any Migration 0082
 * category-pricing dependency is still live. These tests EXECUTE the real
 * rollback script on PostgreSQL 16 (PGlite) after replaying every migration, so
 * they assert behaviour — the SQLSTATE, the blockers, and the absence of schema
 * changes — rather than matching source text.
 *
 * Scope, stated honestly:
 *   * PGlite is a single-connection Postgres with stubbed auth/storage schemas.
 *     It proves catalog checks, DDL and SQLSTATE behaviour.
 *   * It says nothing about the hosted project: supabase_migrations.
 *     schema_migrations is NOT part of the harness unless a test creates it, so
 *     the "ledger" cases below build the table themselves and the absent-ledger
 *     case is exactly what a scratch replay looks like.
 *   * No hosted database is contacted. No migration is applied anywhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDb, type Db } from './helpers/pg-harness';

const ROOT = join(__dirname, '..');
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8');

const DOWN_SQL = read('supabase/rollbacks/0081_retailer_categories_and_approval.down.sql');
const MIGRATION_0082 = read('supabase/migrations/0082_category_tier_pricing.sql');
const MIGRATION_0056 = read('supabase/migrations/0056_mobile_checkout_atomic.sql');
const MIGRATION_0065 = read('supabase/migrations/0065_checkout_split_rpcs.sql');

const ACK_GUC = 'maharani.rollback_0081_ledger_ack';

type PgError = Error & { code?: string; detail?: string; hint?: string };

/** Runs the real rollback script and returns the raised error (or null). */
async function runRollback(db: Db): Promise<PgError | null> {
  let failure: PgError | null = null;
  try {
    await db.exec(DOWN_SQL);
  } catch (error) {
    failure = error as PgError;
  } finally {
    // A failed statement inside the script's explicit transaction leaves the
    // connection in an aborted transaction block; clear it so the next case
    // starts from a clean session.
    try {
      await db.exec('rollback');
    } catch {
      /* no transaction in progress — nothing to clear */
    }
  }
  return failure;
}

async function setAck(db: Db, value: string) {
  await db.query(`select set_config($1, $2, false)`, [ACK_GUC, value]);
}

async function clearAck(db: Db) {
  await db.query(`select set_config($1, '', false)`, [ACK_GUC]);
}

async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}

/**
 * Catalog snapshot of every object the 0081/0082 rollback chain can touch.
 * Deterministic ordering so a before/after comparison means "nothing moved".
 */
async function snapshot(db: Db) {
  const tables = `('retailers','product_tier_prices','retailer_applications','retailer_approval_events','retailer_approval_settings','product_packs','orders')`;
  const relations = `('public.retailers', 'public.retailer_applications', 'public.retailer_approval_events', 'public.retailer_approval_settings', 'public.product_tier_prices')`;
  return {
    columns: await rows(
      db,
      `select table_name, column_name, data_type, udt_name, is_nullable,
              column_default, ordinal_position
         from information_schema.columns
        where table_schema = 'public' and table_name in ${tables}
        order by table_name, ordinal_position`
    ),
    policies: await rows(
      db,
      `select schemaname, tablename, policyname, cmd, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename in ${tables}
        order by tablename, policyname`
    ),
    functions: await rows(
      db,
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as args,
              p.prosecdef, p.provolatile,
              coalesce(array_to_string(p.proconfig, ','), '') as proconfig,
              md5(p.prosrc) as body_md5
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'admin_%'
               or p.proname like 'retailer_%'
               or p.proname like '%product_tier_prices%'
               or p.proname like 'pack_category_price%'
               or p.proname like '%retailer_application%'
               or p.proname like 'create_order_atomic%')
        order by p.proname, args`
    ),
    routines_grants: await rows(
      db,
      `select routine_name, grantee, privilege_type
         from information_schema.routine_privileges
        where routine_schema = 'public'
          and (routine_name like 'admin_%' or routine_name like 'retailer_%'
               or routine_name like 'pack_category%')
        order by routine_name, grantee, privilege_type`
    ),
    triggers: await rows(
      db,
      `select t.tgname, t.tgrelid::regclass::text as table_name,
              pg_get_triggerdef(t.oid) as definition
         from pg_trigger t
        where not t.tgisinternal
          and t.tgrelid::regclass::text in ${relations}
        order by table_name, t.tgname`
    ),
    constraints: await rows(
      db,
      `select c.conrelid::regclass::text as table_name, c.conname, c.contype,
              pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
        where c.connamespace = 'public'::regnamespace
          and c.conrelid::regclass::text in ${relations}
        order by table_name, c.conname`
    ),
    indexes: await rows(
      db,
      `select tablename, indexname, indexdef
         from pg_indexes
        where schemaname = 'public' and tablename in ${tables}
        order by tablename, indexname`
    ),
    enums: await rows(
      db,
      `select t.typname, e.enumlabel, e.enumsortorder
         from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'retailer_category'
        order by e.enumsortorder`
    ),
    user_rows: await rows(
      db,
      `select 'retailer_applications' as source, count(*)::int as total from public.retailer_applications
       union all select 'retailer_approval_events', count(*)::int from public.retailer_approval_events
       union all select 'retailer_approval_settings', count(*)::int from public.retailer_approval_settings
       union all select 'retailers', count(*)::int from public.retailers
       order by source`
    ),
  };
}

const BLOCKED = (error: PgError | null): PgError => {
  expect(error, 'the rollback must be blocked').not.toBeNull();
  return error as PgError;
};

describe('0081 rollback is fail-closed while 0082 dependencies remain', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createMigratedDb();
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('raises SQLSTATE 55000 and refuses to run without any ledger attestation', async () => {
    await clearAck(db);
    const error = BLOCKED(await runRollback(db));

    expect(error.code).toBe('55000');
    expect(error.message).toContain('MIGRATION_0081_ROLLBACK_BLOCKED');
    // The absent ledger is never treated as proof: it is a blocker of its own.
    expect(error.detail).toContain('migration ledger');
    expect(error.detail).toContain('0082');
    // ... and the live catalog inventory is reported at the same time.
    expect(error.detail).toContain('public.product_tier_prices');
    expect(error.hint).toContain('0084 -> 0083 -> 0082');
  });

  it('names every known dependency in the error detail once the ledger is attested', async () => {
    await setAck(db, 'ledger verified in a local scratch replay for this test run');
    const error = BLOCKED(await runRollback(db));

    expect(error.code).toBe('55000');
    const detail = error.detail ?? '';

    // 0082 objects — each is a separate blocker, not a single "table exists".
    expect(detail).toContain('table: public.product_tier_prices exists');
    expect(detail).toContain('policy product_tier_prices_read on public.product_tier_prices');
    expect(detail).toContain('policy product_tier_prices_admin_insert on public.product_tier_prices');
    expect(detail).toContain('function: public.pack_category_price_per_piece(');
    expect(detail).toContain('function: public.validate_product_tier_prices()');
    expect(detail).toContain('function: public.guard_product_tier_prices_write()');
    // Both pricing trigger functions AND their triggers.
    expect(detail).toContain('trigger trg_validate_product_tier_prices on product_tier_prices');
    expect(detail).toContain('trigger trg_guard_product_tier_prices_write on product_tier_prices');
    // Both checkout bodies that still price by category.
    expect(detail).toContain('public.create_order_atomic still contains category-pricing logic');
    expect(detail).toContain('public.create_order_atomic_v2 still contains category-pricing logic');
    // The policy dependency on retailers.retailer_category, found through pg_depend.
    expect(detail).toContain('policy product_tier_prices_read on table product_tier_prices');

    // With an attested ledger the ledger line must not be a blocker any more.
    expect(detail).not.toContain('migration ledger');
  });

  it('makes no schema changes at all when the rollback is blocked', async () => {
    const before = await snapshot(db);
    const error = BLOCKED(await runRollback(db));
    const after = await snapshot(db);

    expect(error.code).toBe('55000');
    expect(after).toEqual(before);
  });

  it('keeps the category column, its enum and the pricing table/policy intact', async () => {
    BLOCKED(await runRollback(db));

    const column = await rows<{ udt_name: string; is_nullable: string }>(
      db,
      `select udt_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'retailers' and column_name = 'retailer_category'`
    );
    expect(column).toEqual([{ udt_name: 'retailer_category', is_nullable: 'NO' }]);

    const enumLabels = await rows<{ enumlabel: string }>(
      db,
      `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'retailer_category' order by e.enumsortorder`
    );
    expect(enumLabels.map((row) => row.enumlabel)).toEqual(['general', 'silver', 'gold']);

    const pricingTable = await rows<{ exists: boolean }>(
      db,
      `select to_regclass('public.product_tier_prices') is not null as exists`
    );
    expect(pricingTable[0]?.exists).toBe(true);

    const readPolicy = await rows<{ qual: string }>(
      db,
      `select qual from pg_policies
        where schemaname = 'public' and tablename = 'product_tier_prices'
          and policyname = 'product_tier_prices_read'`
    );
    expect(readPolicy).toHaveLength(1);
    // The access rule must be the migration's own expression, never a guess.
    expect(readPolicy[0]?.qual).toContain('is_admin_or_above');
    expect(readPolicy[0]?.qual).toContain("retailer_category = 'general'");
    expect(readPolicy[0]?.qual).toContain('is_active_account');
  });

  it('keeps the approval settings, RPCs, audit objects and their triggers intact', async () => {
    BLOCKED(await runRollback(db));

    const functions = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'admin_review_retailer_application', 'admin_set_retailer_category',
          'admin_set_retailer_access', 'admin_update_approval_settings',
          'retailer_resubmit_application', 'ensure_retailer_application',
          'retailer_approval_events_immutable', 'guard_retailer_sensitive_columns'
        ) order by 1`
    );
    expect(functions.map((row) => row.proname)).toEqual([
      'admin_review_retailer_application',
      'admin_set_retailer_access',
      'admin_set_retailer_category',
      'admin_update_approval_settings',
      'ensure_retailer_application',
      'guard_retailer_sensitive_columns',
      'retailer_approval_events_immutable',
      'retailer_resubmit_application',
    ]);

    const triggers = await rows<{ tgname: string }>(
      db,
      `select tgname from pg_trigger
        where not tgisinternal
          and tgrelid in ('public.retailers'::regclass, 'public.retailer_approval_events'::regclass)
        order by 1`
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'trg_ensure_retailer_application',
      'trg_guard_retailer_sensitive_columns',
      'trg_retailer_approval_events_immutable',
    ]);

    const settings = await rows<{ review_target_hours: number; reminder_hours: number }>(
      db,
      `select review_target_hours, reminder_hours from public.retailer_approval_settings`
    );
    expect(settings).toEqual([{ review_target_hours: 48, reminder_hours: 12 }]);
  });

  it('stays blocked (and unchanged) on repeated execution', async () => {
    const before = await snapshot(db);
    const first = BLOCKED(await runRollback(db));
    const second = BLOCKED(await runRollback(db));
    const after = await snapshot(db);

    expect(first.code).toBe('55000');
    expect(second.code).toBe('55000');
    expect(second.detail).toBe(first.detail);
    expect(after).toEqual(before);
  });

  describe('migration ledger', () => {
    beforeAll(async () => {
      await db.exec(`
        create schema supabase_migrations;
        create table supabase_migrations.schema_migrations (
          version text primary key,
          name text,
          inserted_at timestamptz not null default now()
        );
        insert into supabase_migrations.schema_migrations (version, name)
        values ('0001', 'init'), ('0081', 'retailer_categories_and_approval'),
               ('0082', 'category_tier_pricing');
      `);
    }, 60_000);

    afterAll(async () => {
      // Drop the objects explicitly: never DROP ... CASCADE, even in a scratch db.
      await db.exec(`
        drop table supabase_migrations.schema_migrations;
        drop schema supabase_migrations;
      `);
    });

    it('blocks when the ledger still records 0081/0082 as applied — an ack cannot override it', async () => {
      await setAck(db, 'operator claims the chain was reversed (should not matter)');
      const error = BLOCKED(await runRollback(db));

      expect(error.code).toBe('55000');
      expect(error.detail).toContain('migration ledger');
      expect(error.detail).toContain('0081, 0082');
    });

    it('does not treat a ledger without 0082 as proof that the reversal is complete', async () => {
      await db.exec(`delete from supabase_migrations.schema_migrations where version in ('0081', '0082');`);
      await setAck(db, 'ledger verified for this scratch run; 0082 rows absent');
      const error = BLOCKED(await runRollback(db));

      expect(error.code).toBe('55000');
      // The ledger no longer blocks ...
      expect(error.detail).not.toContain('migration ledger');
      // ... but the live catalog still does, because nothing was reversed.
      expect(error.detail).toContain('public.product_tier_prices exists');
      expect(error.detail).toContain('public.create_order_atomic still contains category-pricing logic');
    });
  });

  it('a partially reversed 0082 is still blocked: a missing table is not a completed rollback', async () => {
    // Simulate someone dropping ONLY product_tier_prices (no CASCADE, explicit
    // dependent cleanup first, exactly the way a partial reversal would happen).
    await db.exec(`
      begin;
      drop policy if exists product_tier_prices_read on public.product_tier_prices;
      drop policy if exists product_tier_prices_admin_insert on public.product_tier_prices;
      drop policy if exists product_tier_prices_admin_update on public.product_tier_prices;
      drop policy if exists product_tier_prices_admin_delete on public.product_tier_prices;
      drop table public.product_tier_prices;
      commit;
    `);

    await setAck(db, 'scratch run with the pricing table already removed');
    const error = BLOCKED(await runRollback(db));

    expect(error.code).toBe('55000');
    // The table line is gone ...
    expect(error.detail).not.toContain('table: public.product_tier_prices exists');
    // ... but the helper, the two trigger functions and both checkout bodies
    // still prove 0082 is not reversed.
    expect(error.detail).toContain('public.pack_category_price_per_piece(');
    expect(error.detail).toContain('public.validate_product_tier_prices()');
    expect(error.detail).toContain('public.guard_product_tier_prices_write()');
    expect(error.detail).toContain('public.create_order_atomic still contains category-pricing logic');
    expect(error.detail).toContain('public.create_order_atomic_v2 still contains category-pricing logic');

    // Restore the scratch database by replaying 0082 (idempotent by design).
    await db.exec(MIGRATION_0082);
    const restored = await rows<{ exists: boolean }>(
      db,
      `select to_regclass('public.product_tier_prices') is not null as exists`
    );
    expect(restored[0]?.exists).toBe(true);
  }, 120_000);
});

/**
 * The other half of fail-closed: the guard must ALLOW a genuinely safe
 * rollback. This case performs the documented 0082 reversal (restore the
 * authentic 0056/0065 bodies, drop the helper and its trigger functions, drop
 * the table) and then runs the 0081 rollback for real on a fresh database.
 */
describe('0081 rollback proceeds once the 0082 chain is genuinely reversed', () => {
  let db: Db;

  /** Extracts a `create or replace function public.<name>( ... $$;` block. */
  function extractFunction(source: string, name: string): string {
    const start = source.search(new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
    expect(start, `function ${name} not found in the source file`).toBeGreaterThanOrEqual(0);
    const tail = source.slice(start);
    const bodyStart = tail.indexOf('$$');
    const bodyEnd = tail.indexOf('$$;', bodyStart + 2);
    expect(bodyEnd, `unterminated function body for ${name}`).toBeGreaterThan(0);
    return tail.slice(0, bodyEnd + 3);
  }

  beforeAll(async () => {
    db = await createMigratedDb();
    // 1. Restore the authentic pre-0082 checkout bodies from their own migrations.
    await db.exec(extractFunction(MIGRATION_0056, 'create_order_atomic'));
    await db.exec(extractFunction(MIGRATION_0065, 'create_order_atomic_v2'));
    // 2. Remove the 0082 objects explicitly (never with CASCADE).
    await db.exec(`
      begin;
      drop trigger if exists trg_guard_product_tier_prices_write on public.product_tier_prices;
      drop trigger if exists trg_validate_product_tier_prices on public.product_tier_prices;
      drop function if exists public.guard_product_tier_prices_write();
      drop function if exists public.validate_product_tier_prices();
      drop function if exists public.pack_category_price_per_piece(uuid, uuid);
      drop table if exists public.product_tier_prices;
      commit;
    `);
    await setAck(db, 'scratch run: 0082 explicitly reversed and ledger checked manually');
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('reports no blocker once every 0082 object and both checkout bodies are clean', async () => {
    // A first run succeeds; the assertions below inspect the resulting schema.
    const error = await runRollback(db);
    expect(error).toBeNull();
  });

  it('removes the classification column and the five RPCs', async () => {
    const column = await rows(
      db,
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'retailers' and column_name = 'retailer_category'`
    );
    expect(column).toEqual([]);

    const rpcs = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'admin_review_retailer_application', 'admin_set_retailer_category',
          'admin_set_retailer_access', 'admin_update_approval_settings',
          'retailer_resubmit_application')`
    );
    expect(rpcs).toEqual([]);

    const guard = await rows(
      db,
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'guard_retailer_sensitive_columns'`
    );
    expect(guard).toEqual([]);
  });

  it('retains the approval history, its audit guard and the signup trigger', async () => {
    const tables = await rows<{ relname: string }>(
      db,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('retailer_applications', 'retailer_approval_events', 'retailer_approval_settings')
        order by 1`
    );
    expect(tables.map((row) => row.relname)).toEqual([
      'retailer_applications',
      'retailer_approval_events',
      'retailer_approval_settings',
    ]);

    const triggers = await rows<{ tgname: string }>(
      db,
      `select tgname from pg_trigger
        where not tgisinternal
          and tgrelid in ('public.retailers'::regclass, 'public.retailer_approval_events'::regclass)
        order by 1`
    );
    expect(triggers.map((row) => row.tgname)).toEqual([
      'trg_ensure_retailer_application',
      'trg_retailer_approval_events_immutable',
    ]);

    // History is still append-only: the immutable trigger and its function
    // survived the rollback (the function raises 42501 on any UPDATE/DELETE).
    const immutable = await rows<{ definition: string; body: string }>(
      db,
      `select pg_get_triggerdef(t.oid) as definition, p.prosrc as body
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgname = 'trg_retailer_approval_events_immutable'
          and t.tgrelid = 'public.retailer_approval_events'::regclass`
    );
    expect(immutable).toHaveLength(1);
    expect(immutable[0]?.definition).toMatch(
      /BEFORE (UPDATE OR DELETE|DELETE OR UPDATE) ON public\.retailer_approval_events/
    );
    expect(immutable[0]?.body).toContain('append-only');
    expect(immutable[0]?.body).toContain('42501');

    // The enum type is intentionally retained.
    const enumType = await rows<{ exists: boolean }>(
      db,
      `select to_regtype('public.retailer_category') is not null as exists`
    );
    expect(enumType[0]?.exists).toBe(true);
  });
});

/**
 * Structural contract that complements the behavioural cases above: the guard
 * must precede EVERY destructive statement, and the script may not acquire
 * powers it does not need (no CASCADE, no policy/table/type drops, no grants).
 * The owner-decision block at the end of the script is commented out, so it is
 * removed here together with the other SQL comments.
 */
describe('0081 rollback source contract', () => {
  const withoutGuardDefinition = DOWN_SQL.replace(
    /create or replace function pg_temp\.assert_0081_rollback_safe[\s\S]*?\$guard\$;/,
    ''
  );
  const codeOnly = withoutGuardDefinition.replace(/--[^\n]*/g, '');
  const statements = codeOnly
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  const isGuardCall = (statement: string) => statement.startsWith('select pg_temp.assert_0081_rollback_safe(');

  it('calls the guard immediately before every destructive statement', () => {
    const destructive = statements
      .map((statement, index) => ({ statement, index }))
      .filter(
        ({ statement }) =>
          !isGuardCall(statement) && (/^drop\s/i.test(statement) || /\bdrop\s+column\b/i.test(statement))
      );

    expect(destructive.length).toBeGreaterThanOrEqual(8);
    for (const { statement, index } of destructive) {
      const previous = statements[index - 1] ?? '';
      expect(previous, `no guard before: ${statement}`).toMatch(
        /^select pg_temp\.assert_0081_rollback_safe\(/
      );
    }
  });

  it('never uses CASCADE and never drops a policy, table, type or schema', () => {
    expect(codeOnly.toLowerCase()).not.toContain('cascade');
    expect(codeOnly).not.toMatch(/\bdrop\s+(policy|table|type|schema|index|view|sequence)\b/i);
    expect(codeOnly).not.toMatch(/\btruncate\b/i);
    expect(codeOnly).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('never creates or alters a policy and never issues a grant or revoke', () => {
    expect(codeOnly).not.toMatch(/\b(create|alter)\s+policy\b/i);
    expect(codeOnly).not.toMatch(/\b(grant|revoke)\s/i);
    // Row-level security is untouched: no enable/disable/force statement either.
    expect(codeOnly).not.toMatch(/\b(row\s+level\s+security|enable\s+row|disable\s+row)\b/i);
  });

  it('drops exactly one column, and only retailers.retailer_category', () => {
    const columnDrops = statements.filter(
      (statement) => !isGuardCall(statement) && /^alter\s+table[\s\S]*drop\s+column/i.test(statement)
    );
    expect(columnDrops).toHaveLength(1);
    expect(columnDrops[0]).toMatch(
      /alter\s+table\s+public\.retailers\s+drop\s+column\s+if\s+exists\s+retailer_category/i
    );
  });

  it('retains the approval tables by default (only comments propose dropping them)', () => {
    // The three workflow tables are never dropped in executable code.
    const executable = codeOnly.toLowerCase();
    for (const table of ['retailer_approval_events', 'retailer_applications', 'retailer_approval_settings']) {
      expect(executable).not.toContain(`drop table if exists public.${table}`);
      expect(executable).not.toContain(`drop table public.${table}`);
    }
  });
});
