/**
 * Migration Validation Suite — Production Baseline (0103) -> Upgrade (0104–0109),
 * Fresh vs Upgrade Schema Parity, Idempotent Re-Run, Dependency Fail-Fast, and
 * Sequential Ordering Invariants.
 *
 * Runs against disposable in-process PostgreSQL 16 (PGlite) inside `pnpm test`
 * and GitHub Actions CI — never touches any live Supabase database.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  as,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  publishProduct,
  type Tx,
} from './helpers/pg-harness';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const ROLLBACKS_DIR = join(process.cwd(), 'supabase', 'rollbacks');

const UPGRADE_SEQUENCE = [
  '0104_site_content_management.sql',
  '0105_seed_site_content.sql',
  '0106_first_super_admin_bootstrap.sql',
  '0107_restore_cost_price_column_lockdown.sql',
  '0108_publishing_integrity.sql',
  '0109_phase3_business_control.sql',
] as const;

const REQUIRED_ROLLBACKS = [
  '0104_site_content_management.down.sql',
  '0105_seed_site_content.down.sql',
  '0106_first_super_admin_bootstrap.down.sql',
  '0108_publishing_integrity.down.sql',
  '0109_phase3_business_control.down.sql',
] as const;

const PHASE3_TABLES = [
  'ad_program_settings',
  'membership_program_settings',
  'membership_upgrade_requests',
  'product_moderation_history',
  'product_wholesale_limits',
  'seller_ad_campaign_audit',
  'seller_ad_campaigns',
  'seller_pricing_permissions',
  'wholesale_pricing_rules',
];

async function expectFail(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('Expected promise to reject, but it resolved.');
}

async function snapshotPhase3Schema(db: PGlite) {
  const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity
       from pg_tables
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename`,
    [PHASE3_TABLES]
  );

  const policies = await db.query<{ tablename: string; policyname: string; cmd: string }>(
    `select tablename, policyname, cmd
       from pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename, policyname`,
    [PHASE3_TABLES]
  );

  const triggers = await db.query<{ tbl: string; tgname: string }>(
    `select c.relname as tbl, t.tgname
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not t.tgisinternal
        and (
          c.relname = any($1::text[])
          or t.tgname in (
            'trg_log_seller_offer_moderation_event',
            'trg_enforce_seller_offer_wholesale_limits',
            'trg_enforce_seller_tier_wholesale_limits',
            'trg_enforce_product_tier_wholesale_limits',
            'trg_guard_membership_plan_changes',
            'trg_audit_membership_plans',
            'trg_guard_super_admin_audit_insert',
            'trg_prevent_sa_audit_mutation',
            'trg_audit_banners'
          )
        )
      order by c.relname, t.tgname`,
    [PHASE3_TABLES]
  );

  const functions = await db.query<{ proname: string; args: string }>(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'stamp_product_moderation_actor',
          'prevent_append_only_audit_mutation',
          'log_phase3_governance_audit',
          'log_seller_offer_moderation_event',
          'stamp_wholesale_rule_editor',
          'enforce_seller_offer_wholesale_limits',
          'enforce_seller_tier_wholesale_limits',
          'enforce_product_tier_wholesale_limits',
          'guard_membership_plan_changes',
          'enforce_membership_upgrade_request',
          'get_retailer_membership_overview',
          'super_admin_assign_membership',
          'enforce_seller_ad_campaign_rules',
          'log_seller_ad_campaign_audit',
          'guard_super_admin_audit_insert'
        )
      order by p.proname, args`
  );

  return {
    tables: tables.rows,
    policies: policies.rows,
    triggers: triggers.rows,
    functions: functions.rows,
  };
}

describe('Migration Validation — Production Baseline (0103) -> Upgrade (0104–0109), Parity, Idempotency & Ordering', () => {
  const openDbs: PGlite[] = [];

  afterAll(async () => {
    for (const db of openDbs) {
      await db.close();
    }
  });

  it('enforces sequential 4-digit migration naming without mixed timestamps and verifies rollbacks for 0104–0109', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(files.length).toBeGreaterThanOrEqual(106);

    const nums: number[] = [];
    for (const file of files) {
      // Every repo migration must use 4-digit sequential numbering (never mixed 14-digit timestamps)
      expect(file, `Unexpected non-sequential filename: ${file}`).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      nums.push(Number(file.slice(0, 4)));
    }

    // Strictly monotonic without duplicate prefixes
    expect(new Set(nums).size).toBe(nums.length);
    for (let i = 1; i < nums.length; i += 1) {
      expect(nums[i]!).toBeGreaterThan(nums[i - 1]!);
    }

    // Only documented historical reservations (0061, 0075, 0076) may be absent
    const missing: number[] = [];
    const maxNum = nums[nums.length - 1]!;
    const present = new Set(nums);
    for (let n = 1; n <= maxNum; n += 1) {
      if (!present.has(n)) missing.push(n);
    }
    expect(missing).toEqual([61, 75, 76]);
    expect(maxNum).toBe(109);

    // Verify rollback scripts exist for schema/data migrations in 0104–0109
    // (0107 is a pure column-privilege security lockdown and intentionally omits a rollback)
    for (const downFile of REQUIRED_ROLLBACKS) {
      expect(existsSync(join(ROLLBACKS_DIR, downFile)), `Missing rollback: ${downFile}`).toBe(true);
    }
  });

  it('upgrades cleanly from the exact live production baseline (0103) through 0104–0109, matches fresh schema parity, and replays 0109 idempotently', async () => {
    // 1. Build a disposable DB stopped at exact live production baseline (0103)
    const upgradedDb = await createMigratedDb({ lastMigration: '0103_security_advisor_remediation.sql' });
    openDbs.push(upgradedDb);

    // Seed realistic pre-existing business data before upgrading
    const superAdminId = await createUser(upgradedDb, 'super_admin', 'Baseline Owner');
    const adminId = await createUser(upgradedDb, 'admin', 'Baseline Admin');
    const retailerId = (await createRetailer(upgradedDb)).id;
    const { productId, packId } = await createPack(upgradedDb, { publish: false });
    await publishProduct(upgradedDb, productId);

    // Confirm baseline 0103 matches known live production state BEFORE 0107 & 0109:
    // - products.cost_price IS selectable by authenticated at 0103
    // - can_current_staff_read_profile(adminId) leaks TRUE to anon at 0103
    const baselineCheck = await upgradedDb.query<{ cost_auth: boolean; has_wpr: string | null }>(`
      select
        has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') as cost_auth,
        to_regclass('public.wholesale_pricing_rules')::text as has_wpr
    `);
    expect(baselineCheck.rows[0]?.cost_auth).toBe(true);
    expect(baselineCheck.rows[0]?.has_wpr).toBeNull();

    const preHardeningProbe = await as(upgradedDb, 'anon', (tx: Tx) =>
      tx.query<{ leaked: boolean }>(`select public.can_current_staff_read_profile($1) as leaked`, [adminId])
    );
    expect(preHardeningProbe.rows[0]?.leaked).toBe(true);

    // 2. Apply exact unapplied production sequence 0104 -> 0109
    for (const file of UPGRADE_SEQUENCE) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await upgradedDb.exec(sql);
    }

    // 3. Verify pre-existing data survived AND all security/business upgrades took effect
    const postUpgrade = await upgradedDb.query<{
      products: string;
      packs: string;
      cost_auth: boolean;
      cost_anon: boolean;
      desc_auth: boolean;
      active_plans: string;
    }>(
      `select
         (select count(*)::text from public.products where id = $1) as products,
         (select count(*)::text from public.product_packs where id = $2) as packs,
         has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') as cost_auth,
         has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT') as cost_anon,
         has_column_privilege('authenticated', 'public.products', 'description', 'SELECT') as desc_auth,
         (select count(*)::text from public.membership_plans where is_active = true) as active_plans`,
      [productId, packId]
    );
    expect(postUpgrade.rows[0]).toEqual({
      products: '1',
      packs: '1',
      cost_auth: false,
      cost_anon: false,
      desc_auth: true,
      active_plans: '0',
    });

    // can_current_staff_read_profile leak is now closed for anon & retailer
    for (const caller of ['anon', retailerId]) {
      const probe = await as(upgradedDb, caller, (tx: Tx) =>
        tx.query<{ leaked: boolean }>(`select public.can_current_staff_read_profile($1) as leaked`, [superAdminId])
      );
      expect(probe.rows[0]?.leaked).toBe(false);
    }

    // 4. Compare upgraded schema against a fresh 0001–0109 install: MUST be 100% identical
    const freshDb = await createMigratedDb();
    openDbs.push(freshDb);

    const upgradedSnap = await snapshotPhase3Schema(upgradedDb);
    const freshSnap = await snapshotPhase3Schema(freshDb);
    expect(upgradedSnap).toEqual(freshSnap);

    // 5. Idempotent replay of 0109 must succeed with zero duplicate triggers/policies/constraints
    const sql0109 = readFileSync(join(MIGRATIONS_DIR, '0109_phase3_business_control.sql'), 'utf8');
    await upgradedDb.exec(sql0109);

    const afterReplaySnap = await snapshotPhase3Schema(upgradedDb);
    expect(afterReplaySnap).toEqual(upgradedSnap);

    const singletonCounts = await upgradedDb.query<{ wpr: string; mps: string; aps: string }>(`
      select
        (select count(*)::text from public.wholesale_pricing_rules) as wpr,
        (select count(*)::text from public.membership_program_settings) as mps,
        (select count(*)::text from public.ad_program_settings) as aps
    `);
    expect(singletonCounts.rows[0]).toEqual({ wpr: '1', mps: '1', aps: '1' });
  }, 120_000);

  it('fails fast on 0109 preflight dependency violation without creating any partial objects', async () => {
    // Stop at 0050 (missing 0059/0060 suppliers+rate limiter and 0072 sellers/offers)
    const underMigratedDb = await createMigratedDb({ lastMigration: '0050_catalog_admin_upgrade.sql' });
    openDbs.push(underMigratedDb);

    const sql0109 = readFileSync(join(MIGRATIONS_DIR, '0109_phase3_business_control.sql'), 'utf8');
    const err = await expectFail(underMigratedDb.exec(sql0109));
    expect(err).toMatch(/MIGRATION ORDER VIOLATION/);

    // Verify zero partial Phase 3 tables were created
    const { rows } = await underMigratedDb.query<{ c: string }>(
      `select count(*)::text as c
         from pg_tables
        where schemaname = 'public'
          and tablename = any($1::text[])`,
      [PHASE3_TABLES]
    );
    expect(rows[0]?.c).toBe('0');
  }, 120_000);
});
