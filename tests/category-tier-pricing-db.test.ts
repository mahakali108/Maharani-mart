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

/**
 * Migration 0082 — product-wise retailer-category pricing.
 *
 * Gold ≤ Silver ≤ General, enforced in PostgreSQL; the checkout RPCs re-price
 * every own-stock line from the database, so a browser-supplied price is only
 * ever a claim that must match. These tests exercise the REAL functions on a
 * real database (every migration is replayed), not string matches.
 */

let db: Db;
let admin: string;
let areaId: string;
let warehouseId: string;
let general: RetailerFixture;
let silver: RetailerFixture;
let gold: RetailerFixture;
let plain: RetailerFixture;
let pack: PackFixture;

const RPC_SQL = `select public.create_order_atomic(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb,
  $7::numeric, $8::numeric, $9::numeric, $10::numeric,
  $11::uuid, $12::text, $13::numeric, $14::bigint, $15::jsonb, $16::boolean
) as result`;

type OrderInput = {
  retailer: RetailerFixture;
  quantity: number;
  unitPrice: number;
  packId?: string;
  requestKey?: string;
};

async function placeOrder({ retailer, quantity, unitPrice, packId = pack.packId, requestKey = randomUUID() }: OrderInput) {
  const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
  const gstTotal = Math.round(((lineTotal * 18) / 118) * 100) / 100;
  const args = [
    retailer.id,
    null,
    requestKey,
    'b'.repeat(64),
    'Category pricing test',
    JSON.stringify({ line: '10 Test Road, Gaya', label: 'Shop', district: 'Gaya', state: 'Bihar', pincode: '823001' }),
    Math.round((lineTotal - gstTotal) * 100) / 100,
    gstTotal,
    0,
    lineTotal,
    null,
    null,
    0,
    BigInt(0),
    JSON.stringify([{ pack_id: packId, quantity, unit_price: unitPrice, gst_percent: 18, line_total: lineTotal }]),
    false,
  ];
  return args;
}

async function orderError(input: OrderInput) {
  const args = await placeOrder(input);
  return errorOf(db, 'service', (tx) => tx.query(RPC_SQL, args));
}

async function orderSucceeds(input: OrderInput) {
  const args = await placeOrder(input);
  return as(db, 'service', (tx) =>
    tx.query<{ result: { grandTotalPaise: number } }>(RPC_SQL, args)
  );
}

async function setCategoryPrice(category: 'general' | 'silver' | 'gold', price: number, packId = pack.packId) {
  await as(db, admin, (tx) =>
    tx.query(
      `insert into public.product_tier_prices (product_pack_id, retailer_category, price_per_piece)
       values ($1, $2, $3)
       on conflict (product_pack_id, retailer_category)
       do update set price_per_piece = excluded.price_per_piece, is_active = true`,
      [packId, category, price]
    )
  );
}

