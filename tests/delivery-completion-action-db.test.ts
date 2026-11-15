/**
 * Behavioural tests for `completeDeliveryAction` (lib/delivery/delivery-actions.ts).
 *
 * The REAL server action runs against the REAL migration 0099 function on
 * PostgreSQL 16 (PGlite). Only the edges are replaced: the signed-in user, the
 * notification sender, Next's cache, and the service-role client — whose `rpc`
 * executes the function inside a real transaction as `service_role`, exactly
 * like PostgREST does (one call = one transaction; an error rolls it back).
 *
 * Limit, stated honestly: PGlite has one connection, so "concurrent" calls here
 * are serialised by the driver. True multi-session races are exercised in
 * tests/pr126-delivery-completion.pg.mjs on real PostgreSQL (run by hand).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

process.env.DELIVERY_OTP_SECRET = 'test-only-delivery-otp-secret';

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; email: string | null; fullName: string | null },
  db: null as unknown,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  trustedAvailable: true,
  dropResponse: false,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn(async () => state.user) }));
vi.mock('@/lib/notifications/notify', () => ({
  notifyOrderEvent: vi.fn(async () => undefined),
  createInAppNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/supabase/server', () => ({
  // The completion path must not write through the user's own session at all.
  createClient: vi.fn(async () => {
    throw new Error('completeDeliveryAction must not use the session client');
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
        const { as: runAs } = await import('./helpers/pg-harness');
        try {
          const data = await runAs(state.db as Db, 'service', async (tx: Tx) => {
            const { rows } = await tx.query<{ r: unknown }>(
              `select public.complete_delivery_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) as r`,
              [args.p_order_id, args.p_actor_id, args.p_otp_digest, args.p_idempotency_key, args.p_receiver_name,
                args.p_notes, args.p_signature_ref, args.p_photo_ref, JSON.stringify(args.p_items)],
            );
            return rows[0]!.r;
          });
          // Simulates the response being lost AFTER the transaction committed.
          if (state.dropResponse) throw new Error('socket hang up');
          return { data, error: null };
        } catch (error) {
          if ((error as Error).message === 'socket hang up') throw error;
          return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } };
        }
      },
    };
  },
}));

import { completeDeliveryAction, type DeliveryCompletionInput } from '@/lib/delivery/delivery-actions';
import { hashDeliveryOtp } from '@/lib/delivery/otp';
import { notifyOrderEvent } from '@/lib/notifications/notify';
import { can } from '@/lib/permissions/permissions';

let db: Db;
let admin: string;
let staff: string;
let otherStaff: string;
let salesman: string;
let retailer: string;
let warehouse: string;
let productId: string;

const OTP = '482913';

interface Fixture { orderId: string; deliveryId: string; itemIds: string[]; pieces: number[] }

/** A dispatched order assigned to `staff`. `lines` = [lineTotalRupees, piecesOrdered]. */
async function dispatched(lines: [number, number][], opts: { assignee?: string } = {}): Promise<Fixture> {
  const orderId = randomUUID();
  const total = lines.reduce((sum, [value]) => sum + value, 0);
  await db.exec(`alter table public.order_items disable trigger user;`);
  await db.query(
    `insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id)
     values ($1, $2, $3, 'pending', $4, 0, 0, $4, $5)`,
    [orderId, `T-${orderId.slice(0, 8)}`, retailer, total, warehouse],
  );
  const itemIds: string[] = [];
  for (const [value, pieces] of lines) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total)
       values ($1, $2, $3, $4, 0, $5) returning id`,
      [orderId, productId, pieces, value / pieces, value],
    );
    itemIds.push(rows[0]!.id);
  }
  await db.exec(`alter table public.order_items enable trigger user;`);
  for (const status of ['confirmed', 'processing', 'packed', 'dispatched']) {
    await db.query(`update public.orders set status = $2 where id = $1`, [orderId, status]);
  }
  const { rows: delivery } = await db.query<{ id: string }>(
    `insert into public.order_deliveries (order_id, delivery_status, assigned_staff_id, assigned_by, assigned_at, otp_hash)
     values ($1, 'assigned', $2, $3, now(), $4) returning id`,
    [orderId, opts.assignee ?? staff, admin, hashDeliveryOtp(orderId, OTP)],
  );
  for (let index = 0; index < itemIds.length; index += 1) {
    await db.query(
      `insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, $3)`,
      [delivery[0]!.id, itemIds[index], lines[index]![1]],
    );
  }
  return { orderId, deliveryId: delivery[0]!.id, itemIds, pieces: lines.map(([, p]) => p) };
}

/**
 * Records an uploaded proof the way Supabase Storage does: `owner_id` is the
 * uploader taken from their token. (The harness table mirrors the live
 * storage.objects columns; Storage itself is not running here.)
 */
async function putProof(name: string, uploader: string | null) {
  await db.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id) values ('delivery-proofs', $1, $2, $3)`,
    [name, uploader, uploader],
  );
}

