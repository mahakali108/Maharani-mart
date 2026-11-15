/**
 * Behavioural tests for the return-request server actions that became single
 * database transactions in migration 0101:
 *
 *   approveReturnAction -> approve_return_request_atomic
 *   rejectReturnAction  -> reject_return_request_atomic
 *
 * The REAL server actions run against the REAL migrations on PostgreSQL 16
 * (PGlite). Only the edges are replaced: the signed-in user, notifications,
 * Next's cache, and the service-role client — whose `rpc` executes the function
 * as `service_role` in one transaction, exactly like PostgREST does. The
 * retailer's request is inserted from a retailer session, so row-level security
 * and the insert guard apply.
 *
 * Limit, stated honestly: PGlite has one connection, so nothing here proves
 * concurrency. Simultaneous approvals and the approve/reject race run on real
 * PostgreSQL 17 in tests/pr126-return-requests.pg.mjs.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

process.env.DELIVERY_OTP_SECRET = 'test-only-delivery-otp-secret';

const state = vi.hoisted(() => ({
  missing: new Set<string>(),
  user: null as null | { id: string; role: string; email: string | null; fullName: string | null },
  db: null as unknown,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  trustedAvailable: true,
}));

const SIGNATURES: Record<string, string> = {
  dispatch_order_atomic: `select public.dispatch_order_atomic($1, $2, $3) as r`,
  return_delivery_to_warehouse_atomic: `select public.return_delivery_to_warehouse_atomic($1, $2, $3) as r`,
  approve_return_request_atomic: `select public.approve_return_request_atomic($1, $2, $3) as r`,
  reject_return_request_atomic: `select public.reject_return_request_atomic($1, $2, $3) as r`,
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
  queueChannelNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/inventory/alerts', () => ({ notifyLowStockIfNeeded: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  // The return actions may not write through the user's own session.
  createClient: vi.fn(async () => {
    throw new Error('return actions must not use the session client');
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
        if (!sql || state.missing.has(name)) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache`, code: 'PGRST202' } };
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

import { approveReturnAction, rejectReturnAction } from '@/lib/admin/returns-actions';
import { dispatchOrderAction } from '@/lib/staff/dispatch-actions';
import { recordReturnToWarehouseAction } from '@/lib/delivery/delivery-actions';
import { createInAppNotification, queueChannelNotification } from '@/lib/notifications/notify';
import { RETURNS_ADMIN_ONLY, RETURNS_NOT_INSTALLED, RETURNS_WRITER_UNAVAILABLE } from '@/lib/returns/resolution';

let db: Db;
let superAdmin: string;
let admin: string;
let staff: string;
let salesman: string;
let warehouse: string;
let productId: string;

interface Fixture { orderId: string; retailer: string; packIds: string[]; itemIds: string[] }

/** A DELIVERED order through the real dispatch action and the real completion function.
 *  Each line has its own pack (stock 7 after checkout, Rs 100 a pack); paid in Coins. */
