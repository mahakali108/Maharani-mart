/**
 * release_order_stock — the authorization matrix, EXECUTED.
 *
 * 0017 shipped this SECURITY DEFINER function with no caller check on purpose
 * ("invoked from the orders cancel trigger"), but Supabase's default function
 * privileges made it EXECUTE-able by anon and authenticated, so ANY signed-in
 * account could release another retailer's live stock reservations. 0079 adds
 * the check. This file pins both directions:
 *
 *   allowed   staff, admin, super_admin, service_role, the retailer who owns
 *             the order, a seller holding a child order, a salesman for a
 *             retailer assigned to them, and a JWT-less database session
 *   denied    anon, any other retailer, a seller with no child order, a
 *             salesman for somebody else's retailer, a deactivated admin
 *
 * The allowed set is exactly the set of roles that can already reach this
 * cancellation through RLS (0009 orders_retailer_cancel / orders_salesman_update,
 * 0037 orders_update_staff, 0066/0069 seller sub-orders). Anything wider is a
 * cross-user vulnerability; anything narrower leaves a cancelled order holding
 * reservations forever.
 *
 * Run: corepack pnpm exec vitest run tests/release-stock-authorization.test.ts
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createArea, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let superAdmin: string;
let admin: string;
let staff: string;
let salesManA: string;
let salesManB: string;
let retailerA: string;
let retailerB: string;
let sellerId: string;
let sellerMember: string;
let outsiderSellerMember: string;
let warehouseId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  const area = await createArea(db);

  superAdmin = await createUser(db, 'super_admin');
  admin = await createUser(db, 'admin');
  staff = await createUser(db, 'staff');
  salesManA = await createUser(db, 'salesman');
  salesManB = await createUser(db, 'salesman');

  retailerA = await createUser(db, 'retailer', 'Retailer A', { areaId: area });
  retailerB = await createUser(db, 'retailer', 'Retailer B', { areaId: area });
  // Promoted to active; A is the book of salesManA, B of salesManB.
  await db.query(
    `insert into retailers (id, shop_name, area_id, status, assigned_salesman_id)
     values ($1, 'Shop A', $2, 'active', $3), ($4, 'Shop B', $2, 'active', $5)
     on conflict (id) do update
       set status = 'active', assigned_salesman_id = excluded.assigned_salesman_id`,
    [retailerA, area, salesManA, retailerB, salesManB]
  );

  const { rows } = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ('Matrix WH', $1, true) returning id`,
    [area]
  );
  warehouseId = rows[0]!.id;

  // Marketplace side: one seller with a member, and an unrelated seller member.
  const seller = await db.query<{ id: string }>(
    `insert into sellers (business_name, status) values ('Matrix Seller', 'active') returning id`
  );
  sellerId = seller.rows[0]!.id;
  sellerMember = await createUser(db, 'seller', 'Seller Member');
  outsiderSellerMember = await createUser(db, 'seller', 'Outsider Seller Member');
  await db.query(`insert into seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`, [
    sellerId,
    sellerMember,
  ]);
  const other = await db.query<{ id: string }>(
    `insert into sellers (business_name, status) values ('Other Seller', 'active') returning id`
  );
  await db.query(`insert into seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`, [
    other.rows[0]!.id,
    outsiderSellerMember,
  ]);
}, 180_000);

/** A reserved order for `retailerId`, optionally with a seller child. */
async function seedOrder(
  retailerId: string,
  { sellerChild = null as string | null, collectedBy = null as string | null } = {}
): Promise<string> {
  return as(db, 'service', async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into orders (retailer_id, warehouse_id, request_key, status, collected_by)
       values ($1, $2, $3, 'pending', $4) returning id`,
      [retailerId, warehouseId, randomUUID(), collectedBy]
    );
    const orderId = rows[0]!.id;
    if (sellerChild) {
      await tx.query(
        `insert into sub_orders (parent_order_id, seller_id, fulfilment_type, status)
         values ($1, $2, 'seller', 'pending')`,
        [orderId, sellerChild]
      );
    }
    return orderId;
  });
}

const releaseAs = (who: string, orderId: string) =>
  as(db, who, async (tx) => {
    const { rows } = await tx.query<{ r: { status: string; units_released: number } }>(
      `select public.release_order_stock($1) as r`,
      [orderId]
    );
    return rows[0]!.r;
  });

describe('allowed callers', () => {
  it.each([
    ['super_admin', () => superAdmin],
    ['admin', () => admin],
    ['staff', () => staff],
  ])('%s may release any order', async (_label, who) => {
    const order = await seedOrder(retailerA);
    await expect(releaseAs(who(), order)).resolves.toMatchObject({ status: 'released' });
  });

  it('service_role may release (cron / cancellation jobs)', async () => {
    const order = await seedOrder(retailerA);
    await expect(releaseAs('service', order)).resolves.toMatchObject({ status: 'released' });
  });

  it('the owning retailer may release its own order', async () => {
    const order = await seedOrder(retailerA);
    await expect(releaseAs(retailerA, order)).resolves.toMatchObject({ status: 'released' });
  });

  it('a seller holding a child order may release (sub-order cancellation)', async () => {
    const order = await seedOrder(retailerA, { sellerChild: sellerId });
    await expect(releaseAs(sellerMember, order)).resolves.toMatchObject({ status: 'released' });
  });

  it('a salesman may release for a retailer assigned to them (mirrors 0009 RLS)', async () => {
    const order = await seedOrder(retailerA);
    await expect(releaseAs(salesManA, order)).resolves.toMatchObject({ status: 'released' });
  });

  it('a salesman may release an order they personally collected', async () => {
    const order = await seedOrder(retailerB, { collectedBy: salesManA });
    await expect(releaseAs(salesManA, order)).resolves.toMatchObject({ status: 'released' });
  });

  it('a JWT-less database session (SQL Editor, psql, migration) behaves as before', async () => {
    const order = await seedOrder(retailerA);
    const { rows } = await db.query<{ r: { status: string } }>(
      `select public.release_order_stock($1) as r`,
      [order]
    );
    expect(rows[0]!.r.status).toBe('released');
  });
});

describe('denied callers', () => {
  it('anon cannot call the function at all (0079 revokes EXECUTE)', async () => {
    const order = await seedOrder(retailerA);
    expect(
      await errorOf(db, 'anon', (tx) => tx.query(`select public.release_order_stock($1)`, [order]))
    ).toMatch(/permission denied for function release_order_stock/);
  });

  it('another retailer cannot release a stranger’s reservations', async () => {
    const order = await seedOrder(retailerA);
    expect(
      await errorOf(db, retailerB, (tx) => tx.query(`select public.release_order_stock($1)`, [order]))
    ).toMatch(/not permitted to release stock for this order/);
  });

  it('a seller without a child order here cannot release', async () => {
    const order = await seedOrder(retailerA);
    expect(
      await errorOf(db, outsiderSellerMember, (tx) =>
        tx.query(`select public.release_order_stock($1)`, [order])
      )
    ).toMatch(/not permitted to release stock for this order/);
  });

  it('a seller member of a DIFFERENT seller cannot release', async () => {
    const order = await seedOrder(retailerA, { sellerChild: sellerId });
    expect(
      await errorOf(db, outsiderSellerMember, (tx) =>
        tx.query(`select public.release_order_stock($1)`, [order])
      )
    ).toMatch(/not permitted to release stock for this order/);
  });

  it('a salesman cannot release for another salesman’s retailer', async () => {
    const order = await seedOrder(retailerA);
    expect(
      await errorOf(db, salesManB, (tx) => tx.query(`select public.release_order_stock($1)`, [order]))
    ).toMatch(/not permitted to release stock for this order/);
  });

  it('a deactivated admin cannot release (is_staff_or_above filters is_active)', async () => {
    const order = await seedOrder(retailerA);
    const dormant = await createUser(db, 'admin', 'Dormant Admin');
    await db.query(`update profiles set is_active = false where id = $1`, [dormant]);
    expect(
      await errorOf(db, dormant, (tx) => tx.query(`select public.release_order_stock($1)`, [order]))
    ).toMatch(/not permitted to release stock for this order/);
  });
});

describe('the check does not change what the function does', () => {
  it('is idempotent: a second release is a no-op that reports 0 units', async () => {
    const order = await seedOrder(retailerA);
    await releaseAs(admin, order);
    await expect(releaseAs(admin, order)).resolves.toMatchObject({ status: 'released', units_released: 0 });
  });

  it('still reports order_not_found for a missing id (only to authorised callers)', async () => {
    const missing = randomUUID();
    await expect(releaseAs(admin, missing)).resolves.toMatchObject({ status: 'order_not_found' });
    // An unauthorised caller must not learn even that: the check runs first.
    expect(
      await errorOf(db, retailerB, (tx) => tx.query(`select public.release_order_stock($1)`, [missing]))
    ).toMatch(/not permitted to release stock for this order/);
  });

  it('a retailer cancelling through RLS still releases, exactly once', async () => {
    const order = await seedOrder(retailerA);
    const updated = await as(db, retailerA, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update orders set status = 'cancelled' where id = $1 returning id`,
        [order]
      );
      return rows;
    });
    expect(updated).toHaveLength(1);
    const { rows } = await db.query<{ status: string }>(
      `select status from orders where id = $1`,
      [order]
    );
    expect(rows[0]!.status).toBe('cancelled');
  });

  it('a salesman cancelling an assigned order is not blocked by the release check', async () => {
    // Regression found in review: 0079 v1 refused this with 42501 even though
    // 0009's orders_salesman_update policy allows the UPDATE itself.
    const order = await seedOrder(retailerA);
    const updated = await as(db, salesManA, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update orders set status = 'cancelled' where id = $1 returning id`,
        [order]
      );
      return rows;
    });
    expect(updated).toHaveLength(1);
  });

  it('an admin cancelling somebody else’s order still releases', async () => {
    const order = await seedOrder(retailerB);
    const updated = await as(db, admin, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update orders set status = 'cancelled' where id = $1 returning id`,
        [order]
      );
      return rows;
    });
    expect(updated).toHaveLength(1);
  });
});
