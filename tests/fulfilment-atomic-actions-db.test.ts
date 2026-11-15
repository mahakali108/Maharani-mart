/**
 * Behavioural tests for the three fulfilment server actions that became single
 * database transactions in migration 0100:
 *
 *   dispatchOrderAction            -> dispatch_order_atomic
 *   recordFailedDeliveryAction     -> fail_delivery_atomic
 *   recordReturnToWarehouseAction  -> return_delivery_to_warehouse_atomic
 *
 * The REAL server actions run against the REAL migrations on PostgreSQL 16
 * (PGlite). Only the edges are replaced: the signed-in user, notifications,
 * Next's cache, and the service-role client — whose `rpc` executes the function
 * as `service_role` in one transaction, exactly like PostgREST does.
 *
 * Limit, stated honestly: PGlite has one connection, so nothing here proves
 * concurrency. Multi-session races for the same functions run on real
 * PostgreSQL 17 in tests/pr126-fulfilment-and-locks.pg.mjs.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

process.env.DELIVERY_OTP_SECRET = 'test-only-delivery-otp-secret';

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; email: string | null; fullName: string | null },
  db: null as unknown,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  trustedAvailable: true,
}));

const SIGNATURES: Record<string, string> = {
  dispatch_order_atomic: `select public.dispatch_order_atomic($1, $2, $3) as r`,
  fail_delivery_atomic: `select public.fail_delivery_atomic($1, $2, $3) as r`,
  return_delivery_to_warehouse_atomic: `select public.return_delivery_to_warehouse_atomic($1, $2, $3) as r`,
};

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn(async () => state.user) }));
vi.mock('@/lib/admin/guard', () => ({
  requirePermission: vi.fn(async (permission: string) => {
    const { can } = await import('@/lib/permissions/permissions');
    if (!state.user || !can(state.user.role as never, permission as never)) throw new Error('NEXT_REDIRECT:/unauthorized');
    return state.user;
  }),
}));
vi.mock('@/lib/notifications/notify', () => ({
  notifyOrderEvent: vi.fn(async () => undefined),
  createInAppNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/inventory/alerts', () => ({ notifyLowStockIfNeeded: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  // None of these three actions may write through the user's own session.
  createClient: vi.fn(async () => {
    throw new Error('fulfilment actions must not use the session client');
  }),
  createServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/delivery/trusted-writer', () => ({
  TRUSTED_WRITER_UNAVAILABLE: 'Delivery verification is not configured on the server. Ask an administrator to complete this step.',
  createTrustedDeliveryWriter: () => {
    if (!state.trustedAvailable) return null;
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        const sql = SIGNATURES[name];
        if (!sql) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache`, code: 'PGRST202' } };
        const { as: runAs } = await import('./helpers/pg-harness');
        try {
          const data = await runAs(state.db as Db, 'service', async (tx: Tx) => {
            const { rows } = await tx.query<{ r: unknown }>(sql, Object.values(args));
            return rows[0]!.r;
          });
          return { data, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } };
        }
      },
    };
  },
}));

import { dispatchOrderAction } from '@/lib/staff/dispatch-actions';
import { recordFailedDeliveryAction, recordReturnToWarehouseAction } from '@/lib/delivery/delivery-actions';
import { updateOrderStatusAction } from '@/lib/admin/orders-actions';
import { hashDeliveryOtp } from '@/lib/delivery/otp';
import { notifyOrderEvent } from '@/lib/notifications/notify';

let db: Db;
let admin: string;
let staff: string;
let otherStaff: string;
let outsider: string;
let salesman: string;
let warehouse: string;
let productId: string;

interface Fixture { orderId: string; retailer: string; packId: string; itemId: string }

/** A PACKED order: 3 packs (Rs 300) already deducted at checkout (pack stock 7), Rs 300 paid in Coins. */
async function packed(): Promise<Fixture> {
  const retailer = (await createRetailer(db)).id;
  const orderId = randomUUID();
  const packId = randomUUID();
  await db.query(
    `insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id)
     values ($1, $2, $3, 'pending', 300, 0, 0, 300, $4)`,
    [orderId, `F-${orderId.slice(0, 8)}`, retailer, warehouse]);
  await db.exec(`alter table public.order_items disable trigger user; alter table public.product_packs disable trigger user;`);
  await db.query(
    `insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity)
     values ($1, $2, $3, $4, 100, 100, 7)`, [packId, productId, `Pack ${packId}`, `SKU-${packId}`]);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, product_id, pack_id, source_type, fulfilment_type, quantity, unit_price, gst_percent, line_total, stock_deducted_quantity)
     values ($1, $2, $3, 'maharani', 'maharani', 3, 100, 0, 300, 3) returning id`, [orderId, productId, packId]);
  await db.exec(`alter table public.order_items enable trigger user; alter table public.product_packs enable trigger user;`);
  await db.query(
    `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
     values ($1, 'ORDER_DEBIT', 30000, 'debit', 'order', $2, 'checkout', $3)`, [retailer, orderId, `order:${orderId}`]);
  for (const status of ['confirmed', 'processing', 'packed']) {
    await db.query(`update public.orders set status = $2 where id = $1`, [orderId, status]);
  }
  return { orderId, retailer, packId, itemId: rows[0]!.id };
}

function actAs(id: string, role: string) {
  state.user = { id, role, email: null, fullName: role };
}

async function dispatchedBy(actor: string, role: string): Promise<Fixture> {
  const f = await packed();
  actAs(actor, role);
  expect(await dispatchOrderAction(f.orderId)).toEqual({ success: true });
  return f;
}

/** Completes the delivery through the real 0099 function (full delivery unless `missing`). */
async function complete(f: Fixture, missing = 0) {
  const { rows } = await db.query<{ otp_hash: string; assigned_staff_id: string }>(
    `select otp_hash, assigned_staff_id from public.order_deliveries where order_id = $1`, [f.orderId]);
  await as(db, 'service', (tx: Tx) => tx.query(
    `select public.complete_delivery_atomic($1, $2, $3, $4, 'Shop Owner', null, null, null, $5::jsonb)`,
    [f.orderId, rows[0]!.assigned_staff_id, rows[0]!.otp_hash, `key-${f.orderId}`,
      JSON.stringify([{ order_item_id: f.itemId, delivered: 3 - missing, missing, damaged: 0 }])]));
}

async function snap(f: Fixture) {
  const one = async <T,>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const [order] = await one<{ s: string; b: string | null }>(`select status::text s, dispatched_by b from public.orders where id = $1`, [f.orderId]);
  const deliveries = await one<{ id: string; s: string; a: string | null; h: string | null; n: number; r: string | null }>(
    `select id, delivery_status s, assigned_staff_id a, otp_hash h, otp_attempts n, failure_reason r from public.order_deliveries where order_id = $1`, [f.orderId]);
  const lines = deliveries.length
    ? await one<{ o: number; d: number; m: number }>(`select quantity_ordered o, quantity_delivered d, quantity_missing m from public.order_delivery_items where delivery_id = $1 order by created_at, id`, [deliveries[0]!.id])
    : [];
  const [pack] = await one<{ n: number }>(`select stock_quantity n from public.product_packs where id = $1`, [f.packId]);
  const reversals = await one<{ n: string; by: string }>(
    `select amount_paise::text n, created_by "by" from public.retailer_wallet_ledger where reference_type = 'order' and reference_id = $1 and transaction_type = 'ORDER_REVERSAL'`, [f.orderId]);
  const loyalty = await one<{ t: string; n: number }>(`select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at, points desc`, [f.orderId]);
  return {
    order: order!.s, dispatchedBy: order!.b,
    deliveries: deliveries.map((d) => d.s), delivery: deliveries[0] ?? null,
    lines: lines.map((l) => `${l.o}:${l.d}/${l.m}`),
    packStock: pack!.n,
    reversals: reversals.map((r) => Number(r.n)), reversalActors: reversals.map((r) => r.by),
    loyalty: loyalty.map((l) => `${l.t}:${l.n}`),
  };
}

async function withFailure(table: string, when: string, fn: () => Promise<void>) {
  const name = `trg_test_fail_${table}`;
  await db.exec(`
    create or replace function public._test_fail() returns trigger language plpgsql as $$
    begin raise exception 'TEST_INJECTED_FAILURE on %', tg_table_name; end $$;
    create trigger ${name} before ${when} on public.${table} for each row execute function public._test_fail();`);
  try { await fn(); } finally { await db.exec(`drop trigger ${name} on public.${table};`); }
}

const errorText = (result: unknown) => (result as { error?: string }).error ?? '';
const notified = () => vi.mocked(notifyOrderEvent).mock.calls.map((c) => (c[0] as { title: string }).title);

beforeAll(async () => {
  db = await createMigratedDb();
  state.db = db;
  admin = await createUser(db, 'super_admin', 'Admin');
  staff = await createUser(db, 'staff', 'Warehouse Staff');
  otherStaff = await createUser(db, 'staff', 'Other Staff');
  outsider = await createUser(db, 'staff', 'Staff of another warehouse');
  salesman = await createUser(db, 'salesman', 'Salesman');
  const { rows } = await db.query<{ id: string }>(`insert into public.warehouses (name, is_active) values ('WH 0100', true) returning id`);
  warehouse = rows[0]!.id;
  await db.query(`insert into public.staff_assignments (staff_id, warehouse_id) values ($1, $3), ($2, $3)`, [staff, otherStaff, warehouse]);
  await db.exec(`alter table public.categories disable trigger user; alter table public.products disable trigger user;`);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ('Cat 0100') returning id`);
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
     values ('SKU-0100', 'Product 0100', 'pcs', 100, 18, $1, true) returning id`, [cat[0]!.id]);
  await db.exec(`alter table public.categories enable trigger user; alter table public.products enable trigger user;`);
  productId = product[0]!.id;
}, 180_000);

afterEach(() => {
  state.rpcCalls.length = 0;
  state.trustedAvailable = true;
  vi.mocked(notifyOrderEvent).mockClear();
});

describe('dispatchOrderAction — one transaction', () => {
  it('dispatches: order status, one delivery task for the actor, hashed OTP, a snapshot of every line; the OTP goes only to the retailer in-app', async () => {
    const f = await packed();
    actAs(staff, 'staff');
    expect(await dispatchOrderAction(f.orderId)).toEqual({ success: true });
    const s = await snap(f);
    expect(s).toMatchObject({ order: 'dispatched', dispatchedBy: staff, deliveries: ['assigned'], lines: ['3:0/0'], packStock: 7 });
    expect(s.delivery!.a).toBe(staff);
    expect(state.rpcCalls.map((c) => c.name)).toEqual(['dispatch_order_atomic']);
    // Only the keyed digest reached the database, and it matches the OTP the retailer was told.
    const call = vi.mocked(notifyOrderEvent).mock.calls[0]![0] as { recipientId: string; body: string; channelBody: string };
    const otp = /OTP is (\d{6})/.exec(call.body)![1]!;
    expect(call.recipientId).toBe(f.retailer);
    expect(call.channelBody).not.toMatch(/\d{6}/);
    expect(s.delivery!.h).toBe(hashDeliveryOtp(f.orderId, otp));
    expect(JSON.stringify(state.rpcCalls[0]!.args)).not.toContain(otp);
  });

  it('a second dispatch changes nothing: no second task, no new OTP, no second notification', async () => {
    const f = await dispatchedBy(staff, 'staff');
    const before = await snap(f);
    vi.mocked(notifyOrderEvent).mockClear();
    expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/already dispatched/);
    actAs(admin, 'super_admin');
    expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/already dispatched/);
    expect(await snap(f)).toEqual(before);
    expect(notified()).toEqual([]);
  });

  it.each([
    ['orders', 'update'],
    ['order_deliveries', 'insert'],
    ['order_delivery_items', 'insert'],
  ])('a failure while writing %s leaves the order packed with no delivery task; the retry succeeds', async (table, when) => {
    const f = await packed();
    actAs(staff, 'staff');
    await withFailure(table, when, async () => {
      expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/could not be dispatched\. Nothing was changed/);
    });
    expect(await snap(f)).toMatchObject({ order: 'packed', dispatchedBy: null, deliveries: [], lines: [], packStock: 7 });
    expect(notified()).toEqual([]);
    expect(await dispatchOrderAction(f.orderId)).toEqual({ success: true });
    expect(await snap(f)).toMatchObject({ order: 'dispatched', deliveries: ['assigned'], lines: ['3:0/0'] });
  });

  it('refuses a salesman (no permission), staff of another warehouse (scope), a missing server key, and a missing 0100 — and changes nothing', async () => {
    const f = await packed();
    actAs(salesman, 'salesman');
    await expect(dispatchOrderAction(f.orderId)).rejects.toThrow(/NEXT_REDIRECT/);
    actAs(outsider, 'staff');
    expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/outside your warehouse or area/);
    actAs(staff, 'staff');
    state.trustedAvailable = false;
    expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/not configured on the server/);
    state.trustedAvailable = true;
    expect(await snap(f)).toMatchObject({ order: 'packed', deliveries: [] });
    expect(notified()).toEqual([]);
  });

  it('the database does not trust the app about the actor: a forged actor id with a staff session is still checked', async () => {
    const f = await packed();
    for (const actor of [salesman, f.retailer, randomUUID()]) {
      expect(await errorOf(db, 'service', (tx: Tx) => tx.query(SIGNATURES.dispatch_order_atomic!, [f.orderId, actor, 'a'.repeat(64)]))).toMatch(/DISPATCH:NO_PERMISSION/);
    }
    for (const who of [staff, admin, f.retailer, 'anon']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(SIGNATURES.dispatch_order_atomic!, [f.orderId, staff, 'a'.repeat(64)]))).toMatch(/permission denied/);
    }
    expect(await snap(f)).toMatchObject({ order: 'packed', deliveries: [] });
  });

  it('the generic status action and a direct UPDATE cannot dispatch or return an order', async () => {
    const f = await packed();
    actAs(admin, 'super_admin');
    expect(errorText(await updateOrderStatusAction(f.orderId, 'dispatched' as never))).toMatch(/Use the Dispatch button/);
    expect(errorText(await updateOrderStatusAction(f.orderId, 'returned' as never))).toMatch(/Use Return to warehouse/);
    for (const who of [admin, staff, 'service']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.orders set status = 'dispatched' where id = $1 returning id`, [f.orderId]))).toMatch(/FULFILMENT_GUARD/);
    }
    expect(await snap(f)).toMatchObject({ order: 'packed', deliveries: [] });
  });
});

