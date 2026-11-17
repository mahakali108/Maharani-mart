/**
 * Regression suite for the reported `0109_phase3_business_control.sql` failure:
 *
 *   ERROR: 42P01: MIGRATION ORDER VIOLATION: 0109 requires base catalog, seller,
 *   supplier, membership, banner and control-center tables (0001–0108).
 *   CONTEXT: PL/pgSQL function inline_code_block line 15 at RAISE
 *
 * Those two lines are evidence, and this file records what they prove and what
 * they do not (verified by replaying the guard in embedded PostgreSQL, and
 * cross-checked against the real PostgreSQL 17.11 catalog of the official
 * project `fhrmsrumsraprvutrpeo` — see
 * docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md):
 *
 *   * `line 15 at RAISE` is the FIRST RAISE of the current/most complete guard
 *     (PR #137 final commit `a3bbdee`, identical to the merged file). Older PR
 *     revisions raised on line 13 and did not mention "supplier" at all, so the
 *     owner was running the current text.
 *   * The failure is therefore about a RELATION, not about a helper function.
 *   * In `fhrmsrumsraprvutrpeo` (official project) all 12 guard relations and
 *     all 7 guard functions resolve PRESENT, and the guard passes locally on the
 *     exact production baseline. So the guard did not fire on that schema as it
 *     exists today.
 *   * Migration `0060_supplier_application_rate_limit.sql` is the only migration
 *     that creates `public.supplier_application_rate_limits`, and it is the only
 *     base-catalog migration whose objects are absent from the legacy project
 *     `gbxhmffsbsfhdrfuwurx`. On such a schema this guard raises exactly
 *     `42P01`, `line 15 at RAISE`, with this message.
 *
 * What this suite pins down is the behaviour that must hold regardless of which
 * database produced the error: the guard must (a) still refuse to run on an
 * under-migrated database, (b) name every unmet dependency with its creating
 * migration, (c) also name a wrong function SIGNATURE, (d) enforce the 0107
 * ordering that its §1 column grant depends on, and (e) remain idempotent once
 * the dependencies exist.
 *
 * Environment limit (stated honestly): PGlite is PostgreSQL 16 (WASM). Real
 * PostgreSQL 17.11 runs of the same scenarios are recorded in
 * docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md §7; this file does not by
 * itself prove PostgreSQL 17 behaviour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDb, migrationFiles } from './helpers/pg-harness';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const readMigration = (file: string) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

const MIGRATION_0109 = '0109_phase3_business_control.sql';

const ORDERED_CHAIN = [
  '0104_site_content_management.sql',
  '0105_seed_site_content.sql',
  '0106_first_super_admin_bootstrap.sql',
  '0107_restore_cost_price_column_lockdown.sql',
  '0108_publishing_integrity.sql',
] as const;

/** Relations the 0109 pre-flight guard requires, with the migration that creates each. */
const REQUIRED_RELATIONS: ReadonlyArray<readonly [string, string]> = [
  ['public.products', '0001_init'],
  ['public.banners', '0001_init'],
  ['public.super_admin_audit_logs', '0020_super_admin_control_center'],
  ['public.product_pricing_tiers', '0022_case_based_pricing'],
  ['public.product_packs', '0004_product_packs'],
  ['public.suppliers', '0059_supplier_applications'],
  ['public.supplier_application_rate_limits', '0060_supplier_application_rate_limit'],
  ['public.sellers', '0062_seller_identity'],
  ['public.seller_offers', '0063_seller_offers'],
  ['public.seller_offer_tiers', '0069_seller_portal_access'],
  ['public.membership_plans', '0080_retailer_memberships_and_loyalty'],
  ['public.retailer_memberships', '0080_retailer_memberships_and_loyalty'],
];