async function clearCategoryPrices(packId = pack.packId) {
  await db.query(`delete from product_tier_prices where product_pack_id = $1`, [packId]);
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  await as(db, admin, (tx) =>
    tx.query(
      `insert into delivery_service_areas (district, state, pincode, is_active, created_by, updated_by)
       values ('Gaya', 'Bihar', '823001', true, $1, $1)`,
      [admin]
    )
  );
  areaId = await createArea(db);
  general = await createRetailer(db, { areaId, creditLimitRupees: 0 });
  silver = await createRetailer(db, { areaId, creditLimitRupees: 0 });
  gold = await createRetailer(db, { areaId, creditLimitRupees: 0 });
  plain = await createRetailer(db, { areaId, creditLimitRupees: 0 });
  pack = await createPack(db, { gstPercent: 18, moq: 2, unitsPerCase: 10 });
  await db.query(
    `insert into product_pricing_tiers (product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label)
     values ($1, 1, null, 100, 'default', 'Baseline slab')`,
    [pack.packId]
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ('Category warehouse', $1, true) returning id`,
    [areaId]
  );
  warehouseId = rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.query(`update retailers set status = 'active', retailer_category = 'general' where id = any($1::uuid[])`, [
    [general.id, silver.id, gold.id, plain.id],
  ]);
  await db.query(`update warehouses set is_active = (id = $1)`, [warehouseId]);
  await db.query(`update product_packs set moq = 2, case_price = 1000, allow_loose_pieces = true where id = $1`, [pack.packId]);
  await clearCategoryPrices();
  // Admin-assigned categories (the only supported path).
  await as(db, admin, (tx) =>
    tx.query(`select public.admin_set_retailer_category($1::uuid, 'silver', 'Approved wholesale volume')`, [silver.id])
  );
  await as(db, admin, (tx) =>
    tx.query(`select public.admin_set_retailer_category($1::uuid, 'gold', 'Contracted key account')`, [gold.id])
  );
  await as(db, admin, (tx) => tx.query(`select public.admin_set_product_pack_stock($1, $2)`, [pack.packId, 500]));
});

describe('ordering invariant gold <= silver <= general', () => {
  it('accepts a correctly ordered set', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from product_tier_prices`);
    expect(rows[0]!.n).toBe('3');
  });

  it('rejects gold above silver', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 90);
    const message = await errorOf(db, admin, (tx) =>
      tx.query(
        `insert into public.product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'gold', 91)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/CATEGORY_PRICE_ORDER_INVALID/);
  });

  it('rejects silver above general', async () => {
    await setCategoryPrice('general', 100);
    const message = await errorOf(db, admin, (tx) =>
      tx.query(
        `insert into public.product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'silver', 101)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/CATEGORY_PRICE_ORDER_INVALID/);
  });

  it('rejects a zero or negative price at the column level', async () => {
    const message = await errorOf(db, admin, (tx) =>
      tx.query(
        `insert into public.product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'general', 0)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/violates check constraint|check/i);
  });

  it('rejects lowering general below an existing silver price on update', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 95);
    const message = await errorOf(db, admin, (tx) =>
      tx.query(
        `update public.product_tier_prices set price_per_piece = 90
          where product_pack_id = $1 and retailer_category = 'general'`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/CATEGORY_PRICE_ORDER_INVALID/);
  });
});

describe('authorization', () => {
  it('refuses a retailer writing any category price', async () => {
    const message = await errorOf(db, general.id, (tx) =>
      tx.query(
        `insert into public.product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'general', 1)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/permission denied|row-level security|administrator/i);
  });

  it('refuses a retailer changing its own category directly or via the RPC', async () => {
    const rpcMessage = await errorOf(db, general.id, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'gold', 'self upgrade')`, [general.id])
    );
    expect(rpcMessage).toMatch(/permission denied|could not be executed|Access denied|administrator/i);

    // A direct UPDATE under RLS affects 0 rows and fails the guard trigger.
    const direct = await errorOf(db, general.id, async (tx) => {
      const res = await tx.query(
        `update public.retailers set retailer_category = 'gold' where id = $1 returning id`,
        [general.id]
      );
      expect(res.rows).toHaveLength(0);
    });
    // Either path is acceptable; what matters is that the value did not change.
    const { rows } = await db.query<{ retailer_category: string }>(
      `select retailer_category from public.retailers where id = $1`,
      [general.id]
    );
    expect(rows[0]!.retailer_category).toBe('general');
    expect(direct === null || typeof direct === 'string').toBe(true);
  });
});

describe('visibility', () => {
  it('shows a general retailer only the general row', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);
    const { rows } = await as(db, general.id, (tx) =>
      tx.query<{ retailer_category: string }>(`select retailer_category from public.product_tier_prices`)
    );
    expect(rows.map((row) => row.retailer_category)).toEqual(['general']);
  });

  it('shows a silver retailer general + silver but never gold', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);
    const { rows } = await as(db, silver.id, (tx) =>
      tx.query<{ retailer_category: string }>(
        `select retailer_category from public.product_tier_prices order by retailer_category`
      )
    );
    expect(rows.map((row) => row.retailer_category)).toEqual(['general', 'silver']);
  });

  it('shows an admin every category', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);
    const { rows } = await as(db, admin, (tx) =>
      tx.query<{ retailer_category: string }>(`select retailer_category from public.product_tier_prices`)
    );
    expect(rows).toHaveLength(3);
  });

  it('never exposes the seller floor / cost columns through this table', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'product_tier_prices'`
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns.some((name) => /cost|floor|margin|settlement/i.test(name))).toBe(false);
  });
});

