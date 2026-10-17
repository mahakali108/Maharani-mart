/**
 * Data retention & cleanup — real-PostgreSQL tests (migration 0055).
 *
 * Runs the ACTUAL cleanup engine against the FULL migrated schema (PGlite),
 * asserting the spec's contracts:
 *
 *   - explicit retention rules only (no table is ever guessed),
 *   - 90-day temporary cleanup (exact boundary: exactly-90-days kept, older removed),
 *   - legacy 120-day business cleanup engine (TEST-ONLY manual opt-in after
 *     0059 pauses this unsafe production policy; never re-enable in production
 *     without an owner/CA-approved retention schedule),
 *   - permanent product/catalog/stock/image data is NEVER deleted,
 *   - coins/credit balances are mathematically unchanged by ledger purge
 *     (delta folded into the frozen opening baseline),
 *   - foreign-key safety (child-first deletion, nullable historical refs),
 *   - dry runs delete nothing,
 *   - repeated execution is idempotent (second run deletes nothing twice),
 *   - one failing category is recorded and the rest continue,
 *   - only the service role (production scheduler) can execute cleanup.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type PackFixture,
  type RetailerFixture,
} from './helpers/pg-harness';

interface TargetReport {
  target_key: string;
  category: string;
  table: string;
  retention_days: number;
  cutoff: string;
  action: string;
  eligible_rows: number | null;
  deleted_rows: number;
  status: 'ok' | 'failed';
  breakdown?: Record<string, number>;
}

interface CleanupReport {
  run_id: string;
  dry_run: boolean;
  triggered_by: string;
  status: 'completed' | 'completed_with_errors' | 'failed';
  targets: TargetReport[];
  totals: { temporary: number; '120_day': number; deleted?: number; eligible?: number };
  errors: { target_key: string; message: string }[];
}

let db: Db;
let admin: string;
let retailer: RetailerFixture;
let pack: PackFixture;

async function runCleanup(
  opts: { dryRun?: boolean; batchSize?: number; maxRows?: number } = {}
): Promise<CleanupReport> {
  return as(db, 'service', async (tx) => {
    const { rows } = await tx.query<{ r: CleanupReport | string }>(
      `select run_data_cleanup($1, 'test', $2, $3) as r`,
      [opts.dryRun ?? false, opts.batchSize ?? 100, opts.maxRows ?? 10000]
    );
    const raw = rows[0]!.r;
    return typeof raw === 'string' ? (JSON.parse(raw) as CleanupReport) : raw;
  });
}

function target(report: CleanupReport, key: string): TargetReport {
  const found = report.targets.find((t) => t.target_key === key);
  if (!found) throw new Error(`target ${key} missing from report: ${JSON.stringify(report.targets.map((t) => t.target_key))}`);
  return found;
}

async function countRows(table: string, where = 'true'): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where ${where}`);
  return Number(rows[0]!.n);
}

async function seedNotification(daysAgo: number, recipient: string): Promise<void> {
  await db.query(
    `insert into notifications (recipient_id, title, body, created_at)
     values ($1, 't', 'b', now() - make_interval(days => $2))`,
    [recipient, daysAgo]
  );
}

async function seedOrder(daysAgo: number, status = 'pending'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into orders (order_number, retailer_id, status, placed_at)
     values ($1, $2, $3::order_status, now() - make_interval(days => $4)) returning id`,
    [`ORD-${randomUUID().slice(0, 12)}`, retailer.id, status, daysAgo]
  );
  return rows[0]!.id;
}

/**
 * A simple-stock order line: 0054 requires a pack, pieces and available stock.
 * The shared `pack` fixture carries a large stock set in beforeAll.
 */