async function deliveredOrder(pieces: number[] = [3], missing = 0): Promise<Fixture> {
  const retailer = (await createRetailer(db)).id;
  const orderId = randomUUID();
  const total = pieces.reduce((sum, n) => sum + n * 100, 0);
  await db.query(
    `insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id)
     values ($1, $2, $3, 'pending', $4, 0, 0, $4, $5)`,
    [orderId, `R-${orderId.slice(0, 8)}`, retailer, total, warehouse]);
  const packIds: string[] = [];
  const itemIds: string[] = [];
  await db.exec(`alter table public.order_items disable trigger user; alter table public.product_packs disable trigger user;`);
  for (const n of pieces) {
    const packId = randomUUID();
    await db.query(
      `insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity)
       values ($1, $2, $3, $4, 100, 100, 7)`, [packId, productId, `Pack ${packId}`, `SKU-${packId}`]);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, product_id, pack_id, source_type, fulfilment_type, quantity, unit_price, gst_percent, line_total, stock_deducted_quantity)
       values ($1, $2, $3, 'maharani', 'maharani', $4, 100, 0, $5, $4) returning id`, [orderId, productId, packId, n, n * 100]);
    packIds.push(packId);
    itemIds.push(rows[0]!.id);
  }
  await db.exec(`alter table public.order_items enable trigger user; alter table public.product_packs enable trigger user;`);
  await db.query(
    `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
     values ($1, 'ORDER_DEBIT', $2, 'debit', 'order', $3, 'checkout', $4)`, [retailer, total * 100, orderId, `order:${orderId}`]);
  for (const status of ['confirmed', 'processing', 'packed']) {
    await db.query(`update public.orders set status = $2 where id = $1`, [orderId, status]);
  }
  actAs(staff, 'staff');
  expect(await dispatchOrderAction(orderId)).toEqual({ success: true });
  const { rows } = await db.query<{ otp_hash: string; assigned_staff_id: string }>(
    `select otp_hash, assigned_staff_id from public.order_deliveries where order_id = $1`, [orderId]);
  await as(db, 'service', (tx: Tx) => tx.query(
    `select public.complete_delivery_atomic($1, $2, $3, $4, 'Shop Owner', null, null, null, $5::jsonb)`,
    [orderId, rows[0]!.assigned_staff_id, rows[0]!.otp_hash, `key-${orderId}`,
      JSON.stringify(itemIds.map((id, i) => ({ order_item_id: id, delivered: pieces[i]! - (i === 0 ? missing : 0), missing: i === 0 ? missing : 0, damaged: 0 })))]));
  state.rpcCalls.length = 0;
  vi.mocked(createInAppNotification).mockClear();
  return { orderId, retailer, packIds, itemIds };
}

/** The retailer submits the request from their own session. */
async function request(f: Fixture, itemId: string | null = null): Promise<string> {
  return as(db, f.retailer, async (tx: Tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.return_requests (order_id, order_item_id, retailer_id, reason) values ($1, $2, $3, 'Wrong shade') returning id`,
      [f.orderId, itemId, f.retailer]);
    return rows[0]!.id;
  });
}

function actAs(id: string, role: string) {
  state.user = { id, role, email: null, fullName: role };
}

