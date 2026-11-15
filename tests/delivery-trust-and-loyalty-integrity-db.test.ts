/**
 * Migration 0094 executed on real PostgreSQL 16 (PGlite): the delivery trust
 * boundary, server-computed shortfall credit, loyalty on delivered value and
 * API-role privilege hygiene. Every assertion runs the actual triggers,
 * policies and functions; nothing here inspects SQL text.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let admin: string;
let staff: string;
let otherStaff: string;
let retailer: string;
let warehouse: string;
let productId: string;

/** Catalog fixtures are created with user triggers off: catalog compliance is tested elsewhere. */
async function seedProduct(): Promise<string> {
  await db.exec(`alter table public.categories disable trigger user; alter table public.products disable trigger user;`);
  const tag = randomUUID().slice(0, 8);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [`Cat ${tag}`]);
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
     values ($1, $2, 'pcs', 100, 18, $3, true) returning id`,
    [`SKU-${tag}`, `Product ${tag}`, cat[0]!.id],
  );
  await db.exec(`alter table public.categories enable trigger user; alter table public.products enable trigger user;`);
  return product[0]!.id;
}

interface OrderFixture { orderId: string; deliveryId: string; itemIds: string[] }

/**
 * A dispatched order with one delivery task assigned to `staff`.
 * `lines` = [lineTotalRupees, piecesOrdered].
 */
async function dispatchedOrder(lines: [number, number][], grandTotal?: number): Promise<OrderFixture> {
  const orderId = randomUUID();
  const total = grandTotal ?? lines.reduce((sum, [value]) => sum + value, 0);
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
     values ($1, 'assigned', $2, $3, now(), 'keyed-hash-placeholder') returning id`,
    [orderId, staff, admin],
  );
  for (let index = 0; index < itemIds.length; index += 1) {
    await db.query(
      `insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, $3)`,
      [delivery[0]!.id, itemIds[index], lines[index]![1]],
    );
  }
  return { orderId, deliveryId: delivery[0]!.id, itemIds };
}

async function loyaltyPoints(orderId: string, type: string): Promise<number[]> {
  const { rows } = await db.query<{ points: number }>(
    `select points from public.loyalty_ledger where reference_id = $1 and entry_type = $2 order by created_at`,
    [orderId, type],
  );
  return rows.map((row) => row.points);
}

