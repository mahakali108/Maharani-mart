/**
 * Seller Marketplace (0062–0068) — EXECUTED against PostgreSQL (PGlite, all
 * migrations applied) with PostgREST-style impersonation. Pins the invariants
 * the design review demanded:
 *   - seller tenant isolation (members see ONLY their own seller/offers);
 *   - status transition stamps (reviewed_by = auth.uid());
 *   - admin price floors enforced on every offer write;
 *   - cart line identity: one Maharani line AND one seller line per pack;
 *   - partial order uniqueness: legacy (order,pack) vs split (sub_order,pack);
 *   - seller stock oversell guard (conditional UPDATE, row-serialised);
 *   - restorable = deducted − shipped + returned_received − restored ≥ 0;
 *   - drain-mode suspension deactivates offers (history preserved);
 *   - child-scoped coin refunds reverse each debit exactly once.
 * Run locally/disposable only — never against a production project.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { as, createMigratedDb, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let admin: string;
let staff: string;
let retailer: string;
let sellerProfile: string;
let productId: string;
let packId: string;
let sellerId: string;
let offerId: string;

async function createPack(tx: Db | Tx, name: string, stock: number): Promise<{ productId: string; packId: string }> {
  const sku = `SKU-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows: productRows } = await tx.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price) values ($1, $2, 'pcs', 100) returning id`,
    [sku, name]
  );
  const { rows: packRows } = await tx.query<{ id: string }>(
    `insert into product_packs (product_id, pack_name, pack_sku_code, units_per_case, base_price, case_price, stock_quantity)
     values ($1, 'Std', $2, 12, 100, 1200, $3) returning id`,
    [productRows[0]!.id, `${sku}-P`, stock]
  );
  return { productId: productRows[0]!.id, packId: packRows[0]!.id };
}

async function createSeller(tx: Db | Tx, name: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into sellers (business_name, status) values ($1, 'pending') returning id`,
    [name]
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  staff = await createUser(db, 'staff');
  retailer = await createUser(db, 'retailer');
  sellerProfile = await createUser(db, 'seller');
  const created = await createPack(db, 'Marketplace goods', 100);
  productId = created.productId;
  packId = created.packId;

  await as(db, admin, (tx) => tx.query(
    `insert into retailers (id, status, area_id) values ($1, 'active', null)`,
    [retailer]
  ).catch(async () => tx.query(`update retailers set status='active' where id=$1`, [retailer])));

  sellerId = await as(db, admin, (tx) => createSeller(tx, 'Bazaar Seller Co'));
  await as(db, admin, (tx) => tx.query(
    `update sellers set status='active' where id=$1 and status='pending'`,
    [sellerId]
  ));

  // Admin-authored, approved, seller-fulfilled offer at ₹100.00/piece.
  offerId = await as(db, admin, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into seller_offers
         (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity, moderation_status)
       values ($1, $2, $3, 'seller', 10000, 1, 50, 'approved') returning id`,
      [sellerId, productId, packId]
    );
    return rows[0]!.id;
  });
}, 180_000);

describe('0062 seller identity and tenancy', () => {
  it('a seller member sees ONLY their own seller; staff sees none', async () => {
    const otherSeller = await as(db, admin, (tx) => createSeller(tx, 'Other Seller Ltd'));
    await as(db, admin, (tx) => tx.query(
      `insert into seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`,
      [sellerId, sellerProfile]
    ));

    const memberRows = await as(db, sellerProfile, async (tx) =>
      (await tx.query(`select id from sellers`)).rows
    );
    expect(memberRows.map((r) => r.id)).toEqual([sellerId]);

    const staffRows = await as(db, staff, async (tx) =>
      (await tx.query(`select id from sellers`)).rows
    );
    expect(staffRows).toEqual([]);

    const adminRows = await as(db, admin, async (tx) =>
      (await tx.query(`select id from sellers`)).rows
    );
    expect(adminRows.map((r) => r.id)).toContain(otherSeller);
  });

  it('status transitions stamp the reviewer and refuse impossible jumps', async () => {
    const pendingId = await as(db, admin, (tx) => createSeller(tx, 'Pending Review Co'));
    expect(await errorOf(db, admin, (tx) => tx.query(
      `update sellers set status='suspended' where id=$1`,
      [pendingId]
    ))).toMatch(/INVALID_SELLER_STATUS_TRANSITION/);

    await as(db, admin, (tx) => tx.query(
      `update sellers set status='active' where id=$1 and status='pending'`,
      [pendingId]
    ));
    const { rows } = await db.query<{ reviewed_by: string | null }>(
      `select reviewed_by from sellers where id=$1`, [pendingId]
    );
    expect(rows[0]!.reviewed_by).toBe(admin);
  });
});

describe('0063 floors, moderation and deactivation-only', () => {
  it('a below-floor offer is rejected at write time', async () => {
    await as(db, admin, (tx) => tx.query(
      `insert into offer_price_floors (pack_id, floor_paise, set_by) values ($1, 9500, $2)`,
      [packId, admin]
    ));
    expect(await errorOf(db, admin, (tx) => tx.query(
      `insert into seller_offers (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity, moderation_status)
       values ($1, $2, $3, 'seller', 9400, 1, 5, 'approved')`,
      [sellerId, productId, packId]
    ))).toMatch(/PRICE_BELOW_FLOOR/);
  });

  it('a seller member cannot change moderation state; offers are never deleted', async () => {
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `update seller_offers set moderation_status='approved' where id=$1`,
      [offerId]
    ))).toMatch(/Only an Admin can change the moderation state|row-level security/);
    expect(await errorOf(db, admin, (tx) => tx.query(
      `delete from seller_offers where id=$1`, [offerId]
    ))).toMatch(/permission denied|row-level security/);
  });

  it('price floors are append-only', async () => {
    expect(await errorOf(db, admin, (tx) => tx.query(
      `update offer_price_floors set floor_paise = 1 where pack_id=$1`, [packId]
    ))).toMatch(/append-only/);
    expect(await errorOf(db, admin, (tx) => tx.query(
      `delete from offer_price_floors where pack_id=$1`, [packId]
    ))).toMatch(/append-only/);
  });
});

describe('0064 line identity', () => {
  it('cart holds a Maharani line AND a seller line for the same pack', async () => {
    // Cart writes go through the compare-and-set RPCs (direct DML is revoked).
    await as(db, retailer, (tx) => tx.query(
      `select mutate_retailer_cart_line_ex($1, null, null, 0, 3)`,
      [packId]
    ));
    await as(db, retailer, (tx) => tx.query(
      `select mutate_retailer_cart_line_ex($1, $2, null, 0, 4)`,
      [packId, offerId]
    ));
    const { rows: cartRows } = await db.query<{ line_key: string }>(
      `select line_key from cart_items where retailer_id=$1 order by line_key`, [retailer]
    );
    expect(cartRows.map((r) => r.line_key).sort()).toEqual(['m', `s:${offerId}`].sort());

    // The underlying uq_cart_items_pack_source index also refuses duplicates.
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `insert into cart_items (retailer_id, pack_id, seller_offer_id, source_type, quantity)
       values ($1, $2, $3, 'seller', 5)`,
      [retailer, packId, offerId]
    ))).toMatch(/duplicate key|conflict/);
    // Source shape CHECK: seller source requires the offer reference.
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `insert into cart_items (retailer_id, pack_id, source_type, quantity) values ($1, $2, 'seller', 1)`,
      [retailer, packId]
    ))).toMatch(/cart_items_source_shape|check constraint/);
    await as(db, retailer, (tx) => tx.query(`delete from cart_items where retailer_id=$1`, [retailer]));
  });

  it('order lines: legacy one-pack-per-order; split one-pack-per-sub-order', async () => {
    const parentId = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into orders (id, retailer_id, status, subtotal, gst_total, discount_total, grand_total, request_key, request_fingerprint, fulfilment_profile)
       values ($1, $2, 'pending', 100, 0, 0, 100, $3, repeat('a', 64), 'all_seller')`,
      [parentId, retailer, randomUUID()]
    ));
    const childA = randomUUID();
    const childB = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into sub_orders (id, parent_order_id, seller_id, fulfilment_type, status, sort_index, gross_paise, payable_paise)
       values ($1, $2, $3, 'seller', 'pending', 0, 10000, 10000), ($4, $2, $3, 'seller', 'pending', 1, 10000, 10000)`,
      [childA, parentId, sellerId, childB]
    ));

    // The same pack in TWO different sub-orders is legal (m + s, or two sellers).
    await as(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, seller_offer_id, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, $4, $5, 'seller', 'seller', 1)`,
      [parentId, productId, packId, childA, offerId]
    ));
    // ...but twice inside the SAME sub-order is not (partial unique + trigger).
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, seller_offer_id, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, $4, $5, 'seller', 'seller', 1)`,
      [parentId, productId, packId, childA, offerId]
    ))).toMatch(/duplicate key|already present/);

    // Legacy unsplit rows: one pack per order (non-null key set).
    const legacyOrder = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into orders (id, retailer_id, status, subtotal, gst_total, discount_total, grand_total, request_key, request_fingerprint, fulfilment_profile)
       values ($1, $2, 'pending', 100, 0, 0, 100, $3, repeat('b', 64), 'all_seller')`,
      [legacyOrder, retailer, randomUUID()]
    ));
    await as(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, 'maharani', 'maharani', 1)`,
      [legacyOrder, productId, packId]
    ));
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, 'maharani', 'maharani', 1)`,
      [legacyOrder, productId, packId]
    ))).toMatch(/duplicate key|already present/);
  });
});

describe('0065/0066 stock discipline', () => {
  it('seller stock cannot oversell (conditional UPDATE is the guard)', async () => {
    const { rows } = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from seller_offers where id=$1`, [offerId]
    );
    const before = rows[0]!.stock_quantity;

    const parentId = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into orders (id, retailer_id, status, subtotal, gst_total, discount_total, grand_total, request_key, request_fingerprint, fulfilment_profile)
       values ($1, $2, 'pending', 100, 0, 0, 100, $3, repeat('c', 64), 'all_seller')`,
      [parentId, retailer, randomUUID()]
    ));
    const childId = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into sub_orders (id, parent_order_id, seller_id, fulfilment_type, status, sort_index, gross_paise, payable_paise)
       values ($1, $2, $3, 'seller', 'pending', 0, 10000, 10000)`,
      [childId, parentId, sellerId]
    ));

    // The insert trigger deducts seller stock atomically (source-aware 0065).
    await as(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, seller_offer_id, source_type, fulfilment_type)
       values ($1, $2, $3, 2, 'pieces', 2, 12, 100, 0, 200, $4, $5, 'seller', 'seller')`,
      [parentId, productId, packId, childId, offerId]
    ));
    const { rows: afterRows } = await db.query<{ stock_quantity: number; }>(
      `select stock_quantity from seller_offers where id=$1`, [offerId]
    );
    expect(afterRows[0]!.stock_quantity).toBe(before - 2);

    // Asking for more than remains fails INSUFFICIENT_STOCK — never oversells.
    const parent2 = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into orders (id, retailer_id, status, subtotal, gst_total, discount_total, grand_total, request_key, request_fingerprint, fulfilment_profile)
       values ($1, $2, 'pending', 100, 0, 0, 100, $3, repeat('d', 64), 'all_seller')`,
      [parent2, retailer, randomUUID()]
    ));
    const child2 = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into sub_orders (id, parent_order_id, seller_id, fulfilment_type, status, sort_index, gross_paise, payable_paise)
       values ($1, $2, $3, 'seller', 'pending', 0, 10000, 10000)`,
      [child2, parent2, sellerId]
    ));
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, seller_offer_id, source_type, fulfilment_type)
       values ($1, $2, $3, $4, 'pieces', $4, 12, 100, 0, 100, $5, $6, 'seller', 'seller')`,
      [parent2, productId, packId, rows[0]!.stock_quantity + 1, child2, offerId]
    ))).toMatch(/INSUFFICIENT_STOCK/);
  });

  it('restorable can never exceed deducted − shipped + returned_received', async () => {
    const { rows: itemRows } = await db.query<{ id: string; sub_order_id: string }>(
      `select id, sub_order_id from order_items where seller_offer_id=$1 order by created_at desc limit 1`,
      [offerId]
    );
    const itemId = itemRows[0]!.id;
    expect(await errorOf(db, 'service', (tx) => tx.query(
      `update order_items set stock_restored_quantity = 99 where id=$1`, [itemId]
    ))).toMatch(/RESTORABLE_EXCEEDED|check constraint|violates/);
  });

  it('0065 allocate_largest_remainder sums EXACTLY and zeroes ineligible bases', async () => {
    const { rows } = await db.query<{ shares: string[] }>(
      `select allocate_largest_remainder(100, array[33,33,34]::bigint[]) as shares`
    );
    const shares = (rows[0]!.shares as unknown as string[]).map(Number);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([33, 33, 34]);

    const { rows: zeroRows } = await db.query<{ shares: string[] }>(
      `select allocate_largest_remainder(17, array[0, 50, 50]::bigint[]) as shares`
    );
    const zeroShares = (zeroRows[0]!.shares as unknown as string[]).map(Number);
    expect(zeroShares[0]).toBe(0);
    expect(zeroShares.reduce((a, b) => a + b, 0)).toBe(17);
  });
});

describe('0067 child-scoped coin refunds', () => {
  it('reverses each child debit exactly once, capped by the request', async () => {
    const { rows: orderRows } = await db.query<{ id: string }>(
      `select id from orders where retailer_id=$1 order by placed_at limit 1`, [retailer]
    );
    const parentId = orderRows[0]!.id;
    const { rows: childRows } = await db.query<{ id: string }>(
      `select id from sub_orders where parent_order_id=$1 order by sort_index limit 1`, [parentId]
    );
    const childId = childRows[0]!.id;

    await db.query(
      `insert into retailer_credit_accounts (retailer_id, credit_limit) values ($1, 0)
       on conflict do nothing`,
      [retailer]
    );
    const debitId = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into retailer_wallet_ledger
         (id, retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
       values ($1, $2, 'ORDER_DEBIT', 500, 'debit', 'order', $3, 'test debit', $4)`,
      [debitId, retailer, parentId, `order:${parentId}:${childId}`]
    ));

    const refunded = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ refunded: string }>(
        `select refund_sub_order_coins($1, 300, 'partial test') as refunded`, [childId]
      );
      return Number(rows[0]!.refunded);
    });
    expect(refunded).toBe(300);

    // A second reversal of the same debit is refused by the exactly-once key.
    const again = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ refunded: string }>(
        `select refund_sub_order_coins($1, 300, 'retry') as refunded`, [childId]
      );
      return Number(rows[0]!.refunded);
    });
    expect(again).toBe(0);

    const { rows: reversals } = await db.query<{ count: string }>(
      `select count(*) from retailer_wallet_ledger where reversal_of=$1`, [debitId]
    );
    expect(Number(reversals[0]!.count)).toBe(1);
  });
});

describe('0068 drain-mode suspension', () => {
  it('suspending a seller deactivates their offers; history is preserved', async () => {
    await as(db, admin, (tx) => tx.query(
      `update sellers set status='suspended', suspension_reason='compliance hold' where id=$1 and status='active'`,
      [sellerId]
    ));
    const { rows } = await db.query<{ is_active: boolean }>(
      `select is_active from seller_offers where id=$1`, [offerId]
    );
    expect(rows[0]!.is_active).toBe(false);

    // The row itself survives (deactivate, never delete).
    const { rows: kept } = await db.query<{ id: string }>(
      `select id from seller_offers where id=$1`, [offerId]
    );
    expect(kept).toHaveLength(1);

    // Reinstating does NOT auto-reactivate offers.
    await as(db, admin, (tx) => tx.query(
      `update sellers set status='active' where id=$1 and status='suspended'`, [sellerId]
    ));
    const { rows: still } = await db.query<{ is_active: boolean }>(
      `select is_active from seller_offers where id=$1`, [offerId]
    );
    expect(still[0]!.is_active).toBe(false);
  });
});