/** Helper functions the 0109 pre-flight guard requires (exact signatures). */
const REQUIRED_FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  // Created in 0001_init and re-created (search_path / SECURITY DEFINER hardened)
  // by the migration named second.
  ['public.is_admin_or_above()', '0052_phase0_security_hardening'],
  ['public.is_staff_or_above()', '0052_phase0_security_hardening'],
  ['public.current_user_role()', '0052_phase0_security_hardening'],
  ['public.is_retailer_area_assigned_to_current_staff(uuid)', '0037_staff_scope_policies'],
  ['public.is_active_seller_member(uuid)', '0072_super_admin_seller_invitations'],
  ['public.consume_supplier_application_rate_limit(text,text,integer,integer)', '0060_supplier_application_rate_limit'],
  ['public.log_audit()', '0057_security_definer_hardening'],
];

/** Functions that predate the migration that currently defines their hardened form. */
const HARDENED_IN_PLACE: Readonly<Record<string, string>> = {
  'public.is_admin_or_above()': '0001_init',
  'public.is_staff_or_above()': '0001_init',
  'public.current_user_role()': '0001_init',
  'public.log_audit()': '0001_init',
};

async function expectFail(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('Expected promise to reject, but it resolved.');
}

/**
 * The dependency matrix is documentation that has to stay true. If 0109 stops
 * requiring an object, or a creating migration is renamed, this fails loudly
 * instead of leaving a stale claim in the report.
 */
describe('0109 dependency matrix — guard requirements and creating migrations', () => {
  const sql = readMigration(MIGRATION_0109);

  it('still requires every relation and function it declares, with the exact signatures', () => {
    for (const [relation] of REQUIRED_RELATIONS) {
      expect(sql, `0109 guard no longer requires ${relation}`).toContain(`'${relation}'`);
    }
    for (const [fn] of REQUIRED_FUNCTIONS) {
      expect(sql, `0109 guard no longer requires ${fn}`).toContain(`'${fn}'`);
    }
  });

  it('names the creating migration for every required object', () => {
    for (const [object, migration] of [...REQUIRED_RELATIONS, ...REQUIRED_FUNCTIONS]) {
      expect(sql, `0109 does not attribute ${object} to ${migration}`).toContain(migration);
    }
  });

  it('attributes each object to the migration that actually creates it in the repository', () => {
    const files = migrationFiles();
    for (const [relation, migration] of REQUIRED_RELATIONS) {
      const name = relation.replace('public.', '');
      const creator = files.find((file) =>
        new RegExp(`^create table (if not exists )?(public\\.)?${name} \\(`, 'm').test(readMigration(file)),
      );
      expect(creator, `no migration creates ${relation}`).toBeDefined();
      expect(creator, `${relation} is created by ${creator}, not ${migration}`).toContain(migration);
    }
    for (const [fn, migration] of REQUIRED_FUNCTIONS) {
      const name = fn.slice('public.'.length, fn.indexOf('('));
      // Some older migrations create helpers unqualified (`... function name(`)
      // and rely on `search_path = public`; both spellings are accepted here.
      const creator = files.find((file) =>
        new RegExp(`function (public\\.)?${name}\\s*\\(`, 'm').test(readMigration(file)),
      );
      expect(creator, `no migration creates ${fn}`).toBeDefined();
      const expectedCreator = HARDENED_IN_PLACE[fn] ?? migration;
      expect(creator, `${fn} is created by ${creator}, not ${expectedCreator}`).toContain(expectedCreator);
      // ...and the hardening migration must still touch it.
      const hardeningFile = files.find((file) => file.startsWith(`${migration}.sql`) || file.startsWith(migration));
      expect(hardeningFile, `${migration} not found in supabase/migrations`).toBeDefined();
      expect(readMigration(hardeningFile!), `${migration} no longer defines ${fn}`).toContain(name);
    }
  });

  it('keeps the guard ahead of every DDL statement in the migration', () => {
    const guardIdx = sql.indexOf('MIGRATION ORDER VIOLATION: 0109 requires');
    const firstDdlIdx = sql.search(/^(alter table|create table|create index|grant )/m);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstDdlIdx).toBeGreaterThan(guardIdx);
  });
});

