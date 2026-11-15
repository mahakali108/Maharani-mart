/**
 * API privilege hardening (migrations 0078 + 0079) — executed, not asserted
 * from source text.
 *
 * Every case below runs against a database built by applying ALL migrations in
 * supabase/migrations to PostgreSQL 16 (PGlite, WASM) and then impersonates a
 * PostgREST caller (`set local role` + request.jwt.claims), which is how the
 * hosted project evaluates RLS and EXECUTE privileges.
 *
 * Run: corepack pnpm exec vitest run tests/api-privilege-hardening.test.ts
 *
 * Why these exist: Supabase's `alter default privileges` grants EXECUTE on new
 * public functions to anon/authenticated, so a SECURITY DEFINER helper is
 * reachable at /rest/v1/rpc/<name> unless a migration withdraws the grant. The
 * audit found three such helpers with no caller check (fefo_plan_for_product,
 * current_offer_floor_paise — fixed by 0078 — plus ensure_fefo_coverage and
 * release_order_stock in 0079) and fourteen more that were anon-callable.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createPack, createRetailer, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let retailerA: { id: string; areaId: string };
let retailerB: { id: string; areaId: string };
let adminId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  retailerA = await createRetailer(db);
  retailerB = await createRetailer(db);
  // createUser() promotes the account server-side, exactly like the invite
  // flow does; a raw auth.users insert would be treated as a retailer signup.
  adminId = await createUser(db, 'admin', 'Audit Admin');
  // 0026's order guard requires exactly one active warehouse; the order rows
  // below only need to exist so release_order_stock has something to authorise.
  await db.query(
    `insert into warehouses (name, area_id, is_active) values ('Audit Warehouse', $1, true)`,
    [retailerA.areaId]
  );
}, 180_000);

const canExecute = async (role: string, signature: string): Promise<boolean> => {
  const { rows } = await db.query<{ ok: boolean }>(
    `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as ok`,
    [role, signature]
  );
  return rows[0]!.ok;
};

// ---------------------------------------------------------------------------
// H5 — ensure_fefo_coverage writes inventory_batches and has no caller check
// ---------------------------------------------------------------------------
describe('H5 ensure_fefo_coverage is owner-only', () => {
  const signature = 'public.ensure_fefo_coverage(uuid, uuid, integer)';

  it('is not executable by anon or authenticated', async () => {
    expect(await canExecute('anon', signature)).toBe(false);
    expect(await canExecute('authenticated', signature)).toBe(false);
  });

  it('refuses an anonymous RPC call with 42501 instead of touching stock', async () => {
    const denied = await errorOf(db, 'anon', (tx) =>
      tx.query(`select public.ensure_fefo_coverage($1, $2, 1)`, [randomUUID(), randomUUID()])
    );
    expect(denied).toMatch(/permission denied for function ensure_fefo_coverage/);
  });

  it('refuses a signed-in retailer for the same reason', async () => {
    const denied = await errorOf(db, retailerA.id, (tx) =>
      tx.query(`select public.ensure_fefo_coverage($1, $2, 1)`, [randomUUID(), randomUUID()])
    );
    expect(denied).toMatch(/permission denied for function ensure_fefo_coverage/);
  });
});

// ---------------------------------------------------------------------------
// H6 — release_order_stock: the caller check 0017 explicitly omitted
// ---------------------------------------------------------------------------
describe('H6 release_order_stock authorisation', () => {
  it('is still executable by authenticated (the admin cancel action needs it)', async () => {
    expect(await canExecute('authenticated', 'public.release_order_stock(uuid)')).toBe(true);
    expect(await canExecute('anon', 'public.release_order_stock(uuid)')).toBe(false);
  });

  it('refuses an anon call before reading the order', async () => {
    const denied = await errorOf(db, 'anon', (tx) =>
      tx.query(`select public.release_order_stock($1)`, [randomUUID()])
    );
    expect(denied).toMatch(/permission denied for function release_order_stock|not permitted to release stock/);
  });

  it('refuses a retailer releasing a live reservation it does not own', async () => {
    const order = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into orders (retailer_id, request_key) values ($1, $2) returning id`,
        [retailerA.id, randomUUID()]
      );
      return rows[0]!.id;
    });

    expect(
      await errorOf(db, retailerB.id, (tx) =>
        tx.query(`select public.release_order_stock($1)`, [order])
      )
    ).toMatch(/not permitted to release stock for this order/);

    // The owner still reaches the function body and gets the normal answer.
    const own = await as(db, retailerA.id, async (tx) => {
      const { rows } = await tx.query<{ release_order_stock: { status: string } }>(
        `select public.release_order_stock($1)`,
        [order]
      );
      return rows[0]!.release_order_stock;
    });
    expect(own.status).toBe('released');
  });

  it('lets staff and service_role release any order', async () => {
    const order = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into orders (retailer_id, request_key) values ($1, $2) returning id`,
        [retailerA.id, randomUUID()]
      );
      return rows[0]!.id;
    });

    const asAdmin = await as(db, adminId, async (tx) => {
      const { rows } = await tx.query<{ release_order_stock: { status: string } }>(
        `select public.release_order_stock($1)`,
        [order]
      );
      return rows[0]!.release_order_stock;
    });
    expect(asAdmin.status).toBe('released');

    const asService = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ release_order_stock: { status: string } }>(
        `select public.release_order_stock($1)`,
        [order]
      );
      return rows[0]!.release_order_stock;
    });
    expect(asService.status).toBe('released');
  });
});

// ---------------------------------------------------------------------------
// H7 — anon can no longer call inventory/cost RPCs
// ---------------------------------------------------------------------------
describe('H7 anon EXECUTE withdrawn from inventory and cost RPCs', () => {
  const withdrawn = [
    'public.adjust_product_stock(uuid, uuid, integer, text, uuid)',
    'public.admin_pack_cost(uuid)',
    'public.admin_pack_costs(uuid)',
    'public.admin_product_cost(uuid)',
    'public.admin_product_costs()',
    'public.cancel_grn(uuid, text)',
    'public.cancel_stock_transfer(uuid, text)',
    'public.confirm_grn(uuid)',
    'public.consume_ai_confirmation(text)',
    'public.consume_ai_rate_limit(text, integer, integer)',
    'public.execute_stock_transfer(uuid)',
    'public.record_batch_loss(uuid, integer, text, text)',
    'public.require_inventory_role()',
    'public.reserve_order_stock(uuid)',
  ];

  it.each(withdrawn)('%s is anon-denied and authenticated-allowed', async (signature) => {
    expect(await canExecute('anon', signature), `${signature} anon`).toBe(false);
    expect(await canExecute('authenticated', signature), `${signature} authenticated`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The deliberate exceptions must survive the hardening
// ---------------------------------------------------------------------------
describe('public endpoints and RLS predicates still work for anonymous callers', () => {
  it('keeps the public registration and supplier-form endpoints', async () => {
    expect(await canExecute('anon', 'public.is_phone_registered(text)')).toBe(true);
    const { rows } = await db.query<{ signature: string }>(`
      select p.oid::regprocedure::text as signature
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'submit_supplier_application'`);
    expect(rows).toHaveLength(1);
    expect(await canExecute('anon', rows[0]!.signature)).toBe(true);
  });

  it('keeps every predicate a `public` RLS policy evaluates', async () => {
    // If any of these lost anon EXECUTE, an anonymous select would fail with
    // "permission denied for function" instead of returning its (empty) rows.
    for (const signature of [
      'public.current_user_role()',
      'public.is_admin_or_above()',
      'public.is_staff_or_above()',
      'public.is_area_assigned_to_current_staff(uuid)',
      'public.is_warehouse_assigned_to_current_staff(uuid)',
    ]) {
      expect(await canExecute('anon', signature), signature).toBe(true);
    }
  });

  it('lets an anonymous visitor still read a public catalog table', async () => {
    // No rows required: the point is that policy evaluation and table SELECT
    // still succeed rather than raising a function-permission error.
    const rows = await as(db, 'anon', async (tx) => {
      const result = await tx.query(`select id from products limit 1`);
      return result.rows;
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('0102: every table and view anon may select from answers without a function-permission error, and shows no catalogue or seller row', async () => {
    // A published product, with a pack and an image, and a seller exist.
    const published = await createPack(db);
    await db.query(`insert into product_images (product_id, image_url) values ($1, 'https://example.invalid/a.png')`, [published.productId]);
    await db.query(`insert into sellers (business_name, status) values ('Anon Probe Seller', 'pending')`);

    const { rows: relations } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and has_table_privilege('anon', c.oid, 'SELECT')
        order by 1`
    );
    expect(relations.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const { name } of relations) {
      const error = await errorOf(db, 'anon', (tx) => tx.query(`select * from public."${name}" limit 5`));
      if (error) failures.push(`${name}: ${error}`);
    }
    expect(failures).toEqual([]);

    for (const table of ['products', 'product_packs', 'product_images']) {
      const { rows } = await as(db, 'anon', (tx) => tx.query(`select 1 from public."${table}"`));
      expect(rows, table).toHaveLength(0);
    }
    // sellers has no anonymous table grant at all
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select 1 from public.sellers`))).toMatch(/permission denied for table sellers/);
    // The helpers stay closed to anon; a signed-in retailer still sees the published product.
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select public.product_is_sale_eligible($1)`, [published.productId])))
      .toMatch(/permission denied for function product_is_sale_eligible/);
    const seen = await as(db, retailerA.id, (tx) => tx.query(`select id from products where id = $1`, [published.productId]));
    expect(seen.rows).toHaveLength(1);
  });
});