function actAs(id: string, role: string) {
  state.user = { id, role, email: null, fullName: role };
}

/** Full delivery of every line unless `shortfall` gives [missing, damaged] per line index. */
function payload(f: Fixture, shortfall: Record<number, [number, number]> = {}, extra: Partial<DeliveryCompletionInput> = {}): DeliveryCompletionInput {
  return {
    otp: OTP,
    receiverName: 'Shop Owner',
    notes: '',
    items: f.itemIds.map((id, index) => {
      const [missing, damaged] = shortfall[index] ?? [0, 0];
      return { orderItemId: id, delivered: f.pieces[index]! - missing - damaged, missing, damaged };
    }),
    ...extra,
  };
}

async function snapshot(f: Fixture) {
  const one = async <T,>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const [delivery] = await one<{ delivery_status: string; otp_attempts: number; otp_verified_at: string | null; completed_by: string | null; receiver_name: string | null; return_window_days: number | null; return_deadline: string | null; signature_url: string | null }>(
    `select delivery_status, otp_attempts, otp_verified_at, completed_by, receiver_name, return_window_days, return_deadline::text, signature_url from public.order_deliveries where id = $1`, [f.deliveryId]);
  const [order] = await one<{ status: string; delivered_at: string | null }>(`select status::text, delivered_at from public.orders where id = $1`, [f.orderId]);
  const lines = await one<{ d: number; m: number; g: number }>(
    `select quantity_delivered d, quantity_missing m, quantity_damaged g from public.order_delivery_items where delivery_id = $1 order by created_at, id`, [f.deliveryId]);
  const credits = await one<{ amount_paise: string; created_by: string }>(
    `select amount_paise::text, created_by from public.retailer_wallet_ledger where reference_type = 'delivery' and reference_id = $1 and transaction_type = 'REFUND_CREDIT'`, [f.deliveryId]);
  const loyalty = await one<{ points: number; entry_type: string }>(
    `select points, entry_type from public.loyalty_ledger where reference_id = $1 order by created_at, points desc`, [f.orderId]);
  const requests = await one<{ id: string }>(`select id from public.delivery_completion_requests where delivery_id = $1`, [f.deliveryId]);
  return {
    delivery: delivery!, order: order!, lines,
    creditsPaise: credits.map((c) => Number(c.amount_paise)), creditActors: credits.map((c) => c.created_by),
    loyalty: loyalty.map((l) => `${l.entry_type}:${l.points}`), requests: requests.length,
  };
}

/** Asserts the delivery is exactly as dispatched: nothing was written. */
async function expectUntouched(f: Fixture, attempts = 0) {
  const s = await snapshot(f);
  expect(s.delivery.delivery_status).toBe('assigned');
  expect(s.delivery.otp_attempts).toBe(attempts);
  expect(s.delivery.otp_verified_at).toBeNull();
  expect(s.delivery.completed_by).toBeNull();
  expect(s.delivery.receiver_name).toBeNull();
  expect(s.order.status).toBe('dispatched');
  expect(s.lines.every((l) => l.d === 0 && l.m === 0 && l.g === 0)).toBe(true);
  expect(s.creditsPaise).toEqual([]);
  expect(s.loyalty).toEqual([]);
  expect(s.requests).toBe(0);
}

/** Makes one table refuse the write the completion needs, for the duration of `fn`. */
async function withFailure(table: string, when: string, fn: () => Promise<void>) {
  const name = `trg_test_fail_${table}`;
  await db.exec(`
    create or replace function public._test_fail() returns trigger language plpgsql as $$
    begin raise exception 'TEST_INJECTED_FAILURE on %', tg_table_name; end $$;
    create trigger ${name} before ${when} on public.${table} for each row execute function public._test_fail();`);
  try { await fn(); } finally { await db.exec(`drop trigger ${name} on public.${table};`); }
}

const errorText = (result: unknown) => (result as { error?: string }).error ?? '';

beforeAll(async () => {
  db = await createMigratedDb();
  state.db = db;
  admin = await createUser(db, 'super_admin', 'Admin');
  staff = await createUser(db, 'staff', 'Delivery Staff');
  otherStaff = await createUser(db, 'staff', 'Other Staff');
  salesman = await createUser(db, 'salesman', 'Salesman');
  retailer = (await createRetailer(db)).id;
  const { rows } = await db.query<{ id: string }>(`insert into public.warehouses (name, is_active) values ('WH 0099', true) returning id`);
  warehouse = rows[0]!.id;
  await db.exec(`alter table public.categories disable trigger user; alter table public.products disable trigger user;`);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ('Cat 0099') returning id`);
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
     values ('SKU-0099', 'Product 0099', 'pcs', 100, 18, $1, true) returning id`, [cat[0]!.id]);
  await db.exec(`alter table public.categories enable trigger user; alter table public.products enable trigger user;`);
  productId = product[0]!.id;
}, 180_000);

