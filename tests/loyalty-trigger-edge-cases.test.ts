import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let admin: string;
let retailer: string;

describe('0080 Loyalty Trigger Security & Edge Cases', () => {
  beforeAll(async () => {
    db = await createMigratedDb();
    admin = await createUser(db, 'super_admin', 'Admin User');
    retailer = await createUser(db, 'retailer', 'Loyalty Retailer');

    await as(db, admin, (tx: Tx) =>
      tx.query(`update retailers set status='active' where id = $1`, [retailer])
    );
    await db.query(`insert into public.warehouses (name, is_active) values ('Central Loyalty WH', true)`);
  });

  it('does NOT award points on order creation (status=pending)', async () => {
    const orderId = 'c0000000-0000-0000-0000-000000000001';
    await as(db, 'service', async (tx: Tx) => {
      await tx.query(`
        insert into public.orders (
          id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total
        ) values (
          $1, 'ORD-PEND-1', $2, 'pending', 847.46, 152.54, 0, 1000.00
        )
      `, [orderId, retailer]);
    });

    const balRes = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    expect(balRes.rows[0]?.get_retailer_loyalty_balance).toBe(0);
  });

  it('does NOT award points when order transitions through confirmed, processing, dispatched', async () => {
    const orderId = 'c0000000-0000-0000-0000-000000000001';
    await as(db, 'service', async (tx: Tx) => {
      await tx.query(`update public.orders set status = 'confirmed' where id = $1`, [orderId]);
      await tx.query(`update public.orders set status = 'processing' where id = $1`, [orderId]);
    });
    {
      // 0100: an API role (even the service key) can no longer make this
      // transition with a plain UPDATE; it belongs to the atomic fulfilment
      // functions, which run as the database owner. The loyalty rule under
      // test is unchanged, so the step is made the way those functions make it.
      await expect(as(db, 'service', (tx: Tx) => tx.query(`update public.orders set status = 'dispatched' where id = $1`, [orderId]))).rejects.toThrow(/FULFILMENT_GUARD/);
      await db.query(`update public.orders set status = 'dispatched' where id = $1`, [orderId]);
    }

    const balRes = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    expect(balRes.rows[0]?.get_retailer_loyalty_balance).toBe(0);
  });

  it('awards points ONLY when status becomes delivered', async () => {
    const orderId = 'c0000000-0000-0000-0000-000000000001';
    await as(db, 'service', async (tx: Tx) => {
      await tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]);
    });

    const balRes = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    // 1000 rupees / 100 = 10 points (Free plan = 1x multiplier)
    expect(balRes.rows[0]?.get_retailer_loyalty_balance).toBe(10);
  });

  it('does NOT double award points on repeated updates to an already delivered order', async () => {
    const orderId = 'c0000000-0000-0000-0000-000000000001';
    await as(db, 'service', async (tx: Tx) => {
      await tx.query(`update public.orders set notes = 'updated note' where id = $1`, [orderId]);
    });

    const balRes = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    expect(balRes.rows[0]?.get_retailer_loyalty_balance).toBe(10);
  });

  it('handles delivered -> returned reversal safely', async () => {
    const orderId = 'c0000000-0000-0000-0000-000000000001';
    // 1. Returned to warehouse -> points reversed to 0
    {
      // 0100: an API role (even the service key) can no longer make this
      // transition with a plain UPDATE; it belongs to the atomic fulfilment
      // functions, which run as the database owner. The loyalty rule under
      // test is unchanged, so the step is made the way those functions make it.
      await expect(as(db, 'service', (tx: Tx) => tx.query(`update public.orders set status = 'returned' where id = $1`, [orderId]))).rejects.toThrow(/FULFILMENT_GUARD/);
      await db.query(`update public.orders set status = 'returned' where id = $1`, [orderId]);
    }
    const balReturned = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    expect(balReturned.rows[0]?.get_retailer_loyalty_balance).toBe(0);

    // 2. Repeated returned update does not duplicate reversal
    await as(db, 'service', async (tx: Tx) => {
      await tx.query(`update public.orders set notes = 're-checked return' where id = $1`, [orderId]);
    });
    const balRepeated = await as(db, retailer, async (tx: Tx) => {
      return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer]);
    });
    expect(balRepeated.rows[0]?.get_retailer_loyalty_balance).toBe(0);
  });
});
