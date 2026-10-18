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
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
let stockSubOrderId: string;

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

  // createUser() already created the pending retailer and its valid area; only
  // promote that row. Do not intentionally fail an INSERT and catch it inside
  // the same transaction — PostgreSQL keeps the transaction aborted afterward.
  await as(db, admin, (tx) => tx.query(
    `update retailers set status='active' where id=$1`,
    [retailer]
  ));

  sellerId = await as(db, admin, (tx) => createSeller(tx, 'Bazaar Seller Co'));
  await as(db, admin, (tx) => tx.query(
    `update sellers set status='active' where id=$1 and status='pending'`,
    [sellerId]
  ));
  await as(db, admin, (tx) => tx.query(
    `insert into seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`,
    [sellerId, sellerProfile]
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
    const memberRows = await as(db, sellerProfile, async (tx) =>
      (await tx.query<{ id: string }>(`select id from sellers`)).rows
    );
    expect(memberRows.map((r) => r.id)).toEqual([sellerId]);

    const staffRows = await as(db, staff, async (tx) =>
      (await tx.query<{ id: string }>(`select id from sellers`)).rows
    );
    expect(staffRows).toEqual([]);

    const adminRows = await as(db, admin, async (tx) =>
      (await tx.query<{ id: string }>(`select id from sellers`)).rows
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
      `insert into seller_offers
         (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity, moderation_status)
       values ($1, $2, $3, 'seller', 10000, 1, 10, 'approved')`,
      [sellerId, productId, packId]
    ))).toMatch(/New offers start in pending moderation|row-level security/);
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `update seller_offers set moderation_status='rejected' where id=$1`,
      [offerId]
    ))).toMatch(/Only an Admin can change the moderation state|row-level security/);
    expect(await errorOf(db, admin, (tx) => tx.query(
      `delete from seller_offers where id=$1`, [offerId]
    ))).toMatch(/permission denied|row-level security/);
  });

  it('price floors are append-only', async () => {
    expect(await errorOf(db, admin, (tx) => tx.query(
      `update offer_price_floors set floor_paise = 1 where pack_id=$1`, [packId]
    ))).toMatch(/append-only|permission denied/);
    expect(await errorOf(db, admin, (tx) => tx.query(
      `delete from offer_price_floors where pack_id=$1`, [packId]
    ))).toMatch(/append-only|permission denied/);
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
       values ($1, $2, $3, 'seller', 'pending', 0, 10000, 10000), ($4, $2, null, 'maharani', 'pending', 1, 10000, 10000)`,
      [childA, parentId, sellerId, childB]
    ));

    // The same pack in TWO different sub-orders is legal (m + s, or two sellers).
    await as(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, seller_offer_id, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, $4, $5, 'seller', 'seller', 1)`,
      [parentId, productId, packId, childA, offerId]
    ));
    // Keep this invariant test independent of other stock-focused cases.
    await as(db, 'service', (tx) => tx.query(
      `update product_packs set stock_quantity=100 where id=$1`, [packId]
    ));
    await as(db, 'service', (tx) => tx.query(
      `insert into order_items (order_id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, sub_order_id, source_type, fulfilment_type, stock_deducted_quantity)
       values ($1, $2, $3, 1, 'pieces', 1, 12, 100, 0, 100, $4, 'maharani', 'maharani', 1)`,
      [parentId, productId, packId, childB]
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
    stockSubOrderId = childId;
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
      `select id, sub_order_id from order_items where seller_offer_id=$1 and sub_order_id=$2 limit 1`,
      [offerId, stockSubOrderId]
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
    const parentId = randomUUID();
    const childId = randomUUID();
    await as(db, 'service', (tx) => tx.query(
      `insert into orders (id, retailer_id, status, subtotal, gst_total, discount_total, grand_total, request_key, request_fingerprint, fulfilment_profile)
       values ($1, $2, 'pending', 500, 0, 0, 500, $3, repeat('e', 64), 'all_seller')`,
      [parentId, retailer, randomUUID()]
    ));
    await as(db, 'service', (tx) => tx.query(
      `insert into sub_orders (id, parent_order_id, seller_id, fulfilment_type, status, sort_index, gross_paise, payable_paise)
       values ($1, $2, $3, 'seller', 'cancelled', 0, 500, 500)`,
      [childId, parentId, sellerId]
    ));

    await db.query(
      `insert into retailer_credit_accounts (retailer_id, credit_limit_paise) values ($1, 0)
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

describe('0069 seller portal boundaries', () => {
  it('creates only a pending seller from public seller metadata and ignores role escalation metadata', async () => {
    const pendingProfile = randomUUID();
    const pendingEmail = `seller-signup-${pendingProfile}@test.local`;
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [pendingProfile, pendingEmail, JSON.stringify({
        account_type: 'seller',
        business_name: `Pending Seller ${pendingProfile.slice(0, 8)}`,
        full_name: 'Pending Owner',
        phone: `9${pendingProfile.replaceAll('-', '').slice(0, 9).replace(/[a-f]/g, '1')}`,
      })]
    );
    const { rows: sellerRows } = await db.query<{
      id: string; status: string; created_by: string; role: string;
    }>(
      `select s.id, s.status, s.created_by, p.role::text as role
         from sellers s join profiles p on p.id=s.created_by
        where s.created_by=$1`,
      [pendingProfile]
    );
    expect(sellerRows).toHaveLength(1);
    expect(sellerRows[0]).toMatchObject({
      status: 'pending', created_by: pendingProfile, role: 'seller',
    });

    // Pending tenants can read their own application but cannot create offers.
    expect(await errorOf(db, pendingProfile, (tx) => tx.query(
      `insert into seller_offers
         (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity)
       values ($1,$2,$3,'seller',10000,1,1)`,
      [sellerRows[0]!.id, productId, packId]
    ))).toMatch(/active seller membership/i);

    const { rows: areaRows } = await db.query<{ area_id: string }>(
      `select area_id from retailers where id=$1`, [retailer]
    );
    const attemptedAdmin = randomUUID();
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
      [attemptedAdmin, `role-escalation-${attemptedAdmin}@test.local`, JSON.stringify({
        account_type: 'admin', role: 'super_admin', full_name: 'Not Admin',
        phone: `8${attemptedAdmin.replaceAll('-', '').slice(0, 9).replace(/[a-f]/g, '2')}`,
        area_id: areaRows[0]!.area_id, shop_name: 'Role-safe shop',
      })]
    );
    const { rows: roleRows } = await db.query<{ role: string }>(
      `select role::text as role from profiles where id=$1`, [attemptedAdmin]
    );
    expect(roleRows[0]!.role).toBe('retailer');
  });

  it('adds a first seller-offer cart line with expected quantity zero', async () => {
    const quantity = await as(db, retailer, async (tx) => {
      const { rows } = await tx.query<{ quantity: number }>(
        `select mutate_retailer_cart_line_ex($1,$2,null,0,1) as quantity`,
        [packId, offerId]
      );
      return rows[0]!.quantity;
    });
    expect(quantity).toBe(1);
    await as(db, retailer, (tx) => tx.query(
      `delete from cart_items where retailer_id=$1`, [retailer]
    ));
  });

  it('preserves text source_type and source-shape invariants on retailer_saved_cart_items', async () => {
    const savedCartId = await as(db, retailer, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into retailer_saved_carts (retailer_id, name) values ($1, 'Weekly list') returning id`,
        [retailer]
      );
      return rows[0]!.id;
    });

    // Legacy insert (no source_type or seller_offer_id provided) defaults to 'maharani'.
    const legacyRow = await as(db, retailer, async (tx) => {
      const { rows } = await tx.query<{ id: string; source_type: string; seller_offer_id: string | null }>(
        `insert into retailer_saved_cart_items (saved_cart_id, retailer_id, product_id, pack_id, quantity)
         values ($1, $2, $3, $4, 2)
         returning id, source_type, seller_offer_id`,
        [savedCartId, retailer, productId, packId]
      );
      return rows[0]!;
    });
    expect(legacyRow).toMatchObject({ source_type: 'maharani', seller_offer_id: null });

    // Seller-offer saved line requires both source_type = 'seller' and seller_offer_id.
    const sellerRow = await as(db, retailer, async (tx) => {
      const { rows } = await tx.query<{ id: string; source_type: string; seller_offer_id: string | null }>(
        `insert into retailer_saved_cart_items
           (saved_cart_id, retailer_id, product_id, pack_id, seller_offer_id, source_type, quantity)
         values ($1, $2, $3, $4, $5, 'seller', 3)
         returning id, source_type, seller_offer_id`,
        [savedCartId, retailer, productId, packId, offerId]
      );
      return rows[0]!;
    });
    expect(sellerRow).toMatchObject({ source_type: 'seller', seller_offer_id: offerId });

    // Mismatched source_type / seller_offer_id combinations fail the check constraint.
    expect(await errorOf(db, retailer, (tx) => tx.query(
      `insert into retailer_saved_cart_items
         (saved_cart_id, retailer_id, product_id, pack_id, source_type, quantity)
       values ($1, $2, $3, $4, 'seller', 1)`,
      [savedCartId, retailer, productId, packId]
    ))).toMatch(/retailer_saved_cart_items_source_shape|check constraint/);

    expect(await errorOf(db, retailer, (tx) => tx.query(
      `insert into retailer_saved_cart_items
         (saved_cart_id, retailer_id, product_id, pack_id, seller_offer_id, source_type, quantity)
       values ($1, $2, $3, $4, $5, 'maharani', 1)`,
      [savedCartId, retailer, productId, packId, offerId]
    ))).toMatch(/retailer_saved_cart_items_source_shape|check constraint/);

    // Remove the seller-offer saved line so rollback 0069 is permitted, leaving
    // the legacy saved line in place to verify pre-0069 data preservation and backfill.
    await as(db, retailer, (tx) => tx.query(
      `delete from retailer_saved_cart_items where id = $1`,
      [sellerRow.id]
    ));

    const rollback0069 = readFileSync(
      path.join(__dirname, '..', 'supabase', 'rollbacks', '0069_seller_portal_access.down.sql'),
      'utf8'
    );
    const migration0069 = readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations', '0069_seller_portal_access.sql'),
      'utf8'
    );
    await db.exec(rollback0069);

    // Re-apply 0069 over the existing legacy row and re-run 0069 to verify idempotency.
    await db.exec(migration0069);
    await db.exec(migration0069);

    const { rows: preservedRows } = await db.query<{
      id: string;
      source_type: string;
      seller_offer_id: string | null;
      quantity: number;
    }>(
      `select id, source_type, seller_offer_id, quantity
         from retailer_saved_cart_items
        where id = $1`,
      [legacyRow.id]
    );
    expect(preservedRows).toEqual([
      { id: legacyRow.id, source_type: 'maharani', seller_offer_id: null, quantity: 2 },
    ]);
  });

  it('discloses only approved merchant terms to retailers and re-moderates seller price edits', async () => {
    const offers = await as(db, retailer, async (tx) => (
      await tx.query<{ offer_id: string; seller_business_name: string }>(
        `select offer_id, seller_business_name from marketplace_offers_for_product($1)`,
        [productId]
      )
    ).rows);
    expect(offers).toContainEqual({ offer_id: offerId, seller_business_name: 'Bazaar Seller Co' });
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `select * from marketplace_offers_for_product($1)`, [productId]
    ))).toMatch(/active retailer session/i);

    await as(db, sellerProfile, (tx) => tx.query(
      `update seller_offers set unit_price_paise=10100 where id=$1`, [offerId]
    ));
    const { rows: pending } = await db.query<{ moderation_status: string }>(
      `select moderation_status from seller_offers where id=$1`, [offerId]
    );
    expect(pending[0]!.moderation_status).toBe('pending');

    // A seller cannot self-approve a pending offer via UPDATE.
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `update seller_offers set moderation_status='approved' where id=$1`, [offerId]
    ))).toMatch(/Only an Admin can change the moderation state|row-level security/);

    await as(db, admin, (tx) => tx.query(
      `update seller_offers set moderation_status='approved' where id=$1`, [offerId]
    ));
  });

  it('updates only owned stock and restores it exactly once on seller cancellation', async () => {
    const setStock = await as(db, sellerProfile, async (tx) => {
      const { rows } = await tx.query<{ stock: number }>(
        `select seller_set_offer_stock($1,40) as stock`, [offerId]
      );
      return rows[0]!.stock;
    });
    expect(setStock).toBe(40);

    await as(db, sellerProfile, (tx) => tx.query(
      `select seller_update_sub_order($1,'confirmed')`, [stockSubOrderId]
    ));
    await as(db, sellerProfile, (tx) => tx.query(
      `select seller_update_sub_order($1,'cancelled')`, [stockSubOrderId]
    ));
    const { rows: afterCancel } = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from seller_offers where id=$1`, [offerId]
    );
    expect(afterCancel[0]!.stock_quantity).toBe(42);

    // A retry is harmless: no line has any remaining restorable quantity.
    await expect(as(db, sellerProfile, (tx) => tx.query(
      `select seller_update_sub_order($1,'cancelled')`, [stockSubOrderId]
    ))).resolves.toBeDefined();
    const { rows: afterRetry } = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from seller_offers where id=$1`, [offerId]
    );
    expect(afterRetry[0]!.stock_quantity).toBe(42);
  });

  it('allows a seller to update their own profile without touching status and enforces quantity-tier rules', async () => {
    await as(db, sellerProfile, (tx) => tx.query(
      `select seller_update_own_profile($1, $2, $3, $4, $5, $6, $7)`,
      [
        'Bazaar Seller Co',
        'Ramesh Owner',
        '9876543210',
        'owner@bazaar.local',
        '10AABCU9603R1ZM',
        'AABCU9603R',
        'Station Road, Chapra',
      ]
    ));
    const { rows: updatedSeller } = await db.query<{
      status: string;
      contact_name: string;
      gstin: string;
      pan: string;
    }>(
      `select status, contact_name, gstin, pan from sellers where id=$1`,
      [sellerId]
    );
    expect(updatedSeller[0]).toEqual({
      status: 'active',
      contact_name: 'Ramesh Owner',
      gstin: '10AABCU9603R1ZM',
      pan: 'AABCU9603R',
    });

    // Below-floor tier is rejected (floor is 9500 paise on packId).
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `select seller_replace_offer_tiers($1, $2::jsonb)`,
      [offerId, JSON.stringify([{ min_quantity: 10, max_quantity: null, unit_price_paise: 9000 }])]
    ))).toMatch(/PRICE_BELOW_FLOOR/);

    // Above-base-price tier is rejected (base is 10100 paise on offerId).
    expect(await errorOf(db, sellerProfile, (tx) => tx.query(
      `select seller_replace_offer_tiers($1, $2::jsonb)`,
      [offerId, JSON.stringify([{ min_quantity: 10, max_quantity: null, unit_price_paise: 15000 }])]
    ))).toMatch(/TIER_ABOVE_BASE_PRICE/);

    // Valid quantity tiers succeed and reset offer moderation_status to 'pending'.
    const count = await as(db, sellerProfile, async (tx) => {
      const { rows } = await tx.query<{ count: number }>(
        `select seller_replace_offer_tiers($1, $2::jsonb) as count`,
        [
          offerId,
          JSON.stringify([
            { min_quantity: 5, max_quantity: 11, unit_price_paise: 9900 },
            { min_quantity: 12, max_quantity: null, unit_price_paise: 9600 },
          ]),
        ]
      );
      return rows[0]!.count;
    });
    expect(count).toBe(2);

    const { rows: pendingAfterTier } = await db.query<{ moderation_status: string }>(
      `select moderation_status from seller_offers where id=$1`,
      [offerId]
    );
    expect(pendingAfterTier[0]!.moderation_status).toBe('pending');

    await as(db, admin, (tx) => tx.query(
      `update seller_offers set moderation_status='approved' where id=$1`,
      [offerId]
    ));

    // Effective unit price resolves base price below 5, 9900 for 5..11, 9600 for 12+.
    const { rows: effRows } = await db.query<{ p1: string; p6: string; p15: string }>(
      `select effective_seller_offer_unit_price_paise($1, 1) as p1,
              effective_seller_offer_unit_price_paise($1, 6) as p6,
              effective_seller_offer_unit_price_paise($1, 15) as p15`,
      [offerId]
    );
    expect({
      p1: Number(effRows[0]!.p1),
      p6: Number(effRows[0]!.p6),
      p15: Number(effRows[0]!.p15),
    }).toEqual({ p1: 10100, p6: 9900, p15: 9600 });

    // Retailer can read approved tiers via marketplace_offer_tiers and sub-order projection via retailer_order_sub_orders.
    const tierProjection = await as(db, retailer, async (tx) =>
      (await tx.query<{ min_quantity: number; unit_price_paise: string }>(
        `select min_quantity, unit_price_paise from marketplace_offer_tiers(array[$1]::uuid[])`,
        [offerId]
      )).rows
    );
    expect(tierProjection.map((r) => ({ min: r.min_quantity, price: Number(r.unit_price_paise) }))).toEqual([
      { min: 5, price: 9900 },
      { min: 12, price: 9600 },
    ]);

    const { rows: parentRow } = await db.query<{ parent_order_id: string }>(
      `select parent_order_id from sub_orders where id=$1`,
      [stockSubOrderId]
    );
    const subOrderProjection = await as(db, retailer, async (tx) =>
      (await tx.query<{ sub_order_id: string; seller_business_name: string }>(
        `select sub_order_id, seller_business_name from retailer_order_sub_orders($1)`,
        [parentRow[0]!.parent_order_id]
      )).rows
    );
    expect(subOrderProjection).toEqual([
      { sub_order_id: stockSubOrderId, seller_business_name: 'Bazaar Seller Co' },
    ]);
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