describe('recordFailedDeliveryAction — one transaction', () => {
  it('marks the delivery failed and re-opens the order together; a repeat writes nothing and does not notify again', async () => {
    const f = await dispatchedBy(staff, 'staff');
    vi.mocked(notifyOrderEvent).mockClear();
    expect(await recordFailedDeliveryAction(f.orderId, '  Shop closed  ')).toMatchObject({ success: true });
    let s = await snap(f);
    expect(s).toMatchObject({ order: 'processing', deliveries: ['failed'] });
    expect(s.delivery!.r).toBe('Shop closed');
    expect(notified()).toEqual(['Delivery could not be completed']);
    expect(await recordFailedDeliveryAction(f.orderId, 'A different reason')).toMatchObject({ success: true });
    s = await snap(f);
    expect(s.delivery!.r).toBe('Shop closed');
    expect(notified()).toEqual(['Delivery could not be completed']);
  });

  it('a failure while re-opening the order rolls the delivery back too (no failed task on a dispatched order)', async () => {
    const f = await dispatchedBy(staff, 'staff');
    vi.mocked(notifyOrderEvent).mockClear();
    await withFailure('orders', 'update', async () => {
      expect(errorText(await recordFailedDeliveryAction(f.orderId, 'Shop closed'))).toMatch(/Nothing was changed/);
    });
    expect(await snap(f)).toMatchObject({ order: 'dispatched', deliveries: ['assigned'] });
    expect(notified()).toEqual([]);
  });

  it('only the assignee or an Admin; an assigned salesman may; a short reason and a completed delivery are refused', async () => {
    const f = await dispatchedBy(staff, 'staff');
    actAs(otherStaff, 'staff');
    expect(errorText(await recordFailedDeliveryAction(f.orderId, 'Shop closed'))).toMatch(/Only the assigned delivery person/);
    actAs(salesman, 'salesman');
    expect(errorText(await recordFailedDeliveryAction(f.orderId, 'Shop closed'))).toMatch(/Only the assigned delivery person/);
    actAs(staff, 'staff');
    expect(errorText(await recordFailedDeliveryAction(f.orderId, 'x'))).toMatch(/3–500 characters/);
    expect(await snap(f)).toMatchObject({ order: 'dispatched', deliveries: ['assigned'] });

    await db.query(`update public.order_deliveries set assigned_staff_id = $2 where order_id = $1`, [f.orderId, salesman]);
    actAs(salesman, 'salesman');
    expect(await recordFailedDeliveryAction(f.orderId, 'Shop closed')).toMatchObject({ success: true });
    expect(await snap(f)).toMatchObject({ order: 'processing', deliveries: ['failed'] });

    const done = await dispatchedBy(staff, 'staff');
    await complete(done);
    expect(errorText(await recordFailedDeliveryAction(done.orderId, 'Shop closed'))).toMatch(/delivered — it can no longer be marked failed/);
    expect(await snap(done)).toMatchObject({ order: 'delivered', deliveries: ['delivered'] });
  });

  it('re-dispatch after a failure resets the SAME task: new OTP, zero attempts, fresh lines; a failed re-dispatch keeps the failed state', async () => {
    const f = await dispatchedBy(staff, 'staff');
    const first = await snap(f);
    await as(db, staff, (tx: Tx) => tx.query(`update public.order_delivery_items set quantity_delivered = 1, quantity_missing = 2 where order_item_id = $1`, [f.itemId]));
    await db.query(`update public.order_deliveries set otp_attempts = 4 where order_id = $1`, [f.orderId]);
    expect(await recordFailedDeliveryAction(f.orderId, 'Shop closed')).toMatchObject({ success: true });

    await withFailure('order_delivery_items', 'insert', async () => {
      expect(errorText(await dispatchOrderAction(f.orderId))).toMatch(/Nothing was changed/);
    });
    expect(await snap(f)).toMatchObject({ order: 'processing', deliveries: ['failed'], lines: ['3:1/2'] });

    actAs(otherStaff, 'staff');
    expect(await dispatchOrderAction(f.orderId)).toEqual({ success: true });
    const s = await snap(f);
    expect(s).toMatchObject({ order: 'dispatched', deliveries: ['assigned'], lines: ['3:0/0'], packStock: 7 });
    expect(s.delivery!.id).toBe(first.delivery!.id);
    expect(s.delivery!.a).toBe(otherStaff);
    expect(s.delivery!.n).toBe(0);
    expect(s.delivery!.r).toBeNull();
    expect(s.delivery!.h).not.toBe(first.delivery!.h);
  });
});