describe('0094 delivery trust boundary and loyalty integrity (PostgreSQL 16)', () => {
  beforeAll(async () => {
    db = await createMigratedDb();
    admin = await createUser(db, 'super_admin', 'Admin');
    staff = await createUser(db, 'staff', 'Delivery Staff');
    otherStaff = await createUser(db, 'staff', 'Other Staff');
    retailer = (await createRetailer(db)).id;
    const { rows } = await db.query<{ id: string }>(`insert into public.warehouses (name, is_active) values ('WH 0094', true) returning id`);
    warehouse = rows[0]!.id;
    await db.query(`insert into public.staff_assignments (staff_id, warehouse_id) values ($1, $2)`, [staff, warehouse]);
    productId = await seedProduct();
  }, 120_000);

  describe('SEC-01: OTP cannot be bypassed through the Data API', () => {
    it('rejects the assigned staff member completing a delivery directly', async () => {
      const { deliveryId } = await dispatchedOrder([[500, 10]]);
      const message = await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set delivery_status = 'delivered', otp_verified_at = now() where id = $1`, [deliveryId]));
      expect(message).toMatch(/DELIVERY_GUARD/);
      const { rows } = await db.query<{ delivery_status: string }>(`select delivery_status from public.order_deliveries where id = $1`, [deliveryId]);
      expect(rows[0]?.delivery_status).toBe('assigned');
    });

    it('rejects replacing the OTP hash, resetting attempts or forging verification', async () => {
      const { deliveryId } = await dispatchedOrder([[500, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set otp_hash = 'attacker-chosen' where id = $1`, [deliveryId]))).toMatch(/OTP fields are server-managed/);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set otp_verified_at = now() where id = $1`, [deliveryId]))).toMatch(/OTP fields are server-managed/);
      // Counting a wrong attempt is allowed; lowering or skipping is not.
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set otp_attempts = otp_attempts + 1 where id = $1`, [deliveryId]))).toBeNull();
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set otp_attempts = 0 where id = $1`, [deliveryId]))).toMatch(/counted upward/);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set otp_attempts = otp_attempts + 5 where id = $1`, [deliveryId]))).toMatch(/counted upward/);
    });

    it('rejects self-reassignment and moving a delivery to another order', async () => {
      const first = await dispatchedOrder([[500, 10]]);
      const second = await dispatchedOrder([[500, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set assigned_staff_id = $2 where id = $1`, [first.deliveryId, otherStaff]))).toMatch(/dispatch desk/);
      await db.query(`delete from public.order_deliveries where id = $1`, [second.deliveryId]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set order_id = $2 where id = $1`, [first.deliveryId, second.orderId]))).toMatch(/another order/);
    });

    it('rejects forging proof fields on an open delivery', async () => {
      const { deliveryId } = await dispatchedOrder([[500, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set photo_url = 'other-order/proof.jpg', receiver_name = 'Forged' where id = $1`, [deliveryId]))).toMatch(/server-managed/);
    });

    it('still lets the assigned staff start a delivery and record a failed attempt', async () => {
      const { orderId, deliveryId } = await dispatchedOrder([[500, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set delivery_status = 'in_progress', in_progress_at = now() where id = $1`, [deliveryId]))).toBeNull();
      // 0100: a failed attempt must also re-open the order, so it is one
      // transaction (fail_delivery_atomic) and no longer a plain UPDATE that
      // could leave a failed task on a still-dispatched order.
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_deliveries set delivery_status = 'failed', failure_reason = 'Shop closed' where id = $1`, [deliveryId]))).toMatch(/FULFILMENT_GUARD/);
      // The assigned staff member still CAN record it — through the server.
      expect(await errorOf(db, 'service', (tx: Tx) =>
        tx.query(`select public.fail_delivery_atomic($1, $2, 'Shop closed')`, [orderId, staff]))).toBeNull();
      const { rows } = await db.query<{ d: string; r: string; o: string }>(
        `select d.delivery_status d, d.failure_reason r, o.status::text o from public.order_deliveries d join public.orders o on o.id = d.order_id where d.id = $1`, [deliveryId]);
      expect(rows[0]).toEqual({ d: 'failed', r: 'Shop closed', o: 'processing' });
    });

    it('rejects staff marking the order delivered directly, and awards nothing', async () => {
      const { orderId } = await dispatchedOrder([[1000, 10]]);
      const message = await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]));
      expect(message).toMatch(/ORDER_GUARD/);
      expect(await loyaltyPoints(orderId, 'ORDER_EARN')).toEqual([]);
    });

    it('allows the trusted paths: service role (after server OTP check) and Admin', async () => {
      const viaService = await dispatchedOrder([[1000, 10]]);
      await as(db, 'service', async (tx: Tx) => {
        // 0096: a delivery completes only with every line fully accounted for.
        await tx.query(`update public.order_delivery_items set quantity_delivered = quantity_ordered where delivery_id = $1`, [viaService.deliveryId]);
        await tx.query(`update public.order_deliveries set delivery_status = 'delivered', otp_verified_at = now(), completed_by = $2 where id = $1`, [viaService.deliveryId, staff]);
        await tx.query(`update public.orders set status = 'delivered' where id = $1`, [viaService.orderId]);
      });
      expect(await loyaltyPoints(viaService.orderId, 'ORDER_EARN')).toEqual([10]);

      const viaAdmin = await dispatchedOrder([[1000, 10]]);
      expect(await errorOf(db, admin, (tx: Tx) =>
        tx.query(`update public.orders set status = 'delivered' where id = $1`, [viaAdmin.orderId]))).toBeNull();
    });

    it('freezes delivered quantities for staff once the delivery is completed', async () => {
      const { deliveryId, itemIds } = await dispatchedOrder([[1000, 10]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = quantity_ordered where delivery_id = $1`, [deliveryId]);
        await tx.query(`update public.order_deliveries set delivery_status = 'delivered' where id = $1`, [deliveryId]);
      });
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1`, [itemIds[0]]))).toMatch(/locked after completion/);
    });
  });

  describe('SEC-16 (0096): the delivery line snapshot cannot be manipulated through the Data API', () => {
    const lineOf = async (itemId: string) => (await db.query<{ delivery_id: string; order_item_id: string; quantity_ordered: number; quantity_delivered: number; quantity_missing: number; quantity_damaged: number }>(
      `select delivery_id, order_item_id, quantity_ordered, quantity_delivered, quantity_missing, quantity_damaged from public.order_delivery_items where order_item_id = $1`, [itemId])).rows;

    it('REPRODUCTION: without 0096 the assigned staff member can rewrite quantity_ordered and re-point the line', async () => {
      const { itemIds } = await dispatchedOrder([[1000, 10]]);
      const other = await dispatchedOrder([[9000, 10]]);
      await db.exec(`alter table public.order_delivery_items disable trigger trg_guard_order_delivery_item_snapshot;`);
      try {
        expect(await errorOf(db, staff, (tx: Tx) =>
          tx.query(`update public.order_delivery_items set quantity_ordered = 1, quantity_missing = 1 where order_item_id = $1`, [itemIds[0]]))).toBeNull();
        expect((await lineOf(itemIds[0]!))[0]?.quantity_ordered).toBe(1);
        expect(await errorOf(db, staff, (tx: Tx) =>
          tx.query(`delete from public.order_delivery_items where order_item_id = $1`, [other.itemIds[0]]))).toBeNull();
        expect(await lineOf(other.itemIds[0]!)).toHaveLength(0);
      } finally {
        await db.exec(`alter table public.order_delivery_items enable trigger trg_guard_order_delivery_item_snapshot;`);
      }
    });

    it('rejects changing quantity_ordered, order_item_id or delivery_id by the assigned staff member', async () => {
      const mine = await dispatchedOrder([[1000, 10], [500, 5]]);
      const other = await dispatchedOrder([[9000, 10]]);
      const before = await lineOf(mine.itemIds[0]!);
      for (const sql of [
        `update public.order_delivery_items set quantity_ordered = 1 where order_item_id = '${mine.itemIds[0]}'`,
        `update public.order_delivery_items set quantity_ordered = 1000, quantity_missing = 1000 where order_item_id = '${mine.itemIds[0]}'`,
        `update public.order_delivery_items set order_item_id = '${other.itemIds[0]}' where order_item_id = '${mine.itemIds[0]}'`,
        `update public.order_delivery_items set delivery_id = '${other.deliveryId}' where order_item_id = '${mine.itemIds[0]}'`,
        `update public.order_delivery_items set created_at = now() - interval '1 day' where order_item_id = '${mine.itemIds[0]}'`,
      ]) {
        expect(await errorOf(db, staff, (tx: Tx) => tx.query(sql)), sql).toMatch(/snapshot .* is immutable/);
      }
      expect(await lineOf(mine.itemIds[0]!)).toEqual(before);
    });

    it('keeps the snapshot immutable for Admin and the service role too', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      const sql = `update public.order_delivery_items set quantity_ordered = 2 where order_item_id = '${mine.itemIds[0]}'`;
      expect(await errorOf(db, admin, (tx: Tx) => tx.query(sql))).toMatch(/is immutable/);
      expect(await errorOf(db, 'service', (tx: Tx) => tx.query(sql))).toMatch(/is immutable/);
    });

    it('rejects staff deleting a line or inserting a forged one', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      const other = await dispatchedOrder([[9000, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`delete from public.order_delivery_items where order_item_id = $1`, [mine.itemIds[0]]))).toMatch(/cannot be removed/);
      expect(await lineOf(mine.itemIds[0]!)).toHaveLength(1);
      // A line of ANOTHER order attached to my delivery.
      await db.query(`delete from public.order_delivery_items where order_item_id = $1`, [other.itemIds[0]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 10)`, [mine.deliveryId, other.itemIds[0]]))).toMatch(/does not belong to this delivery's order/);
      // Right order, wrong ordered quantity.
      await db.query(`delete from public.order_delivery_items where order_item_id = $1`, [mine.itemIds[0]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 3)`, [mine.deliveryId, mine.itemIds[0]]))).toMatch(/must equal the original ordered quantity \(10\)/);
      // Right snapshot but pre-filled quantities.
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered, quantity_missing, quantity_delivered) values ($1, $2, 10, 10, 0)`, [mine.deliveryId, mine.itemIds[0]]))).toMatch(/starts with no quantities recorded/);
      expect(await lineOf(mine.itemIds[0]!)).toHaveLength(0);
    });

    it('applies membership and original-quantity validation to trusted writers as well', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      const other = await dispatchedOrder([[9000, 10]]);
      await db.query(`delete from public.order_delivery_items where delivery_id in ($1, $2)`, [mine.deliveryId, other.deliveryId]);
      expect(await errorOf(db, 'service', (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 10)`, [mine.deliveryId, other.itemIds[0]]))).toMatch(/does not belong/);
      expect(await errorOf(db, admin, (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 99)`, [mine.deliveryId, mine.itemIds[0]]))).toMatch(/must equal the original ordered quantity/);
      expect(await errorOf(db, 'service', (tx: Tx) =>
        tx.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 10)`, [mine.deliveryId, mine.itemIds[0]]))).toBeNull();
    });

    it('lets the assigned staff member record only delivered / missing / damaged within the ordered quantity', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_delivery_items set quantity_delivered = 7, quantity_missing = 2, quantity_damaged = 1 where order_item_id = $1`, [mine.itemIds[0]]))).toBeNull();
      expect((await lineOf(mine.itemIds[0]!))[0]).toMatchObject({ quantity_ordered: 10, quantity_delivered: 7, quantity_missing: 2, quantity_damaged: 1 });
      for (const set of [
        `quantity_delivered = 11, quantity_missing = 0, quantity_damaged = 0`,
        `quantity_delivered = 7, quantity_missing = 3, quantity_damaged = 1`,
        `quantity_delivered = -1, quantity_missing = 11, quantity_damaged = 0`,
        `quantity_delivered = 5, quantity_missing = 0, quantity_damaged = 0`,
      ]) {
        expect(await errorOf(db, staff, (tx: Tx) =>
          tx.query(`update public.order_delivery_items set ${set} where order_item_id = $1`, [mine.itemIds[0]])), set).not.toBeNull();
      }
      expect((await lineOf(mine.itemIds[0]!))[0]).toMatchObject({ quantity_delivered: 7, quantity_missing: 2, quantity_damaged: 1 });
    });

    it('gives no write access to another staff member, a retailer or an anonymous caller', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      const before = await lineOf(mine.itemIds[0]!);
      for (const who of [otherStaff, retailer, 'anon'] as const) {
        await errorOf(db, who, (tx: Tx) =>
          tx.query(`update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1`, [mine.itemIds[0]]));
        await errorOf(db, who, (tx: Tx) =>
          tx.query(`delete from public.order_delivery_items where order_item_id = $1`, [mine.itemIds[0]]));
        expect(await lineOf(mine.itemIds[0]!), String(who)).toEqual(before);
      }
    });

    it('refuses completion with missing, unaccounted or mis-labelled lines (every caller)', async () => {
      const mine = await dispatchedOrder([[1000, 10], [500, 5]]);
      const complete = (status: string) => errorOf(db, 'service', (tx: Tx) =>
        tx.query(`update public.order_deliveries set delivery_status = '${status}' where id = $1`, [mine.deliveryId]));
      expect(await complete('delivered')).toMatch(/full ordered quantity/);
      await db.query(`update public.order_delivery_items set quantity_delivered = quantity_ordered where order_item_id = $1`, [mine.itemIds[0]]);
      await db.query(`update public.order_delivery_items set quantity_delivered = 3, quantity_damaged = 2 where order_item_id = $1`, [mine.itemIds[1]]);
      expect(await complete('delivered')).toMatch(/must be recorded as partially delivered/);
      await db.query(`delete from public.order_delivery_items where order_item_id = $1`, [mine.itemIds[0]]);
      expect(await complete('partially_delivered')).toMatch(/exactly one line per order line/);
      await db.query(`insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered, quantity_delivered) values ($1, $2, 10, 10)`, [mine.deliveryId, mine.itemIds[0]]);
      expect(await complete('partially_delivered')).toBeNull();
    });

    it('values the shortfall and loyalty from the original order line even if a snapshot row were corrupted', async () => {
      // ₹1,000 for 10 pieces; 2 missing → ₹200 shortfall; loyalty on ₹800 → 8 points.
      const mine = await dispatchedOrder([[1000, 10]]);
      await db.query(`update public.order_delivery_items set quantity_delivered = 8, quantity_missing = 2 where order_item_id = $1`, [mine.itemIds[0]]);
      // Simulate legacy / corrupted data that predates the guard: quantity_ordered understated to 2.
      await db.exec(`alter table public.order_delivery_items disable trigger user;`);
      await db.query(`update public.order_delivery_items set quantity_ordered = 2, quantity_delivered = 0 where order_item_id = $1`, [mine.itemIds[0]]);
      await db.exec(`alter table public.order_delivery_items enable trigger user;`);
      const { rows } = await db.query<{ paise: string }>(`select public.delivery_shortfall_paise($1) as paise`, [mine.deliveryId]);
      // 0094 would have returned 100000 (2 of "2" = the whole line). 0096 uses the order line: 2 of 10.
      expect(Number(rows[0]!.paise)).toBe(20000);
    });

    it('end to end: staff records quantities, trusted writer completes, refund and points use original quantities', async () => {
      const mine = await dispatchedOrder([[1000, 10]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_delivery_items set quantity_delivered = 8, quantity_missing = 2 where order_item_id = $1`, [mine.itemIds[0]]))).toBeNull();
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered', otp_verified_at = now(), completed_by = $2 where id = $1`, [mine.deliveryId, staff]);
        await tx.query(`select public.order_shortfall_coins($1, 1, 'shortfall', $2, false)`, [mine.deliveryId, staff]);
        await tx.query(`update public.orders set status = 'delivered' where id = $1`, [mine.orderId]);
      });
      const { rows } = await db.query<{ amount_paise: string }>(
        `select amount_paise from public.retailer_wallet_ledger where reference_type = 'delivery' and reference_id = $1`, [mine.deliveryId]);
      expect(rows.map((row) => Number(row.amount_paise))).toEqual([20000]);
      expect(await loyaltyPoints(mine.orderId, 'ORDER_EARN')).toEqual([8]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1`, [mine.itemIds[0]]))).toMatch(/locked after completion/);
    });
  });

  describe('SEC-03: shortfall credit is computed by the database', () => {
    it('ignores an inflated caller amount and credits the recorded shortfall in paise', async () => {
      // ₹500.50 line, 10 pieces, 3 not delivered → round_half_up(50050 * 3 / 10) = 15015 paise.
      const { deliveryId, itemIds } = await dispatchedOrder([[500.5, 10]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 7, quantity_missing = 2, quantity_damaged = 1 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [deliveryId]);
      });
      const credited = await as(db, staff, async (tx: Tx) => {
        const { rows } = await tx.query<{ credited: string }>(
          `select public.order_shortfall_coins($1, 5005000, 'inflated', null, false) as credited`, [deliveryId]);
        return Number(rows[0]!.credited);
      });
      expect(credited).toBe(15015);
      const { rows } = await db.query<{ amount_paise: string }>(
        `select amount_paise from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'REFUND_CREDIT'`, [deliveryId]);
      expect(rows.map((row) => Number(row.amount_paise))).toEqual([15015]);
    });

    it('is idempotent: a replay creates no second credit', async () => {
      const { deliveryId, itemIds } = await dispatchedOrder([[400, 4]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 3, quantity_missing = 1 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [deliveryId]);
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await as(db, staff, (tx: Tx) => tx.query(`select public.order_shortfall_coins($1, 0, 'replay', null, false)`, [deliveryId]));
      }
      const { rows } = await db.query<{ count: string }>(
        `select count(*) from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'REFUND_CREDIT'`, [deliveryId]);
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it('credits nothing for a fully delivered order whatever amount is requested', async () => {
      const { deliveryId, itemIds } = await dispatchedOrder([[900, 9]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 9 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'delivered' where id = $1`, [deliveryId]);
      });
      const credited = await as(db, otherStaff, async (tx: Tx) => {
        const { rows } = await tx.query<{ credited: string }>(`select public.order_shortfall_coins($1, 90000, 'fake', null, false) as credited`, [deliveryId]);
        return Number(rows[0]!.credited);
      });
      expect(credited).toBe(0);
    });

    it('refuses a credit on an open delivery and a reversal before return to warehouse', async () => {
      const open = await dispatchedOrder([[500, 5]]);
      expect(await errorOf(db, staff, (tx: Tx) =>
        tx.query(`select public.order_shortfall_coins($1, 100, 'early', null, false)`, [open.deliveryId]))).toMatch(/completed delivery/);

      const done = await dispatchedOrder([[500, 5]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 4, quantity_damaged = 1 where order_item_id = $1`, [done.itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [done.deliveryId]);
      });
      await as(db, staff, (tx: Tx) => tx.query(`select public.order_shortfall_coins($1, 0, null, null, false)`, [done.deliveryId]));
      expect(await errorOf(db, otherStaff, (tx: Tx) =>
        tx.query(`select public.order_shortfall_coins($1, 0, 'malicious reversal', null, true)`, [done.deliveryId]))).toMatch(/returned to the warehouse/);
    });

    it('denies retailers and anonymous callers', async () => {
      const { deliveryId } = await dispatchedOrder([[500, 5]]);
      expect(await errorOf(db, retailer, (tx: Tx) =>
        tx.query(`select public.order_shortfall_coins($1, 100, null, null, false)`, [deliveryId]))).toMatch(/Access denied/);
      expect(await errorOf(db, 'anon', (tx: Tx) =>
        tx.query(`select public.order_shortfall_coins($1, 100, null, null, false)`, [deliveryId]))).toMatch(/permission denied/);
    });
  });

  describe('SEC-04: loyalty accrues on delivered value only', () => {
    it('awards on grand total minus the recorded shortfall for a partial delivery', async () => {
      // ₹2,000 order, 10 pieces, 3 short → shortfall ₹600 → eligible ₹1,400 → 14 points.
      const { orderId, deliveryId, itemIds } = await dispatchedOrder([[2000, 10]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 7, quantity_missing = 3 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [deliveryId]);
        await tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]);
      });
      expect(await loyaltyPoints(orderId, 'ORDER_EARN')).toEqual([14]);
    });

    it('awards nothing when the delivered value falls below the ₹100 threshold', async () => {
      const { orderId, deliveryId, itemIds } = await dispatchedOrder([[150, 3]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 1, quantity_missing = 2 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [deliveryId]);
        await tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]);
      });
      expect(await loyaltyPoints(orderId, 'ORDER_EARN')).toEqual([]);
    });

    it('reverses exactly the awarded points once when the order is returned, even on a replayed transition', async () => {
      const { orderId, deliveryId, itemIds } = await dispatchedOrder([[2000, 10]]);
      await as(db, 'service', async (tx: Tx) => {
        await tx.query(`update public.order_delivery_items set quantity_delivered = 7, quantity_missing = 3 where order_item_id = $1`, [itemIds[0]]);
        await tx.query(`update public.order_deliveries set delivery_status = 'partially_delivered' where id = $1`, [deliveryId]);
        await tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]);
      });
      // 0100: an API role (even the service key) can no longer mark an order
      // returned with a plain UPDATE; only return_delivery_to_warehouse_atomic
      // (which runs as the function owner) performs this transition.
      expect(await errorOf(db, 'service', (tx: Tx) =>
        tx.query(`update public.orders set status = 'returned' where id = $1`, [orderId]))).toMatch(/FULFILMENT_GUARD/);
      expect(await loyaltyPoints(orderId, 'ORDER_REVERSAL')).toEqual([]);
      // The transition as the atomic function makes it (database owner).
      await db.query(`update public.orders set status = 'returned' where id = $1`, [orderId]);
      expect(await loyaltyPoints(orderId, 'ORDER_EARN')).toEqual([14]);
      expect(await loyaltyPoints(orderId, 'ORDER_REVERSAL')).toEqual([-14]);
    });

    it('keeps ORDER_EARN trigger-only and the ledger closed to direct inserts', async () => {
      expect(await errorOf(db, admin, (tx: Tx) =>
        tx.query(`select public.record_loyalty_points($1, 500, 'ORDER_EARN', 'forged', 'order', null, null)`, [retailer]))).toMatch(/verified order-delivery trigger/);
      expect(await errorOf(db, retailer, (tx: Tx) =>
        tx.query(`insert into public.loyalty_ledger (retailer_id, points, entry_type, reason) values ($1, 999, 'ORDER_EARN', 'direct')`, [retailer]))).toMatch(/permission denied|row-level security/);
    });
  });

  describe('SEC-02: record_loyalty_points authorisation', () => {
    it('REPRODUCTION: through migration 0093 a retailer can mint points for themself', async () => {
      const vulnerable = await createMigratedDb({ lastMigration: '0093_loyalty_earn_rpc_hardening.sql' });
      const attacker = (await createRetailer(vulnerable)).id;
      const minted = await errorOf(vulnerable, attacker, (tx: Tx) =>
        tx.query(`select public.record_loyalty_points($1, 100000, 'MANUAL_CREDIT', 'self award', null, null, null)`, [attacker]));
      expect(minted).toBeNull(); // no error: the Admin check never ran
      const { rows } = await vulnerable.query<{ total: string }>(
        `select coalesce(sum(points), 0)::text as total from public.loyalty_ledger where retailer_id = $1`, [attacker]);
      expect(rows[0]!.total).toBe('100000');
      await vulnerable.close();
    }, 120_000);

    it('FIXED: retailers, staff and anonymous callers are denied; nothing is written', async () => {
      for (const who of [retailer, staff, 'anon']) {
        const message = await errorOf(db, who, (tx: Tx) =>
          tx.query(`select public.record_loyalty_points($1, 100000, 'MANUAL_CREDIT', 'self award', null, null, null)`, [retailer]));
        expect(message).toMatch(/Access denied|permission denied/);
      }
      const { rows } = await db.query<{ count: string }>(
        `select count(*)::text as count from public.loyalty_ledger where retailer_id = $1 and entry_type = 'MANUAL_CREDIT'`, [retailer]);
      expect(rows[0]!.count).toBe('0');
    });

    it('FIXED: an Admin can still record an idempotent manual credit and a bounded debit', async () => {
      const key = `manual:${randomUUID()}`;
      const first = await as(db, admin, async (tx: Tx) =>
        (await tx.query<{ id: string }>(`select public.record_loyalty_points($1, 50, 'MANUAL_CREDIT', 'Goodwill', 'manual', null, $2) as id`, [retailer, key])).rows[0]!.id);
      const replay = await as(db, admin, async (tx: Tx) =>
        (await tx.query<{ id: string }>(`select public.record_loyalty_points($1, 50, 'MANUAL_CREDIT', 'Goodwill', 'manual', null, $2) as id`, [retailer, key])).rows[0]!.id);
      expect(replay).toBe(first);
      expect(await errorOf(db, admin, (tx: Tx) =>
        tx.query(`select public.record_loyalty_points($1, -100000000, 'MANUAL_DEBIT', 'Too much', null, null, null)`, [retailer]))).toMatch(/INSUFFICIENT_LOYALTY_POINTS/);
    });
  });

  describe('SEC-07: API roles hold no TRUNCATE / REFERENCES / TRIGGER on public tables', () => {
    it('has no such grant left on any public table', async () => {
      const { rows } = await db.query<{ table_name: string }>(
        `select distinct table_name from information_schema.table_privileges
          where table_schema = 'public' and grantee in ('anon', 'authenticated')
            and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`);
      expect(rows).toEqual([]);
    });

    it('does not grant API roles EXECUTE on the loyalty trigger function', async () => {
      const { rows } = await db.query<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', 'public.trg_order_delivered_loyalty()', 'EXECUTE') as anon,
                has_function_privilege('authenticated', 'public.trg_order_delivered_loyalty()', 'EXECUTE') as auth`);
      expect(rows[0]).toEqual({ anon: false, auth: false });
    });
  });

  it('is re-runnable: applying 0094 a second time succeeds and changes nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0094_delivery_trust_and_loyalty_integrity.sql'), 'utf8');
    await expect(db.exec(sql)).resolves.toBeDefined();
  });
});

describe('0094 rollback script', () => {
  it('applies cleanly after 0094 and removes the guards it added', async () => {
    const scratch = await createMigratedDb();
    const { readFileSync } = await import('node:fs');
    await scratch.exec(readFileSync('supabase/rollbacks/0094_delivery_trust_and_loyalty_integrity.down.sql', 'utf8'));
    const { rows } = await scratch.query<{ n: string }>(
      `select count(*)::text as n from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('is_untrusted_api_caller','guard_order_delivery_trusted_fields',
                         'guard_order_delivery_items_after_completion','guard_order_delivered_transition',
                         'delivery_shortfall_paise')`);
    expect(rows[0]!.n).toBe('0');
    // …and 0094 can be applied again afterwards (forward re-apply).
    await scratch.exec(readFileSync('supabase/migrations/0094_delivery_trust_and_loyalty_integrity.sql', 'utf8'));
    await scratch.close();
  }, 120_000);
});