afterEach(() => {
  state.rpcCalls.length = 0;
  state.trustedAvailable = true;
  state.dropResponse = false;
});

describe('completeDeliveryAction — success', () => {
  it('a valid OTP completes a full delivery: lines, delivery, order, return window, loyalty, attribution', async () => {
    const f = await dispatched([[600, 6], [400, 4]]);
    actAs(staff, 'staff');
    const result = await completeDeliveryAction(f.orderId, payload(f));
    expect(result).toEqual({ success: true, message: expect.stringContaining('recorded') });

    const s = await snapshot(f);
    expect(s.delivery.delivery_status).toBe('delivered');
    expect(s.delivery.otp_verified_at).not.toBeNull();
    expect(s.delivery.completed_by).toBe(staff);
    expect(s.delivery.receiver_name).toBe('Shop Owner');
    expect(s.delivery.return_window_days).toBe(7);
    expect(s.delivery.return_deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.order.status).toBe('delivered');
    expect(s.order.delivered_at).not.toBeNull();
    expect(s.lines).toEqual([{ d: 6, m: 0, g: 0 }, { d: 4, m: 0, g: 0 }]);
    expect(s.creditsPaise).toEqual([]);
    expect(s.loyalty).toEqual(['ORDER_EARN:10']);
    expect(s.requests).toBe(1);

    // Audit rows are attributed to the verified delivery person, not to "nobody".
    const { rows: history } = await db.query<{ changed_by: string | null }>(
      `select changed_by from public.order_status_history where order_id = $1 and status = 'delivered'`, [f.orderId]);
    expect(history.map((h) => h.changed_by)).toEqual([staff]);
    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyOrderEvent).mock.calls[0]![0]).toMatchObject({ recipientId: retailer, title: 'Order delivered' });
  });

  it('a partial delivery credits the shortfall from the ORIGINAL line values and awards loyalty on what was delivered', async () => {
    // Rs 1,000 for 10 pieces; 2 missing -> Rs 200 back, 8 points.
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    const result = await completeDeliveryAction(f.orderId, payload(f, { 0: [1, 1] }));
    expect(result).toMatchObject({ success: true });
    expect((result as { message: string }).message).toContain('₹200');

    const s = await snapshot(f);
    expect(s.delivery.delivery_status).toBe('partially_delivered');
    expect(s.order.status).toBe('delivered');
    expect(s.lines).toEqual([{ d: 8, m: 1, g: 1 }]);
    expect(s.creditsPaise).toEqual([20000]);
    expect(s.creditActors).toEqual([staff]);
    expect(s.loyalty).toEqual(['ORDER_EARN:8']);
    expect(vi.mocked(notifyOrderEvent).mock.calls[0]![0]).toMatchObject({ title: 'Order partially delivered' });
  });

  it('an Admin who is not the assignee may complete; the plain OTP is never sent to the database', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(admin, 'super_admin');
    expect(await completeDeliveryAction(f.orderId, payload(f))).toMatchObject({ success: true });
    expect((await snapshot(f)).delivery.completed_by).toBe(admin);

    expect(state.rpcCalls).toHaveLength(1);
    const sent = JSON.stringify(state.rpcCalls[0]);
    expect(sent).not.toContain(OTP);
    expect(sent).not.toContain('test-only-delivery-otp-secret');
    expect(state.rpcCalls[0]!.args.p_otp_digest).toBe(hashDeliveryOtp(f.orderId, OTP));
    expect(state.rpcCalls[0]!.args.p_actor_id).toBe(admin);
  });

  it('an order an Admin had already marked delivered: points are brought down to the delivered value, and a return nets to zero', async () => {
    const f = await dispatched([[1000, 10]]);
    await db.query(`update public.orders set status = 'delivered' where id = $1`, [f.orderId]);
    expect((await snapshot(f)).loyalty).toEqual(['ORDER_EARN:10']);

    actAs(staff, 'staff');
    expect(await completeDeliveryAction(f.orderId, payload(f, { 0: [3, 0] }))).toMatchObject({ success: true });
    let s = await snapshot(f);
    expect(s.creditsPaise).toEqual([30000]);
    expect(s.loyalty).toEqual(['ORDER_EARN:10', 'ORDER_REVERSAL:-3']);

    await db.exec(`alter table public.orders disable trigger trg_guard_order_cancel_path;`).catch(() => undefined);
    await db.query(`update public.orders set status = 'returned' where id = $1`, [f.orderId]);
    s = await snapshot(f);
    const net = s.loyalty.reduce((sum, row) => sum + Number(row.split(':')[1]), 0);
    expect(net).toBe(0);
  });
});