async function seedOrderItem(orderId: string, gstPercent = 18): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, unit_price, gst_percent, line_total)
     values ($1, $2, $3, 2, 'pieces', 100, $4, 200) returning id`,
    [orderId, pack.productId, pack.packId, gstPercent]
  );
  return rows[0]!.id;
}

async function seedLedger(
  retailerId: string,
  daysAgo: number,
  direction: 'debit' | 'credit',
  amountPaise: number,
  type = 'ORDER_DEBIT',
  extra: Record<string, unknown> = {}
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into retailer_wallet_ledger
       (retailer_id, transaction_type, amount_paise, direction, description,
        created_at, idempotency_key, is_reversed, reversal_of)
     values ($1, $2, $3, $4, 'test row', now() - make_interval(days => $5), $6, $7, $8)
     returning id`,
    [
      retailerId,
      type,
      amountPaise,
      direction,
      daysAgo,
      (extra.idempotencyKey as string) ?? `test-${randomUUID()}`,
      (extra.isReversed as boolean) ?? false,
      (extra.reversalOf as string) ?? null,
    ]
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  // LEGACY ENGINE TEST ONLY, isolated PGlite fixture — NEVER in production:
  // 0059 disables and constrains business_120 and evidence-bearing 90-day
  // rules. Remove holds *only in this disposable scratch DB* to exercise the
  // historical engine; production must never repeat these statements.
  await db.query(`alter table data_retention_rules drop constraint data_retention_business_hold`);
  await db.query(`alter table data_retention_rules drop constraint data_retention_evidence_hold`);
  await db.query(`update data_retention_rules set enabled = true where category = 'business_120'
    or target_key in ('expired_notifications', 'notification_logs', 'cleanup_run_logs')`);
  admin = await createUser(db, 'admin');
  retailer = await createRetailer(db, { creditLimitRupees: 10000 });
  pack = await createPack(db);
  // Order inserts run the single-active-warehouse guard (0054); the fixture
  // business has exactly one active warehouse.
  await db.query(`insert into warehouses (name, is_active) values ('Main WH', true)`);
  // Simple-stock order lines deduct pack stock atomically at insert (0054).
  await as(db, admin, (tx) =>
    tx.query(`select admin_set_product_pack_stock($1, $2)`, [pack.packId, 100000])
  );
});

