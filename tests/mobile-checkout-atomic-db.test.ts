import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  createArea,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type PackFixture,
  type RetailerFixture,
} from './helpers/pg-harness';

type AtomicResult = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  coinsUsedPaise: number;
  coinsBalanceAfterPaise: number | null;
  placedAt: string;
  replayed: boolean;
};

type AtomicInput = {
  p_retailer_id: string;
  p_collected_by: string | null;
  p_request_key: string;
  p_request_fingerprint: string;
  p_notes: string;
  p_shipping_address: { line: string; label: string; district?: string; state?: string; pincode?: string };
  p_subtotal: number;
  p_gst_total: number;
  p_discount_total: number;
  p_grand_total: number;
  p_coupon_id: string | null;
  p_coupon_code: string | null;
  p_coupon_discount: number;
  p_expected_coins_used_paise: number;
  p_order_items: { pack_id: string; quantity: number; unit_price: number; gst_percent: number; line_total: number }[];
  p_clear_cart_after_order: boolean;
};

let db: Db;
let admin: string;
let retailer: RetailerFixture;
let pack: PackFixture;
let areaId: string;
let activeWarehouseId: string;

const RPC_SQL = `select public.create_order_atomic(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb,
  $7::numeric, $8::numeric, $9::numeric, $10::numeric,
  $11::uuid, $12::text, $13::numeric, $14::bigint, $15::jsonb, $16::boolean
) as result`;

function orderInput(quantity = 2, overrides: Partial<AtomicInput> = {}): AtomicInput {
  const unitPrice = 100;
  const lineTotal = unitPrice * quantity;
  const gstTotal = Math.round((lineTotal * 18) / 118 * 100) / 100;
  const grandTotal = lineTotal;
  return {
    p_retailer_id: retailer.id,
    p_collected_by: null,
    p_request_key: randomUUID(),
    p_request_fingerprint: 'a'.repeat(64),
    p_notes: 'Native checkout test',
    p_shipping_address: { line: '10 Test Road, Gaya', label: 'Shop', district: 'Gaya', state: 'Bihar', pincode: '823001' },
    p_subtotal: Math.round((grandTotal - gstTotal) * 100) / 100,
    p_gst_total: gstTotal,
    p_discount_total: 0,
    p_grand_total: grandTotal,
    p_coupon_id: null,
    p_coupon_code: null,
    p_coupon_discount: 0,
    p_expected_coins_used_paise: 0,
    p_order_items: [{
      pack_id: pack.packId,
      quantity,
      unit_price: 100,
      gst_percent: 18,
      line_total: lineTotal,
    }],
    p_clear_cart_after_order: true,
    ...overrides,
  };
}

function atomicArgs(input: AtomicInput) {
  return [
    input.p_retailer_id,
    input.p_collected_by,
    input.p_request_key,
    input.p_request_fingerprint,
    input.p_notes,
    JSON.stringify(input.p_shipping_address),
    input.p_subtotal,
    input.p_gst_total,
    input.p_discount_total,
    input.p_grand_total,
    input.p_coupon_id,
    input.p_coupon_code,
    input.p_coupon_discount,
    input.p_expected_coins_used_paise,
    JSON.stringify(input.p_order_items),
    input.p_clear_cart_after_order,
  ];
}

async function callAtomic(input: AtomicInput) {
  return as(db, 'service', (tx) => tx.query<{ result: AtomicResult }>(RPC_SQL, atomicArgs(input)));
}

async function atomicError(input: AtomicInput) {
  return errorOf(db, 'service', (tx) => tx.query(RPC_SQL, atomicArgs(input)));
}

async function createCoupon({
  categoryId = null,
  minimumOrderValue = 100,
  retailerId = retailer.id,
}: { categoryId?: string | null; minimumOrderValue?: number; retailerId?: string } = {}) {
  const code = `SAVE${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into coupons (
       code, title, discount_type, discount_value, minimum_order_value,
       starts_at, expires_at, is_active, first_order_only, category_id
     ) values ($1, 'Atomic coupon test', 'percentage', 10, $2, now() - interval '1 minute',
               now() + interval '1 day', true, false, $3)
     returning id`,
    [code, minimumOrderValue, categoryId]
  );
  await db.query(
    `insert into retailer_active_coupons (retailer_id, coupon_id) values ($1, $2)`,
    [retailerId, rows[0]!.id]
  );
  return { id: rows[0]!.id, code };
}


