import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedDb } from './helpers/pg-harness';

/**
 * Migration 0110 retires the seller marketplace / supplier programme at the
 * DATABASE layer. The application code that drove both is gone; this suite
 * proves the database half, which is the half an attacker with a session could
 * still reach.
 *
 * The three things that must hold together:
 *   1. no API role can EXECUTE a seller-portal, marketplace or supplier RPC;
 *   2. no historical table or row was destroyed (this migration never drops);
 *   3. the 0109 dependency contract and the 0110 rollback still work.
 */
const MIGRATION = '0110_retire_seller_supplier_marketplace.sql';

const RETIRED_FUNCTIONS = [
  'seller_set_offer_stock',
  'seller_replace_offer_tiers',
  'seller_update_sub_order',
  'seller_update_own_profile',
  'seller_order_headers',
  'seller_offer_gate_status',
  'marketplace_offer_quotes',
  'marketplace_offers_for_product',
  'marketplace_offer_tiers',
  'submit_supplier_application',
  'record_marketplace_launch_approval',
  'reserve_seller_invite',
  'attach_existing_seller_invite',
  'claim_seller_invite_attempt',
];

const PRESERVED_TABLES = [
  'sellers',
  'seller_members',
  'seller_offers',
  'seller_offer_tiers',
  'seller_offer_price_history',
  'offer_price_floors',
  'seller_ledger',
  'seller_payouts',
  'seller_shipments',
  'seller_account_invites',
  'seller_compliance_reviews',
  'seller_pricing_permissions',
  'seller_ad_campaigns',
  'seller_ad_campaign_audit',
  'suppliers',
  'supplier_documents',
  'supplier_application_rate_limits',
  'sub_orders',
  'collection_allocations',
  'payment_collections',
  'return_requests',
  'orders',
  'order_items',
  'grns',
  'grn_items',
  'audit_logs',
  'profiles',
];