describe('data retention — explicit rules registry', () => {
  it('seeds exactly the approved 90-day and 120-day targets with explicit rules', async () => {
    const { rows } = await db.query<{ target_key: string; category: string; retention_days: number; table_name: string }>(
      `select target_key, category, retention_days, table_name from data_retention_rules order by deletion_order`
    );
    const byKey = new Map(rows.map((r) => [r.target_key, r]));

    const expected: [string, string, number, string][] = [
      ['abandoned_carts', 'temporary_90', 90, 'cart_items'],
      ['expired_notifications', 'temporary_90', 90, 'notifications'],
      ['notification_logs', 'temporary_90', 90, 'notification_logs'],
      ['expired_staff_invites', 'temporary_90', 90, 'staff_account_invites'],
      ['ai_rate_limit_windows', 'temporary_90', 90, 'ai_rate_limit_windows'],
      ['cleanup_run_logs', 'temporary_90', 90, 'cleanup_runs'],
      ['historical_stock_allocations', 'business_120', 120, 'order_stock_allocations'],
      ['return_records', 'business_120', 120, 'return_requests'],
      ['coins_ledger', 'business_120', 120, 'retailer_wallet_ledger'],
      ['payment_records', 'business_120', 120, 'payment_collections'],
      ['historical_inventory_movements', 'business_120', 120, 'stock_movements'],
      ['orders', 'business_120', 120, 'orders'],
    ];
    expect(rows).toHaveLength(expected.length);
    for (const [key, category, days, table] of expected) {
      const rule = byKey.get(key);
      expect(rule, `missing rule ${key}`).toBeTruthy();
      expect(rule!.category).toBe(category);
      expect(rule!.retention_days).toBe(days);
      expect(rule!.table_name).toBe(table);
    }
  });

  it('never registers permanent product/catalog/master data as a cleanup target', async () => {
    const protectedTables = [
      'products',
      'product_packs',
      'product_images',
      'product_pack_images',
      'categories',
      'brands',
      'product_pricing_tiers',
      'price_lists',
      'schemes',
      'inventory_stock',
      'inventory_batches',
      'retailers',
      'profiles',
      'warehouses',
      'banners',
    ];
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from data_retention_rules where table_name = any($1)`,
      [protectedTables]
    );
    expect(rows).toHaveLength(0);
  });

  it('is migration-managed: neither service role nor an admin can alter the registry', async () => {
    const asService = await errorOf(db, 'service', (tx) =>
      tx.query(
        `insert into data_retention_rules (target_key, category, table_name, retention_days, cutoff_column, deletion_order, description)
         values ('evil', 'temporary_90', 'cart_items', 90, 'updated_at', 1, 'x')`
      )
    );
    expect(asService).toMatch(/migration-managed/i);

    const asAdmin = await errorOf(db, admin, (tx) =>
      tx.query(
        `insert into data_retention_rules (target_key, category, table_name, retention_days, cutoff_column, deletion_order, description)
         values ('evil2', 'temporary_90', 'cart_items', 90, 'updated_at', 1, 'x')`
      )
    );
    expect(asAdmin).toBeTruthy();

    const asAnon = await errorOf(db, 'anon', (tx) => tx.query(`select * from data_retention_rules`));
    expect(asAnon).toBeTruthy();
  });

  it('refuses to execute cleanup for an authenticated caller', async () => {
    // Denied either by the function's privilege revoke (permission denied) or
    // by its service-role-only guard — never silently executed.
    const denied = await errorOf(db, admin, (tx) =>
      tx.query(`select run_data_cleanup(false, 'test', 10, 100)`)
    );
    expect(denied).toMatch(/permission denied|server-scheduler only/i);

    const deniedAnon = await errorOf(db, 'anon', (tx) =>
      tx.query(`select run_data_cleanup(false, 'test', 10, 100)`)
    );
    expect(deniedAnon).toMatch(/permission denied|server-scheduler only/i);
  });
});

describe('90-day temporary cleanup — boundaries', () => {
  it('deletes rows strictly older than 90 days and keeps rows at exactly 90 days or newer', async () => {
    const p1 = await createPack(db);
    const p2 = await createPack(db);
    const p3 = await createPack(db);
    await as(db, 'service', async (tx) => {
      // All three timestamps share this transaction's now(), so the boundary
      // is exact: cutoff == now() - 90 days.
      await tx.query(
        `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '90 days')`,
        [retailer.id, p1.packId]
      );
      await tx.query(
        `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '90 days' - interval '1 second')`,
        [retailer.id, p2.packId]
      );
      await tx.query(
        `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '89 days')`,
        [retailer.id, p3.packId]
      );

      const { rows } = await tx.query<{ r: CleanupReport | string }>(
        `select run_data_cleanup(false, 'test', 100, 10000) as r`
      );
      const raw = rows[0]!.r;
      const report = typeof raw === 'string' ? (JSON.parse(raw) as CleanupReport) : raw;
      expect(report.status).toBe('completed');
      expect(target(report, 'abandoned_carts').deleted_rows).toBe(1);
    });

    const remaining = await countRows('cart_items', `pack_id in ('${p1.packId}', '${p2.packId}', '${p3.packId}')`);
    expect(remaining).toBe(2);
    const gone = await countRows('cart_items', `pack_id = '${p2.packId}'`);
    expect(gone).toBe(0);
  });

  it('cleans expired notifications, notification logs, expired staff invites and spent AI rate-limit windows', async () => {
    const oldInvite = `old-${randomUUID().slice(0, 8)}@test.local`;
    const newInvite = `new-${randomUUID().slice(0, 8)}@test.local`;
    await db.query(`insert into staff_account_invites (email, role, created_at, expires_at) values ($1, 'staff', now() - interval '100 days', now() - interval '99 days')`, [oldInvite]);
    await db.query(`insert into staff_account_invites (email, role, created_at, expires_at) values ($1, 'staff', now() - interval '1 minute', now() + interval '14 minutes')`, [newInvite]);

    await db.query(
      `insert into notification_logs (recipient_id, channel, status, created_at) values ($1, 'push', 'sent', now() - interval '91 days')`,
      [admin]
    );
    await db.query(
      `insert into notification_logs (recipient_id, channel, status, created_at) values ($1, 'push', 'sent', now() - interval '10 days')`,
      [admin]
    );
    await db.query(
      `insert into ai_rate_limit_windows (user_id, bucket, window_started_at, request_count) values ($1, 'chat-old', now() - interval '91 days', 5)`,
      [admin]
    );
    await db.query(
      `insert into ai_rate_limit_windows (user_id, bucket, window_started_at, request_count) values ($1, 'chat-new', now() - interval '1 hour', 2)`,
      [admin]
    );
    await seedNotification(100, admin);
    await seedNotification(5, admin);

    const report = await runCleanup();
    expect(report.status).toBe('completed');
    expect(target(report, 'expired_notifications').deleted_rows).toBe(1);
    expect(target(report, 'notification_logs').deleted_rows).toBe(1);
    expect(target(report, 'expired_staff_invites').deleted_rows).toBe(1);
    expect(target(report, 'ai_rate_limit_windows').deleted_rows).toBe(1);

    expect(await countRows('staff_account_invites', `email = '${newInvite}'`)).toBe(1);
    expect(await countRows('staff_account_invites', `email = '${oldInvite}'`)).toBe(0);
  });

  it('never deletes a still-running cleanup log, but marks stale runs failed and retires old completed logs', async () => {
    await db.query(
      `insert into cleanup_runs (run_id, dry_run, triggered_by, status, batch_size, max_rows_per_target, started_at, completed_at, summary)
       values ('cleanup-2020-01-01-aaaaaaaa', false, 'test', 'completed', 10, 100, now() - interval '100 days', now() - interval '100 days', '{}')`
    );
    await db.query(
      `insert into cleanup_runs (run_id, dry_run, triggered_by, status, batch_size, max_rows_per_target, started_at, completed_at, summary)
       values ('cleanup-2020-01-02-bbbbbbbb', false, 'test', 'completed', 10, 100, now() - interval '100 days', now() - interval '5 days', '{}')`
    );
    await db.query(
      `insert into cleanup_runs (run_id, dry_run, triggered_by, status, batch_size, max_rows_per_target, started_at)
       values ('cleanup-2020-01-03-cccccccc', false, 'test', 'running', 10, 100, now() - interval '10 minutes')`
    );
    await db.query(
      `insert into cleanup_runs (run_id, dry_run, triggered_by, status, batch_size, max_rows_per_target, started_at)
       values ('cleanup-2020-01-04-dddddddd', false, 'test', 'running', 10, 100, now() - interval '2 hours')`
    );

    const report = await runCleanup();
    expect(target(report, 'cleanup_run_logs').deleted_rows).toBe(1); // only the 100-day completed run

    expect(await countRows('cleanup_runs', `run_id = 'cleanup-2020-01-01-aaaaaaaa'`)).toBe(0);
    expect(await countRows('cleanup_runs', `run_id = 'cleanup-2020-01-02-bbbbbbbb'`)).toBe(1);
    expect(await countRows('cleanup_runs', `run_id = 'cleanup-2020-01-03-cccccccc'`)).toBe(1);

    // The stale running row was marked failed+completed by the run's opening
    // hygiene pass — observable, and eligible for log retention later.
    const stale = await db.query<{ status: string; completed_at: string | null; errors: unknown }>(
      `select status, completed_at, errors from cleanup_runs where run_id = 'cleanup-2020-01-04-dddddddd'`
    );
    expect(stale.rows[0]!.status).toBe('failed');
    expect(stale.rows[0]!.completed_at).toBeTruthy();
    expect(JSON.stringify(stale.rows[0]!.errors)).toMatch(/interrupted/i);
  });
});

describe('120-day business cleanup — boundaries and categories', () => {
  it('deletes orders strictly older than 120 days and keeps orders at exactly 120 days or newer', async () => {
    await as(db, 'service', async (tx) => {
      const { rows: o1 } = await tx.query<{ id: string }>(
        `insert into orders (order_number, retailer_id, status, placed_at, simple_stock_mode)
         values ($1, $2, 'delivered', now() - interval '120 days', false) returning id`,
        [`B1-${randomUUID().slice(0, 8)}`, retailer.id]
      );
      const { rows: o2 } = await tx.query<{ id: string }>(
        `insert into orders (order_number, retailer_id, status, placed_at, simple_stock_mode)
         values ($1, $2, 'delivered', now() - interval '120 days' - interval '1 second', false) returning id`,
        [`B2-${randomUUID().slice(0, 8)}`, retailer.id]
      );
      const { rows: o3 } = await tx.query<{ id: string }>(
        `insert into orders (order_number, retailer_id, status, placed_at, simple_stock_mode)
         values ($1, $2, 'delivered', now() - interval '119 days', false) returning id`,
        [`B3-${randomUUID().slice(0, 8)}`, retailer.id]
      );

      const { rows } = await tx.query<{ r: CleanupReport | string }>(
        `select run_data_cleanup(false, 'test', 100, 10000) as r`
      );
      const raw = rows[0]!.r;
      const report = typeof raw === 'string' ? (JSON.parse(raw) as CleanupReport) : raw;
      expect(target(report, 'orders').deleted_rows).toBe(1);

      const { rows: left } = await tx.query<{ id: string }>(
        `select id from orders where id = any($1) order by placed_at`,
        [[o1[0]!.id, o2[0]!.id, o3[0]!.id]]
      );
      expect(left.map((r) => r.id)).toEqual([o1[0]!.id, o3[0]!.id]);
    });
  });

  it('deletes payment records, return records, historical stock movements and allocations older than 120 days', async () => {
    const orderId = await seedOrder(130);
    const itemId = await seedOrderItem(orderId);

    await db.query(
      `insert into payment_collections (retailer_id, order_id, collected_by, amount_paise, method, status, created_at)
       values ($1, $2, $3, 5000, 'cash', 'verified', now() - interval '130 days')`,
      [retailer.id, orderId, admin]
    );
    await db.query(
      `insert into payment_collections (retailer_id, order_id, collected_by, amount_paise, method, status, created_at)
       values ($1, $2, $3, 5000, 'cash', 'verified', now() - interval '5 days')`,
      [retailer.id, orderId, admin]
    );
    await db.query(
      `insert into return_requests (order_id, order_item_id, retailer_id, reason, status, requested_at)
       values ($1, $2, $3, 'damaged', 'requested', now() - interval '130 days')`,
      [orderId, itemId, retailer.id]
    );
    await db.query(
      `insert into return_requests (order_id, order_item_id, retailer_id, reason, status, requested_at)
       values ($1, $2, $3, 'damaged', 'requested', now() - interval '5 days')`,
      [orderId, itemId, retailer.id]
    );

    // Legacy inventory history (must NOT touch current inventory_stock rows).
    const { rows: wh } = await db.query<{ id: string }>(
      `insert into warehouses (name, is_active) values ($1, false) returning id`,
      [`WH-${randomUUID().slice(0, 8)}`]
    );
    await db.query(
      `insert into stock_movements (product_id, warehouse_id, movement_type, quantity, performed_by, created_at)
       values ($1, $2, 'inward', 5, $3, now() - interval '130 days')`,
      [pack.productId, wh[0]!.id, admin]
    );
    await db.query(
      `insert into stock_movements (product_id, warehouse_id, movement_type, quantity, performed_by, created_at)
       values ($1, $2, 'inward', 5, $3, now() - interval '5 days')`,
      [pack.productId, wh[0]!.id, admin]
    );
    const { rows: batch } = await db.query<{ id: string }>(
      `insert into inventory_batches (product_id, warehouse_id, batch_number, created_at)
       values ($1, $2, 'B-OLD', now() - interval '130 days') returning id`,
      [pack.productId, wh[0]!.id]
    );
    await db.query(
      `insert into order_stock_allocations (order_id, order_item_id, product_id, warehouse_id, batch_id, quantity_reserved, created_at)
       values ($1, $2, $3, $4, $5, 1, now() - interval '130 days')`,
      [orderId, itemId, pack.productId, wh[0]!.id, batch[0]!.id]
    );

    // Snapshot current stock AFTER the inserts (movement inserts themselves
    // create/update inventory_stock rows by design) — the cleanup must not
    // change it.
    const beforeStock = await db.query<{ n: string; q: string }>(
      `select count(*)::text as n, coalesce(sum(quantity), 0)::text as q from inventory_stock where product_id = $1`,
      [pack.productId]
    );

    const report = await runCleanup();
    expect(report.status).toBe('completed');
    expect(target(report, 'payment_records').deleted_rows).toBe(1);
    expect(target(report, 'return_records').deleted_rows).toBe(1);
    expect(target(report, 'historical_inventory_movements').deleted_rows).toBe(1);
    // The allocation belongs to the old order and is removed child-first with it
    // (counted under the orders breakdown or its own target — either way gone).
    expect(await countRows('order_stock_allocations', `order_id = '${orderId}'`)).toBe(0);

    expect(await countRows('payment_collections', `created_at > now() - interval '6 days'`)).toBe(1);
    // The young return request on the OLD order is deleted child-first with its
    // parent (never left dangling) — while a young return on a live order stays.
    expect(await countRows('return_requests', `order_id = '${orderId}'`)).toBe(0);
    const liveOrder = await seedOrder(3);
    const liveItem = await seedOrderItem(liveOrder);
    await db.query(
      `insert into return_requests (order_id, order_item_id, retailer_id, reason, status, requested_at)
       values ($1, $2, $3, 'recent return on live order', 'requested', now() - interval '5 days')`,
      [liveOrder, liveItem, retailer.id]
    );
    const afterLive = await runCleanup();
    expect(target(afterLive, 'orders').deleted_rows).toBe(0);
    expect(await countRows('return_requests', `order_id = '${liveOrder}'`)).toBe(1);
    expect(await countRows('stock_movements', `created_at > now() - interval '6 days'`)).toBe(1);

    // Current stock structures survive untouched (only history rows are eligible).
    const afterStock = await db.query<{ n: string; q: string }>(
      `select count(*)::text as n, coalesce(sum(quantity), 0)::text as q from inventory_stock where product_id = $1`,
      [pack.productId]
    );
    expect(afterStock.rows[0]!.n).toBe(beforeStock.rows[0]!.n);
    expect(afterStock.rows[0]!.q).toBe(beforeStock.rows[0]!.q);
    expect(await countRows('inventory_batches', `id = '${batch[0]!.id}'`)).toBe(1);
    expect(await countRows('warehouses', `id = '${wh[0]!.id}'`)).toBe(1);
  });
});

describe('orders tree — foreign-key safety and child-first deletion', () => {
  it('removes the whole order tree, keeps young dependents, and nulls historical links without FK errors', async () => {
    const oldOrder = await seedOrder(130);
    const oldItem = await seedOrderItem(oldOrder);
    // Walk the order to 'delivered' through legal transitions (0042).
    for (const status of ['confirmed', 'dispatched', 'delivered']) {
      await db.query(`update orders set status = $1::order_status where id = $2`, [status, oldOrder]);
    }
    await db.query(
      `insert into order_status_history (order_id, status, changed_by, created_at) values ($1, 'pending', $2, now() - interval '130 days')`,
      [oldOrder, admin]
    );
    await db.query(
      `insert into visits (salesman_id, retailer_id, status, order_id) values ($1, $2, 'checked_out', $3)`,
      [admin, retailer.id, oldOrder]
    );
    // A return request YOUNGER than 120 days on an old order: deleted child-first
    // with its parent (never left as a dangling FK).
    const youngReturn = await db.query<{ id: string }>(
      `insert into return_requests (order_id, order_item_id, retailer_id, reason, status, requested_at)
       values ($1, $2, $3, 'late return on old order', 'requested', now() - interval '10 days') returning id`,
      [oldOrder, oldItem, retailer.id]
    );
    // A payment YOUNGER than 120 days on an old order: survives with order_id set
    // to NULL (nullable historical reference — its own rule deletes it later).
    await db.query(
      `insert into payment_collections (retailer_id, order_id, collected_by, amount_paise, method, status, created_at)
       values ($1, $2, $3, 7000, 'upi', 'pending', now() - interval '10 days')`,
      [retailer.id, oldOrder, admin]
    );
    await db.query(
      `insert into support_tickets (ticket_number, retailer_id, subject, topic, status, order_id, created_at)
       values ($1, $2, 'ticket on old order', 'order', 'open', $3, now() - interval '10 days')`,
      [`T-${randomUUID().slice(0, 10)}`, retailer.id, oldOrder]
    );

    const report = await runCleanup();
    expect(report.status).toBe('completed');
    expect(target(report, 'orders').deleted_rows).toBeGreaterThanOrEqual(1);

    expect(await countRows('orders', `id = '${oldOrder}'`)).toBe(0);
    expect(await countRows('order_items', `id = '${oldItem}'`)).toBe(0);
    expect(await countRows('order_status_history', `order_id = '${oldOrder}'`)).toBe(0);
    expect(await countRows('return_requests', `id = '${youngReturn.rows[0]!.id}'`)).toBe(0);

    const visit = await db.query<{ order_id: string | null }>(
      `select order_id from visits where retailer_id = $1 and order_id is null`,
      [retailer.id]
    );
    expect(visit.rows.length).toBeGreaterThanOrEqual(1);

    const payment = await db.query<{ order_id: string | null }>(
      `select order_id from payment_collections where retailer_id = $1 and status = 'pending'`,
      [retailer.id]
    );
    expect(payment.rows[0]!.order_id).toBeNull();
    expect(await countRows('support_tickets', `order_id is null and retailer_id = '${retailer.id}'`)).toBe(1);
  });
});

describe('coins / historical credit ledger purge — balances preserved', () => {
  it('folds the deleted rows balance delta into the opening baseline so outstanding is unchanged', async () => {
    const walletRetailer = await createRetailer(db, { creditLimitRupees: 5000 });
    await seedLedger(walletRetailer.id, 130, 'debit', 50000, 'ORDER_DEBIT');
    await seedLedger(walletRetailer.id, 130, 'credit', 20000, 'MANUAL_CREDIT');
    await seedLedger(walletRetailer.id, 5, 'debit', 10000, 'ORDER_DEBIT');

    const readOutstanding = async (): Promise<number> => {
      const { rows } = await db.query<{ n: string }>(
        `select get_retailer_outstanding_paise($1)::text as n`,
        [walletRetailer.id]
      );
      return Number(rows[0]!.n);
    };
    const before = await readOutstanding();
    expect(before).toBe(40000); // 50000 - 20000 + 10000

    const report = await runCleanup();
    expect(report.status).toBe('completed');
    const ledger = target(report, 'coins_ledger');
    expect(ledger.deleted_rows).toBe(2);

    const after = await readOutstanding();
    expect(after).toBe(before); // live balance mathematically unchanged

    const { rows: acct } = await db.query<{ opening_outstanding_paise: string }>(
      `select opening_outstanding_paise from retailer_credit_accounts where retailer_id = $1`,
      [walletRetailer.id]
    );
    expect(Number(acct[0]!.opening_outstanding_paise)).toBe(30000);
    expect(await countRows('retailer_wallet_ledger', `retailer_id = '${walletRetailer.id}'`)).toBe(1);
  });

  it('unlinks surviving reversal references (nullable historical FK) when the original row is purged', async () => {
    const walletRetailer = await createRetailer(db, { creditLimitRupees: 1000 });
    const debitId = await seedLedger(walletRetailer.id, 130, 'debit', 30000, 'ORDER_DEBIT', { isReversed: true });
    // The reversal credit is YOUNG and points at the old debit via reversal_of.
    const reversalId = await seedLedger(walletRetailer.id, 2, 'credit', 30000, 'ORDER_REVERSAL', {
      reversalOf: debitId,
      idempotencyKey: `reversal:${debitId}`,
    });

    const outstandingBefore = await db.query<{ n: string }>(
      `select get_retailer_outstanding_paise($1)::text as n`,
      [walletRetailer.id]
    );

    const report = await runCleanup();
    expect(report.status).toBe('completed');

    expect(await countRows('retailer_wallet_ledger', `id = '${debitId}'`)).toBe(0);
    expect(await countRows('retailer_wallet_ledger', `id = '${reversalId}'`)).toBe(1);
    const survivor = await db.query<{ reversal_of: string | null }>(
      `select reversal_of from retailer_wallet_ledger where id = $1`,
      [reversalId]
    );
    expect(survivor.rows[0]!.reversal_of).toBeNull(); // no broken FK

    const outstandingAfter = await db.query<{ n: string }>(
      `select get_retailer_outstanding_paise($1)::text as n`,
      [walletRetailer.id]
    );
    expect(outstandingAfter.rows[0]!.n).toBe(outstandingBefore.rows[0]!.n);
  });

  it('reports coins/credit ledger counts by transaction type', async () => {
    const walletRetailer = await createRetailer(db, { creditLimitRupees: 1000 });
    await seedLedger(walletRetailer.id, 200, 'debit', 1000, 'ORDER_DEBIT');
    await seedLedger(walletRetailer.id, 200, 'credit', 500, 'REFUND_CREDIT');

    const report = await runCleanup();
    const ledger = target(report, 'coins_ledger');
    expect(ledger.breakdown).toBeTruthy();
    expect((ledger.breakdown!.ORDER_DEBIT ?? 0)).toBeGreaterThanOrEqual(1);
    expect((ledger.breakdown!.REFUND_CREDIT ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('permanent product data is never deleted', () => {
  it('keeps products, packs, stock, images, categories, brands, SKU/barcode and pricing through a full cleanup', async () => {
    const p = await createPack(db);
    await as(db, admin, (tx) =>
      tx.query(`select admin_set_product_pack_stock($1, $2)`, [p.packId, 42])
    );
    await db.query(`insert into product_images (product_id, image_url, created_at) values ($1, 'https://x/y.png', now() - interval '400 days')`, [p.productId]);
    await db.query(`insert into product_pricing_tiers (product_pack_id, min_quantity, price_per_piece) values ($1, 1, 90)`, [p.packId]);
    await db.query(`update products set barcode = 'EAN-TEST-1', sku_code = 'SKU-TEST-1' where id = $1`, [p.productId]);

    // Seed deletable history too, so the cleanup actually runs its120-day pass.
    const oldOrder = await seedOrder(200);
    await seedOrderItem(oldOrder);

    await runCleanup();

    expect(await countRows('products', `id = '${p.productId}'`)).toBe(1);
    expect(await countRows('product_packs', `id = '${p.packId}'`)).toBe(1);
    const stock = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from product_packs where id = $1`,
      [p.packId]
    );
    expect(stock.rows[0]!.stock_quantity).toBe(42);
    expect(await countRows('product_images', `product_id = '${p.productId}'`)).toBe(1);
    expect(await countRows('product_pricing_tiers', `product_pack_id = '${p.packId}'`)).toBe(1);
    expect(await countRows('categories', `id = '${p.categoryId}'`)).toBe(1);
    expect(await countRows('brands', `id = '${p.brandId}'`)).toBe(1);
    const master = await db.query<{ sku_code: string | null; barcode: string | null; base_price: unknown }>(
      `select sku_code, barcode, base_price from products where id = $1`,
      [p.productId]
    );
    expect(master.rows[0]!.sku_code).toBe('SKU-TEST-1');
    expect(master.rows[0]!.barcode).toBe('EAN-TEST-1');
    expect(Number(master.rows[0]!.base_price)).toBe(100);

    // The old order tree was still cleaned (cleanup did run).
    expect(await countRows('orders', `id = '${oldOrder}'`)).toBe(0);
  });

  it('does not delete active customer/retailer master records because of order age', async () => {
    const oldOrder = await seedOrder(300);
    await seedOrderItem(oldOrder);
    await runCleanup();
    expect(await countRows('retailers', `id = '${retailer.id}'`)).toBe(1);
    expect(await countRows('retailer_credit_accounts', `retailer_id = '${retailer.id}'`)).toBe(1);
  });
});

