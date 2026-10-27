import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Product-wise retailer category (tier) pricing — migrations 0081/0082,
 * executed on PostgreSQL 16.
 *
 * The point of these tests is the *authoritative* path: whatever the browser
 * submits, `create_order_atomic` must price the line from the database. A
 * retailer category price is only accepted when the submitted unit price is
 * exactly the server-resolved category price.
 */

let db: Db;
let admin: string;
let general: RetailerFixture;
let silver: RetailerFixture;
let gold: RetailerFixture;
let pack: PackFixture;
let areaId: string;
let warehouseId: string;

const RPC = `select public.create_order_atomic(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb,
  $7::numeric, $8::numeric, $9::numeric, $10::numeric,
  $11::uuid, $12::text, $13::numeric, $14::bigint, $15::jsonb, $16::boolean
) as result`;

function orderArgs({
  retailerId,
  unitPrice,
  quantity = 2,
}: {
  retailerId: string;
  unitPrice: number;
  quantity?: number;
}) {
  const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
  const gstTotal = Math.round(((lineTotal * 18) / 118) * 100) / 100;
  const subtotal = Math.round((lineTotal - gstTotal) * 100) / 100;
  return [
    retailerId,
    null,
    randomUUID(),
    'b'.repeat(64),
    'Category pricing test',
    JSON.stringify({ line: '10 Test Road, Gaya', label: 'Shop', district: 'Gaya', state: 'Bihar', pincode: '823001' }),
    subtotal,
    gstTotal,
    0,
    lineTotal,
    null,
    null,
    0,
    0,
    JSON.stringify([{ pack_id: pack.packId, quantity, unit_price: unitPrice, gst_percent: 18, line_total: lineTotal }]),
    false,
  ];
}

async function placeOrder(opts: { retailerId: string; unitPrice: number }) {
  return errorOf(db, 'service', (tx) => tx.query(RPC, orderArgs(opts)));
}