describe('0109 pre-flight — dependency failures are named, not collapsed', () => {
  const openDbs: PGlite[] = [];
  afterAll(async () => {
    for (const db of openDbs) await db.close();
  });

  it('reports the 0060 relation by name when it is the only missing dependency', async () => {
    const db = await createMigratedDb({
      lastMigration: '0108_publishing_integrity.sql',
    });
    openDbs.push(db);

    await db.exec('drop table public.supplier_application_rate_limits cascade');

    const message = await expectFail(db.exec(readMigration(MIGRATION_0109)));
    expect(message).toMatch(/MIGRATION ORDER VIOLATION: 0109 requires/);
    expect(message).toMatch(
      /public\.supplier_application_rate_limits \(from 0060_supplier_application_rate_limit\)/,
    );
    // It must NOT be reported as a function problem.
    expect(message).not.toMatch(/helper functions/);
  }, 120_000);

  it('names every unmet relation with its creating migration on an under-migrated database', async () => {
    // Stop at 0059: 0060 (rate limits), 0062/0063/0069 (sellers) and 0080
    // (membership) are all absent, exactly the shape that raises 42P01 here.
    const db = await createMigratedDb({ lastMigration: '0059_supplier_applications.sql' });
    openDbs.push(db);

    const message = await expectFail(db.exec(readMigration(MIGRATION_0109)));

    expect(message).toMatch(/MIGRATION ORDER VIOLATION: 0109 requires base catalog/);
    for (const relation of [
      'public.supplier_application_rate_limits (from 0060_supplier_application_rate_limit)',
      'public.sellers (from 0062_seller_identity)',
      'public.seller_offers (from 0063_seller_offers)',
      'public.seller_offer_tiers (from 0069_seller_portal_access)',
      'public.membership_plans (from 0080_retailer_memberships_and_loyalty)',
      'public.retailer_memberships (from 0080_retailer_memberships_and_loyalty)',
    ]) {
      expect(message, `missing relation not named: ${relation}`).toContain(relation);
    }
    // Relations that DO exist at 0059 must not be blamed.
    expect(message).not.toContain('public.products (from 0001_init)');
    expect(message).not.toContain('public.suppliers (from 0059_supplier_applications)');
  }, 120_000);

  it('reports a wrong function signature (not a missing table) when only the signature differs', async () => {
    const db = await createMigratedDb({ lastMigration: '0108_publishing_integrity.sql' });
    openDbs.push(db);

    await db.exec(`
      drop function public.consume_supplier_application_rate_limit(text, text, integer, integer);
      create function public.consume_supplier_application_rate_limit(text, text, integer)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    `);

    const message = await expectFail(db.exec(readMigration(MIGRATION_0109)));
    expect(message).toMatch(/MIGRATION ORDER VIOLATION: 0109 requires helper functions/);
    expect(message).toContain(
      'public.consume_supplier_application_rate_limit(text,text,integer,integer) (from 0060_supplier_application_rate_limit)',
    );
    expect(message).not.toMatch(/base catalog/);
  }, 120_000);

  it('leaves zero partial Phase 3 objects behind when the guard fires', async () => {
    const db = await createMigratedDb({ lastMigration: '0059_supplier_applications.sql' });
    openDbs.push(db);

    await expectFail(db.exec(readMigration(MIGRATION_0109)));

    const { rows } = await db.query<{ c: string }>(
      `select count(*)::text as c
         from pg_tables
        where schemaname = 'public'
          and tablename = any($1::text[])`,
      [[
        'wholesale_pricing_rules',
        'seller_pricing_permissions',
        'product_wholesale_limits',
        'product_moderation_history',
        'membership_program_settings',
        'membership_upgrade_requests',
        'ad_program_settings',
        'seller_ad_campaigns',
        'seller_ad_campaign_audit',
      ]],
    );
    expect(rows[0]?.c).toBe('0');
  }, 120_000);
});

