import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, type Db } from './helpers/pg-harness';

let db: Db;
let adminId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  adminId = await createUser(db, 'admin', 'Security Advisor Admin');
}, 180_000);

const canExecute = async (role: string, signature: string): Promise<boolean> => {
  const { rows } = await db.query<{ ok: boolean }>(
    `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`,
    [role, signature]
  );
  return rows[0]!.ok;
};

describe('0103 security advisor remediation', () => {
  it('makes all four staff analytics views SECURITY INVOKER', async () => {
    const { rows } = await db.query<{ relname: string; reloptions: string[] | null }>(`
      select c.relname, c.reloptions
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'v'
         and c.relname = any($1::text[])
       order by c.relname
    `, [[
      'ai_product_demand_daily',
      'inventory_product_totals',
      'inventory_expiry_report',
      'catalog_product_sales',
    ]]);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.reloptions ?? []).toContain('security_invoker=true');
  });

  it('exposes operational views only to authenticated callers, with base RLS still enforced', async () => {
    const views = [
      'public.ai_product_demand_daily',
      'public.inventory_product_totals',
      'public.inventory_expiry_report',
      'public.catalog_product_sales',
    ];
    for (const view of views) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_table_privilege('anon',$1,'SELECT') as anon,
                has_table_privilege('authenticated',$1,'SELECT') as authenticated`,
        [view]
      );
      expect(rows[0]!.anon, view).toBe(false);
      expect(rows[0]!.authenticated, view).toBe(true);
    }
    const anonError = await as(db, 'anon', async (tx) => {
      try {
        await tx.query('select * from public.inventory_product_totals limit 1');
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(anonError).toMatch(/permission denied|not allowed/i);

    // The new base-table grant is still subject to the 0102 products RLS policy.
    const retailer = await createUser(db, 'retailer', 'View RLS Retailer');
    const retailerRows = await as(db, retailer, (tx) =>
      tx.query('select id from public.products limit 1')
    );
    expect(retailerRows.rows).toHaveLength(0);

    // Staff can execute the invoker view; the view's own predicate remains staff-only.
    const staffRows = await as(db, adminId, (tx) =>
      tx.query('select * from public.inventory_product_totals limit 1')
    );
    expect(Array.isArray(staffRows.rows)).toBe(true);
  });

  it('pins search_path on every function flagged by the live advisor', async () => {
    const expected = [
      'apply_stock_movement',
      'compliance_boolean',
      'current_jwt_role',
      'enforce_delivery_status_transitions',
      'enforce_order_status_transitions',
      'generate_grn_number',
      'generate_order_number',
      'generate_transfer_number',
      'get_effective_price',
      'normalize_batch_number',
      'prevent_ledger_mutation',
      'sync_cart_item_product_id',
      'update_retailer_credit_account_updated_at',
      'update_support_ticket_updated_at',
    ];
    const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(`
      select p.proname, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])
    `, [expected]);
    expect(rows).toHaveLength(expected.length);
    for (const row of rows) {
      expect(row.proconfig ?? [], row.proname).toContain('search_path=pg_catalog, public, pg_temp');
    }
  });

  it('withdraws API EXECUTE from trigger-only SECURITY DEFINER functions without disabling their triggers', async () => {
    const triggerFunctions = [
      'public.audit_credit_limit_change()',
      'public.drain_seller_offers_on_suspend()',
      'public.enforce_self_checkout_delivery_area()',
      'public.enforce_seller_offer_rules()',
      'public.enforce_seller_offer_tier_rules()',
      'public.guard_delivery_snapshot_update()',
      'public.guard_seller_offer_portal_write()',
      'public.log_audit()',
      'public.log_order_status_change()',
      'public.log_seller_offer_price_change()',
      'public.release_stock_on_order_cancel()',
      'public.sync_product_pack_primary_image()',
    ];
    for (const signature of triggerFunctions) {
      expect(await canExecute('anon', signature), signature).toBe(false);
      expect(await canExecute('authenticated', signature), signature).toBe(false);
    }
    const { rows } = await db.query<{ enabled: boolean }>(`
      select bool_and(t.tgenabled <> 'D') as enabled
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.oid = any(array(select to_regprocedure(s) from unnest($1::text[]) s))
         and not t.tgisinternal
    `, [triggerFunctions]);
    expect(rows[0]!.enabled).toBe(true);
  });

  it('withdraws API EXECUTE from the RLS auto-enable event trigger function when installed', async () => {
    const { rows } = await db.query<{ function_exists: boolean; event_trigger_exists: boolean }>(`
      select to_regprocedure('public.rls_auto_enable()') is not null as function_exists,
             exists(
               select 1 from pg_event_trigger
                where evtfoid = to_regprocedure('public.rls_auto_enable()')
             ) as event_trigger_exists
    `);
    if (rows[0]!.function_exists) {
      expect(await canExecute('anon', 'public.rls_auto_enable()')).toBe(false);
      expect(await canExecute('authenticated', 'public.rls_auto_enable()')).toBe(false);
      expect(rows[0]!.event_trigger_exists).toBe(true);
    } else {
      // The lightweight PGlite harness does not model this optional event trigger.
      expect(rows[0]!.event_trigger_exists).toBe(false);
    }
  });

  it('preserves anonymous RLS predicates and intended public endpoints', async () => {
    for (const signature of [
      'public.current_user_role()',
      'public.is_admin_or_above()',
      'public.is_staff_or_above()',
      'public.can_current_user_view_delivery(uuid)',
      'public.is_area_assigned_to_current_staff(uuid)',
      'public.is_warehouse_assigned_to_current_staff(uuid)',
      'public.is_phone_registered(text)',
      'public.submit_supplier_application(text,text,text,text,text,text,text,text,text,text,text)',
    ]) {
      expect(await canExecute('anon', signature), signature).toBe(true);
    }
  });

  it('keeps the five internal service_role-only tables closed with RLS enabled', async () => {
    const tables = [
      'ai_cleanup_runs',
      'ai_retention_rules',
      'cleanup_runs',
      'data_retention_rules',
      'supplier_application_rate_limits',
    ];
    const { rows } = await db.query<{ relname: string; rls: boolean; anon: boolean; authenticated: boolean; service: boolean }>(`
      select c.relname, c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'SELECT') as anon,
             has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated,
             has_table_privilege('service_role', c.oid, 'SELECT') as service
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])
       order by c.relname
    `, [tables]);
    expect(rows).toHaveLength(tables.length);
    for (const row of rows) {
      expect(row.rls, row.relname).toBe(true);
      expect(row.anon, row.relname).toBe(false);
      expect(row.authenticated, row.relname).toBe(false);
      expect(row.service, row.relname).toBe(true);
    }
  });
});