async function setPackStock(quantity: number) {
  await as(db, admin, (tx) => tx.query(
    `select public.admin_set_product_pack_stock($1, $2)`, [pack.packId, quantity]
  ));
}

async function setCart(quantity: number) {
  await setCartFor(retailer.id, quantity);
}

async function setCartFor(retailerId: string, quantity: number) {
  await db.query(`delete from cart_items where retailer_id = $1`, [retailerId]);
  await db.query(
    `insert into cart_items (retailer_id, product_id, pack_id, quantity) values ($1, $2, $3, $4)`,
    [retailerId, pack.productId, pack.packId, quantity]
  );
}

async function cartQuantity(): Promise<number | null> {
  const { rows } = await db.query<{ quantity: number }>(
    `select quantity from cart_items where retailer_id = $1 and pack_id = $2`,
    [retailer.id, pack.packId]
  );
  return rows[0]?.quantity ?? null;
}

async function packStock(): Promise<number> {
  const { rows } = await db.query<{ stock_quantity: number }>(
    `select stock_quantity from product_packs where id = $1`, [pack.packId]
  );
  return Number(rows[0]!.stock_quantity);
}

async function orderCount(requestKey: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from orders where request_key = $1`, [requestKey]
  );
  return rows[0]!.count;
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  // Test-only verified PIN. Migration 0071 never seeds production coverage.
  await as(db, admin, (tx) => tx.query(
    `insert into delivery_service_areas (district, state, pincode, is_active, created_by, updated_by)
     values ('Gaya', 'Bihar', '823001', true, $1, $1)`, [admin]
  ));
  areaId = await createArea(db);
  retailer = await createRetailer(db, { areaId, creditLimitRupees: 0 });
  pack = await createPack(db, { gstPercent: 18, moq: 2, unitsPerCase: 10 });
  await db.query(
    `insert into product_pricing_tiers (product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label)
     values ($1, 1, null, 100, 'default', 'Test retailer piece rate')`,
    [pack.packId]
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ('Mobile checkout warehouse', $1, true) returning id`,
    [areaId]
  );
  activeWarehouseId = rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.query(`update retailers set status = 'active' where id = $1`, [retailer.id]);
  await db.query(`update warehouses set is_active = (id = $1)`, [activeWarehouseId]);
  await db.query(`update products set gst_percent = 18, category_id = $2, brand_id = $3 where id = $1`, [
    pack.productId, pack.categoryId, pack.brandId,
  ]);
  await db.query(`update product_packs set moq = 2, case_price = 1000, allow_loose_pieces = true where id = $1`, [pack.packId]);
  await db.query(`update product_pricing_tiers set price_per_piece = 100 where product_pack_id = $1`, [pack.packId]);
  await db.query(`delete from retailer_active_coupons where retailer_id = $1`, [retailer.id]);
  await db.query(`delete from cart_items where retailer_id = $1`, [retailer.id]);
  await setPackStock(10);
});