async function snap(f: Fixture) {
  const rows = async <T,>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const packs: number[] = [];
  for (const id of f.packIds) packs.push((await rows<{ n: number }>(`select stock_quantity n from public.product_packs where id = $1`, [id]))[0]!.n);
  return {
    order: (await rows<{ s: string }>(`select status::text s from public.orders where id = $1`, [f.orderId]))[0]!.s,
    packs,
    requests: (await rows<{ s: string; b: string | null; n: string | null }>(
      `select status::text s, resolved_by b, resolution_note n from public.return_requests where order_id = $1 order by requested_at, id`, [f.orderId]))
      .map((r) => `${r.s}:${r.b ?? '-'}:${r.n ?? '-'}`),
    events: (await rows<{ a: string; u: number; p: string; b: string }>(
      `select action a, units_restored u, refund_paise::text p, actor_id b from public.return_request_events where order_id = $1 order by created_at, id`, [f.orderId]))
      .map((e) => `${e.a}:${e.u}:${e.p}:${e.b}`),
    wallet: (await rows<{ t: string; n: string }>(
      `select transaction_type t, amount_paise::text n from public.retailer_wallet_ledger where retailer_id = $1 order by created_at, id`, [f.retailer]))
      .map((w) => `${w.t}:${w.n}`),
    loyalty: (await rows<{ t: string; n: number }>(
      `select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at, points desc`, [f.orderId]))
      .map((l) => `${l.t}:${l.n}`),
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
const inApp = () => vi.mocked(createInAppNotification).mock.calls.map((c) => (c[0] as { title: string; recipientId: string }));
const rpcNames = () => state.rpcCalls.map((c) => c.name);

beforeAll(async () => {
  db = await createMigratedDb();
  state.db = db;
  superAdmin = await createUser(db, 'super_admin', 'Super Admin');
  admin = await createUser(db, 'admin', 'Admin');
  staff = await createUser(db, 'staff', 'Warehouse Staff');
  salesman = await createUser(db, 'salesman', 'Salesman');
  const { rows } = await db.query<{ id: string }>(`insert into public.warehouses (name, is_active) values ('WH 0101', true) returning id`);
  warehouse = rows[0]!.id;
  await db.query(`insert into public.staff_assignments (staff_id, warehouse_id) values ($1, $2)`, [staff, warehouse]);
  await db.exec(`alter table public.categories disable trigger user; alter table public.products disable trigger user;`);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ('Cat 0101') returning id`);
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
     values ('SKU-0101', 'Product 0101', 'pcs', 100, 18, $1, true) returning id`, [cat[0]!.id]);
  await db.exec(`alter table public.categories enable trigger user; alter table public.products enable trigger user;`);
  productId = product[0]!.id;
}, 180_000);

afterEach(() => {
  state.rpcCalls.length = 0;
  state.trustedAvailable = true;
  state.missing.clear();
  vi.mocked(createInAppNotification).mockClear();
  vi.mocked(queueChannelNotification).mockClear();
});

describe('approveReturnAction — one transaction (0101)', () => {
  it('restores the stock, approves the request and writes the history in ONE database call; no Coins, no points; the retailer is told once', async () => {
    const f = await deliveredOrder();
    const before = await snap(f);
    expect([before.order, before.packs, before.wallet, before.loyalty]).toEqual(['delivered', [7], ['ORDER_DEBIT:30000'], ['ORDER_EARN:3']]);
    const id = await request(f);
    actAs(admin, 'admin');
    expect(await approveReturnAction(id, '  Checked at the counter ')).toEqual({ success: true });
    expect(rpcNames()).toEqual(['approve_return_request_atomic']);
    expect(state.rpcCalls[0]!.args).toEqual({ p_return_request_id: id, p_actor_id: admin, p_note: 'Checked at the counter' });
    expect(await snap(f)).toEqual({
      order: 'delivered', packs: [10],
      requests: [`approved:${admin}:Checked at the counter`],
      events: [`approved:3:0:${admin}`],
      wallet: before.wallet, loyalty: before.loyalty,
    });
    expect(inApp().map((n) => [n.title, n.recipientId])).toEqual([['Return request approved', f.retailer]]);
    expect(vi.mocked(queueChannelNotification)).toHaveBeenCalledTimes(1);
  });

  it('a double click or a retry changes nothing: no second stock movement, no second history row, no second notification', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    actAs(admin, 'admin');
    expect(await approveReturnAction(id, '')).toEqual({ success: true });
    const after = await snap(f);
    vi.mocked(createInAppNotification).mockClear();
    vi.mocked(queueChannelNotification).mockClear();
    for (const [actor, role] of [[admin, 'admin'], [superAdmin, 'super_admin'], [admin, 'admin']] as const) {
      actAs(actor, role);
      expect(await approveReturnAction(id, 'again')).toEqual({ success: true });
      expect(await snap(f)).toEqual(after);
    }
    expect(after.packs).toEqual([10]);
    expect(inApp()).toEqual([]);
    expect(vi.mocked(queueChannelNotification)).not.toHaveBeenCalled();
  });

  it('a failure between the stock step and the status step leaves NOTHING behind; the retry then does it once', async () => {
    for (const [table, when] of [['return_requests', 'update'], ['return_request_events', 'insert'], ['product_packs', 'update']] as const) {
      const f = await deliveredOrder();
      const id = await request(f);
      const before = await snap(f);
      actAs(admin, 'admin');
      await withFailure(table, when, async () => {
        const result = await approveReturnAction(id, '');
        expect(errorText(result)).toMatch(/could not be approved\. Nothing was changed/);
        expect(errorText(result)).not.toMatch(/TEST_INJECTED|public\./); // raw database text is not shown
      });
      expect(await snap(f)).toEqual(before);
      expect(inApp()).toEqual([]);
      expect(await approveReturnAction(id, '')).toEqual({ success: true });
      expect((await snap(f)).packs).toEqual([10]);
      expect((await snap(f)).events).toHaveLength(1);
    }
  });

  it('only Admin and Super Admin: staff are stopped in the app without a database call; salesman and retailer hold no permission at all', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    const before = await snap(f);
    actAs(staff, 'staff');
    expect(await approveReturnAction(id, '')).toEqual({ error: RETURNS_ADMIN_ONLY });
    expect(await rejectReturnAction(id, 'a valid reason')).toEqual({ error: RETURNS_ADMIN_ONLY });
    expect(rpcNames()).toEqual([]);
    for (const [actor, role] of [[salesman, 'salesman'], [f.retailer, 'retailer']] as const) {
      actAs(actor, role);
      await expect(approveReturnAction(id, '')).rejects.toThrow(/unauthorized/);
      await expect(rejectReturnAction(id, 'a valid reason')).rejects.toThrow(/unauthorized/);
    }
    expect(rpcNames()).toEqual([]);
    expect(await snap(f)).toEqual(before);
    actAs(superAdmin, 'super_admin');
    expect(await approveReturnAction(id, '')).toEqual({ success: true });
  });

  it('the database does not trust the app about the actor: a session that claims Admin but is a staff account is refused there too', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    const before = await snap(f);
    actAs(staff, 'admin'); // app-side role forged
    expect(await approveReturnAction(id, '')).toEqual({ error: RETURNS_ADMIN_ONLY });
    expect(await rejectReturnAction(id, 'a valid reason')).toEqual({ error: RETURNS_ADMIN_ONLY });
    expect(rpcNames()).toEqual(['approve_return_request_atomic', 'reject_return_request_atomic']);
    expect(await snap(f)).toEqual(before);
    expect(inApp()).toEqual([]);
  });

  it('fails closed: malformed id, over-long note, no server key, and a database without 0101 — nothing is written', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    const before = await snap(f);
    actAs(admin, 'admin');
    expect(await approveReturnAction('not-a-uuid', '')).toEqual({ error: 'Return request not found.' });
    expect(await approveReturnAction(randomUUID(), '')).toEqual({ error: 'Return request not found.' });
    expect(errorText(await approveReturnAction(id, 'x'.repeat(1001)))).toMatch(/1000 characters/);
    state.trustedAvailable = false;
    expect(await approveReturnAction(id, '')).toEqual({ error: RETURNS_WRITER_UNAVAILABLE });
    expect(await rejectReturnAction(id, 'a valid reason')).toEqual({ error: RETURNS_WRITER_UNAVAILABLE });
    state.trustedAvailable = true;
    state.missing.add('approve_return_request_atomic').add('reject_return_request_atomic');
    expect(await approveReturnAction(id, '')).toEqual({ error: RETURNS_NOT_INSTALLED });
    expect(await rejectReturnAction(id, 'a valid reason')).toEqual({ error: RETURNS_NOT_INSTALLED });
    expect(await snap(f)).toEqual(before);
  });

  it('partial return: a one-item request restores that item only; the same item cannot be restored twice', async () => {
    const f = await deliveredOrder([3, 2]);
    actAs(admin, 'admin');
    expect(await approveReturnAction(await request(f, f.itemIds[1]!), '')).toEqual({ success: true });
    expect((await snap(f)).packs).toEqual([7, 9]);
    const again = await request(f, f.itemIds[1]!);
    expect(errorText(await approveReturnAction(again, ''))).toMatch(/already back in inventory\. Nothing was changed/);
    expect((await snap(f)).packs).toEqual([7, 9]);
    expect(await approveReturnAction(await request(f), '')).toEqual({ success: true });
    const s = await snap(f);
    expect([s.packs, s.order, s.wallet, s.events.map((e) => e.split(':')[1])]).toEqual([[10, 9], 'delivered', ['ORDER_DEBIT:50000'], ['2', '3']]);
  });

  it('a return over goods already settled with a shortfall credit is refused and explained; the credit is neither reversed nor repeated', async () => {
    const f = await deliveredOrder([3, 2], 1);
    const whole = await request(f);
    const shortLine = await request(f, f.itemIds[0]!);
    const before = await snap(f);
    expect(before.wallet).toEqual(['ORDER_DEBIT:50000', 'REFUND_CREDIT:10000']);
    actAs(admin, 'admin');
    for (const id of [whole, shortLine]) {
      expect(errorText(await approveReturnAction(id, ''))).toMatch(/already settled in Coins.*manual reconciliation\. Nothing was changed/);
    }
    expect(await snap(f)).toEqual(before);
    expect(inApp()).toEqual([]);
    // the fully delivered line of the same order is unaffected by the credit
    expect(await approveReturnAction(await request(f, f.itemIds[1]!), '')).toEqual({ success: true });
    const after = await snap(f);
    expect([after.packs, after.wallet]).toEqual([[7, 9], before.wallet]);
  });

  it('an order already returned to the warehouse (stock back, Coins refunded) cannot have a request approved on top', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    actAs(staff, 'staff');
    expect(await recordReturnToWarehouseAction(f.orderId, 'refused at the door')).toMatchObject({ success: true });
    const returned = await snap(f);
    expect([returned.order, returned.packs, returned.wallet]).toEqual(['returned', [10], ['ORDER_DEBIT:30000', 'ORDER_REVERSAL:30000']]);
    actAs(admin, 'admin');
    expect(errorText(await approveReturnAction(id, ''))).toMatch(/already returned to the warehouse.*Nothing was changed/);
    expect(await snap(f)).toEqual(returned);
  });
});