describe('recordReturnToWarehouseAction — one transaction', () => {
  it('returns stock, closes delivery and order, refunds the Coins and reverses the points — once, attributed to the actor', async () => {
    const f = await dispatchedBy(staff, 'staff');
    await complete(f);
    expect(await snap(f)).toMatchObject({ order: 'delivered', packStock: 7, reversals: [], loyalty: ['ORDER_EARN:3'] });
    vi.mocked(notifyOrderEvent).mockClear();
    state.rpcCalls.length = 0;
    actAs(staff, 'staff');
    expect(await recordReturnToWarehouseAction(f.orderId, 'Retailer refused the goods')).toMatchObject({ success: true });
    const s = await snap(f);
    expect(s).toMatchObject({
      order: 'returned', deliveries: ['returned_to_warehouse'], packStock: 10,
      reversals: [30000], reversalActors: [staff], loyalty: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'],
    });
    expect(notified()).toEqual(['Order returned to warehouse']);
    expect(state.rpcCalls.map((c) => c.name)).toEqual(['return_delivery_to_warehouse_atomic']);
  });

  it('retries after success change nothing: stock, refund and points are not applied again, and the retailer is not notified again', async () => {
    const f = await dispatchedBy(staff, 'staff');
    await complete(f);
    expect(await recordReturnToWarehouseAction(f.orderId)).toMatchObject({ success: true });
    const before = await snap(f);
    vi.mocked(notifyOrderEvent).mockClear();
    for (const [id, role] of [[staff, 'staff'], [admin, 'super_admin'], [otherStaff, 'staff']] as const) {
      actAs(id, role);
      expect(await recordReturnToWarehouseAction(f.orderId, 'again')).toMatchObject({ success: true });
    }
    expect(await snap(f)).toEqual(before);
    expect(before.packStock).toBe(10);
    expect(notified()).toEqual([]);
  });

  it.each([
    ['product_packs', 'update'],
    ['order_deliveries', 'update'],
    ['orders', 'update'],
    ['retailer_wallet_ledger', 'insert'],
    ['loyalty_ledger', 'insert'],
  ])('a failure while writing %s rolls back stock, statuses, refund and points; the retry then completes once', async (table, when) => {
    const f = await dispatchedBy(staff, 'staff');
    await complete(f);
    const before = await snap(f);
    vi.mocked(notifyOrderEvent).mockClear();
    await withFailure(table, when, async () => {
      expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/Nothing was changed/);
    });
    expect(await snap(f)).toEqual(before);
    expect(notified()).toEqual([]);
    expect(await recordReturnToWarehouseAction(f.orderId)).toMatchObject({ success: true });
    expect(await snap(f)).toMatchObject({ order: 'returned', packStock: 10, reversals: [30000], loyalty: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'] });
  });

  it('a delivery with a shortfall credit is refused up front and left untouched (it used to end half-returned)', async () => {
    const f = await dispatchedBy(staff, 'staff');
    await complete(f, 1);
    const before = await snap(f);
    expect(before).toMatchObject({ order: 'delivered', deliveries: ['partially_delivered'] });
    actAs(admin, 'super_admin');
    expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/already has a shortfall credit.*Nothing was changed/);
    expect(await snap(f)).toEqual(before);
  });

  it('refuses a salesman, staff of another warehouse, over-long notes, an open delivery and a missing server key', async () => {
    const f = await dispatchedBy(staff, 'staff');
    expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/only a completed delivery can be returned/);
    await complete(f);
    const before = await snap(f);
    actAs(salesman, 'salesman');
    expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/do not have permission to manage returns/);
    actAs(outsider, 'staff');
    expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/outside your warehouse or area/);
    actAs(staff, 'staff');
    expect(errorText(await recordReturnToWarehouseAction(f.orderId, 'x'.repeat(1001)))).toMatch(/1000 characters or fewer/);
    state.trustedAvailable = false;
    expect(errorText(await recordReturnToWarehouseAction(f.orderId))).toMatch(/not configured on the server/);
    expect(await snap(f)).toEqual(before);
  });

  it('no API role can reach "returned" or "returned_to_warehouse" by a direct write, or edit quantities after completion', async () => {
    const f = await dispatchedBy(staff, 'staff');
    await complete(f);
    const before = await snap(f);
    for (const who of [admin, staff, 'service']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.orders set status = 'returned' where id = $1 returning id`, [f.orderId]))).toMatch(/FULFILMENT_GUARD/);
    }
    for (const who of [admin, 'service']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.order_deliveries set delivery_status = 'returned_to_warehouse' where order_id = $1 returning id`, [f.orderId]))).toMatch(/FULFILMENT_GUARD/);
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.order_delivery_items set quantity_delivered = 1, quantity_missing = 2 where order_item_id = $1 returning id`, [f.itemId]))).toMatch(/DELIVERY_GUARD/);
    }
    for (const who of [staff, admin, f.retailer, 'anon']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(SIGNATURES.return_delivery_to_warehouse_atomic!, [f.orderId, staff, null]))).toMatch(/permission denied/);
      expect(await errorOf(db, who, (tx: Tx) => tx.query(SIGNATURES.fail_delivery_atomic!, [f.orderId, staff, 'Shop closed']))).toMatch(/permission denied/);
    }
    expect(await snap(f)).toEqual(before);
  });
});