describe('0071 verified delivery coverage in atomic checkout', () => {
  it('rejects missing structure, wrong district and unconfigured PIN without touching cart, stock or orders', async () => {
    await setCart(2);
    const beforeStock = await packStock();
    for (const address of [
      { line: 'Unverified shop', label: 'Shop' },
      { line: 'Wrong district', label: 'Shop', district: 'Saran', state: 'Bihar', pincode: '823001' },
      { line: 'Wrong PIN', label: 'Shop', district: 'Gaya', state: 'Bihar', pincode: '823999' },
    ]) {
      const input = orderInput(2, { p_shipping_address: address });
      expect(await atomicError(input)).toMatch(/DELIVERY_ADDRESS_REQUIRED|DELIVERY_AREA_UNAVAILABLE/);
      expect(await orderCount(input.p_request_key)).toBe(0);
      expect(await cartQuantity()).toBe(2);
      expect(await packStock()).toBe(beforeStock);
    }
  });

  it('blocks a deactivated PIN, raised minimum or nonzero fee, and keeps the exact cart on failure', async () => {
    await setCart(2);
    try {
      await as(db, admin, (tx) => tx.query(
        `update delivery_service_areas set is_active=false, updated_by=$1 where pincode='823001'`, [admin]
      ));
      expect(await atomicError(orderInput())).toMatch(/DELIVERY_AREA_UNAVAILABLE/);
      await as(db, admin, (tx) => tx.query(
        `update delivery_service_areas set is_active=true, minimum_order_paise=20100, updated_by=$1 where pincode='823001'`, [admin]
      ));
      expect(await atomicError(orderInput())).toMatch(/DELIVERY_MINIMUM_NOT_MET/);
      await as(db, admin, (tx) => tx.query(
        `update delivery_service_areas set minimum_order_paise=0, delivery_fee_paise=1000, updated_by=$1 where pincode='823001'`, [admin]
      ));
      expect(await atomicError(orderInput())).toMatch(/DELIVERY_FEE_NOT_SUPPORTED/);
      expect(await cartQuantity()).toBe(2);
    } finally {
      await as(db, admin, (tx) => tx.query(
        `update delivery_service_areas set is_active=true, minimum_order_paise=0, delivery_fee_paise=0, updated_by=$1 where pincode='823001'`, [admin]
      ));
    }
  });

  it('hides the delivery directory from retailers and denies anonymous/retailer writes', async () => {
    expect((await as(db, retailer.id, (tx) => tx.query(`select id from delivery_service_areas`))).rows).toEqual([]);
    const { rows } = await as(db, retailer.id, (tx) => tx.query<{ area_id: string }>(
      `select area_id from public.check_delivery_serviceability(' GAYA ', 'bihar', '823001')`
    ));
    expect(rows).toHaveLength(1);
    expect((await as(db, retailer.id, (tx) => tx.query(
      `select * from public.check_delivery_serviceability('Gaya', 'Bihar', '823999')`
    ))).rows).toHaveLength(0);
    expect(await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into delivery_service_areas (district, state, pincode) values ('Gaya','Bihar','823999')`
    ))).toMatch(/permission denied|row-level security/i);
    expect(await errorOf(db, 'anon', (tx) => tx.query(
      `select * from public.check_delivery_serviceability('Gaya','Bihar','823001')`
    ))).toMatch(/permission denied/i);
  });
});

describe('0056 atomic mobile checkout database contract', () => {
  it('commits order, exact cart clear and stock deduction together, then replays the original order', async () => {
    await setCart(2);
    const input = orderInput();

    const first = (await callAtomic(input)).rows[0]!.result;
    expect(first).toMatchObject({
      status: 'pending', grandTotalPaise: 20000, coinsUsedPaise: 0,
      coinsBalanceAfterPaise: 0, replayed: false,
    });
    expect(first.id).toBeTruthy();
    expect(first.orderNumber).toMatch(/^MK-/);
    expect(first.placedAt).toBeTruthy();
    expect(await packStock()).toBe(8);
    expect(await cartQuantity()).toBeNull();
    expect(await orderCount(input.p_request_key)).toBe(1);

    const { rows: snapshots } = await db.query<{
      request_fingerprint: string;
      request_completed_at: string | null;
      shipping_address: { line: string; deliveryAreaId: string };
      delivery_service_area_id: string;
      delivery_minimum_order_paise: number;
      delivery_fee_paise: number;
      line_total: string;
      stock_deducted_quantity: number;
    }>(
      `select o.request_fingerprint, o.request_completed_at, o.shipping_address,
              o.delivery_service_area_id, o.delivery_minimum_order_paise, o.delivery_fee_paise,
              oi.line_total, oi.stock_deducted_quantity
         from orders o join order_items oi on oi.order_id = o.id
        where o.id = $1`,
      [first.id]
    );
    expect(snapshots[0]).toMatchObject({
      request_fingerprint: input.p_request_fingerprint,
      shipping_address: { line: '10 Test Road, Gaya' },
      stock_deducted_quantity: 2,
    });
    expect(snapshots[0]!.delivery_service_area_id).toBe(snapshots[0]!.shipping_address.deliveryAreaId);
    expect(Number(snapshots[0]!.delivery_minimum_order_paise)).toBe(0);
    expect(Number(snapshots[0]!.delivery_fee_paise)).toBe(0);
    expect(Number(snapshots[0]!.line_total)).toBe(200);
    expect(snapshots[0]!.request_completed_at).toBeTruthy();

    const replay = (await callAtomic(input)).rows[0]!.result;
    expect(replay).toMatchObject({
      id: first.id,
      orderNumber: first.orderNumber,
      coinsBalanceAfterPaise: 0,
      replayed: true,
    });
    expect(await orderCount(input.p_request_key)).toBe(1);
    expect(await packStock()).toBe(8);
    expect(await cartQuantity()).toBeNull();

    const changed = { ...input, p_request_fingerprint: 'b'.repeat(64) };
    const mismatch = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      changed.p_retailer_id,
      changed.p_collected_by,
      changed.p_request_key,
      changed.p_request_fingerprint,
      changed.p_notes,
      JSON.stringify(changed.p_shipping_address),
      changed.p_subtotal,
      changed.p_gst_total,
      changed.p_discount_total,
      changed.p_grand_total,
      changed.p_coupon_id,
      changed.p_coupon_code,
      changed.p_coupon_discount,
      changed.p_expected_coins_used_paise,
      JSON.stringify(changed.p_order_items),
      changed.p_clear_cart_after_order,
    ]));
    expect(mismatch).toMatch(/IDEMPOTENCY_CONFLICT/);
    expect(await orderCount(input.p_request_key)).toBe(1);
    expect(await packStock()).toBe(8);
  });

  it('keeps the current one-piece increment when legacy case metadata disallows loose pieces', async () => {
    await db.query(`update product_packs set allow_loose_pieces = false where id = $1`, [pack.packId]);
    await setCart(2);

    const input = orderInput(2);
    const result = (await callAtomic(input)).rows[0]!.result;

    expect(result).toMatchObject({ status: 'pending', grandTotalPaise: 20000, replayed: false });
    expect(await packStock()).toBe(8);
    expect(await cartQuantity()).toBeNull();
  });

  it('returns one committed order for simultaneously scheduled submissions with the same request key', async () => {
    await setCart(2);
    const input = orderInput();

    // PGlite uses one connection, so Promise.all exercises racing callers but
    // not two backend sessions waiting on the advisory lock. Production
    // PostgreSQL serializes those sessions with the request-key transaction lock.
    const results = await Promise.all([callAtomic(input), callAtomic(input)]);
    const orders = results.map((result) => result.rows[0]!.result);

    expect(orders.map((order) => order.replayed).sort((left, right) => Number(left) - Number(right)))
      .toEqual([false, true]);
    expect(orders[0]!.id).toBe(orders[1]!.id);
    expect(orders[0]!.orderNumber).toBe(orders[1]!.orderNumber);
    expect(await orderCount(input.p_request_key)).toBe(1);
    expect(await packStock()).toBe(8);
    expect(await cartQuantity()).toBeNull();
  });

  it('snapshots the real wallet balance after Coins and returns that same value on idempotent replay', async () => {
    const coinRetailer = await createRetailer(db, { areaId, creditLimitRupees: 500 });
    await setCartFor(coinRetailer.id, 2);
    const input = orderInput(2, {
      p_retailer_id: coinRetailer.id,
      p_expected_coins_used_paise: 20000,
    });

    const first = (await callAtomic(input)).rows[0]!.result;
    expect(first).toMatchObject({ coinsUsedPaise: 20000, coinsBalanceAfterPaise: 30000, replayed: false });
    const { rows } = await db.query<{ coins_balance_after_paise: string | number }>(
      `select coins_balance_after_paise from orders where id = $1`, [first.id]
    );
    expect(Number(rows[0]!.coins_balance_after_paise)).toBe(30000);

    const replay = (await callAtomic(input)).rows[0]!.result;
    expect(replay).toMatchObject({
      id: first.id,
      coinsUsedPaise: 20000,
      coinsBalanceAfterPaise: 30000,
      replayed: true,
    });
  });

  it('commits a coupon only at the recomputed server discount and redeems it atomically', async () => {
    const coupon = await createCoupon({ categoryId: pack.categoryId });
    await setCart(2);
    const quote = orderInput(2, {
      p_coupon_id: coupon.id,
      p_coupon_code: coupon.code,
      p_coupon_discount: 16.95,
      p_discount_total: 16.95,
      p_grand_total: 183.05,
    });

    const result = (await callAtomic(quote)).rows[0]!.result;
    expect(result).toMatchObject({ status: 'pending', grandTotalPaise: 18305, replayed: false });
    expect(await cartQuantity()).toBeNull();
    expect(await packStock()).toBe(8);
    const { rows } = await db.query<{ discount_total: string | number; coupon_id: string | null }>(
      `select discount_total, coupon_id from orders where id = $1`, [result.id]
    );
    expect(Number(rows[0]!.discount_total)).toBe(16.95);
    expect(rows[0]!.coupon_id).toBe(coupon.id);
    const { rows: redemptions } = await db.query<{ count: number }>(
      `select count(*)::int as count from coupon_redemptions where coupon_id = $1`, [coupon.id]
    );
    expect(redemptions[0]!.count).toBe(1);
    const { rows: active } = await db.query<{ count: number }>(
      `select count(*)::int as count from retailer_active_coupons where retailer_id = $1`, [retailer.id]
    );
    expect(active[0]!.count).toBe(0);
  });

  it('keeps cancelled orders from blocking a first-order-only coupon at commit time', async () => {
    const firstOrderRetailer = await createRetailer(db, { areaId, creditLimitRupees: 0 });
    const coupon = await createCoupon({ categoryId: pack.categoryId, retailerId: firstOrderRetailer.id });
    await db.query(`update coupons set first_order_only = true where id = $1`, [coupon.id]);
    await db.query(
      `insert into orders (order_number, retailer_id, status, subtotal, discount_total, gst_total, grand_total)
       values ($1, $2, 'cancelled', 0, 0, 0, 0)`,
      [`MK-CANCELLED-${randomUUID()}`, firstOrderRetailer.id]
    );
    await setCartFor(firstOrderRetailer.id, 2);

    const input = orderInput(2, {
      p_retailer_id: firstOrderRetailer.id,
      p_coupon_id: coupon.id,
      p_coupon_code: coupon.code,
      p_coupon_discount: 16.95,
      p_discount_total: 16.95,
      p_grand_total: 183.05,
    });
    const result = (await callAtomic(input)).rows[0]!.result;

    expect(result).toMatchObject({ status: 'pending', grandTotalPaise: 18305, replayed: false });
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from coupon_redemptions where coupon_id = $1 and retailer_id = $2`,
      [coupon.id, firstOrderRetailer.id]
    );
    expect(rows[0]!.count).toBe(1);
  });

  it('recomputes changed coupon discount, minimum and scoped eligibility before any order side effect', async () => {
    const coupon = await createCoupon({ categoryId: pack.categoryId });
    await setCart(2);
    const quote = orderInput(2, {
      p_coupon_id: coupon.id,
      p_coupon_code: coupon.code,
      p_coupon_discount: 16.95,
      p_discount_total: 16.95,
      p_grand_total: 183.05,
    });

    // Simulate the coupon terms changing after TypeScript quoted it.
    await db.query(`update coupons set discount_value = 20 where id = $1`, [coupon.id]);
    const discountError = await atomicError(quote);
    expect(discountError).toMatch(/COUPON_INVALID: the coupon discount changed/);
    expect(await orderCount(quote.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(10);

    // A minimum raised after quoting is also authoritative at commit.
    await db.query(`update coupons set discount_value = 10, minimum_order_value = 1000 where id = $1`, [coupon.id]);
    const minimumError = await atomicError({ ...quote, p_request_key: randomUUID() });
    expect(minimumError).toMatch(/COUPON_INVALID: the order no longer meets the coupon minimum/);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(10);

    // Restore terms, then make the scoped product ineligible before commit.
    await db.query(`update coupons set minimum_order_value = 100, discount_value = 10 where id = $1`, [coupon.id]);
    const { rows: otherCategory } = await db.query<{ id: string }>(
      `insert into categories (name) values ('Changed category') returning id`
    );
    await db.query(`update products set category_id = $2 where id = $1`, [pack.productId, otherCategory[0]!.id]);
    const scopeError = await atomicError({ ...quote, p_request_key: randomUUID() });
    expect(scopeError).toMatch(/COUPON_INVALID: the coupon no longer applies/);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(10);
    const { rows: redemptions } = await db.query<{ count: number }>(
      `select count(*)::int as count from coupon_redemptions where coupon_id = $1`, [coupon.id]
    );
    expect(redemptions[0]!.count).toBe(0);
  });

  it('rejects a quote made stale by a live selling-price or GST change before any write', async () => {
    await setCart(2);
    const stalePrice = orderInput();
    await db.query(`update product_pricing_tiers set price_per_piece = 120 where product_pack_id = $1`, [pack.packId]);

    const priceError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      stalePrice.p_retailer_id,
      stalePrice.p_collected_by,
      stalePrice.p_request_key,
      stalePrice.p_request_fingerprint,
      stalePrice.p_notes,
      JSON.stringify(stalePrice.p_shipping_address),
      stalePrice.p_subtotal,
      stalePrice.p_gst_total,
      stalePrice.p_discount_total,
      stalePrice.p_grand_total,
      stalePrice.p_coupon_id,
      stalePrice.p_coupon_code,
      stalePrice.p_coupon_discount,
      stalePrice.p_expected_coins_used_paise,
      JSON.stringify(stalePrice.p_order_items),
      stalePrice.p_clear_cart_after_order,
    ]));
    expect(priceError).toMatch(/ORDER_PRICE_CHANGED: the selling price changed/);
    expect(await orderCount(stalePrice.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(10);

    await db.query(`update product_pricing_tiers set price_per_piece = 100 where product_pack_id = $1`, [pack.packId]);
    const staleGst = orderInput();
    await db.query(`update products set gst_percent = 5 where id = $1`, [pack.productId]);
    const gstError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      staleGst.p_retailer_id,
      staleGst.p_collected_by,
      staleGst.p_request_key,
      staleGst.p_request_fingerprint,
      staleGst.p_notes,
      JSON.stringify(staleGst.p_shipping_address),
      staleGst.p_subtotal,
      staleGst.p_gst_total,
      staleGst.p_discount_total,
      staleGst.p_grand_total,
      staleGst.p_coupon_id,
      staleGst.p_coupon_code,
      staleGst.p_coupon_discount,
      staleGst.p_expected_coins_used_paise,
      JSON.stringify(staleGst.p_order_items),
      staleGst.p_clear_cart_after_order,
    ]));
    expect(gstError).toMatch(/ORDER_PRICE_CHANGED: the GST rate changed/);
    expect(await orderCount(staleGst.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(10);
  });

  it('rolls back the order, cart and all side effects when the stock trigger rejects a stale quote', async () => {
    await setCart(2);
    await setPackStock(1);
    const input = orderInput();

    const shortage = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      input.p_retailer_id,
      input.p_collected_by,
      input.p_request_key,
      input.p_request_fingerprint,
      input.p_notes,
      JSON.stringify(input.p_shipping_address),
      input.p_subtotal,
      input.p_gst_total,
      input.p_discount_total,
      input.p_grand_total,
      input.p_coupon_id,
      input.p_coupon_code,
      input.p_coupon_discount,
      input.p_expected_coins_used_paise,
      JSON.stringify(input.p_order_items),
      input.p_clear_cart_after_order,
    ]));
    expect(shortage).toMatch(/INSUFFICIENT_STOCK: Only 1 available/);
    expect(await orderCount(input.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(2);
    expect(await packStock()).toBe(1);
  });

  it('rejects changed cart snapshots and non-reconciling GST totals without clearing the saved basket', async () => {
    await setCart(3);
    const changedCart = orderInput(2);
    const cartError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      changedCart.p_retailer_id,
      changedCart.p_collected_by,
      changedCart.p_request_key,
      changedCart.p_request_fingerprint,
      changedCart.p_notes,
      JSON.stringify(changedCart.p_shipping_address),
      changedCart.p_subtotal,
      changedCart.p_gst_total,
      changedCart.p_discount_total,
      changedCart.p_grand_total,
      changedCart.p_coupon_id,
      changedCart.p_coupon_code,
      changedCart.p_coupon_discount,
      changedCart.p_expected_coins_used_paise,
      JSON.stringify(changedCart.p_order_items),
      changedCart.p_clear_cart_after_order,
    ]));
    expect(cartError).toMatch(/CART_CHANGED/);
    expect(await orderCount(changedCart.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(3);
    expect(await packStock()).toBe(10);

    const badTotals = orderInput(3, { p_gst_total: 4.05 });
    const totalsError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      badTotals.p_retailer_id,
      badTotals.p_collected_by,
      badTotals.p_request_key,
      badTotals.p_request_fingerprint,
      badTotals.p_notes,
      JSON.stringify(badTotals.p_shipping_address),
      badTotals.p_subtotal,
      badTotals.p_gst_total,
      badTotals.p_discount_total,
      badTotals.p_grand_total,
      badTotals.p_coupon_id,
      badTotals.p_coupon_code,
      badTotals.p_coupon_discount,
      badTotals.p_expected_coins_used_paise,
      JSON.stringify(badTotals.p_order_items),
      badTotals.p_clear_cart_after_order,
    ]));
    expect(totalsError).toMatch(/ORDER_QUOTE_INVALID/);
    expect(await orderCount(badTotals.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(3);
    expect(await packStock()).toBe(10);
  });

  it('enforces caller-role, retailer eligibility, salesman assignment, MOQ and warehouse configuration', async () => {
    await setCart(2);
    const input = orderInput();
    const denied = await errorOf(db, retailer.id, (tx) => tx.query(RPC_SQL, [
      input.p_retailer_id,
      input.p_collected_by,
      input.p_request_key,
      input.p_request_fingerprint,
      input.p_notes,
      JSON.stringify(input.p_shipping_address),
      input.p_subtotal,
      input.p_gst_total,
      input.p_discount_total,
      input.p_grand_total,
      input.p_coupon_id,
      input.p_coupon_code,
      input.p_coupon_discount,
      input.p_expected_coins_used_paise,
      JSON.stringify(input.p_order_items),
      input.p_clear_cart_after_order,
    ]));
    expect(denied).toMatch(/permission denied for function create_order_atomic/);

    await db.query(`update retailers set status = 'suspended' where id = $1`, [retailer.id]);
    const suspended = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      input.p_retailer_id,
      input.p_collected_by,
      input.p_request_key,
      input.p_request_fingerprint,
      input.p_notes,
      JSON.stringify(input.p_shipping_address),
      input.p_subtotal,
      input.p_gst_total,
      input.p_discount_total,
      input.p_grand_total,
      input.p_coupon_id,
      input.p_coupon_code,
      input.p_coupon_discount,
      input.p_expected_coins_used_paise,
      JSON.stringify(input.p_order_items),
      input.p_clear_cart_after_order,
    ]));
    expect(suspended).toMatch(/RETAILER_NOT_ACTIVE/);
    expect(await cartQuantity()).toBe(2);
    await db.query(`update retailers set status = 'active' where id = $1`, [retailer.id]);

    const unassignedSalesman = await createUser(db, 'salesman');
    const salesmanInput = orderInput(2, { p_collected_by: unassignedSalesman });
    const assignmentError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      salesmanInput.p_retailer_id,
      salesmanInput.p_collected_by,
      salesmanInput.p_request_key,
      salesmanInput.p_request_fingerprint,
      salesmanInput.p_notes,
      JSON.stringify(salesmanInput.p_shipping_address),
      salesmanInput.p_subtotal,
      salesmanInput.p_gst_total,
      salesmanInput.p_discount_total,
      salesmanInput.p_grand_total,
      salesmanInput.p_coupon_id,
      salesmanInput.p_coupon_code,
      salesmanInput.p_coupon_discount,
      salesmanInput.p_expected_coins_used_paise,
      JSON.stringify(salesmanInput.p_order_items),
      salesmanInput.p_clear_cart_after_order,
    ]));
    expect(assignmentError).toMatch(/RETAILER_ASSIGNMENT_REQUIRED/);

    await db.query(`update warehouses set is_active = false`);
    const noWarehouse = orderInput();
    const warehouseError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      noWarehouse.p_retailer_id,
      noWarehouse.p_collected_by,
      noWarehouse.p_request_key,
      noWarehouse.p_request_fingerprint,
      noWarehouse.p_notes,
      JSON.stringify(noWarehouse.p_shipping_address),
      noWarehouse.p_subtotal,
      noWarehouse.p_gst_total,
      noWarehouse.p_discount_total,
      noWarehouse.p_grand_total,
      noWarehouse.p_coupon_id,
      noWarehouse.p_coupon_code,
      noWarehouse.p_coupon_discount,
      noWarehouse.p_expected_coins_used_paise,
      JSON.stringify(noWarehouse.p_order_items),
      noWarehouse.p_clear_cart_after_order,
    ]));
    expect(warehouseError).toMatch(/WAREHOUSE_CONFIGURATION_ERROR/);
    expect(await cartQuantity()).toBe(2);

    await db.query(`update warehouses set is_active = (id = $1)`, [activeWarehouseId]);
    await db.query(`update product_packs set moq = 3 where id = $1`, [pack.packId]);
    const belowMoq = orderInput(2);
    const moqError = await errorOf(db, 'service', (tx) => tx.query(RPC_SQL, [
      belowMoq.p_retailer_id,
      belowMoq.p_collected_by,
      belowMoq.p_request_key,
      belowMoq.p_request_fingerprint,
      belowMoq.p_notes,
      JSON.stringify(belowMoq.p_shipping_address),
      belowMoq.p_subtotal,
      belowMoq.p_gst_total,
      belowMoq.p_discount_total,
      belowMoq.p_grand_total,
      belowMoq.p_coupon_id,
      belowMoq.p_coupon_code,
      belowMoq.p_coupon_discount,
      belowMoq.p_expected_coins_used_paise,
      JSON.stringify(belowMoq.p_order_items),
      belowMoq.p_clear_cart_after_order,
    ]));
    expect(moqError).toMatch(/MINIMUM_ORDER_QUANTITY/);
    expect(await orderCount(belowMoq.p_request_key)).toBe(0);
    expect(await cartQuantity()).toBe(2);
  });
});