describe('completeDeliveryAction — OTP', () => {
  it('an invalid OTP cannot complete: one attempt is counted and nothing else changes', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const result = await completeDeliveryAction(f.orderId, payload(f, {}, { otp: '000000' }));
    expect(errorText(result)).toBe('Incorrect OTP. 9 attempts remaining before the task is locked.');
    await expectUntouched(f, 1);
    expect(notifyOrderEvent).not.toHaveBeenCalled();
  });

  it('a malformed OTP is refused before the database is called', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { otp: '12ab' })))).toMatch(/6-digit OTP/);
    expect(state.rpcCalls).toHaveLength(0);
    await expectUntouched(f, 0);
  });

  it('ten wrong attempts lock the task; the correct OTP is then refused; twelve parallel wrong guesses count exactly ten', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const guesses = Array.from({ length: 12 }, (_, i) => String(100000 + i));
    const results = await Promise.all(guesses.map((otp) => completeDeliveryAction(f.orderId, payload(f, {}, { otp }))));
    expect(results.filter((r) => /Incorrect OTP/.test(errorText(r)))).toHaveLength(10);
    expect(results.filter((r) => /Too many wrong OTP attempts/.test(errorText(r)))).toHaveLength(2);
    expect(errorText(results[9])).toMatch(/now locked/);
    await expectUntouched(f, 10);

    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/Too many wrong OTP attempts/);
    await expectUntouched(f, 10);
  });

  it('an OTP digest from another order does not open this one', async () => {
    const a = await dispatched([[500, 5]]);
    const b = await dispatched([[500, 5]]);
    // Give B a different code; A's code must not work on B.
    await db.query(`update public.order_deliveries set otp_hash = $2 where id = $1`, [b.deliveryId, hashDeliveryOtp(b.orderId, '777777')]);
    actAs(staff, 'staff');
    expect(errorText(await completeDeliveryAction(b.orderId, payload(b)))).toMatch(/Incorrect OTP/);
    await expectUntouched(b, 1);
    await expectUntouched(a, 0);
  });
});

describe('completeDeliveryAction — who may complete', () => {
  it('unassigned staff cannot complete, even with the right OTP; no attempt is counted', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(otherStaff, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toBe('Only the assigned delivery person can complete this delivery.');
    await expectUntouched(f, 0);
  });

  it('an assigned salesman can complete', async () => {
    const f = await dispatched([[500, 5]], { assignee: salesman });
    actAs(salesman, 'salesman');
    expect(await completeDeliveryAction(f.orderId, payload(f))).toMatchObject({ success: true });
  });

  it('a retailer is refused by the app, and by the database even if the app check were skipped', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(retailer, 'retailer');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/do not have permission/);
    expect(state.rpcCalls).toHaveLength(0);

    // Lie about the role to get past the app check: the database looks the actor up itself.
    actAs(retailer, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/do not have permission/);
    await expectUntouched(f, 0);
  });

  it('a deactivated staff account is refused by the database', async () => {
    const gone = await createUser(db, 'staff', 'Left the company');
    const f = await dispatched([[500, 5]], { assignee: gone });
    await db.query(`update public.profiles set is_active = false where id = $1`, [gone]);
    actAs(gone, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/do not have permission/);
    await expectUntouched(f, 0);
  });

  it('the roles the database accepts are exactly the roles holding deliveries.execute', () => {
    const sql = readFileSync('supabase/migrations/0099_atomic_delivery_completion.sql', 'utf8');
    const list = /v_actor_role not in \(([^)]+)\) then\s+raise exception 'DELIVERY_COMPLETE:NO_PERMISSION/.exec(sql);
    const dbRoles = list![1]!.split(',').map((r) => r.trim().replace(/'/g, '')).sort();
    const appRoles = (['super_admin', 'admin', 'staff', 'salesman', 'retailer', 'seller'] as const)
      .filter((role) => can(role, 'deliveries.execute')).sort();
    expect(dbRoles).toEqual(appRoles);
  });

  it('only the service role can execute the function: staff, admin and anonymous sessions are refused', async () => {
    const f = await dispatched([[500, 5]]);
    const call = (tx: Tx) => tx.query(
      `select public.complete_delivery_atomic($1, $2, $3, $4, 'Shop Owner', null, null, null, $5::jsonb)`,
      [f.orderId, staff, hashDeliveryOtp(f.orderId, OTP), 'k'.repeat(32),
        JSON.stringify([{ order_item_id: f.itemIds[0], delivered: 5, missing: 0, damaged: 0 }])]);
    for (const who of [staff, admin, retailer, 'anon']) {
      expect(await errorOf(db, who, call)).toMatch(/permission denied for function complete_delivery_atomic/);
    }
    await expectUntouched(f, 0);
    // No API role can read or write the idempotency table either.
    for (const who of [staff, admin, 'anon']) {
      expect(await errorOf(db, who, (tx: Tx) => tx.query(`select 1 from public.delivery_completion_requests`))).toMatch(/permission denied/);
    }
  });

  it('fails closed when the server has no trusted role configured', async () => {
    const f = await dispatched([[500, 5]]);
    state.trustedAvailable = false;
    actAs(staff, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/not configured on the server/);
    await expectUntouched(f, 0);
  });
});