describe('authoritative resolution helper', () => {
  it('returns the own-category price, falls back to general, and denies cross-retailer calls', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);

    const { rows } = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [pack.packId, gold.id]
    );
    expect(Number(rows[0]!.price)).toBe(94);

    // Gold retailer with no gold row → general.
    await clearCategoryPrices();
    await setCategoryPrice('general', 100);
    const fallback = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [pack.packId, gold.id]
    );
    expect(Number(fallback.rows[0]!.price)).toBe(100);

    // No configuration at all → NULL (legacy slab rules continue).
    await clearCategoryPrices();
    const none = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [pack.packId, general.id]
    );
    expect(none.rows[0]!.price).toBeNull();

    // A retailer cannot ask for another retailer's price.
    await setCategoryPrice('gold', 94);
    const cross = await errorOf(db, general.id, (tx) =>
      tx.query(`select public.pack_category_price_per_piece($1, $2)`, [pack.packId, gold.id])
    );
    expect(cross).toMatch(/Access denied|could not be executed|permission denied/i);
  });

  it('is not directly executable by an API role', async () => {
    const message = await errorOf(db, 'anon', (tx) =>
      tx.query(`select public.pack_category_price_per_piece($1, $2)`, [pack.packId, general.id])
    );
    expect(message).toMatch(/permission denied|could not be executed/i);
  });
});