describe('0056 caller-owned cart mutation', () => {
  it('enforces MOQ and compare-and-set changes at a one-piece step despite legacy case metadata', async () => {
    await db.query(`update product_packs set allow_loose_pieces = false where id = $1`, [pack.packId]);
    const directInsert = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into cart_items (retailer_id, product_id, pack_id, quantity) values ($1, $2, $3, 2)`,
      [retailer.id, pack.productId, pack.packId]
    ));
    expect(directInsert).toMatch(/permission denied for table cart_items/);

    const added = await as(db, retailer.id, (tx) => tx.query<{ quantity: number }>(
      `select public.mutate_retailer_cart_line($1, null, 0, 2) as quantity`, [pack.packId]
    ));
    expect(added.rows[0]!.quantity).toBe(2);

    const stale = await errorOf(db, retailer.id, (tx) => tx.query(
      `select public.mutate_retailer_cart_line($1, null, 0, 4)`, [pack.packId]
    ));
    expect(stale).toMatch(/CART_CHANGED/);

    const { rows: lineRows } = await db.query<{ id: string }>(
      `select id from cart_items where retailer_id = $1 and pack_id = $2`, [retailer.id, pack.packId]
    );
    const lineId = lineRows[0]!.id;
    const changed = await as(db, retailer.id, (tx) => tx.query<{ quantity: number }>(
      `select public.mutate_retailer_cart_line($1, $2, 2, 4) as quantity`, [pack.packId, lineId]
    ));
    expect(changed.rows[0]!.quantity).toBe(4);

    const wrongExpected = await errorOf(db, retailer.id, (tx) => tx.query(
      `select public.mutate_retailer_cart_line($1, $2, 2, 6)`, [pack.packId, lineId]
    ));
    expect(wrongExpected).toMatch(/CART_CHANGED/);

    const belowMoq = await errorOf(db, retailer.id, (tx) => tx.query(
      `select public.mutate_retailer_cart_line($1, $2, 4, 1)`, [pack.packId, lineId]
    ));
    expect(belowMoq).toMatch(/MINIMUM_ORDER_QUANTITY/);

    const updated = await as(db, retailer.id, (tx) => tx.query<{ quantity: number }>(
      `select public.mutate_retailer_cart_line($1, $2, 4, 6) as quantity`, [pack.packId, lineId]
    ));
    expect(updated.rows[0]!.quantity).toBe(6);

    const fetched = await as(db, retailer.id, (tx) => tx.query<{ pack_id: string; quantity: number }>(
      `select pack_id, quantity from public.get_retailer_cart_lines()`
    ));
    expect(fetched.rows).toEqual([{ pack_id: pack.packId, quantity: 6 }]);
  });
});