describe('dry run, idempotency, bounded batches, partial failure', () => {
  it('dry run reports eligible rows and deletes nothing', async () => {
    const p = await createPack(db);
    await db.query(
      `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '100 days')`,
      [retailer.id, p.packId]
    );

    const report = await runCleanup({ dryRun: true });
    expect(report.dry_run).toBe(true);
    expect(report.status).toBe('completed');
    const carts = target(report, 'abandoned_carts');
    expect(carts.action).toBe('DELETE');
    expect(carts.eligible_rows).toBeGreaterThanOrEqual(1);
    expect(carts.deleted_rows).toBe(0);
    expect(await countRows('cart_items', `pack_id = '${p.packId}'`)).toBe(1);

    // The dry run left an audit row behind for observability.
    expect(await countRows('cleanup_runs', `dry_run = true`)).toBeGreaterThanOrEqual(1);
  });

  it('running cleanup twice is idempotent — the second run deletes nothing', async () => {
    const p = await createPack(db);
    await db.query(
      `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '100 days')`,
      [retailer.id, p.packId]
    );
    const first = await runCleanup();
    expect(target(first, 'abandoned_carts').deleted_rows).toBeGreaterThanOrEqual(1);

    const second = await runCleanup();
    const totalDeleted = second.totals.deleted ?? second.totals.temporary + second.totals['120_day'];
    expect(totalDeleted).toBe(0);
  });

  it('respects max_rows_per_target (bounded processing)', async () => {
    const packs = await Promise.all([1, 2, 3, 4].map(() => createPack(db)));
    for (const p of packs) {
      await db.query(
        `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '100 days')`,
        [retailer.id, p.packId]
      );
    }
    const first = await runCleanup({ batchSize: 2, maxRows: 2 });
    expect(target(first, 'abandoned_carts').deleted_rows).toBe(2);
    const second = await runCleanup({ batchSize: 2, maxRows: 2 });
    expect(target(second, 'abandoned_carts').deleted_rows).toBe(2);
    const third = await runCleanup({ batchSize: 2, maxRows: 2 });
    expect(target(third, 'abandoned_carts').deleted_rows).toBe(0);
  });

  it('records a failing category and still cleans the others (no silent success)', async () => {
    const p = await createPack(db);
    await db.query(
      `insert into cart_items (retailer_id, pack_id, quantity, updated_at) values ($1, $2, 1, now() - interval '100 days')`,
      [retailer.id, p.packId]
    );
    // Simulate a misconfigured/unknown target appearing in the registry.
    await db.query(
      `insert into data_retention_rules (target_key, category, table_name, retention_days, cutoff_column, deletion_order, enabled, description)
       values ('broken_target', 'temporary_90', 'cart_items', 90, 'updated_at', 999, true, 'Injected failure for tests')`
    );

    const report = await runCleanup();
    expect(report.status).toBe('completed_with_errors');
    expect(report.errors.some((e) => e.target_key === 'broken_target')).toBe(true);
    // The other categories still ran.
    expect(target(report, 'abandoned_carts').deleted_rows).toBeGreaterThanOrEqual(1);
    expect(await countRows('cart_items', `pack_id = '${p.packId}'`)).toBe(0);

    // Retry after fixing the configuration completes cleanly.
    await db.query(`delete from data_retention_rules where target_key = 'broken_target'`);
    const retry = await runCleanup();
    expect(retry.status).toBe('completed');
  });

  it('refuses a rule whose table does not match its implementation', async () => {
    await db.query(`delete from data_retention_rules where target_key = 'orders'`);
    await db.query(
      `insert into data_retention_rules (target_key, category, table_name, retention_days, cutoff_column, deletion_order, enabled, description)
       values ('orders', 'business_120', 'products', 120, 'created_at', 150, true, 'tampered rule pointing at products')`
    );

    const report = await runCleanup();
    const orders = report.targets.find((t) => t.target_key === 'orders');
    expect(orders?.status).toBe('failed');
    expect(report.errors.some((e) => /implementation uses/i.test(e.message) || e.target_key === 'orders')).toBe(true);
    // products were NOT deleted by the tampered rule
    expect(await countRows('products', `id = '${pack.productId}'`)).toBe(1);

    // Restore the correct rule for later tests.
    await db.query(`delete from data_retention_rules where target_key = 'orders'`);
    await db.query(
      `insert into data_retention_rules (target_key, category, table_name, retention_days, cutoff_column, deletion_order, enabled, description)
       values ('orders', 'business_120', 'orders', 120, 'placed_at', 150, true, 'Orders older than 120 days with their order items and children.')`
    );
  });

  it('records every run in the audit log with run_id, status and per-target counts', async () => {
    const report = await runCleanup();
    expect(report.run_id).toMatch(/^cleanup-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
    const { rows } = await db.query<{ run_id: string; status: string; summary: unknown }>(
      `select run_id, status, summary from cleanup_runs where run_id = $1`,
      [report.run_id]
    );
    expect(rows[0]!.status).toBe(report.status);
    expect(JSON.stringify(rows[0]!.summary)).toMatch(/targets/);
  });
});