describe('completeDeliveryAction — proofs and lines', () => {
  it("another order's proof cannot be attached (app check and database check)", async () => {
    const f = await dispatched([[500, 5]]);
    const other = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    for (const ref of [
      `deliveries/${other.orderId}/signature.png`,
      `deliveries/${f.orderId}/../${other.orderId}/signature.png`,
      `https://evil.example/deliveries/${f.orderId}/x.png`,
      `payments/${f.orderId}/x.png`,
    ]) {
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: ref })))).toMatch(/Proof files must belong to this order/);
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { photoUrl: ref })))).toMatch(/Proof files must belong to this order/);
    }
    await expectUntouched(f, 0);

    // The database refuses it on its own, without the app check.
    const message = await errorOf(db, 'service', (tx: Tx) => tx.query(
      `select public.complete_delivery_atomic($1, $2, $3, $4, 'Shop Owner', null, $5, null, $6::jsonb)`,
      [f.orderId, staff, hashDeliveryOtp(f.orderId, OTP), 'k'.repeat(32), `deliveries/${other.orderId}/signature.png`,
        JSON.stringify([{ order_item_id: f.itemIds[0], delivered: 5, missing: 0, damaged: 0 }])]));
    expect(message).toMatch(/DELIVERY_COMPLETE:PROOF/);
    await expectUntouched(f, 0);
  });

  it("this order's own proof, uploaded by the assignee, is stored", async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const ref = `deliveries/${f.orderId}/signature.png`;
    const photo = `deliveries/${f.orderId}/photo.jpg`;
    await putProof(ref, staff);
    await putProof(photo, staff);
    expect(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: ref, photoUrl: photo }))).toMatchObject({ success: true });
    const done = await snapshot(f);
    expect(done.delivery.signature_url).toBe(ref);
    expect(done.delivery.delivery_status).toBe('delivered');
  });

  it('a well-formed path whose file does not exist is refused: the path alone proves nothing', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const ref = `deliveries/${f.orderId}/${randomUUID()}.png`;
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: ref })))).toMatch(/could not be found in storage/);
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { photoUrl: ref })))).toMatch(/could not be found in storage/);
    expect(state.rpcCalls.length).toBe(2); // the app check passed; the DATABASE refused
    await expectUntouched(f, 0);
  });

  it("another user's upload is refused even inside the right folder (other staff, salesman, retailer, unknown, no uploader)", async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const uploaders: (string | null)[] = [otherStaff, salesman, retailer, randomUUID(), null];
    for (const uploader of uploaders) {
      const ref = `deliveries/${f.orderId}/${randomUUID()}.png`;
      await putProof(ref, uploader);
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: ref })))).toMatch(/not uploaded by the delivery person/);
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { photoUrl: ref })))).toMatch(/not uploaded by the delivery person/);
    }
    await expectUntouched(f, 0);
  });

  it('client-supplied metadata is never trusted: forged owner metadata, the wrong bucket, archived and deleted versions are refused', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    // The uploader is otherStaff; the metadata CLAIMS the assignee.
    const forged = `deliveries/${f.orderId}/${randomUUID()}.png`;
    await db.query(
      `insert into storage.objects (bucket_id, name, owner, owner_id, metadata, user_metadata)
       values ('delivery-proofs', $1, $2, $3, $4::jsonb, $4::jsonb)`,
      [forged, otherStaff, otherStaff, JSON.stringify({ owner: staff, owner_id: staff, uploaded_by: staff, order_id: f.orderId })]);
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: forged })))).toMatch(/not uploaded by the delivery person/);

    const wrongBucket = `deliveries/${f.orderId}/${randomUUID()}.png`;
    await db.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('payment-proofs', $1, $2, $3)`, [wrongBucket, staff, staff]);
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: wrongBucket })))).toMatch(/could not be found in storage/);

    const archived = `deliveries/${f.orderId}/${randomUUID()}.png`;
    await db.query(`insert into storage.objects (bucket_id, name, owner, owner_id, archived_at) values ('delivery-proofs', $1, $2, $3, now())`, [archived, staff, staff]);
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { signatureUrl: archived })))).toMatch(/could not be found in storage/);

    const deleted = `deliveries/${f.orderId}/${randomUUID()}.png`;
    await db.query(`insert into storage.objects (bucket_id, name, owner, owner_id, is_delete_marker) values ('delivery-proofs', $1, $2, $3, true)`, [deleted, staff, staff]);
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f, {}, { photoUrl: deleted })))).toMatch(/could not be found in storage/);
    await expectUntouched(f, 0);
  });

  it("an Admin's upload is accepted; the assignee's upload is accepted when an Admin completes; a deactivated Admin's upload is not", async () => {
    const a = await dispatched([[500, 5]]);
    const byAdmin = `deliveries/${a.orderId}/${randomUUID()}.png`;
    await putProof(byAdmin, admin);
    actAs(staff, 'staff');
    expect(await completeDeliveryAction(a.orderId, payload(a, {}, { photoUrl: byAdmin }))).toMatchObject({ success: true });

    const b = await dispatched([[500, 5]]);
    const byAssignee = `deliveries/${b.orderId}/${randomUUID()}.png`;
    await putProof(byAssignee, staff);
    actAs(admin, 'super_admin');
    expect(await completeDeliveryAction(b.orderId, payload(b, {}, { signatureUrl: byAssignee }))).toMatchObject({ success: true });

    const c = await dispatched([[500, 5]]);
    const formerAdmin = await createUser(db, 'admin', 'Former Admin');
    await db.query(`update public.profiles set is_active = false where id = $1`, [formerAdmin]);
    const byFormer = `deliveries/${c.orderId}/${randomUUID()}.png`;
    await putProof(byFormer, formerAdmin);
    actAs(staff, 'staff');
    expect(errorText(await completeDeliveryAction(c.orderId, payload(c, {}, { signatureUrl: byFormer })))).toMatch(/not uploaded by the delivery person/);
    await expectUntouched(c, 0);
  });

  it('calling the database function directly does not bypass the proof check, and API roles cannot call it at all', async () => {
    const f = await dispatched([[500, 5]]);
    const ref = `deliveries/${f.orderId}/${randomUUID()}.png`;
    const call = (who: string, proof: string) => errorOf(db, who, (tx: Tx) => tx.query(
      `select public.complete_delivery_atomic($1, $2, $3, $4, 'Shop Owner', null, $5, null, $6::jsonb)`,
      [f.orderId, staff, hashDeliveryOtp(f.orderId, OTP), 'k'.repeat(32), proof,
        JSON.stringify([{ order_item_id: f.itemIds[0], delivered: 5, missing: 0, damaged: 0 }])]));
    expect(await call('service', ref)).toMatch(/DELIVERY_COMPLETE:PROOF_MISSING/);
    await putProof(ref, otherStaff);
    expect(await call('service', ref)).toMatch(/DELIVERY_COMPLETE:PROOF_OWNER/);
    for (const who of [staff, admin, retailer, 'anon']) expect(await call(who, ref)).toMatch(/permission denied/);
    await expectUntouched(f, 0);
  });

  it('Storage policies agree with the function: only the assignee or an Admin can put a file in the order folder, and nobody can rewrite or delete it', async () => {
    const f = await dispatched([[500, 5]]);
    const name = () => `deliveries/${f.orderId}/${randomUUID()}.png`;
    const insert = (who: string, objectName: string) => errorOf(db, who, (tx: Tx) => tx.query(
      `insert into storage.objects (bucket_id, name, owner, owner_id) values ('delivery-proofs', $1, $2, $3)`,
      [objectName, who === 'anon' ? null : who, who === 'anon' ? null : who]));
    const mine = name();
    expect(await insert(staff, mine)).toBeNull();
    expect(await insert(admin, name())).toBeNull();
    for (const who of [otherStaff, salesman, retailer, 'anon']) {
      expect(await insert(who, name())).toMatch(/row-level security|permission denied/);
    }
    // No UPDATE or DELETE policy exists for this bucket, so the recorded uploader cannot be changed.
    for (const who of [staff, otherStaff, retailer]) {
      const changed = await as(db, who, async (tx: Tx) => {
        const u = await tx.query(`update storage.objects set owner_id = $2 where name = $1 returning id`, [mine, who]);
        const d = await tx.query(`delete from storage.objects where name = $1 returning id`, [mine]);
        return u.rows.length + d.rows.length;
      });
      expect(changed).toBe(0);
    }
    const { rows } = await db.query<{ owner_id: string }>(`select owner_id from storage.objects where name = $1`, [mine]);
    expect(rows[0]!.owner_id).toBe(staff);
    const { rows: policies } = await db.query<{ cmd: string }>(
      `select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and (coalesce(qual, '') || coalesce(with_check, '')) like '%delivery-proofs%' order by 1`);
    expect(policies.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
  });

  it('missing, duplicated and foreign order lines are refused and nothing is written', async () => {
    const f = await dispatched([[600, 6], [400, 4]]);
    const other = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    const full = payload(f);

    expect(errorText(await completeDeliveryAction(f.orderId, { ...full, items: [full.items[0]!] }))).toBe('Quantities are required for all 2 order lines.');
    expect(errorText(await completeDeliveryAction(f.orderId, { ...full, items: [full.items[0]!, full.items[0]!] }))).toBe('Duplicate order lines in the submission.');
    expect(errorText(await completeDeliveryAction(f.orderId, { ...full, items: [] }))).toMatch(/quantities for every order line are required/i);
    expect(errorText(await completeDeliveryAction(f.orderId, {
      ...full, items: [full.items[0]!, { orderItemId: other.itemIds[0]!, delivered: 5, missing: 0, damaged: 0 }],
    }))).toBe('A submitted line does not belong to this delivery.');
    await expectUntouched(f, 0);
    await expectUntouched(other, 0);
  });

  it('tampered quantities are refused: wrong totals, negatives, fractions, over-delivery', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    const id = f.itemIds[0]!;
    const attempt = (delivered: number, missing: number, damaged: number) =>
      completeDeliveryAction(f.orderId, { ...payload(f), items: [{ orderItemId: id, delivered, missing, damaged }] });

    expect(errorText(await attempt(9, 0, 0))).toMatch(/must equal the ordered quantity/);
    expect(errorText(await attempt(12, 0, 0))).toMatch(/must equal the ordered quantity/);
    expect(errorText(await attempt(0, 20, 0))).toMatch(/must equal the ordered quantity/);
    expect(errorText(await attempt(11, -1, 0))).toMatch(/whole numbers/);
    expect(errorText(await attempt(9.5, 0.5, 0))).toMatch(/whole numbers/);
    expect(errorText(await attempt(Number.NaN, 0, 0))).toMatch(/whole numbers/);
    await expectUntouched(f, 0);
  });

  it('a tampered snapshot (ordered quantity rewritten behind the guards) is refused instead of inflating the refund', async () => {
    const f = await dispatched([[1000, 10]]);
    await db.exec(`alter table public.order_delivery_items disable trigger user;`);
    await db.query(`update public.order_delivery_items set quantity_ordered = 100 where delivery_id = $1`, [f.deliveryId]);
    await db.exec(`alter table public.order_delivery_items enable trigger user;`);
    actAs(staff, 'staff');
    const result = await completeDeliveryAction(f.orderId, {
      ...payload(f), items: [{ orderItemId: f.itemIds[0]!, delivered: 10, missing: 90, damaged: 0 }],
    });
    expect(errorText(result)).toMatch(/no longer matches the original order quantities/);
    const s = await snapshot(f);
    expect(s.delivery.delivery_status).toBe('assigned');
    expect(s.order.status).toBe('dispatched');
    expect(s.creditsPaise).toEqual([]);
  });

  it('an order that is not dispatched cannot be completed', async () => {
    const f = await dispatched([[500, 5]]);
    await db.exec(`alter table public.orders disable trigger user;`);
    await db.query(`update public.orders set status = 'processing' where id = $1`, [f.orderId]);
    await db.exec(`alter table public.orders enable trigger user;`);
    actAs(staff, 'staff');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toBe('This order is processing — it cannot be completed as a delivery.');
    expect((await snapshot(f)).delivery.delivery_status).toBe('assigned');
  });
});

describe('completeDeliveryAction — exactly once', () => {
  it('a duplicate completion cannot issue a duplicate refund or loyalty award', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    const input = payload(f, { 0: [2, 0] });
    expect(await completeDeliveryAction(f.orderId, input)).toMatchObject({ success: true });
    const first = await snapshot(f);

    // Same request again (double tap): recognised, same answer, nothing new.
    const again = await completeDeliveryAction(f.orderId, input);
    expect(again).toMatchObject({ success: true });
    // A different request against the completed delivery is refused.
    const different = await completeDeliveryAction(f.orderId, payload(f, { 0: [5, 0] }));
    expect(errorText(different)).toMatch(/already completed/);

    expect(await snapshot(f)).toEqual(first);
    expect(first.creditsPaise).toEqual([20000]);
    expect(first.loyalty).toEqual(['ORDER_EARN:8']);
    expect(first.requests).toBe(1);
    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
  });

  it('simultaneous completion attempts produce exactly one settlement', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    const same = payload(f, { 0: [2, 0] });
    const results = await Promise.all([
      completeDeliveryAction(f.orderId, same),
      completeDeliveryAction(f.orderId, same),
      completeDeliveryAction(f.orderId, payload(f, { 0: [4, 0] })),
      completeDeliveryAction(f.orderId, payload(f)),
      completeDeliveryAction(f.orderId, same),
    ]);
    // The first to run wins; identical requests get its answer; different ones are refused.
    expect(results.filter((r) => 'success' in r)).toHaveLength(3);
    expect(results.filter((r) => /already completed/.test(errorText(r)))).toHaveLength(2);

    const s = await snapshot(f);
    expect(s.creditsPaise).toEqual([20000]);
    expect(s.loyalty).toEqual(['ORDER_EARN:8']);
    expect(s.lines).toEqual([{ d: 8, m: 2, g: 0 }]);
    expect(s.requests).toBe(1);
    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
  });

  it('a lost response followed by a retry does not duplicate credits', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    const input = payload(f, { 0: [2, 0] });

    state.dropResponse = true; // the transaction commits, the answer never arrives
    await expect(completeDeliveryAction(f.orderId, input)).rejects.toThrow(/socket hang up/);
    const committed = await snapshot(f);
    expect(committed.delivery.delivery_status).toBe('partially_delivered');
    expect(committed.creditsPaise).toEqual([20000]);

    state.dropResponse = false;
    const retry = await completeDeliveryAction(f.orderId, input);
    expect(retry).toMatchObject({ success: true });
    expect((retry as { message: string }).message).toContain('₹200');
    expect(await snapshot(f)).toEqual(committed);
  });

  it("someone else replaying the winner's request is refused", async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    expect(await completeDeliveryAction(f.orderId, payload(f))).toMatchObject({ success: true });
    actAs(admin, 'super_admin');
    expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/already completed/);
  });
});

describe('completeDeliveryAction — all or nothing', () => {
  it('a wallet failure rolls back the delivery and the order', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    await withFailure('retailer_wallet_ledger', 'insert', async () => {
      const result = await completeDeliveryAction(f.orderId, payload(f, { 0: [2, 0] }));
      expect(errorText(result)).toMatch(/could not be completed, so nothing was changed/);
      // The raw database error is not shown to staff.
      expect(errorText(result)).not.toMatch(/TEST_INJECTED/);
    });
    await expectUntouched(f, 0);
    expect(notifyOrderEvent).not.toHaveBeenCalled();

    // Once the fault is gone the same request completes normally.
    expect(await completeDeliveryAction(f.orderId, payload(f, { 0: [2, 0] }))).toMatchObject({ success: true });
    expect((await snapshot(f)).creditsPaise).toEqual([20000]);
  });

  it('an order update failure rolls back the line quantities and the delivery', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    await withFailure('orders', 'update', async () => {
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, { 0: [2, 0] })))).toMatch(/nothing was changed/);
    });
    await expectUntouched(f, 0);
    expect(notifyOrderEvent).not.toHaveBeenCalled();
  });

  it('a loyalty failure rolls back the delivery, the order and the wallet credit', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    await withFailure('loyalty_ledger', 'insert', async () => {
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, { 0: [2, 0] })))).toMatch(/nothing was changed/);
    });
    await expectUntouched(f, 0);
    expect(notifyOrderEvent).not.toHaveBeenCalled();
  });

  it('a failure while recording the idempotency result rolls everything back too', async () => {
    const f = await dispatched([[1000, 10]]);
    actAs(staff, 'staff');
    await withFailure('delivery_completion_requests', 'insert', async () => {
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f, { 0: [2, 0] })))).toMatch(/nothing was changed/);
    });
    await expectUntouched(f, 0);
  });

  it('a failed notification does not report the committed delivery as failed', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    vi.mocked(notifyOrderEvent).mockRejectedValueOnce(new Error('push provider down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await completeDeliveryAction(f.orderId, payload(f))).toMatchObject({ success: true });
    expect((await snapshot(f)).delivery.delivery_status).toBe('delivered');
    warn.mockRestore();
  });

  it('reports a clear message when migration 0099 is not installed, and writes nothing', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    await db.exec(`alter function public.complete_delivery_atomic(uuid, uuid, text, text, text, text, text, text, jsonb) rename to complete_delivery_atomic_hidden;`);
    try {
      expect(errorText(await completeDeliveryAction(f.orderId, payload(f)))).toMatch(/database update for it has not been applied/);
    } finally {
      await db.exec(`alter function public.complete_delivery_atomic_hidden(uuid, uuid, text, text, text, text, text, text, jsonb) rename to complete_delivery_atomic;`);
    }
    await expectUntouched(f, 0);
  });
});

describe('0099 rollback script', () => {
  it('removes the function, restores the 0094 loyalty trigger, keeps the idempotency rows, and re-applies cleanly', async () => {
    const f = await dispatched([[500, 5]]);
    actAs(staff, 'staff');
    expect(await completeDeliveryAction(f.orderId, payload(f))).toMatchObject({ success: true });
    const before = await db.query<{ n: number }>(`select count(*)::int n from public.delivery_completion_requests`);

    await db.exec(readFileSync('supabase/rollbacks/0099_atomic_delivery_completion.down.sql', 'utf8'));
    const gone = await db.query<{ present: boolean }>(`select to_regproc('public.complete_delivery_atomic') is not null as present`);
    expect(gone.rows[0]!.present).toBe(false);
    const after = await db.query<{ n: number }>(`select count(*)::int n from public.delivery_completion_requests`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    const g = await dispatched([[500, 5]]);
    expect(errorText(await completeDeliveryAction(g.orderId, payload(g)))).toMatch(/database update for it has not been applied/);

    // Re-apply twice: idempotent.
    const up = readFileSync('supabase/migrations/0099_atomic_delivery_completion.sql', 'utf8');
    await db.exec(up);
    await db.exec(up);
    expect(await completeDeliveryAction(g.orderId, payload(g))).toMatchObject({ success: true });
    const kept = await db.query<{ n: number }>(`select count(*)::int n from public.delivery_completion_requests`);
    expect(kept.rows[0]!.n).toBe(before.rows[0]!.n + 1);
  });
});