describe('migration 0110 — seller/supplier capability retirement', () => {
  it('is numbered after the merged baseline and is the newest migration', () => {
    // 0109 is merged as PR #139; 0110 must sort after it and never collide.
    const src = readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8');
    expect(src).toContain('after 0109');
    expect(MIGRATION > '0109_phase3_business_control.sql').toBe(true);
  });

  it('never drops a table, column, row or foreign key', () => {
    const src = readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8');
    const code = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    // The whole point: revoke, never drop. Deleting history is forbidden.
    expect(code).not.toMatch(/drop\s+table/i);
    expect(code).not.toMatch(/drop\s+column/i);
    expect(code).not.toMatch(/alter\s+table[^;]*drop\s+constraint[^;]*foreign/i);
    expect(code).not.toMatch(/truncate/i);
    expect(code).not.toMatch(/delete\s+from\s+public\.(orders|sub_orders|payments|refunds|collection_allocations|grns)/i);
    // `drop policy` is fine and expected — it removes access, not data.
    expect(code).toMatch(/drop\s+policy/i);
  });

  it('applies cleanly and leaves no seller/supplier RPC executable by an API role', async () => {
    const db = await createMigratedDb();
    const { rows } = await db.query<{ proname: string; anon: boolean; authn: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])
        order by p.proname`,
      [RETIRED_FUNCTIONS],
    );
    // Every retired function must actually exist (so the assertion is not
    // vacuous) and must be closed to both API roles.
    expect(rows.map((row) => row.proname).sort()).toEqual([...RETIRED_FUNCTIONS].sort());
    for (const row of rows) {
      expect(row.anon, `${row.proname} anon`).toBe(false);
      expect(row.authn, `${row.proname} authenticated`).toBe(false);
    }
  }, 300_000);

  it('preserves every historical table, including the 0109 dependency contract', async () => {
    const db = await createMigratedDb();
    const { rows } = await db.query<{ name: string; oid: string | null }>(
      `select name, to_regclass('public.' || name)::text as oid
         from unnest($1::text[]) as name`,
      [PRESERVED_TABLES],
    );
    for (const row of rows) expect(row.oid, row.name).not.toBeNull();

    // 0109 (merged as PR #139) preflights on these two names. Losing either
    // would make an already-merged migration unrunnable.
    const { rows: contract } = await db.query<{ sel: string | null; fn: string | null }>(
      `select to_regclass('public.sellers')::text as sel,
              to_regprocedure('public.is_active_seller_member(uuid)')::text as fn`,
    );
    expect(contract[0]!.sel).not.toBeNull();
    expect(contract[0]!.fn).not.toBeNull();
  }, 300_000);

  it('keeps grns.supplier_reference — purchase provenance is historical data', async () => {
    const db = await createMigratedDb();
    const { rows: col } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.columns
        where table_schema = 'public' and table_name = 'grns' and column_name = 'supplier_reference'`,
    );
    expect(col[0]!.count).toBe('1');
  }, 300_000);

  it('deactivates every seller-role profile without deleting it', async () => {
    const db = await createMigratedDb();
    const { rows: active } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.profiles where role::text = 'seller' and is_active = true`,
    );
    expect(active[0]!.count).toBe('0');
    // The role value itself survives: PostgreSQL cannot drop an enum value, and
    // re-creating the type would rewrite every dependent column and all history.
    const { rows: enumValue } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'user_role' and e.enumlabel = 'seller'`,
    );
    expect(enumValue[0]!.count).toBe('1');
  }, 300_000);

  it('cannot mint a seller account through handle_new_user', async () => {
    const src = readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8');
    const fn = src.slice(src.indexOf('create or replace function public.handle_new_user()'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    // The invitation-consuming branch is gone: no seller_members insert, no
    // seller invitation nonce consumption.
    expect(body).not.toContain('insert into public.seller_members');
    expect(body).not.toContain('seller_invite_nonce');
    // But it still refuses an explicit non-retailer signup rather than silently
    // opening a retailer account in its place.
    expect(body).toContain('seller_invite_required');
    expect(body).toContain("v_staff_role = 'seller'");
  });

  it('is idempotent: a second application is a clean no-op', async () => {
    const db = await createMigratedDb();
    await db.exec(readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8'));
    const { rows } = await db.query<{ anon: boolean; authn: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [RETIRED_FUNCTIONS],
    );
    for (const row of rows) {
      expect(row.anon).toBe(false);
      expect(row.authn).toBe(false);
    }
  }, 300_000);

  it('rewrites the superseded marketplace sentences in seeded website content', async () => {
    // Apply everything up to 0109, plant the pre-retirement wording, then run
    // 0110 and confirm only those sentences changed.
    const db = await createMigratedDb({ lastMigration: '0109_phase3_business_control.sql' });
    // 0105 already seeded every page (as a draft), so reuse the existing row
    // rather than inserting a second 'terms'.
    const { rows: page } = await db.query<{ id: string }>(
      `select id from public.site_pages where slug = 'terms'`,
    );
    const pageId = page[0]!.id;
    await db.query('delete from public.site_page_sections where page_id = $1', [pageId]);
    const superseded = 'The application includes marketplace and seller features, subject to configuration. The own-stock sales policies do not provide complete terms for third-party transactions; any launch or ongoing operation requires separate review.';
    const unrelated = 'Food products are excluded from the current scope.';
    const { rows: section } = await db.query<{ id: string }>(
      `insert into public.site_page_sections (page_id, heading, body, bullets, sort_order)
       values ($1, 'How ordering works', $2::text[], $3::text[], 0) returning id`,
      [pageId, [superseded, unrelated], ['An untouched bullet']],
    );

    await db.exec(readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8'));

    const { rows: after } = await db.query<{ body: string[]; bullets: string[] }>(
      'select body, bullets from public.site_page_sections where id = $1',
      [section[0]!.id],
    );
    // The superseded sentence is gone and replaced by the single-seller text...
    expect(after[0]!.body[0]).not.toContain('marketplace and seller features');
    expect(after[0]!.body[0]).toContain('sells only from its own stock');
    // ...neighbouring text and bullets are byte-identical...
    expect(after[0]!.body[1]).toBe(unrelated);
    expect(after[0]!.bullets).toEqual(['An untouched bullet']);
    // ...and the page's lifecycle fields were not touched.
    const { rows: lifecycle } = await db.query<{ status: string }>(
      'select status from public.site_pages where id = $1',
      [pageId],
    );
    expect(lifecycle[0]!.status).toBe('draft');
  }, 300_000);

  it('has a review-only rollback that restores the revoked grants', async () => {
    const db = await createMigratedDb();
    const rollbackPath = join('supabase', 'rollbacks', '0110_retire_seller_supplier_marketplace.down.sql');
    const rollbackSrc = readFileSync(rollbackPath, 'utf8');
    expect(rollbackSrc).toContain('NOT applied anywhere');

    await db.exec(rollbackSrc);
    const { rows } = await db.query<{ proname: string; authn: boolean }>(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('seller_set_offer_stock', 'marketplace_offer_quotes', 'seller_order_headers')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.authn, row.proname).toBe(true);
    // The rollback must not silently re-open retired logins.
    const { rows: active } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.profiles where role::text = 'seller' and is_active = true`,
    );
    expect(active[0]!.count).toBe('0');
  }, 300_000);
});