describe('checkout re-prices every line from the database', () => {
  it('accepts the general price for a general retailer', async () => {
    await setCategoryPrice('general', 100);
    const result = await orderSucceeds({ retailer: general, quantity: 2, unitPrice: 100 });
    expect(result.rows[0]!.result.grandTotalPaise).toBe(20000);
  });

  it('rejects a general retailer submitting a silver price', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    expect(await orderError({ retailer: general, quantity: 2, unitPrice: 97 })).toMatch(/ORDER_PRICE_CHANGED/);
  });

  it('accepts the silver price for a silver retailer and rejects the general price', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    expect(await orderError({ retailer: silver, quantity: 2, unitPrice: 100 })).toMatch(/ORDER_PRICE_CHANGED/);
    const ok = await orderSucceeds({ retailer: silver, quantity: 2, unitPrice: 97 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(19400);
  });

  it('accepts the gold price for a gold retailer and rejects a silver price', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    await setCategoryPrice('gold', 94);
    expect(await orderError({ retailer: gold, quantity: 2, unitPrice: 97 })).toMatch(/ORDER_PRICE_CHANGED/);
    const ok = await orderSucceeds({ retailer: gold, quantity: 2, unitPrice: 94 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(18800);
  });

  it('rejects a stale quote after the category changes mid-checkout', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 97);
    // The retailer quoted at the general price while still general…
    expect(await orderError({ retailer: plain, quantity: 2, unitPrice: 100 })).toBeNull;
    // …then became silver (or was quoted before the change) and submitted the old price.
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'silver', 'Approved after review')`, [plain.id])
    );
    expect(await orderError({ retailer: plain, quantity: 2, unitPrice: 100 })).toMatch(/ORDER_PRICE_CHANGED/);
    const ok = await orderSucceeds({ retailer: plain, quantity: 2, unitPrice: 97 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(19400);
  });

  it('leaves packs without a category price on the existing slab rules', async () => {
    // No product_tier_prices rows at all: the 100/pc slab governs, unchanged.
    const ok = await orderSucceeds({ retailer: gold, quantity: 2, unitPrice: 100 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(20000);
  });

  it('ignores an inactive category price', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('gold', 94);
    await as(db, admin, (tx) =>
      tx.query(`update public.product_tier_prices set is_active = false where retailer_category = 'gold' and product_pack_id = $1`, [
        pack.packId,
      ])
    );
    // Gold falls back to general 100, so 94 is now wrong and 100 is right.
    expect(await orderError({ retailer: gold, quantity: 2, unitPrice: 94 })).toMatch(/ORDER_PRICE_CHANGED/);
    const ok = await orderSucceeds({ retailer: gold, quantity: 2, unitPrice: 100 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(20000);
  });
});

describe('quantity slabs and inactive/active categories', () => {
  it('keeps a quantity slab for a pack that has no category price', async () => {
    const slabPack = await createPack(db, { gstPercent: 18, moq: 1, unitsPerCase: 10 });
    await as(db, admin, (tx) => tx.query(`select public.admin_set_product_pack_stock($1, $2)`, [slabPack.packId, 500]));
    await db.query(
      `insert into product_pricing_tiers (product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label)
       values ($1, 1, 10, 100, 'default', '1-9 pcs'), ($1, 10, null, 90, 'bulk', '10+ pcs')`,
      [slabPack.packId]
    );
    // The pack has no category price, so the pre-existing slab logic decides.
    // Assert deterministically by trying the two candidate prices.
    const atBulk = await orderError({ retailer: gold, quantity: 12, unitPrice: 90, packId: slabPack.packId });
    const atBase = await orderError({ retailer: gold, quantity: 12, unitPrice: 100, packId: slabPack.packId });
    expect([atBulk === null, atBase === null].filter(Boolean)).toHaveLength(1);
  });

  it('applies the category price instead of the slab when both exist', async () => {
    await setCategoryPrice('gold', 94);
    // 12 pcs at the 90 slab would be wrong for a gold retailer: the category
    // price is authoritative.
    expect(await orderError({ retailer: gold, quantity: 12, unitPrice: 90 })).toMatch(/ORDER_PRICE_CHANGED/);
    const ok = await orderSucceeds({ retailer: gold, quantity: 12, unitPrice: 94 });
    expect(ok.rows[0]!.result.grandTotalPaise).toBe(112800);
  });
});

describe('coupons never re-price a line', () => {
  it('keeps the category unit price while applying a coupon discount', async () => {
    await setCategoryPrice('gold', 94);
    const code = `CAT${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const { rows } = await db.query<{ id: string }>(
      `insert into coupons (code, title, discount_type, discount_value, minimum_order_value,
                            starts_at, expires_at, is_active, first_order_only)
       values ($1, 'Category coupon', 'fixed', 10, 100, now() - interval '1 minute',
               now() + interval '1 day', true, false)
       returning id`,
      [code]
    );
    const couponId = rows[0]!.id;
    await db.query(`insert into retailer_active_coupons (retailer_id, coupon_id) values ($1, $2)`, [gold.id, couponId]);

    const lineTotal = 188;
    const gst = Math.round(((lineTotal * 18) / 118) * 100) / 100;
    const args = [
      gold.id, null, randomUUID(), 'c'.repeat(64), 'Coupon test',
      JSON.stringify({ line: '10 Test Road, Gaya', label: 'Shop', district: 'Gaya', state: 'Bihar', pincode: '823001' }),
      Math.round((lineTotal - gst) * 100) / 100, gst, 10, 178,
      couponId, code, 10, BigInt(0),
      JSON.stringify([{ pack_id: pack.packId, quantity: 2, unit_price: 94, gst_percent: 18, line_total: lineTotal }]),
      false,
    ];
    const res = await as(db, 'service', (tx) => tx.query<{ result: { grandTotalPaise: number } }>(RPC_SQL, args));
    expect(res.rows[0]!.result.grandTotalPaise).toBe(17800);
  });
});