describe('rejectReturnAction — one transaction (0101)', () => {
  it('needs a reason; rejects and writes history together; stock, Coins and points are untouched; the retailer is told once; repeats change nothing', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    const before = await snap(f);
    actAs(admin, 'admin');
    for (const bad of ['', '  ', 'no', 'x'.repeat(1001)]) {
      expect(errorText(await rejectReturnAction(id, bad))).toMatch(/reason of 3 to 1000 characters/);
    }
    expect(rpcNames()).toEqual([]);
    expect(await rejectReturnAction(id, ' Seal broken by the buyer ')).toEqual({ success: true });
    expect(rpcNames()).toEqual(['reject_return_request_atomic']);
    const after = await snap(f);
    expect(after).toEqual({ ...before, requests: [`rejected:${admin}:Seal broken by the buyer`], events: [`rejected:0:0:${admin}`] });
    expect(inApp().map((n) => [n.title, n.recipientId])).toEqual([['Return request rejected', f.retailer]]);
    vi.mocked(createInAppNotification).mockClear();
    expect(await rejectReturnAction(id, 'another reason')).toEqual({ success: true });
    expect(await snap(f)).toEqual(after);
    expect(inApp()).toEqual([]);
    expect(errorText(await approveReturnAction(id, ''))).toBe('This return request has already been rejected.');
    expect(await snap(f)).toEqual(after);
  });

  it('an approved request cannot be rejected afterwards; a failure while writing history rolls the rejection back', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    actAs(admin, 'admin');
    expect(await approveReturnAction(id, '')).toEqual({ success: true });
    const approved = await snap(f);
    expect(errorText(await rejectReturnAction(id, 'changed my mind'))).toBe('This return request has already been approved.');
    expect(await snap(f)).toEqual(approved);

    const g = await deliveredOrder();
    const gid = await request(g);
    const before = await snap(g);
    actAs(admin, 'admin');
    await withFailure('return_request_events', 'insert', async () => {
      expect(errorText(await rejectReturnAction(gid, 'a valid reason'))).toMatch(/could not be rejected\. Nothing was changed/);
    });
    expect(await snap(g)).toEqual(before);
  });
});

