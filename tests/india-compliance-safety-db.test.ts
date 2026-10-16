/**
 * Regression plan for an ISOLATED, disposable PGlite database only.
 * createMigratedDb() applies the repository migrations IN MEMORY; never point
 * this at a production Supabase instance. Not run in the current audit:
 * the owner forbade applying migrations and no dependencies are installed.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let owner: string;
let other: string;
let admin: string;
let salesman: string;
let orderId: string;
let ticketId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  owner = (await createRetailer(db)).id;
  other = (await createRetailer(db)).id;
  admin = await createUser(db, 'admin');
  salesman = await createUser(db, 'salesman');
  await db.query('update retailers set assigned_salesman_id = $1 where id = $2', [salesman, owner]);
  // 0054 requires exactly one active warehouse for every new order, even if a
  // fixture supplies simple_stock_mode=false (the trigger overwrites it).
  await db.query(`insert into warehouses (name, is_active) values ('Isolated audit WH', true)`);
  const { rows } = await db.query<{ id: string }>(
    `insert into orders (order_number, retailer_id, status, placed_at, gst_total, grand_total, simple_stock_mode)
     values ($1, $2, 'delivered', now() - interval '300 days', 18, 118, false) returning id`,
    [`AUDIT-${randomUUID().slice(0, 10)}`, owner]
  );
  orderId = rows[0]!.id;
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('0059 business-record hold', () => {
  it('disables every business_120 target and rejects even migration-owner reactivation', async () => {
    const { rows } = await db.query<{ target_key: string; enabled: boolean }>(
      `select target_key, enabled from data_retention_rules where category = 'business_120'`
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.enabled === false)).toBe(true);
    await expect(db.query(
      `update data_retention_rules set enabled = true where target_key = 'orders'`
    )).rejects.toThrow(/data_retention_business_hold|check constraint/i);
    const held = await db.query<{ target_key: string; enabled: boolean }>(
      `select target_key, enabled from data_retention_rules
        where target_key in ('expired_notifications', 'notification_logs', 'cleanup_run_logs')`
    );
    expect(held.rows).toHaveLength(3);
    expect(held.rows.every((rule) => rule.enabled === false)).toBe(true);
    await expect(db.query(
      `update data_retention_rules set enabled = true where target_key = 'notification_logs'`
    )).rejects.toThrow(/data_retention_evidence_hold|check constraint/i);
  });

  it('keeps old orders, payment collections and ledger entries through a live scheduler RPC', async () => {
    const payment = await db.query<{ id: string }>(
      `insert into payment_collections (retailer_id, order_id, collected_by, amount_paise, method, created_at)
       values ($1, $2, $3, 11800, 'cash', now() - interval '300 days') returning id`,
      [owner, orderId, salesman]
    );
    const ledger = await db.query<{ id: string }>(
      `insert into retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, description, created_at)
       values ($1, 'PAYMENT_CREDIT', 11800, 'credit', 'isolated fixture', now() - interval '300 days') returning id`,
      [owner]
    );
    const report = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ result: unknown }>(
        `select run_data_cleanup(false, 'test', 25, 100) as result`
      );
      return rows[0]!.result;
    });
    const parsed = (typeof report === 'string' ? JSON.parse(report) : report) as { targets: { target_key: string }[] };
    expect(parsed.targets.map((target) => target.target_key)).not.toContain('orders');
    expect(parsed.targets.map((target) => target.target_key)).not.toContain('payment_records');
    for (const key of ['expired_notifications', 'notification_logs', 'cleanup_run_logs']) {
      expect(parsed.targets.map((target) => target.target_key)).not.toContain(key);
    }
    const stillThere = await db.query<{ order_count: string; payment_count: string; ledger_count: string }>(
      `select (select count(*)::text from orders where id = $1) as order_count,
              (select count(*)::text from payment_collections where id = $2) as payment_count,
              (select count(*)::text from retailer_wallet_ledger where id = $3) as ledger_count`,
      [orderId, payment.rows[0]!.id, ledger.rows[0]!.id]
    );
    expect(stillThere.rows[0]).toEqual({ order_count: '1', payment_count: '1', ledger_count: '1' });
  });
});

describe('0059 cancellation and evidence hold', () => {
  it('denies direct coupon-release execution and delivery/KYC deletion policies', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('authenticated', 'public.release_coupon(uuid)', 'EXECUTE') as allowed`
    );
    expect(rows[0]?.allowed).toBe(false);
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where (schemaname = 'public' and tablename in ('order_delivery_items', 'retailer_documents')
               and cmd = 'DELETE')
           or (schemaname = 'storage' and tablename = 'objects'
               and policyname = 'retailer_documents_bucket_delete')`
    );
    expect(policies.rows).toEqual([]);
  });

  it('retains a failed delivery and its line evidence against updates and deletes', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into order_deliveries (order_id, delivery_status) values ($1, 'assigned') returning id`, [orderId]
    );
    const deliveryId = rows[0]!.id;
    // The isolated fixture has no catalogue lines; this proves the parent
    // cannot be reset or removed. The child-row policy is tested separately.
    await db.query(`update order_deliveries set delivery_status = 'failed', failure_reason = 'Isolated fixture' where id = $1`, [deliveryId]);
    await expect(db.query(`update order_deliveries set delivery_status = 'assigned' where id = $1`, [deliveryId]))
      .rejects.toThrow(/evidence is held/i);
    await expect(db.query(`delete from order_deliveries where id = $1`, [deliveryId]))
      .rejects.toThrow(/evidence is held/i);
  });
});

describe('0059 cross-account RLS and complaint provenance', () => {
  it('rejects a foreign order link and a pre-set workflow status; allows own open ticket', async () => {
    expect(await errorOf(db, other, (tx) => tx.query(
      `insert into support_tickets (ticket_number, retailer_id, subject, topic, order_id)
       values ('AUD-FOREIGN-ORDER', $1, 'An order complaint', 'order', $2)`, [other, orderId]
    ))).toMatch(/row-level security/i);
    expect(await errorOf(db, owner, (tx) => tx.query(
      `insert into support_tickets (ticket_number, retailer_id, subject, topic, status)
       values ('AUD-PRESET-STATUS', $1, 'A pending complaint', 'order', 'in_progress')`, [owner]
    ))).toMatch(/row-level security/i);
    const { rows } = await as(db, owner, (tx) => tx.query<{ id: string }>(
      `insert into support_tickets (ticket_number, retailer_id, subject, topic, order_id)
       values ('AUD-OWN-ORDER', $1, 'My actual complaint', 'order', $2) returning id`, [owner, orderId]
    ));
    ticketId = rows[0]!.id;
  });

  it('hides another retailer\'s order, payment and ticket; denies forged admin replies', async () => {
    const visible = await as(db, other, async (tx) => ({
      orders: (await tx.query('select id from orders where id = $1', [orderId])).rows,
      payments: (await tx.query('select id from payment_collections where order_id = $1', [orderId])).rows,
      tickets: (await tx.query('select id from support_tickets where id = $1', [ticketId])).rows,
      messages: (await tx.query('select id from support_ticket_messages where ticket_id = $1', [ticketId])).rows,
    }));
    expect(visible).toEqual({ orders: [], payments: [], tickets: [], messages: [] });
    expect(await errorOf(db, owner, (tx) => tx.query(
      `insert into support_ticket_messages (ticket_id, author_id, author_role, body)
       values ($1, $2, 'admin', 'Forged administrator answer')`, [ticketId, owner]
    ))).toMatch(/row-level security/i);
    expect(await errorOf(db, other, (tx) => tx.query(
      `insert into support_ticket_messages (ticket_id, author_id, author_role, body)
       values ($1, $2, 'retailer', 'Cross account message')`, [ticketId, other]
    ))).toMatch(/row-level security/i);
    expect(await errorOf(db, owner, (tx) => tx.query(
      `insert into support_ticket_messages (ticket_id, author_id, author_role, body)
       values ($1, $2, 'retailer', 'My own complaint message')`, [ticketId, owner]
    ))).toBeNull();
    expect(await errorOf(db, admin, (tx) => tx.query(
      `insert into support_ticket_messages (ticket_id, author_id, author_role, body)
       values ($1, $2, 'admin', 'Verified staff response')`, [ticketId, admin]
    ))).toBeNull();
  });
});

describe('0059 offer preference migration', () => {
  it('does not backfill old true; server-stamps new affirmative choice and clears withdrawal', async () => {
    await as(db, owner, (tx) => tx.query(
      `insert into retailer_notification_prefs (retailer_id, offer_updates) values ($1, true)`, [owner]
    ));
    const read = async () => (await db.query<{ offer_updates: boolean; offer_preference_recorded_at: string | null }>(
      `select offer_updates, offer_preference_recorded_at from retailer_notification_prefs where retailer_id = $1`,
      [owner]
    )).rows[0]!;
    expect(await read()).toMatchObject({ offer_updates: true, offer_preference_recorded_at: null });
    await as(db, owner, (tx) => tx.query(
      `update retailer_notification_prefs set offer_preference_recorded_at = '2020-01-01' where retailer_id = $1`,
      [owner]
    ));
    const stamped = await read();
    expect(Date.parse(String(stamped.offer_preference_recorded_at))).toBeGreaterThan(Date.parse('2024-01-01'));
    await as(db, owner, (tx) => tx.query(
      `update retailer_notification_prefs set offer_updates = false where retailer_id = $1`, [owner]
    ));
    expect(await read()).toMatchObject({ offer_updates: false, offer_preference_recorded_at: null });
    const assignedView = await as(db, salesman, (tx) => tx.query(
      `select retailer_id from retailer_notification_prefs where retailer_id = $1`, [owner]
    ));
    expect(assignedView.rows).toHaveLength(1);
    const outsiderView = await as(db, other, (tx) => tx.query(
      `select retailer_id from retailer_notification_prefs where retailer_id = $1`, [owner]
    ));
    expect(outsiderView.rows).toEqual([]);
  });
});