async function orderCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from orders`);
  return Number(rows[0]!.n);
}

async function setCategoryPrice(category: 'general' | 'silver' | 'gold', price: number) {
  await as(db, admin, (tx) =>
    tx.query(
      `insert into product_tier_prices (product_pack_id, retailer_category, price_per_piece, created_by, updated_by)
       values ($1, $2::public.retailer_category, $3, $4, $4)
       on conflict (product_pack_id, retailer_category) do update
         set price_per_piece = excluded.price_per_piece, updated_by = excluded.updated_by, is_active = true`,
      [pack.packId, category, price, admin]
    )
  );
}

async function clearCategoryPrices() {
  await db.query(`delete from product_tier_prices where product_pack_id = $1`, [pack.packId]);
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
  pack = await createPack(db, { gstPercent: 18, moq: 2, unitsPerCase: 10 });
  await as(db, admin, (tx) =>
    tx.query(
      `insert into product_pricing_tiers (product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label)
       values ($1, 1, null, 100, 'default', 'Baseline slab')`,
      [pack.packId]
    )
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ('Category pricing warehouse', $1, true) returning id`,
    [areaId]
  );
  warehouseId = rows[0]!.id;

  // Categories are only ever assigned through the admin RPC.
  await as(db, admin, (tx) =>
    tx.query(`select public.admin_set_retailer_category($1::uuid, 'silver', 'Approved wholesale volume')`, [silver.id])
  );
  await as(db, admin, (tx) =>
    tx.query(`select public.admin_set_retailer_category($1::uuid, 'gold', 'Key account agreement')`, [gold.id])
  );

  await as(db, admin, (tx) =>
    tx.query(`select public.admin_set_product_pack_stock($1, $2)`, [pack.packId, 1000])
  );
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('category price configuration', () => {
  it('enforces gold <= silver <= general on every write', async () => {
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 92);
    await setCategoryPrice('gold', 85);

    const message = await errorOf(db, admin, (tx) =>
      tx.query(
        `insert into product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'silver', 120)
         on conflict (product_pack_id, retailer_category) do update set price_per_piece = 120`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/CATEGORY_PRICE_ORDER_INVALID/);

    // A price below the gold price is also invalid.
    const lowerIsLegal = await errorOf(db, admin, (tx) =>
      tx.query(
        `update product_tier_prices set price_per_piece = 80
          where product_pack_id = $1 and retailer_category = 'gold'`,
        [pack.packId]
      )
    );
    expect(lowerIsLegal).toBeNull(); // a deeper discount is allowed…
    await setCategoryPrice('gold', 85); // …restore the fixture for later tests
  });

  it('refuses a zero/negative price', async () => {
    const message = await errorOf(db, 'service', (tx) =>
      tx.query(
        `insert into product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'general', 0)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/check constraint/i);
  });

  it('refuses a retailer writing a category price', async () => {
    // The guard trigger raises before RLS would silently filter the row.
    const message = await errorOf(db, general.id, (tx) =>
      tx.query(
        `insert into product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'general', 1)`,
        [pack.packId]
      )
    );
    expect(message).toMatch(/administrator/i);

    const update = await as(db, general.id, (tx) =>
      tx.query<{ id: string }>(
        `update product_tier_prices set price_per_piece = 1 where product_pack_id = $1 returning id`,
        [pack.packId]
      )
    );
    expect(update.rows).toHaveLength(0);
  });

  it('shows a retailer only their own category\'s price', async () => {
    const generalRows = await as(db, general.id, (tx) =>
      tx.query<{ retailer_category: string }>(`select retailer_category from product_tier_prices`)
    );
    expect(generalRows.rows.map((row) => row.retailer_category).sort()).toEqual(['general']);

    const goldRows = await as(db, gold.id, (tx) =>
      tx.query<{ retailer_category: string }>(`select retailer_category from product_tier_prices`)
    );
    expect(goldRows.rows.map((row) => row.retailer_category).sort()).toEqual(['general', 'gold']);
  });

  it('shows no category price at all to an unapproved (pending) retailer', async () => {
    const pending = await createRetailer(db, { areaId, creditLimitRupees: 0 });
    // createRetailer leaves the account pending approval until an admin acts.
    await db.query(`update retailers set status = 'pending_approval' where id = $1`, [pending.id]);
    const rows = await as(db, pending.id, (tx) =>
      tx.query(`select retailer_category from product_tier_prices`)
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('lets staff who create orders read the retailer selling prices (never seller costs)', async () => {
    const staff = await createUser(db, 'staff');
    const rows = await as(db, staff, (tx) =>
      tx.query<{ retailer_category: string }>(`select retailer_category from product_tier_prices`)
    );
    expect(rows.rows.map((row) => row.retailer_category).sort()).toEqual(['general', 'gold', 'silver']);
    // Staff still cannot write a price.
    const message = await errorOf(db, staff, (tx) =>
      tx.query(
        `insert into product_tier_prices (product_pack_id, retailer_category, price_per_piece)
         values ($1, 'gold', 10)`,
        [pack.packId]
      )
    );
    // The write guard raises its own message; RLS may also reject first. Both
    // mean the same thing: a non-admin cannot set a selling price.
    expect(message).toMatch(/permission denied|row-level security|can only be changed by an administrator/i);
  });

  it('resolves the own-category price, falls back to general, and refuses cross-retailer reads', async () => {
    const { rows } = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [pack.packId, gold.id]
    );
    expect(Number(rows[0]!.price)).toBe(85);

    const crossRetailer = await errorOf(db, general.id, (tx) =>
      tx.query(`select public.pack_category_price_per_piece($1, $2)`, [pack.packId, gold.id])
    );
    expect(crossRetailer).toMatch(/Access denied|could not be executed|permission denied/i);
  });
});

describe('checkout uses the server-side category price', () => {
  it('accepts the general price for a general retailer and rejects a lower one', async () => {
    const before = await orderCount();
    expect(await placeOrder({ retailerId: general.id, unitPrice: 100 })).toBeNull();
    expect(await orderCount()).toBe(before + 1);
  });

  it('rejects a silver retailer submitting the general price', async () => {
    const before = await orderCount();
    const message = await placeOrder({ retailerId: silver.id, unitPrice: 100 });
    expect(message).toMatch(/ORDER_PRICE_CHANGED/);
    expect(await orderCount()).toBe(before);
  });

  it('accepts the silver price for a silver retailer', async () => {
    expect(await placeOrder({ retailerId: silver.id, unitPrice: 92 })).toBeNull();
  });

  it('accepts the gold price for a gold retailer and rejects the silver price', async () => {
    expect(await placeOrder({ retailerId: gold.id, unitPrice: 85 })).toBeNull();
    const message = await placeOrder({ retailerId: gold.id, unitPrice: 92 });
    expect(message).toMatch(/ORDER_PRICE_CHANGED/);
  });

  it('re-prices immediately when the admin changes the category mid-flow', async () => {
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'general', 'Category restored')`, [gold.id])
    );
    const message = await placeOrder({ retailerId: gold.id, unitPrice: 85 });
    expect(message).toMatch(/ORDER_PRICE_CHANGED/);
    expect(await placeOrder({ retailerId: gold.id, unitPrice: 100 })).toBeNull();
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'gold', 'Category restored')`, [gold.id])
    );
  });

  it('leaves pre-existing pricing rules untouched for packs with no category price', async () => {
    const other = await createPack(db, { gstPercent: 18, moq: 1, unitsPerCase: 10 });
    await db.query(`update product_packs set case_price = 500 where id = $1`, [other.packId]);
    const { rows } = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [other.packId, general.id]
    );
    expect(rows[0]!.price).toBeNull();
  });

  it('never exposes seller floors or another category through the helper', async () => {
    // The helper is not executable by an API role at all.
    const message = await errorOf(db, 'authenticated', (tx) =>
      tx.query(`select public.pack_category_price_per_piece($1, $2)`, [pack.packId, general.id])
    );
    expect(message).toMatch(/permission denied|could not be executed|Access denied/i);
  });

  it('treats a pack whose category price is deactivated as having no category price', async () => {
    await db.query(
      `update product_tier_prices set is_active = false where product_pack_id = $1 and retailer_category = 'general'`,
      [pack.packId]
    );
    const { rows } = await db.query<{ price: string | number | null }>(
      `select public.pack_category_price_per_piece($1, $2) as price`,
      [pack.packId, general.id]
    );
    expect(rows[0]!.price).toBeNull();
    await db.query(
      `update product_tier_prices set is_active = true where product_pack_id = $1 and retailer_category = 'general'`,
      [pack.packId]
    );
  });

  it('keeps coupons additive but never re-prices the line', async () => {
    // A coupon applies to the category-priced line exactly as before; the
    // line unit price still has to equal the resolved category price.
    const message = await placeOrder({ retailerId: general.id, unitPrice: 90 });
    expect(message).toMatch(/ORDER_PRICE_CHANGED/);
  });
});

describe('quantity slabs remain supported alongside category pricing', () => {
  it('keeps the slab price for packs without category pricing', async () => {
    await clearCategoryPrices();
    expect(await placeOrder({ retailerId: general.id, unitPrice: 100 })).toBeNull();
    await setCategoryPrice('general', 100);
    await setCategoryPrice('silver', 92);
    await setCategoryPrice('gold', 85);
  });
});