describe('the old two-step route is closed (0101)', () => {
  it('no session can restore order stock or resolve a request directly — staff, Admin, Super Admin or the service key', async () => {
    const f = await deliveredOrder();
    const id = await request(f);
    const before = await snap(f);
    for (const who of [staff, admin, superAdmin, 'service'] as const) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`select public.return_order_stock($1, null)`, [f.orderId])))
        .toMatch(/permission denied for function return_order_stock/);
      expect(await errorOf(db, who, (tx: Tx) => tx.query(
        `update public.return_requests set status = 'approved', resolved_by = $2, resolved_at = now() where id = $1`, [id, admin])))
        .toMatch(/RETURN_GUARD/);
    }
    expect(await errorOf(db, f.retailer, (tx: Tx) => tx.query(
      `insert into public.return_requests (order_id, retailer_id, reason, status) values ($1, $2, 'x', 'approved')`, [f.orderId, f.retailer])))
      .toMatch(/RETURN_GUARD/);
    expect(await snap(f)).toEqual(before);
  });

  it('the action file makes no direct table write and no separate stock call', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('lib/admin/returns-actions.ts', 'utf8');
    expect(source).toContain("rpc('approve_return_request_atomic'");
    expect(source).toContain("rpc('reject_return_request_atomic'");
    for (const gone of ["rpc('return_order_stock'", ".from('return_requests')", '.update(', '.insert(', 'createClient']) {
      expect(source).not.toContain(gone);
    }
  });
});