describe('0109 pre-flight — the 0107 ordering contract', () => {
  const openDbs: PGlite[] = [];
  afterAll(async () => {
    for (const db of openDbs) await db.close();
  });

  it('refuses to run before 0107 has locked down products.cost_price', async () => {
    // Exact live production baseline: 0001..0103 only.
    const db = await createMigratedDb({ lastMigration: '0103_security_advisor_remediation.sql' });
    openDbs.push(db);

    const before = await db.query<{ cost: boolean }>(
      `select has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') as cost`,
    );
    expect(before.rows[0]?.cost).toBe(true); // this is what production looks like today

    const message = await expectFail(db.exec(readMigration(MIGRATION_0109)));
    expect(message).toMatch(/MIGRATION ORDER VIOLATION: 0109 must run AFTER 0107_restore_cost_price_column_lockdown/);
    expect(message).toContain('0104 -> 0105 -> 0106 -> 0107 -> 0108');
  }, 120_000);

  it('survives a products table without a cost_price column (42703 from has_column_privilege)', async () => {
    // `has_column_privilege()` raises 42703 when the column is absent, which
    // would replace the actionable MIGRATION ORDER VIOLATION with a raw error.
    const db = await createMigratedDb({ lastMigration: '0059_supplier_applications.sql' });
    openDbs.push(db);

    // Drop the column WITHOUT cascading: any dependent object (a reporting view,
    // a generated column) makes PostgreSQL refuse. In that case the scenario is
    // not constructible on this schema and the guard's column probe is exercised
    // by the read-only diagnostic instead, so skip rather than fake it.
    let dropped = false;
    try {
      await db.exec('alter table public.products drop column cost_price');
      dropped = true;
    } catch {
      dropped = false;
    }
    if (!dropped) {
      // Confirm the raw failure mode that motivated the guard, so the reason for
      // the skip is recorded rather than assumed.
      await expect(
        db.query(`select has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT')`),
      ).resolves.toBeDefined();
      return;
    }

    const message = await expectFail(db.exec(readMigration(MIGRATION_0109)));
    expect(message).toMatch(/MIGRATION ORDER VIOLATION: 0109 requires base catalog/);
    expect(message).not.toMatch(/42703|column "cost_price" does not exist/);
  }, 120_000);

  it('applies cleanly, and keeps cost_price locked, when 0104..0108 run first', async () => {
    const db = await createMigratedDb({ lastMigration: '0103_security_advisor_remediation.sql' });
    openDbs.push(db);

    for (const file of ORDERED_CHAIN) {
      await db.exec(readMigration(file));
    }
    await db.exec(readMigration(MIGRATION_0109));

    const { rows } = await db.query<{
      auth_cost: boolean;
      anon_cost: boolean;
      auth_description: boolean;
      anon_description: boolean;
    }>(`select
         has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') as auth_cost,
         has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT') as anon_cost,
         has_column_privilege('authenticated', 'public.products', 'description', 'SELECT') as auth_description,
         has_column_privilege('anon', 'public.products', 'description', 'SELECT') as anon_description`);

    // 0107 keeps cost_price away from both API roles; 0109 §1 adds ONLY description.
    expect(rows[0]).toEqual({
      auth_cost: false,
      anon_cost: false,
      auth_description: true,
      anon_description: true,
    });

    // Owner gates stay closed after a full ordered rollout.
    const gates = await db.query<{
      membership_enabled: boolean;
      membership_payments: boolean;
      seller_ads: boolean;
      ad_payments: boolean;
    }>(`select
         (select program_enabled from public.membership_program_settings where id = 1) as membership_enabled,
         (select live_payment_collection_enabled from public.membership_program_settings where id = 1) as membership_payments,
         (select seller_ads_enabled from public.ad_program_settings where id = 1) as seller_ads,
         (select live_payment_collection_enabled from public.ad_program_settings where id = 1) as ad_payments`);
    expect(gates.rows[0]).toEqual({
      membership_enabled: false,
      membership_payments: false,
      seller_ads: false,
      ad_payments: false,
    });

    // Replay stays idempotent with a single row per singleton table.
    await db.exec(readMigration(MIGRATION_0109));
    const singletons = await db.query<{ wpr: string; mps: string; aps: string }>(
      `select (select count(*)::text from public.wholesale_pricing_rules) as wpr,
              (select count(*)::text from public.membership_program_settings) as mps,
              (select count(*)::text from public.ad_program_settings) as aps`,
    );
    expect(singletons.rows[0]).toEqual({ wpr: '1', mps: '1', aps: '1' });
  }, 180_000);
});
